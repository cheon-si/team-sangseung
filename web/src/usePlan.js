import { useEffect, useMemo, useState } from "react";
import { loadJson } from "./data";
import * as engine from "./route";
import { readPreset } from "./settings";

// 경로 엔진(src/route/)과 화면을 잇는 곳. 화면은 엔진을 여기서만 쓴다.

export const serviceDayOf = engine.serviceDayOf;
export const nearestStations = engine.nearestStations;
export const NIGHT_START = engine.WINDOW_START; // 21:00. 이보다 이르면 엔진이 21:00 부터 탐색한다(계약 0장)

const SLOW_PLAN_MS = 100; // planTrip 한 번이 이보다 오래 걸리면 콘솔에 남긴다(같은 입력은 아래 캐시로 다시 계산하지 않음)
const PLAN_CACHE_MAX = 60;

// ── 데이터 읽기 ──
// 기본 자료: 역·노드(network) + B 모형(model_b) + 지연 분포(route_dists, B 채택 전 모형·참고 그래프) + 막차 조합표(prob_table, 선택).
// 화면 0(집 등록)·역 검색·지도 핀은 이것만으로 그린다. 요일 시간표(trips_*)는 아래 useDayData 가 따로 읽는다.
async function loadBase() {
  // 첫 화면에 쓸 요일 시간표(시연 URL의 day, 없으면 오늘 운영일)를 기본 자료와 동시에 받기 시작한다.
  // 예전에는 기본 자료를 다 받고 준비한 뒤에야 요청해, CPU를 4배 느리게 한 측정에서 첫 요약이 2.7초 걸렸다.
  // loadJson 이 Promise 를 보관하므로 useDayData 가 같은 요청을 이어받는다(실패하면 거기서 다시 요청)
  const tag = readPreset().tag ?? engine.serviceDayOf(new Date()).tag;
  loadJson(`trips_${tag}`).catch(() => {});
  const [network, route_dists, model_b, prob_table] = await Promise.all([
    loadJson("network"),
    loadJson("route_dists"),
    loadJson("model_b"), // 환승 확률(B 모형). 없으면 확률을 낼 수 없으니 필수
    // 막차 조합 행 대조용. 못 읽어도 경로·확률 계산은 된다
    loadJson("prob_table").catch(() => null),
  ]);
  return { network, route_dists, model_b, prob_table };
}

export function useRouteData() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "loading", raw: null, data: null });
  useEffect(() => {
    let alive = true;
    loadBase().then(
      (raw) => alive && setState({ status: "ready", raw, data: engine.buildRouteData({ ...raw, trips: {} }) }),
      (error) => alive && setState({ status: "error", raw: null, data: null, error }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = () => {
    setState({ status: "loading", raw: null, data: null });
    setAttempt((a) => a + 1);
  };
  return { ...state, retry };
}

// 요일 시간표(trips_DAY|SAT|END, 각 0.4~0.5MB)는 그 요일을 처음 계산할 때만 읽는다.
// 요일별로 만든 엔진 data 를 보관해, 요일을 오가도 다시 받거나 연결 목록을 다시 만들지 않는다.
const dayCache = new Map(); // tag → 엔진 data

export function useDayData(raw, tag) {
  const [, setLoaded] = useState(0);
  const [failedTag, setFailedTag] = useState(null);
  const cached = dayCache.get(tag);

  useEffect(() => {
    if (!raw || !tag || dayCache.has(tag) || failedTag === tag) return;
    let alive = true;
    loadJson(`trips_${tag}`).then(
      (trips) => {
        if (!dayCache.has(tag)) dayCache.set(tag, engine.buildRouteData({ ...raw, trips: { [tag]: trips } }));
        if (alive) setLoaded((n) => n + 1);
      },
      () => alive && setFailedTag(tag),
    );
    return () => {
      alive = false;
    };
  }, [raw, tag, failedTag]);

  if (cached) return { status: "ready", data: cached };
  if (failedTag === tag) return { status: "error", data: null, retry: () => setFailedTag(null) };
  return { status: "loading", data: null };
}

// ── 귀가 계획 ──
// 같은 입력(출발역·집·요일·시각·걸음 속도·여유 선호)은 다시 계산하지 않는다. 출발 시각 칩을 고르거나 요일·시각·설정을 오갈 때 바로 나온다.
// 21:00 전 시각은 모두 21:00 계산과 같으므로 같은 키로 묶는다.
const planCache = new WeakMap(); // 엔진 data → Map(입력 키 → 결과)

// walkSpeed(m/s)·marginSec(초): 설정 화면의 걸음 속도·여유 선호(settings.js paceOptions). 기본 1.2 · 0
export function usePlan(data, { origin, home, tag, nowSec, walkSpeed = engine.BASE_WALK_SPEED, marginSec = 0 }) {
  return useMemo(() => {
    if (!data || !origin || !home || !tag || nowSec == null) return null;
    return planCached(data, { origin, home, tag, nowSec, walkSpeed, marginSec });
  }, [data, origin, home, tag, nowSec, walkSpeed, marginSec]);
}

function planCached(data, input) {
  let cache = planCache.get(data);
  if (!cache) planCache.set(data, (cache = new Map()));
  const key = [input.origin, input.home, input.tag, Math.max(input.nowSec, NIGHT_START), input.walkSpeed, input.marginSec].join("|");
  if (cache.has(key)) return cache.get(key);

  const t0 = performance.now();
  let result;
  try {
    result = engine.planTrip(data, input);
  } catch (error) {
    console.error("planTrip 실패", error);
    result = { status: "error", best: null, options: [], leave_by: { safe: null, last: null } };
  }
  const ms = performance.now() - t0;
  // 실행 시간은 브라우저 개발자 도구 Performance 탭(또는 performance.getEntriesByName("planTrip"))에서 본다
  try {
    performance.measure("planTrip", { start: t0, duration: ms, detail: key });
  } catch {
    // User Timing 확장을 지원하지 않는 브라우저는 건너뜀
  }
  if (ms > SLOW_PLAN_MS) console.warn(`planTrip ${Math.round(ms)}ms (${key})`);

  cache.set(key, result);
  if (cache.size > PLAN_CACHE_MAX) cache.delete(cache.keys().next().value);
  return result;
}

// 위험한 환승역 화면: 막차 조합표 행(p_b 등은 기본 설정 값)을 걸음 속도·여유 선호로 다시 계산한 행 목록.
// 기본 설정이면 원래 행 그대로. 다시 계산하면 p_b·s90_sec·slack_b_sec·buffer_sec·walk_sec 를 덮어쓴다(엔진 rowProbB, 경로와 같은 규칙)
export function rowsForPace(rawModel, rows, { walkSpeed, marginSec, isDefault }) {
  if (isDefault || !rawModel) return rows;
  const model = engine.buildModelB(rawModel);
  if (!model) return rows;
  return rows.map((r) => (r.p_b == null ? r : { ...r, ...engine.rowProbB(model, r, { walkSpeed, marginSec }) }));
}

// 그 요일 시간표의 마지막 열차 출발 시각(운영일 초). 이 시각이 지나면 "오늘 운행 종료"로 본다.
export function serviceEndOf(data, tag) {
  try {
    const tt = engine.timetableOf(data, tag);
    return tt.nConn > 0 ? tt.cDep[tt.nConn - 1] : null;
  } catch {
    return null;
  }
}

// ── 화면이 엔진 데이터를 읽는 접근자. loadRouteData/buildRouteData 반환 형식이 바뀌면 여기만 고친다. ──
// data.network = route/network.js buildNetwork() 결과(nodes, stations, stationById(Map), lineColors)

const networkOf = (data) => data?.network ?? null;

export const stationListOf = (data) => networkOf(data)?.stations ?? [];

export function stationById(data, id) {
  const net = networkOf(data);
  if (!net || !id) return null;
  return net.stationById?.get(id) ?? null;
}

export const nodeOf = (data, i) => networkOf(data)?.nodes?.[i] ?? null;

export function lineColorOf(data, line) {
  return networkOf(data)?.lineColors?.[line] ?? "#64748b";
}

// nearestStations 의 station 은 물리 역 id 문자열
export const nearestId = (row) => row.station;
