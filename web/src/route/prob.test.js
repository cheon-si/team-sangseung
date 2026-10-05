// 확률 모형 단위 테스트. 손으로 계산할 수 있는 작은 계수·잔차(B 모형)와 표본(B 채택 전 모형), 합성 노선망을 쓴다.
// 실행: node --test "web/src/route/*.test.js"   (디렉터리만 주면 Node 24에서 테스트 파일을 돌리지 않는다)

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRouteData, planTrip, timetableOf } from "./plan.js";
import { searchJourney } from "./csa.js";
import {
  buildDists,
  buildModelB,
  evaluateJourney,
  hourBandOf,
  lineLabelB,
  pickArrDist,
  pickDepDist,
  predictDeltaB,
  probB,
  requiredSlackB,
  routeProbability,
  transferProb,
  transferProbB,
  walkB,
} from "./prob.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`);

// 표본 하나를 분포 객체로(buildDists 를 거쳐 실제 경로와 같은 형식으로 만든다)
function distOf(samples) {
  return buildDists({ meta: {}, dep_all: { "9|weekday": { samples } } }).depAll.get("9|weekday");
}

// ── B 모형: ŷ, p = 1 − #(잔차 < −S − ŷ)/n, 필요 여유 ─────────────

// 손 계산용 모형: 잔차 10개(정렬), 계수는 절편 10 · 도착 8호선 +20 · 환승 9호선 −50 · 주말 −5 · el10 −2
const MB = buildModelB({
  coef: { 절편: 10, "F[8호선]": 20, "L[9호선]": -50, "daytype[주말·공휴일]": -5, el10: -2 },
  resid: [-40, -20, -20, 0, 10, 30, 50, 60, 80, 100],
});

test("B ŷ: 절편 + F + L + 주말 + el10 계수 × el10 (없는 범주 = 기준 0)", () => {
  close(predictDeltaB(MB, "8호선", "9호선", false, 3), 10 + 20 - 50 - 6); // −26
  close(predictDeltaB(MB, "8호선", "9호선", true, 3), 10 + 20 - 50 - 5 - 6); // 주말 −5
  close(predictDeltaB(MB, "1호선", "1호선", false, 0), 10); // 기준 노선은 절편만
});

test("B p: 1 − #(잔차 < −S − ŷ)/n, 잔차 = 문턱이면 성공(side=left)", () => {
  const yhat = -26;
  close(probB(MB, 0, yhat), 0.5); // 문턱 26: −40,−20,−20,0,10 → 5개 미만 → .5
  close(probB(MB, -4, yhat), 0.5); // 문턱 30: 잔차 30 은 30 미만이 아님 → 성공
  close(probB(MB, -5, yhat), 0.4); // 문턱 31: 30 도 실패 → 6개
  close(probB(MB, 1000, yhat), 1);
  close(probB(MB, -1000, yhat), 0);
});

test("B 필요 여유: p ≥ 목표가 되는 최소 S = −잔차[⌊n(1−목표)⌋] − ŷ (동률 포함)", () => {
  const yhat = -26;
  // 90%: k = 1 → 잔차[1] = −20 → S90 = 20 + 26 = 46
  close(requiredSlackB(MB, yhat, 0.9), 46);
  close(probB(MB, 46, yhat), 0.9);
  assert.ok(probB(MB, 45.9, yhat) < 0.9); // 조금이라도 작으면 −20 두 개가 실패 → .7
  // 80%: k = 2 → 잔차[2] = −20(동률) → S80 = 46 (45.9 면 .7 < .8)
  close(requiredSlackB(MB, yhat, 0.8), 46);
  assert.ok(probB(MB, 45.9, yhat) < 0.8);
  // 70%: k = 3 → 잔차[3] = 0 → S70 = 26
  close(requiredSlackB(MB, yhat, 0.7), 26);
  close(probB(MB, 26, yhat), 0.7);
  assert.ok(probB(MB, 25.9, yhat) < 0.7);
});

test("B 필요 여유: n(1 − 목표)가 정수일 때 부동소수 오차로 k 가 하나 작아지지 않는다(n = 4160)", () => {
  const big = buildModelB({ coef: { 절편: 0, el10: 0 }, resid: Array.from({ length: 4160 }, (_, i) => i) });
  const s90 = requiredSlackB(big, 0, 0.9); // k = 416 → −416
  assert.equal(s90, -416);
  assert.ok(probB(big, s90, 0) >= 0.9);
  assert.ok(probB(big, s90 - 0.5, 0) < 0.9);
});

test("2호선 지선 판정: 2호선이면서 열차코드가 2로 시작하지 않으면 지선", () => {
  assert.equal(lineLabelB("2", "2301"), "2호선");
  assert.equal(lineLabelB("2", "1685"), "2호선지선"); // 성수지선
  assert.equal(lineLabelB("2", "5612"), "2호선지선"); // 신정지선
  assert.equal(lineLabelB("1", "K504"), "1호선");
  assert.equal(lineLabelB("8", "8238"), "8호선");
});

test("transferProbB: 주말 계수, el10 = (도착 − 시발 출발)/600, S = 출발 − 도착 − W", () => {
  const base = { aLine: "8", aCode: "8101", arrA: 90000, dLine: "9", dCode: "9201", depD: 90100, walkW: 54 };
  // 시발 출발 = 도착 − 4650초 → el10 = 7.75 → ŷ = 10 + 20 − 50 − 15.5 = −35.5, S = 46
  const wd = transferProbB(MB, { ...base, aStart: 90000 - 4650, dayType: "weekday" });
  close(wd.el10, 7.75);
  close(wd.yhat, -35.5);
  close(wd.slack, 46);
  close(wd.p, 0.7); // 문턱 −10.5 → 잔차 −40, −20, −20 실패 → .7
  close(wd.s90, 20 + 35.5);
  assert.equal(wd.fLabel, "8호선");
  assert.equal(wd.lLabel, "9호선");
  const we = transferProbB(MB, { ...base, aStart: 90000 - 4650, dayType: "weekend" });
  close(we.yhat, -40.5); // 주말 −5
  // 시발 시각이 없으면 el10 = 0
  close(transferProbB(MB, { ...base, aStart: null, dayType: "weekday" }).yhat, -20);
  // W: 거리 ÷ 1.2, 거리가 없으면 환승 소요시간
  close(walkB(159, 133), 132.5);
  assert.equal(walkB(null, 133), 133);
});

// ── B 채택 전 모형(남겨 둔 코드): p = Σ_δ w_δ · F_A(B + δ) ─────

test("손 계산 표본: A {-10:.25, 0:.25, 20:.5}, D {0:.5, 10:.5}", () => {
  const A = distOf([[-10, 0.25], [0, 0.25], [20, 0.5]]);
  const D = distOf([[0, 0.5], [10, 0.5]]);
  // B=10: .5·F(10) + .5·F(20) = .5·.5 + .5·1 = .75  (F는 a ≤ x 를 포함: F(20) = 1)
  close(transferProb(A, D, 10), 0.75);
  // B=0: .5·F(0) + .5·F(10) = .5·.5 + .5·.5 = .5
  close(transferProb(A, D, 0), 0.5);
  // B=-15: .5·F(-15) + .5·F(-5) = 0 + .5·.25 = .125
  close(transferProb(A, D, -15), 0.125);
  // 충분히 크면 1, 충분히 작으면 0
  close(transferProb(A, D, 100), 1);
  close(transferProb(A, D, -100), 0);
});

test("가중치 합이 반올림으로 1에서 어긋나도 합으로 나눠 F(∞) = 1", () => {
  // route_dists.json 가중치는 소수 6자리라 합이 0.99998·1.00002 처럼 어긋난다
  const lo = distOf([[0, 0.333333], [10, 0.333333], [20, 0.333333]]); // 합 0.999999
  const hi = distOf([[0, 0.500011], [10, 0.500011]]); // 합 1.000022
  close(transferProb(lo, lo, 1000), 1, 1e-12); // 정규화가 없으면 0.999998
  close(transferProb(hi, lo, 1000), 1, 1e-12);
  // B=5: .5·F_lo(5) + .5·F_lo(15) = .5·(1/3) + .5·(2/3) = .5 (정규화 후 정확히)
  close(transferProb(lo, hi, 5), 0.5, 1e-12);
});

test("이중합 P(δA − δD ≤ B) 와 같다(여러 B)", () => {
  const a = [[-30, 0.1], [-5, 0.2], [0, 0.15], [25, 0.3], [90, 0.25]];
  const d = [[-10, 0.3], [0, 0.4], [35, 0.3]];
  const A = distOf(a);
  const D = distOf(d);
  for (const B of [-200, -60, -15, 0, 5, 30, 61, 120, 400]) {
    let brute = 0;
    for (const [x, wa] of a) for (const [y, wd] of d) if (x - y <= B) brute += wa * wd;
    close(transferProb(A, D, B), brute);
  }
});

test("밤 균등 가중치면 Python conv_matrix 의 밤 평균과 같다", () => {
  // 밤1 A 표본 {0, 60}(각 1/(2·2)), 밤2 A 표본 {30}(1/(2·1)). D 는 지연 0 한 점.
  // Python: mean_i F_A,i(30) = (0.5 + 1.0) / 2 = 0.75
  const A = distOf([[0, 0.25], [30, 0.5], [60, 0.25]]);
  const D = distOf([[0, 1]]);
  close(transferProb(A, D, 30), 0.75);
});

test("분포가 없을 때: D 없음 → F_A(B), A 없음 → P(δD ≥ −B), 둘 다 없음 → 1[B ≥ 0]", () => {
  const A = distOf([[-10, 0.25], [0, 0.25], [20, 0.5]]);
  const D = distOf([[0, 0.5], [10, 0.5]]);
  close(transferProb(A, null, 0), 0.5);
  close(transferProb(null, D, -5), 0.5); // δD ≥ 5 → 10 만 → .5
  assert.equal(transferProb(null, null, 0), 1);
  assert.equal(transferProb(null, null, -1), 0);
});

// ── 분포 선택 규칙 ──────────────────────────────────────────

const S = (v) => ({ samples: [[v, 1]], n_nights: 3, fallback: null });
const DISTS = buildDists({
  meta: { round_sec: 5, band_members: { 22: ["22"], "23-24": ["23", "24"] }, lastk_a_lines: ["2"] },
  arr_cells: {
    "2|weekday|22": { line: "2", day_type: "weekday", hour_band: "22", ...S(1) },
    "2|weekday|23-24": { line: "2", day_type: "weekday", hour_band: "23-24", ...S(2) },
    "3|weekday|22": { line: "3", day_type: "weekday", hour_band: "22", ...S(3) },
    "3|weekday|23-24": { line: "3", day_type: "weekday", hour_band: "23-24", ...S(4) },
    "2|weekend|22": { line: "2", day_type: "weekend", hour_band: "22", ...S(5) },
  },
  arr_last3: { "2|weekday": S(6), "3|weekday": S(7) },
  dep_last3: { "3|weekday": S(8) },
  dep_all: { "3|weekday": S(9), "2|weekday": S(10) },
});

test("시간대: 22시 전 → 22, 22시대 → 22, 23시대 → 23, 24시 이후 → 24", () => {
  assert.equal(hourBandOf(75600), "22");
  assert.equal(hourBandOf(79199), "22");
  assert.equal(hourBandOf(79200), "22");
  assert.equal(hourBandOf(82799), "22");
  assert.equal(hourBandOf(82800), "23");
  assert.equal(hourBandOf(86399), "23");
  assert.equal(hourBandOf(86400), "24");
  assert.equal(hourBandOf(95000), "24");
});

test("A 분포: lastk_a_lines 노선 + flags&1 이면 arr_last3", () => {
  assert.equal(pickArrDist(DISTS, "2", "weekday", 83000, 1).key, "2|weekday|last3");
  assert.equal(pickArrDist(DISTS, "2", "weekday", 80000, 1 | 2 | 4).key, "2|weekday|last3");
});

test("A 분포: flags&1 이 아니거나 lastk 노선이 아니면 시간표 도착 시간대의 셀(band_members)", () => {
  assert.equal(pickArrDist(DISTS, "2", "weekday", 83000, 0).key, "2|weekday|23-24"); // 23시대 → 23-24 셀
  assert.equal(pickArrDist(DISTS, "2", "weekday", 87000, 2).key, "2|weekday|23-24"); // 24시대, flags 2 는 A 와 무관
  assert.equal(pickArrDist(DISTS, "3", "weekday", 80000, 1).key, "3|weekday|22"); // 3호선은 lastk 아님
  assert.equal(pickArrDist(DISTS, "3", "weekday", 78000, 0).key, "3|weekday|22"); // 22시 전 → 22
  // lastk 노선이라도 arr_last3 에 그 요일 키가 없으면 셀로
  assert.equal(pickArrDist(DISTS, "2", "weekend", 80000, 1).key, "2|weekend|22");
  // 셀이 없으면 null
  assert.equal(pickArrDist(DISTS, "2", "weekend", 83000, 0), null);
  assert.equal(pickArrDist(DISTS, "9", "weekday", 83000, 0), null);
});

test("D 분포: flags&2 이면 dep_last3, 아니면 dep_all", () => {
  assert.equal(pickDepDist(DISTS, "3", "weekday", 2).key, "dep_last3:3|weekday");
  assert.equal(pickDepDist(DISTS, "3", "weekday", 2 | 4).key, "dep_last3:3|weekday");
  assert.equal(pickDepDist(DISTS, "3", "weekday", 0).key, "dep_all:3|weekday");
  assert.equal(pickDepDist(DISTS, "3", "weekday", 1).key, "dep_all:3|weekday"); // flags 1 은 D 와 무관
  assert.equal(pickDepDist(DISTS, "9", "weekday", 2), null);
});

// ── 경로 확률 ───────────────────────────────────────────────

test("경로 공식: P = Π p + Σ (Π_{j<k} p_j)(1 − p_k) q_k", () => {
  // .8·.9 + .2·.5 + .8·.1·.3 = .72 + .1 + .024
  close(routeProbability([0.8, 0.9], [0.5, 0.3]), 0.844);
  close(routeProbability([], []), 1); // 환승 없는 경로
  close(routeProbability([0.6], [0]), 0.6); // 결정적 환승 하나
});

// 합성 노선망: A(1) → B 환승(도보 120) → 2호선 → E 환승(도보 60) → 3호선 → F(집)
// B 모형 = 계수 0, 잔차 {-60, -30, 0, 30} → p = P(잔차 ≥ −S): S = 30 → .75, S ≥ 60 → 1
// (B 채택 전 모형으로 돌리면 A 분포 {-30, 0, 30, 60} 각 .25, D 지연 0 → p = F_A(B) 로 같은 값이 나온다)
const NODE_IDS = ["1:A", "1:B", "2:B", "2:E", "3:E", "3:F"];
const IDX = new Map(NODE_IDS.map((id, i) => [id, i]));

function makeRaw({ withU2 = true, withV2 = true, withV3 = false, probRows = null, withModel = true } = {}) {
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
  const tr = (f, t, w) => ({ from: IDX.get(f), to: IDX.get(t), walk_sec: w, src: "csv", same_line: false });
  const trip = (line, code, stops) => ({
    line,
    code,
    dir: "UP",
    express: false,
    dest: stops.at(-1)[0].split(":")[1],
    stops: stops.map(([id, arr, dep, flags = 0]) => [IDX.get(id), arr, dep, flags]),
  });
  const trips = [
    trip("1", "1001", [["1:A", null, 82000], ["1:B", 83400, null]]),
    trip("2", "2001", [["2:B", null, 83550], ["2:E", 84000, null]]), // B 환승 여유 30초 → .75
    withU2 && trip("2", "2002", [["2:B", null, 83700], ["2:E", 84150, null]]), // 2001 을 놓치면 탈 다음 열차
    trip("3", "3001", [["3:E", null, 84090], ["3:F", 84600, null]]), // E 환승 여유 30초 → .75
    withV2 && trip("3", "3002", [["3:E", null, 84240], ["3:F", 84800, null]]),
    withV3 && trip("3", "3003", [["3:E", null, 84400], ["3:F", 85000, null]]),
  ].filter(Boolean);
  const A = { samples: [[-30, 0.25], [0, 0.25], [30, 0.25], [60, 0.25]], n_nights: 9, fallback: null };
  const cell = (line) => ({ line, day_type: "weekday", hour_band: "all", n_nights: 9, ...A });
  const D = { samples: [[0, 1]], n_nights: 9, fallback: null };
  return {
    network: {
      meta: {},
      line_colors: {},
      nodes,
      stations,
      transfers: [tr("1:B", "2:B", 120), tr("2:B", "1:B", 120), tr("2:E", "3:E", 60), tr("3:E", "2:E", 60)],
    },
    trips: { DAY: { meta: {}, trips }, SAT: { meta: {}, trips: [] }, END: { meta: {}, trips: [] } },
    route_dists: {
      meta: { round_sec: 5, lastk_a_lines: [], band_members: { all: ["22", "23", "24"] } },
      arr_cells: { "1|weekday|all": cell("1"), "2|weekday|all": cell("2"), "3|weekday|all": cell("3") },
      arr_last3: {},
      dep_last3: {},
      dep_all: { "2|weekday": D, "3|weekday": D },
    },
    model_b: withModel ? { meta: {}, coef: { 절편: 0, el10: 0 }, resid: [-60, -30, 0, 30] } : null,
    prob_table: probRows ? { meta: {}, rows: probRows } : null,
  };
}

test("재귀 P(route): p .75·.75, q0 = 재탐색 경로(.75, 그 q=0) = .75, q1 = 1 → .9375", () => {
  const data = buildRouteData(makeRaw());
  const r = planTrip(data, { origin: "A", home: "F", tag: "DAY", nowSec: 81000 });
  assert.equal(r.status, "ok");
  const [t0, t1] = r.best.transfers;
  assert.equal(t0.at_station, "B");
  assert.equal(t0.buffer_sec, 30);
  close(t0.p, 0.75);
  close(t0.q, 0.75); // 2002 → 3002(여유 30초 .75), 그 환승을 놓치면 3호선 열차 없음(q=0)
  close(t1.p, 0.75);
  close(t1.q, 1); // 3001 을 놓쳐도 3002 직행
  // .75·.75 + .25·.75 + .75·.25·1 = .5625 + .1875 + .1875
  close(r.best.p_home, 0.9375);
  assert.equal(t0.critical, false);
  assert.equal(t1.critical, false);
  assert.equal(t0.model, "B");
  close(t0.slack_sec, 30); // 거리 자료 없음 → W = 환승 소요시간
  close(t0.s90, 60); // k = ⌊4·0.1⌋ = 0 → −(−60) − 0
  assert.equal(t0.a_dist_key, "1|weekday|all"); // 참고 그래프용 키는 계속 남는다
});

test("B 걸음 시간: 환승거리가 있으면 W = 거리 ÷ 1.2 (탐색 여유 buffer_sec 는 환승 소요시간 그대로)", () => {
  const raw = makeRaw();
  raw.network.transfers[0].distance_m = 150; // 1:B → 2:B, 도보 120초 · 거리 150m → W 125초
  const t0 = planTrip(buildRouteData(raw), { origin: "A", home: "F", tag: "DAY", nowSec: 81000 }).best.transfers[0];
  assert.equal(t0.buffer_sec, 30);
  close(t0.slack_sec, 25);
  close(t0.p, 0.5); // 잔차 ≥ −25: 0, 30 → .5
});

test("B 경과운행시간: 열차의 start(시발 출발)로 el10 을 계산해 ŷ 에 반영", () => {
  const raw = makeRaw();
  raw.model_b.coef.el10 = -10; // 10분당 −10초
  raw.trips.DAY.trips[0].start = 83400 - 1800; // 1001 은 30분 전 시발 → el10 = 3 → ŷ = −30
  const t0 = planTrip(buildRouteData(raw), { origin: "A", home: "F", tag: "DAY", nowSec: 81000 }).best.transfers[0];
  close(t0.el_min, 30);
  close(t0.yhat, -30);
  close(t0.p, 0.5); // 잔차 ≥ −30 + 30 = 0: 0, 30 → .5
});

test("결정적 환승: 놓치면 다음 열차가 없으면 q = 0, critical", () => {
  const data = buildRouteData(makeRaw({ withV2: false }));
  const r = planTrip(data, { origin: "A", home: "F", tag: "DAY", nowSec: 81000 });
  const [t0, t1] = r.best.transfers;
  assert.equal(t0.q, 0); // 2002 를 타도 E 에서 3호선이 없다
  assert.equal(t1.q, 0);
  assert.equal(t0.critical, true);
  assert.equal(t1.critical, true);
  close(r.best.p_home, 0.5625); // 결정적 환승 확률의 곱
});

test("깊이 제한: depth 2 경로의 q 는 0(재탐색 안 함)", () => {
  // 3003 이 있으면 q0 의 재탐색 경로(2002 → 3002)는 그 환승을 놓쳐도 3003 으로 간다
  const data = buildRouteData(makeRaw({ withV3: true }));
  const tt = timetableOf(data, "DAY");
  const net = data.network;
  const homeNodes = net.stationById.get("F").nodes;
  const ctx = { net, tt, tag: "DAY", dayType: "weekday", dists: data.dists, probIndex: null, homeNodes, memo: new Map() };
  const res = searchJourney(net, tt, { startNodes: net.stationById.get("A").nodes, startSec: 81000, homeNodes });

  // depth 0: q0 = P(재탐색, depth1) = .75 + .25·P(3003, depth2)=1 → 1, q1 = 1 → .5625 + .25 + .1875 = 1
  close(evaluateJourney(ctx, res.segments, 0).p_home, 1);
  // depth 1: q0 = P(재탐색, depth2) 인데 depth2 경로의 q 는 0 → .75, q1 = 1 → .9375
  ctx.memo = new Map();
  close(evaluateJourney(ctx, res.segments, 1).p_home, 0.9375);
  // depth 2: q 모두 0 → .75·.75
  ctx.memo = new Map();
  const deep = evaluateJourney(ctx, res.segments, 2);
  close(deep.p_home, 0.5625);
  assert.deepEqual(
    deep.transfers.map((t) => t.q),
    [0, 0],
  );
});

test("prob_row: 같은 역·노선·방향·태그이고 A 도착·D 출발 시각이 같은 막차 조합 행을 붙인다", () => {
  const row = {
    combo_id: "E|2UP>3UP", tt_tag: "DAY", station: "E", to_station: "E", from_line: "2", in_dir: "UP",
    to_line: "3", out_dir: "UP", arrive_sec: 84000, depart_sec: 84090, p_success: 0.7, ci_low: 0.6, ci_high: 0.8,
  };
  const other = { ...row, tt_tag: "SAT" }; // 태그가 다르면 붙이지 않는다
  const data = buildRouteData(makeRaw({ probRows: [other, row] }));
  const r = planTrip(data, { origin: "A", home: "F", tag: "DAY", nowSec: 81000 });
  assert.equal(r.best.transfers[0].prob_row, undefined);
  assert.equal(r.best.transfers[1].prob_row, row);
});

test("flags 로 고른 도착 분포 키가 참고 그래프용으로 환승 상세에 남는다(lastk 노선 A 도착 flags&1)", () => {
  const raw = makeRaw();
  raw.route_dists.meta.lastk_a_lines = ["1"];
  raw.route_dists.arr_last3 = { "1|weekday": { samples: [[0, 1]], n_nights: 9, fallback: null } };
  raw.route_dists.dep_last3 = { "2|weekday": { samples: [[0, 1]], n_nights: 9, fallback: null } };
  // 1001 의 1:B 도착에 flags 1, 2001 의 2:B 출발에 flags 2|4
  raw.trips.DAY.trips[0].stops[1][3] = 1;
  raw.trips.DAY.trips[1].stops[0][3] = 2 | 4;
  const data = buildRouteData(raw);
  const t0 = planTrip(data, { origin: "A", home: "F", tag: "DAY", nowSec: 81000 }).best.transfers[0];
  assert.equal(t0.a_dist_key, "1|weekday|last3");
  close(t0.p, 0.75); // 확률은 B 모형(분포 선택과 무관), 여유 30초
});

test("model_b 가 없으면 B 채택 전 모형(2차 합성곱)으로 계산한다", () => {
  const raw = makeRaw({ withModel: false });
  raw.route_dists.meta.lastk_a_lines = ["1"];
  raw.route_dists.arr_last3 = { "1|weekday": { samples: [[0, 1]], n_nights: 9, fallback: null } };
  raw.trips.DAY.trips[0].stops[1][3] = 1;
  const r = planTrip(buildRouteData(raw), { origin: "A", home: "F", tag: "DAY", nowSec: 81000 });
  const [t0, t1] = r.best.transfers;
  assert.equal(t0.model, "pre_b");
  close(t0.p, 1); // A = arr_last3 지연 0 한 점, 여유 30초
  close(t1.p, 0.75); // F_A(30) = .75
  assert.equal(t0.s90, null);
});
