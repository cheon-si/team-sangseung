// 경로 엔진 4/4: 공개 API. 데이터 읽기, 운영일 판정, 가까운 역, 귀가 계획(planTrip). 계약 3장 공개 API.

import { buildNetwork, buildTimetable, lowerBound } from "./network.js";
import { journeyLegs, journeySignature, searchJourney } from "./csa.js";
import { buildDists, buildProbIndex, evaluateJourney } from "./prob.js";

// 달력상 평일이지만 휴일 시간표로 도는 날(토요일 공휴일 포함).
// 출처: 저장소 루트 common.py HOLIDAYS. 파이썬 쪽을 바꾸면 여기도 같이 바꾼다.
// 2027-01-01 까지만 들어 있다. 그 뒤 공휴일은 평일(DAY) 시간표로 계산되니 운영을 이어가면 목록을 늘린다.
export const HOLIDAYS = new Set(["20260924", "20260925", "20260926", "20261003", "20261005", "20261009", "20261225", "20270101"]);

export const WINDOW_START = 75600; // 21:00. 데이터는 이 시각 이후 정차만 있다
const SERVICE_DAY_CUTOFF_HOUR = 3; // 03:00 전이면 전날 운영일
const SAFE_P = 0.8; // leave_by.safe 기준. src/config.js THRESHOLDS.safe 와 같은 값
const MAX_OPTIONS = 12;
const WALK_FACTOR = 1.3; // 직선거리 → 실제 걷는 거리 근사(웹앱_설계.md 3.1)
const WALK_SPEED = 1.2; // m/s
const TAGS = ["DAY", "SAT", "END"];

// 원본 JSON 묶음 → 엔진 data 객체(동기). 테스트와 loadRouteData 가 같이 쓴다.
// raw = { network, trips: {DAY, SAT, END}, route_dists, prob_table? }
export function buildRouteData(raw) {
  return {
    network: buildNetwork(raw.network),
    rawTrips: raw.trips,
    timetables: {}, // 태그 → 연결 배열(처음 쓸 때 만들어 캐시)
    dists: buildDists(raw.route_dists),
    probIndex: buildProbIndex(raw.prob_table),
  };
}

// fetchJson(name) → Promise<object>. prob_table 은 선택(없거나 실패해도 진행)
export async function loadRouteData(fetchJson) {
  const get = (name) => Promise.resolve().then(() => fetchJson(name));
  const [network, DAY, SAT, END, route_dists, prob_table] = await Promise.all([
    get("network"),
    get("trips_DAY"),
    get("trips_SAT"),
    get("trips_END"),
    get("route_dists"),
    get("prob_table").catch(() => null),
  ]);
  return buildRouteData({ network, trips: { DAY, SAT, END }, route_dists, prob_table });
}

export function timetableOf(data, tag) {
  if (!data.timetables[tag]) data.timetables[tag] = buildTimetable(data.rawTrips[tag], data.network.nodes.length);
  return data.timetables[tag];
}

const pad2 = (v) => String(v).padStart(2, "0");

/**
 * 실제 Date → 운영일. 기기 현지 시각(한국 사용자 = KST 가정)으로 읽는다.
 * 03:00 전이면 전날 운영일이고 nowSec 는 86400 이상(02:30 → 95400). 요일 규칙은 common.day_info 와 같다.
 */
export function serviceDayOf(dateObj) {
  const h = dateObj.getHours();
  let nowSec = h * 3600 + dateObj.getMinutes() * 60 + dateObj.getSeconds();
  let day = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  if (h < SERVICE_DAY_CUTOFF_HOUR) {
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
    nowSec += 86400;
  }
  const serviceDate = `${day.getFullYear()}${pad2(day.getMonth() + 1)}${pad2(day.getDate())}`;
  const weekday = day.getDay(); // 0 = 일요일, 6 = 토요일
  let tag = "DAY";
  if (HOLIDAYS.has(serviceDate) || weekday === 0) tag = "END";
  else if (weekday === 6) tag = "SAT";
  return { serviceDate, tag, dayType: tag === "DAY" ? "weekday" : "weekend", nowSec };
}

// 두 좌표 사이 직선거리(m, haversine)
function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 가장 가까운 물리 역 k곳. walk_sec = 직선거리 × 1.3 ÷ 1.2m/s (근사, 확률에는 넣지 않음)
export function nearestStations(data, lat, lon, k = 3) {
  return data.network.stations
    .map((s) => ({ station: s.id, distance_m: distanceM(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, k)
    .map((r) => ({
      station: r.station,
      distance_m: Math.round(r.distance_m),
      walk_sec: Math.round((r.distance_m * WALK_FACTOR) / WALK_SPEED),
    }));
}

// 탐색 결과 → 공개 Journey 객체(legs, 확률, 환승 상세)
function makeJourney(ctx, res) {
  const { tt } = ctx;
  const { p_home, transfers } = evaluateJourney(ctx, res.segments, 0);
  return {
    legs: journeyLegs(ctx.net, tt, res.segments),
    depart_sec: tt.cDep[res.segments[0].board],
    arrive_sec: res.arrive,
    p_home,
    transfers,
  };
}

// a가 b를 지배하는가: 같거나 늦게 출발, 같거나 일찍 도착, 같거나 높은 확률이고 하나라도 낫다.
// 셋 다 같으면 환승이 적은 쪽(같으면 먼저 온 쪽)을 남긴다.
function dominates(a, b, aIdx, bIdx) {
  if (a.depart_sec < b.depart_sec || a.arrive_sec > b.arrive_sec || a.p_home < b.p_home) return false;
  if (a.depart_sec > b.depart_sec || a.arrive_sec < b.arrive_sec || a.p_home > b.p_home) return true;
  const ta = a.journey.transfers.length;
  const tb = b.journey.transfers.length;
  return ta < tb || (ta === tb && aIdx < bIdx);
}

const emptyResult = (status) => ({ status, best: null, options: [], leave_by: { safe: null, last: null } });

/**
 * 귀가 계획. origin/home = 물리 역 id, tag = DAY|SAT|END, nowSec = 운영일 초(21:00 전이면 21:00으로 올림).
 * best    = nowSec 이후 가장 빨리 도착하는 여정. 도착이 같으면 가장 먼저 떠나는 여정(지금 출발해 처음 타는 열차)
 * options = 출발역에서 nowSec 이후 출발하는 열차마다 "그 열차를 첫 열차로 타는" 최선 여정.
 *           도착 불가·같은 여정·출발역을 다시 지나는 여정은 빼고, 출발·도착·확률 모두에서 다른 안보다 못한 안
 *           (늦게 떠나 일찍 도착하는 안이 있는 경우 등)도 뺀 뒤 출발 시각 오름차순으로 마지막 12개.
 *           best 는 지배당하더라도 항상 넣는다(화면의 출발 시각 띠에서 지금 보고 있는 여정이 선택되도록).
 * leave_by.safe = p_home ≥ 0.8 인 가장 늦은 출발, leave_by.last = p_home > 0 인 가장 늦은 출발
 */
export function planTrip(data, { origin, home, tag, nowSec }) {
  const net = data.network;
  const o = net.stationById.get(origin);
  const h = net.stationById.get(home);
  if (!o || !h || !TAGS.includes(tag) || !data.rawTrips?.[tag]) return emptyResult("unsupported");
  if (origin === home) return emptyResult("same_station");

  const tt = timetableOf(data, tag);
  const t0 = Math.max(nowSec, WINDOW_START);
  const ctx = {
    net,
    tt,
    tag,
    dayType: tag === "DAY" ? "weekday" : "weekend",
    dists: data.dists,
    probIndex: data.probIndex,
    homeNodes: h.nodes,
    memo: new Map(), // 놓친 뒤 재탐색 결과. 이번 planTrip 안에서만 쓴다
  };

  const bestRes = searchJourney(net, tt, { startNodes: o.nodes, startSec: t0, homeNodes: h.nodes });
  if (!bestRes) return emptyResult("no_route");

  // 후보: 출발역 노드에서 t0 이후 출발하는 모든 연결(= 열차 출발)
  const originNodes = new Set(o.nodes);
  const seen = new Set();
  const cands = [];
  for (let c = lowerBound(tt.cDep, t0); c < tt.nConn; c++) {
    if (!originNodes.has(tt.cFrom[c])) continue;
    const res = searchJourney(net, tt, { startSec: tt.cDep[c], homeNodes: h.nodes, firstConn: c });
    if (!res || passesOriginAgain(tt, res.segments, originNodes)) continue;
    const sig = journeySignature(res.segments);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const journey = makeJourney(ctx, res);
    cands.push({ depart_sec: journey.depart_sec, arrive_sec: journey.arrive_sec, p_home: journey.p_home, journey });
  }

  // 요약 화면의 대표 여정: 가장 일찍 도착하는 안 중 가장 먼저 떠나는 안(= 지금 출발해 처음 타는 열차).
  // CSA 결과를 그대로 쓰면 같은 시각에 도착하는 더 늦은 출발이 뽑혀, 지금 떠나면 93%인데 "지금 출발해도 63%"로
  // 보이는 경우가 있었다(서울역→강남 00:15 평일: 00:16 출발 93%, 00:27 출발 63%, 둘 다 00:54 도착).
  const byHeadline = (a, b) => a.arrive_sec - b.arrive_sec || a.depart_sec - b.depart_sec
    || a.journey.transfers.length - b.journey.transfers.length || b.p_home - a.p_home;
  const best = cands.length ? [...cands].sort(byHeadline)[0].journey : makeJourney(ctx, bestRes);

  const kept = cands.filter((b, j) => !cands.some((a, i) => i !== j && dominates(a, b, i, j)));
  // best 는 출발 시각 띠에서 빠지지 않게 한다. best 의 첫 열차 후보가 지배당해 빠졌으면(더 늦게 떠나 같은 시각에 닿는 안이 있는 경우)
  // 다시 넣고, 같은 첫 열차 후보가 남아 있으면 best 여정으로 바꿔 요약 숫자와 칩 숫자를 맞춘다.
  const bestOpt = { depart_sec: best.depart_sec, arrive_sec: best.arrive_sec, p_home: best.p_home, journey: best };
  const others = kept.filter((x) => !sameFirstTrain(x.journey, best));
  const all = [...others, bestOpt].sort((a, b) => a.depart_sec - b.depart_sec || a.arrive_sec - b.arrive_sec);

  // 지배당한 안을 빼도 "가장 늦은 출발"은 남는다(그보다 늦게 떠나며 확률이 같거나 높은 안이 대신 남으므로)
  const latest = (ok) => {
    for (let i = all.length - 1; i >= 0; i--) {
      if (ok(all[i].p_home)) return { depart_sec: all[i].depart_sec, p_home: all[i].p_home };
    }
    return null;
  };
  // 마지막 12개. best 가 잘려 나가면 맨 앞에 두고 나머지 11개
  let options = all.slice(-MAX_OPTIONS);
  if (!options.includes(bestOpt)) options = [bestOpt, ...all.slice(-(MAX_OPTIONS - 1))];
  return {
    status: "ok",
    best,
    options,
    leave_by: { safe: latest((p) => p >= SAFE_P), last: latest((p) => p > 0) },
  };
}

// 두 여정의 첫 열차가 같은가(같은 열차를 같은 정차에서 탐)
function sameFirstTrain(a, b) {
  const ra = a.legs[0];
  const rb = b.legs[0];
  return ra.line === rb.line && ra.trip === rb.trip && ra.from_node === rb.from_node && ra.dep === rb.dep;
}

// 두 번째 이후 탑승 구간이 출발 물리 역을 다시 지나는가. 예: 개봉에서 반대 방향으로 한 정거장(오류동) 갔다가
// 개봉을 다시 지나 돌아오는 여정. 그 역에서 나중 열차를 바로 타는 후보가 따로 있으므로 options 후보에서 뺀다.
function passesOriginAgain(tt, segments, originNodes) {
  for (let k = 1; k < segments.length; k++) {
    const last = tt.cStop[segments[k].alight] + 1;
    for (let s = tt.cStop[segments[k].board]; s <= last; s++) {
      if (originNodes.has(tt.stopNode[s])) return true;
    }
  }
  return false;
}
