// 걸음 속도·여유 선호(옵션 { walkSpeed, marginSec }) 테스트. 합성 노선망(손 계산)과 실제 데이터(web/public/data) 둘 다 쓴다.
// 실행: node --test "web/src/route/*.test.js"

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildRouteData, planTrip } from "./plan.js";
import { buildModelB, rowProbB, transferProbB, walkB } from "./prob.js";
import { netForSpeed, walkSecFor } from "./network.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`);

// ── 합성 노선망 ──────────────────────────────────────────────
// A(1호선) → B 환승 → 2호선 → E(집). 1001 이 B 에 83400 도착, 2001 이 B 에서 83550 출발(시간표 간격 150초).
// B 모형 = 계수 0, 잔차 {-60, -30, 0, 30} → p = P(잔차 ≥ c − S).
const NODE_IDS = ["1:A", "1:B", "2:B", "2:E"];
const IDX = new Map(NODE_IDS.map((id, i) => [id, i]));

function makeRaw({ distance = 144, withU2 = true } = {}) {
  const nodes = NODE_IDS.map((id, i) => {
    const [line, nm] = id.split(":");
    return { id, line, nm, station: nm, lat: 37.5 + i * 0.001, lon: 127.0 };
  });
  const stations = [];
  nodes.forEach((n, i) => {
    let s = stations.find((x) => x.id === n.station);
    if (!s) stations.push((s = { id: n.station, name: n.station, lines: [], lat: n.lat, lon: n.lon, nodes: [] }));
    s.lines.push(n.line);
    s.nodes.push(i);
  });
  // walk_sec 은 실제 자료처럼 round(거리 ÷ 1.2)
  const tr = (f, t) => ({ from: IDX.get(f), to: IDX.get(t), walk_sec: Math.round(distance / 1.2), distance_m: distance, src: "csv", same_line: false });
  const trip = (line, code, stops) => ({
    line, code, dir: "UP", express: false, dest: stops.at(-1)[0].split(":")[1],
    stops: stops.map(([id, arr, dep]) => [IDX.get(id), arr, dep, 0]),
  });
  const trips = [
    trip("1", "1001", [["1:A", null, 82000], ["1:B", 83400, null]]),
    trip("2", "2001", [["2:B", null, 83550], ["2:E", 84000, null]]),
    withU2 && trip("2", "2002", [["2:B", null, 83700], ["2:E", 84150, null]]), // 2001 을 못 타면 탈 다음 열차
  ].filter(Boolean);
  return {
    network: { meta: {}, line_colors: {}, nodes, stations, transfers: [tr("1:B", "2:B"), tr("2:B", "1:B")] },
    trips: { DAY: { meta: {}, trips }, SAT: { meta: {}, trips: [] }, END: { meta: {}, trips: [] } },
    route_dists: { meta: { lastk_a_lines: [], band_members: {} }, arr_cells: {}, arr_last3: {}, dep_last3: {}, dep_all: {} },
    model_b: { meta: {}, coef: { 절편: 0, el10: 0 }, resid: [-60, -30, 0, 30] },
  };
}

const plan = (raw, opts = {}) => planTrip(buildRouteData(raw), { origin: "A", home: "E", tag: "DAY", nowSec: 81000, ...opts });

test("기본 옵션: 옵션을 안 주거나 { walkSpeed: 1.2, marginSec: 0 } 이면 결과가 같고, 1.2m/s 탐색망은 원본 그대로", () => {
  const raw = makeRaw();
  assert.deepEqual(plan(raw, { walkSpeed: 1.2, marginSec: 0 }), plan(raw));
  const net = buildRouteData(raw).network;
  assert.equal(netForSpeed(net, 1.2), net);
  // 실제 환승 자료: walk_sec = round(거리 ÷ 1.2) 이므로 1.2m/s 도보는 walk_sec 과 정확히 같다
  const real = JSON.parse(readFileSync(new URL("../../public/data/network.json", import.meta.url), "utf8"));
  for (const t of real.transfers) assert.equal(walkSecFor(t.distance_m ?? null, t.walk_sec, 1.2), t.walk_sec);
  assert.equal(walkSecFor(null, 133, 1.2), 133); // 거리가 없으면 walk_sec × 1.2 ÷ 속도
  assert.equal(walkSecFor(null, 120, 1.0), 144);
  assert.equal(walkB(null, 133), 133);
  close(walkB(null, 120, 1.0), 144);
});

test("느린 걸음: W 가 늘어 p 가 준다(거리 144m: 1.2 → 120초 S 30 p .75, 1.0 → 144초 S 6 p .5)", () => {
  const raw = makeRaw({ distance: 144 });
  const t12 = plan(raw).best.transfers[0];
  assert.equal(t12.walk_sec, 120);
  close(t12.slack_sec, 30);
  close(t12.p, 0.75);
  const t10 = plan(raw, { walkSpeed: 1.0 }).best.transfers[0];
  assert.equal(t10.dep_D, 83550); // 같은 열차를 그대로 탄다
  assert.equal(t10.walk_sec, 144);
  assert.equal(t10.buffer_sec, 6);
  close(t10.slack_sec, 6);
  close(t10.p, 0.5); // 잔차 ≥ −6: 0, 30
  // 빠른 걸음: 144 ÷ 1.4 = 102.86초(탐색은 103초), S 47.14 → 잔차 ≥ −47.14: −30, 0, 30 → .75
  const t14 = plan(raw, { walkSpeed: 1.4 }).best.transfers[0];
  assert.equal(t14.walk_sec, 103);
  close(t14.slack_sec, 150 - 144 / 1.4);
  close(t14.p, 0.75);
});

test("탐색 경계: 도보 = 시간표 간격이면 탈 수 있고, 1초라도 넘으면 탐색에서 그 환승이 빠진다", () => {
  // 거리 150m, 1.0m/s → 도보 150초 = 간격 150초 → 2001 탐(S 0, p = P(잔차 ≥ 0) = .5)
  const at = plan(makeRaw({ distance: 150 }), { walkSpeed: 1.0 }).best.transfers[0];
  assert.equal(at.dep_D, 83550);
  assert.equal(at.buffer_sec, 0);
  close(at.p, 0.5);
  // 거리 151m: 1.2m/s 면 126초로 2001 을 타지만, 1.0m/s 면 151초 > 150초라 다음 열차 2002 로 간다
  const raw = makeRaw({ distance: 151 });
  assert.equal(plan(raw).best.transfers[0].dep_D, 83550);
  const slow = plan(raw, { walkSpeed: 1.0 });
  assert.equal(slow.best.transfers[0].dep_D, 83700);
  assert.equal(slow.best.arrive_sec, 84150);
  // 다음 열차가 없으면 느린 걸음에서는 시간표상 집에 못 간다(확률 계산 전에 탐색이 막는다)
  const only = makeRaw({ distance: 151, withU2: false });
  assert.equal(plan(only).status, "ok");
  assert.equal(plan(only, { walkSpeed: 1.0 }).status, "no_route");
});

test("탐색과 확률이 같은 걸음: 느린 걸음의 놓친 뒤 재탐색(q)도 그 속도의 도보로 출발 시각을 잡는다", () => {
  // 1.0m/s, 거리 144m: 2001 을 놓친 시점 = 83550 − 144 + 1 → 2:B 에 그 + 144 = 83551 에 닿아 2002(83700)를 탄다 → q = 1
  const r = plan(makeRaw({ distance: 144 }), { walkSpeed: 1.0 });
  const t0 = r.best.transfers[0];
  assert.equal(t0.q, 1);
  close(r.best.p_home, 0.5 + 0.5 * 1);
});

test("여유 선호 30초: p = P(잔차 ≥ 30 − S − ŷ), 필요 여유 S90·S80 은 +30초 (손 계산)", () => {
  // prob.test.js 와 같은 손 계산 모형: 잔차 10개, ŷ = 10 + 20 − 50 − 15.5 = −35.5, S = 46
  const MB = buildModelB({
    coef: { 절편: 10, "F[8호선]": 20, "L[9호선]": -50, el10: -2 },
    resid: [-40, -20, -20, 0, 10, 30, 50, 60, 80, 100],
  });
  const q = { aLine: "8", aCode: "8101", aStart: 90000 - 4650, arrA: 90000, dLine: "9", dCode: "9201", depD: 90100, walkW: 54, dayType: "weekday" };
  const base = transferProbB(MB, q);
  const m30 = transferProbB(MB, { ...q, marginSec: 30 });
  close(base.p, 0.7); // 문턱 0 − 46 + 35.5 = −10.5 → −40, −20, −20 실패
  close(m30.p, 0.5); // 문턱 30 − 46 + 35.5 = 19.5 → −40, −20, −20, 0, 10 실패 → .5
  close(m30.slack, base.slack); // 시간표 여유 S 자체는 그대로
  close(m30.yhat, base.yhat);
  close(m30.s90, base.s90 + 30); // 20 + 35.5 + 30
  close(m30.s90, 85.5);
  close(m30.s80, base.s80 + 30);
  // 경로에서도: S 30, ŷ 0, c 30 → 잔차 ≥ 0: 0, 30 → .5, S90 = 60 + 30
  const t = plan(makeRaw({ distance: 144 }), { marginSec: 30 }).best.transfers[0];
  close(t.p, 0.5);
  close(t.s90, 90);
  assert.equal(t.margin_sec, 30);
  assert.equal(t.buffer_sec, 30); // 탐색(시간표 여유)은 여유 선호와 무관
});

// ── 실제 데이터 ──────────────────────────────────────────────
const DATA = new URL("../../public/data/", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, DATA), "utf8"));
const realRaw = () => ({
  network: readJson("network"),
  trips: { DAY: readJson("trips_DAY"), SAT: readJson("trips_SAT"), END: readJson("trips_END") },
  route_dists: readJson("route_dists"),
  model_b: readJson("model_b"),
  prob_table: readJson("prob_table"),
});

test("위험한 환승역 재계산(rowProbB): 기본 설정이면 prob_table p_b·s90_sec·slack_b_sec 와 같다(반올림 오차만)", () => {
  const model = buildModelB(readJson("model_b"));
  const rows = readJson("prob_table").rows.filter((r) => r.p_b != null);
  for (const r of rows) {
    const x = rowProbB(model, r);
    assert.ok(Math.abs(x.p_b - r.p_b) <= 5e-5 + 1e-12, `${r.combo_id} ${r.tt_tag}: ${x.p_b} vs ${r.p_b}`);
    assert.ok(Math.abs(x.s90_sec - r.s90_sec) <= 0.05 + 1e-9, `${r.combo_id} s90`);
    assert.ok(Math.abs(x.slack_b_sec - r.slack_b_sec) <= 0.05 + 1e-9, `${r.combo_id} slack`);
    assert.equal(x.buffer_sec, r.buffer_sec);
    assert.equal(x.walk_sec, r.walk_sec);
  }
});

test("실제 데이터: 시연 프리셋 경로의 환승 p 가 같은 막차 조합 행의 rowProbB 값과 같다(기본·느림·넉넉하게)", () => {
  const data = buildRouteData(realRaw());
  const model = data.modelB;
  const presets = [["강남", "천호", 87300], ["서울역", "강남", 87600], ["장한평", "잠실", 88500], ["마포", "잠실", 86700]];
  let matched = 0;
  for (const opts of [{}, { walkSpeed: 1.0 }, { marginSec: 60 }, { walkSpeed: 1.0, marginSec: 60 }, { walkSpeed: 1.4, marginSec: 30 }]) {
    for (const [origin, home, nowSec] of presets) {
      const r = planTrip(data, { origin, home, tag: "DAY", nowSec, ...opts });
      for (const o of r.options) {
        for (const t of o.journey.transfers) {
          if (!t.prob_row) continue;
          const x = rowProbB(model, t.prob_row, opts);
          close(x.p_b, t.p);
          close(x.s90_sec, t.s90);
          assert.equal(x.buffer_sec, t.buffer_sec);
          matched++;
        }
      }
    }
  }
  assert.ok(matched > 0);
});

test("실제 데이터: 기본 설정 시연 프리셋 숫자 그대로(강남→천호 99.8%, 홍대입구→신목동 65.1%, 장한평→잠실 30.5%)", () => {
  const data = buildRouteData(realRaw());
  const p = (origin, home, nowSec, opts = {}) => planTrip(data, { origin, home, tag: "DAY", nowSec, ...opts }).best.p_home;
  assert.equal(p("강남", "천호", 87300).toFixed(3), "0.998");
  // 아슬아슬 프리셋은 서울역→강남 00:20(60.9%, 사당 2호선 환승이라 "확률 신뢰 낮음"이 함께 뜸)에서 홍대입구→신목동 00:45 로 바꿨다
  assert.equal(p("홍대입구", "신목동", 89100).toFixed(3), "0.651");
  // 위험 프리셋은 마포→잠실 00:05 에서 장한평→잠실 00:35 로 바꿨다(같은 천호 5→8 막차 환승, 여유 1초).
  // 마포는 귀가 확률 기준 선택에서 을지로4가·성수 경유 81.1% 가 뽑혀 위험 사례가 아니게 됐다(아래 테스트)
  assert.equal(p("장한평", "잠실", 88500).toFixed(3), "0.305");
  // 넉넉하게(60초)면 같은 여정의 확률이 줄어든다
  assert.ok(p("서울역", "강남", 87600, { marginSec: 60 }) < 0.609);
  assert.ok(p("장한평", "잠실", 88500, { marginSec: 60 }) < 0.305);
});

test("실제 데이터: 마포→잠실 00:05 는 걸음과 상관없이 을지로4가·성수 경유(느리게 걸으면 더 안전해 보이던 역전이 없다)", () => {
  // 예전 규칙(가장 이른 도착 중 탑승 수 최소)은 기본 걸음에서 천호 5→8(여유 1초, 30.5%)을 골랐고, 느린 걸음에서는 천호 환승이
  // 시간표상 불가능해져 을지로4가·성수 경유(79.7%)로 바뀌어 느리게 걸을수록 확률이 높아 보였다. 셋 다 00:54 도착
  const data = buildRouteData(realRaw());
  const stations = (j) => j.transfers.map((t) => t.at_station);
  const base = planTrip(data, { origin: "마포", home: "잠실", tag: "DAY", nowSec: 86700 }).best;
  const slow = planTrip(data, { origin: "마포", home: "잠실", tag: "DAY", nowSec: 86700, walkSpeed: 1.0 }).best;
  assert.deepEqual(stations(base), ["을지로4가", "성수"]);
  assert.deepEqual(stations(slow), ["을지로4가", "성수"]);
  assert.equal(base.p_home.toFixed(3), "0.811");
  assert.equal(slow.p_home.toFixed(3), "0.797");
  assert.ok(slow.p_home <= base.p_home);
});
