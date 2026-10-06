// 공개 API 단위 테스트: planTrip, serviceDayOf, nearestStations, loadRouteData.
// 실행: node --test "web/src/route/*.test.js"   (디렉터리만 주면 Node 24에서 테스트 파일을 돌리지 않는다)

import { test } from "node:test";
import assert from "node:assert/strict";

import { HOLIDAYS, buildRouteData, lastChance, loadRouteData, nearestStations, planTrip, serviceDayOf, timetableOf } from "./plan.js";
import { ARRIVAL_SLACK, searchCandidates } from "./csa.js";
import { chooseJourney } from "./prob.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`);

// ── 합성 픽스처 ──────────────────────────────────────────────
// 출발 O(1호선). 1호선 UP 은 X 로, DOWN 은 W 로 간다. X·W 에서 2호선으로 갈아타 집 H.
// 환승 도보 60초. A 분포 {-30, 0, 30, 60} 각 .25, D 분포 지연 0 한 점 → p = F_A(B).
const NODE_IDS = ["1:O", "1:X", "1:W", "2:W", "2:X", "2:H"];
const IDX = new Map(NODE_IDS.map((id, i) => [id, i]));

function makeRaw(trips) {
  const nodes = NODE_IDS.map((id, i) => {
    const [line, nm] = id.split(":");
    return { id, line, nm, station: nm, lat: 37.5 + i * 0.01, lon: 127.0 };
  });
  const stations = [];
  nodes.forEach((n, i) => {
    let s = stations.find((x) => x.id === n.station);
    if (!s) stations.push((s = { id: n.station, name: n.station, lines: [], lat: n.lat, lon: n.lon, nodes: [] }));
    s.lines.push(n.line);
    s.nodes.push(i);
  });
  const tr = (f, t) => ({ from: IDX.get(f), to: IDX.get(t), walk_sec: 60, src: "csv", same_line: false });
  const A = { samples: [[-30, 0.25], [0, 0.25], [30, 0.25], [60, 0.25]], n_nights: 9, fallback: null };
  const cell = (line) => ({ line, day_type: "weekday", hour_band: "all", n_nights: 9, ...A });
  const D = { samples: [[0, 1]], n_nights: 9, fallback: null };
  return {
    network: {
      meta: {},
      line_colors: {},
      nodes,
      stations,
      transfers: [tr("1:X", "2:X"), tr("2:X", "1:X"), tr("1:W", "2:W"), tr("2:W", "1:W")],
    },
    trips: { DAY: { meta: {}, trips }, SAT: { meta: {}, trips: [] }, END: { meta: {}, trips: [] } },
    route_dists: {
      meta: { round_sec: 5, lastk_a_lines: [], band_members: { all: ["22", "23", "24"] } },
      arr_cells: { "1|weekday|all": cell("1"), "2|weekday|all": cell("2") },
      arr_last3: {},
      dep_last3: {},
      dep_all: { "1|weekday": D, "2|weekday": D },
    },
  };
}

function trip(line, code, dir, stops) {
  return {
    line,
    code,
    dir,
    express: false,
    dest: stops.at(-1)[0].split(":")[1],
    stops: stops.map(([id, arr, dep, flags = 0]) => [IDX.get(id), arr, dep, flags]),
  };
}

const TRIPS = [
  // 21:00 전 출발(검색 시작을 21:00으로 올리면 못 탄다)
  trip("1", "0999", "UP", [["1:O", null, 75000], ["1:X", 75600, null]]),
  trip("2", "1999", "OUT", [["2:X", null, 76000], ["2:H", 76600, null]]),
  trip("1", "1000", "UP", [["1:O", null, 76000], ["1:X", 76600, null]]),
  trip("2", "2000", "OUT", [["2:X", null, 77000], ["2:H", 77600, null]]),
  // 23시대
  trip("1", "1001", "UP", [["1:O", null, 82800], ["1:X", 83400, null]]), // → 2001 (여유 640, p 1). 1003 에 지배됨
  trip("1", "1002", "DOWN", [["1:O", null, 83000], ["1:W", 83300, null]]), // 반대 방향 → W 에서 2002, 85600 도착. 1005 에 지배됨
  trip("1", "1003", "UP", [["1:O", null, 83400], ["1:X", 84000, null]]), // → 2001 (여유 40, p .75, q 1) → 1
  trip("1", "1005", "UP", [["1:O", null, 84000], ["1:X", 84600, null]]), // → 2002 at X (여유 340, p 1)
  trip("1", "1007", "UP", [["1:O", null, 84600], ["1:X", 85200, null]]), // → 2003 (여유 30, p .75, q 0) → .75
  trip("1", "1009", "UP", [["1:O", null, 85500], ["1:X", 86100, null]]), // 이후 2호선 없음 → 도착 불가
  trip("2", "2001", "OUT", [["2:X", null, 84100], ["2:H", 84700, null]]),
  trip("2", "2002", "OUT", [["2:W", null, 84400], ["2:X", 84900, 85000], ["2:H", 85600, null]]),
  trip("2", "2003", "OUT", [["2:X", null, 85290], ["2:H", 85900, null]]),
];

const data = buildRouteData(makeRaw(TRIPS));
const firstTrip = (j) => j.legs.find((l) => l.type === "ride").trip;

// ── planTrip ────────────────────────────────────────────────

test("options: 도착 불가·지배된 안을 빼고 출발 시각 오름차순, best = 남은 안 중 가장 먼저 떠나는 안", () => {
  const r = planTrip(data, { origin: "O", home: "H", tag: "DAY", nowSec: 82000 });
  assert.equal(r.status, "ok");
  // 1002(반대 방향, 1005가 더 늦게 떠나 같은 시각 도착)·1009(도착 불가) 제외.
  // 1001 은 늦게 떠나 같은 시각·같은 확률(1)로 닿는 1003 에 지배돼 빠진다.
  // (규칙 변경: 예전에는 best 를 "가장 이른 도착 중 가장 먼저 떠나는 안"으로 따로 정해 지배당한 1001 도 띠에 남겼다.
  //  이제 best 는 지배된 안을 뺀 options 의 첫 안이라 1003 이 best 다 — 20분 더 있다 떠나도 같은 시각·같은 확률)
  assert.deepEqual(
    r.options.map((o) => firstTrip(o.journey)),
    ["1003", "1005", "1007"],
  );
  assert.deepEqual(
    r.options.map((o) => [o.depart_sec, o.arrive_sec]),
    [
      [83400, 84700],
      [84000, 85600],
      [84600, 85900],
    ],
  );
  assert.equal(r.options[0].journey, r.best); // best 와 같은 객체라 요약과 칩 숫자가 같다
  close(r.options[0].p_home, 1); // .75 + .25 · 1(2002 로 귀가)
  close(r.options[0].journey.transfers[0].p, 0.75);
  close(r.options[2].p_home, 0.75);
  assert.equal(r.options[2].journey.transfers[0].critical, true);
  // 같은 여정 없음
  const sigs = r.options.map((o) => JSON.stringify(o.journey.legs));
  assert.equal(new Set(sigs).size, sigs.length);
});

test("leave_by: safe = p ≥ .8 인 가장 늦은 출발, last = p > 0 인 가장 늦은 출발", () => {
  const r = planTrip(data, { origin: "O", home: "H", tag: "DAY", nowSec: 82000 });
  assert.equal(r.leave_by.safe.depart_sec, 84000);
  close(r.leave_by.safe.p_home, 1);
  assert.equal(r.leave_by.last.depart_sec, 84600);
  close(r.leave_by.last.p_home, 0.75);
});

test("best: 지배되지 않은 안 중 가장 먼저 떠나는 여정과 Journey 필드", () => {
  const r = planTrip(data, { origin: "O", home: "H", tag: "DAY", nowSec: 82000 });
  assert.equal(r.best.arrive_sec, 84700);
  // 규칙 변경: 82800(1001)이 아니라 83400(1003). 1001 은 같은 시각·같은 확률로 닿는 늦은 출발 1003 에 지배된다
  assert.equal(r.best.depart_sec, 83400);
  assert.deepEqual(
    r.best.legs.map((l) => l.type),
    ["ride", "transfer", "ride"],
  );
  const t = r.best.transfers[0];
  for (const key of ["at_station", "from_line", "to_line", "from_node", "to_node", "arr_A", "dep_D", "walk_sec",
    "buffer_sec", "p", "q", "critical", "model", "slack_sec", "yhat", "s90", "s80", "el_min", "a_dist_key"]) {
    assert.ok(key in t, key);
  }
  assert.equal(t.at_station, "X");
  assert.equal(t.buffer_sec, 84100 - 84000 - 60);
});

test("21:00 전 nowSec 는 75600 으로 올려 탐색한다", () => {
  const r = planTrip(data, { origin: "O", home: "H", tag: "DAY", nowSec: 70000 });
  assert.equal(r.status, "ok");
  assert.equal(r.best.depart_sec, 76000); // 75000 출발(0999)은 못 탄다
  assert.equal(r.best.arrive_sec, 77600);
  assert.ok(r.options.every((o) => o.depart_sec >= 75600));
});

test("마지막 열차 뒤면 no_route, 같은 역이면 same_station, 모르는 역·태그면 unsupported", () => {
  const empty = { best: null, options: [], leave_by: { safe: null, last: null } };
  assert.deepEqual(planTrip(data, { origin: "O", home: "H", tag: "DAY", nowSec: 86000 }), { status: "no_route", ...empty });
  assert.deepEqual(planTrip(data, { origin: "X", home: "X", tag: "DAY", nowSec: 82000 }), { status: "same_station", ...empty });
  assert.deepEqual(planTrip(data, { origin: "없는역", home: "H", tag: "DAY", nowSec: 82000 }), { status: "unsupported", ...empty });
  assert.deepEqual(planTrip(data, { origin: "O", home: "H", tag: "HOL", nowSec: 82000 }), { status: "unsupported", ...empty });
});

test("lastChance: 경로 없음이면 21:00부터 다시 계산한 가장 늦은 출발(leave_by.last), 21:00부터도 없으면 null", () => {
  const last = lastChance(data, { origin: "O", home: "H", tag: "DAY", nowSec: 86000 });
  assert.equal(last.depart_sec, 84600);
  close(last.p_home, 0.75);
  assert.equal(lastChance(buildRouteData(makeRaw([])), { origin: "O", home: "H", tag: "DAY", nowSec: 86000 }), null);
});

test("options 는 최대 12개, 마지막 가능한 출발까지 포함(best 가 잘리면 맨 앞에 두고 나머지 11개)", () => {
  // O → H 직행 20편(5분 간격). 늦게 떠날수록 늦게 도착하므로 모두 서로 다른 안
  const many = Array.from({ length: 20 }, (_, i) =>
    trip("1", `D${i}`, "UP", [["1:O", null, 80000 + i * 300], ["1:X", 80300 + i * 300, 80330 + i * 300], ["1:W", 80600 + i * 300, null]]),
  );
  const raw = makeRaw(many);
  const r = planTrip(buildRouteData(raw), { origin: "O", home: "W", tag: "DAY", nowSec: 79000 });
  assert.equal(r.options.length, 12);
  assert.equal(firstTrip(r.options.at(-1).journey), "D19");
  assert.equal(firstTrip(r.options[0].journey), "D0"); // best
  assert.equal(firstTrip(r.options[1].journey), "D9");
  assert.equal(r.leave_by.last.depart_sec, 80000 + 19 * 300);
  for (let i = 1; i < r.options.length; i++) assert.ok(r.options[i - 1].depart_sec <= r.options[i].depart_sec);
});

// ── 경로 선택: 후보 중 귀가 확률이 가장 높은 여정 ──────────────────
// 첫 열차 1001: O → X → Y (1호선). 집 H 는 2호선(2:H)·4호선(4:H) 두 노드.
//   2회 탑승: X 에서 2호선 2001 → 2:H.  3회 탑승: Y 에서 3호선 3001 → Z 에서 4호선 4001 → 4:H.
// B 모형 = 계수 0, 잔차 {-60, -30, 0, 30} → p = P(잔차 ≥ −S): S ≥ 60 → 1, 30~59 → .75, 0~29 → .5. 환승 도보 모두 60초.
// 1001 은 X 에 서는 시간 없이(도착 = 출발) 지나가므로 2001 을 놓치면 X 에서 다시 탈 열차가 없다(q = 0).
function makeChoice({ d2 = 83470, h2 = 85000, h4 = 85000 } = {}) {
  const ids = ["1:O", "1:X", "2:X", "2:H", "1:Y", "3:Y", "3:Z", "4:Z", "4:H"];
  const ix = new Map(ids.map((id, i) => [id, i]));
  const nodes = ids.map((id, i) => {
    const [line, nm] = id.split(":");
    return { id, line, nm, station: nm, lat: 37.5 + i * 0.01, lon: 127.0 };
  });
  const stations = [];
  nodes.forEach((n, i) => {
    let s = stations.find((x) => x.id === n.station);
    if (!s) stations.push((s = { id: n.station, name: n.station, lines: [], lat: n.lat, lon: n.lon, nodes: [] }));
    s.lines.push(n.line);
    s.nodes.push(i);
  });
  const tr = (f, t) => ({ from: ix.get(f), to: ix.get(t), walk_sec: 60, src: "csv", same_line: false });
  const t = (line, code, stops) => ({
    line, code, dir: "UP", express: false, dest: stops.at(-1)[0].split(":")[1],
    stops: stops.map(([id, arr, dep]) => [ix.get(id), arr, dep, 0]),
  });
  return {
    network: {
      meta: {}, line_colors: {}, nodes, stations,
      transfers: [tr("1:X", "2:X"), tr("2:X", "1:X"), tr("1:Y", "3:Y"), tr("3:Y", "1:Y"), tr("3:Z", "4:Z"), tr("4:Z", "3:Z")],
    },
    trips: {
      DAY: { meta: {}, trips: [
        t("1", "1001", [["1:O", null, 82800], ["1:X", 83400, 83400], ["1:Y", 83700, null]]),
        t("2", "2001", [["2:X", null, d2], ["2:H", h2, null]]),
        t("3", "3001", [["3:Y", null, 83900], ["3:Z", 84300, null]]), // Y 여유 140초 → p 1
        t("4", "4001", [["4:Z", null, 84500], ["4:H", h4, null]]), // Z 여유 140초 → p 1
      ] },
      SAT: { meta: {}, trips: [] },
      END: { meta: {}, trips: [] },
    },
    route_dists: { meta: { lastk_a_lines: [], band_members: {} }, arr_cells: {}, arr_last3: {}, dep_last3: {}, dep_all: {} },
    model_b: { meta: {}, coef: { 절편: 0, el10: 0 }, resid: [-60, -30, 0, 30] },
  };
}
const choicePlan = (opts) => planTrip(buildRouteData(makeChoice(opts)), { origin: "O", home: "H", tag: "DAY", nowSec: 82000 });
const rideLines = (j) => j.legs.filter((l) => l.type === "ride").map((l) => l.line);

test("경로 선택: 같은 시각에 도착하면 탑승 수가 많아도 귀가 확률이 높은 여정(X 여유 10초 .5 대신 Y·Z 경유 1)", () => {
  // 예전 규칙(가장 이른 도착 중 탑승 수 최소)이면 2회 탑승(X 2호선, p .5)을 골랐다 — 마포→잠실 00:05 의 천호 5→8 축소판
  const r = choicePlan();
  assert.deepEqual(rideLines(r.best), ["1", "3", "4"]);
  assert.equal(r.best.arrive_sec, 85000);
  close(r.best.p_home, 1);
  assert.equal(r.options.length, 1); // 첫 열차가 같은 두 후보 중 하나만 options 에 들어간다
});

test("경로 선택: 확률이 높으면 조금 늦게 도착하는 여정(5분 늦은 4호선), 가장 이른 도착 + 20분을 넘으면 후보가 아니다", () => {
  const late = choicePlan({ h4: 85300 }); // 2호선 85000(.5) vs 4호선 85300(1)
  assert.deepEqual(rideLines(late.best), ["1", "3", "4"]);
  assert.equal(late.best.arrive_sec, 85300);
  close(late.best.p_home, 1);
  const tooLate = choicePlan({ h4: 85000 + ARRIVAL_SLACK + 1 }); // 20분 1초 늦음 → 후보 밖
  assert.deepEqual(rideLines(tooLate.best), ["1", "2"]);
  close(tooLate.best.p_home, 0.5);
  const edge = choicePlan({ h4: 85000 + ARRIVAL_SLACK }); // 딱 20분 늦음 → 후보
  assert.deepEqual(rideLines(edge.best), ["1", "3", "4"]);
});

test("경로 선택 동률: 확률이 같으면 이른 도착, 도착도 같으면 탑승 수가 적은 여정", () => {
  // X 여유 140초(2001 83600 출발)면 두 여정 모두 p 1
  const sameArr = choicePlan({ d2: 83600 }); // 둘 다 85000 도착 → 탑승 2회
  assert.deepEqual(rideLines(sameArr.best), ["1", "2"]);
  const earlier = choicePlan({ d2: 83600, h4: 84900 }); // 4호선이 100초 먼저 도착 → 탑승 3회라도 이른 도착
  assert.deepEqual(rideLines(earlier.best), ["1", "3", "4"]);
  assert.equal(earlier.best.arrive_sec, 84900);
});

test("searchCandidates: 라운드 × 집 노드별 후보, chooseJourney 는 p 최대를 고른다", () => {
  const data = buildRouteData(makeChoice());
  const tt = timetableOf(data, "DAY");
  const net = data.network;
  const homeNodes = net.stationById.get("H").nodes;
  const cands = searchCandidates(net, tt, { startNodes: net.stationById.get("O").nodes, startSec: 82000, homeNodes });
  // 라운드 2 = 2:H(2회 탑승), 라운드 3 = 4:H(3회 탑승). 라운드 3의 2:H 는 라운드 2와 같은 여정이라 하나만 남는다
  assert.deepEqual(
    cands.map((c) => [c.segments.length, net.nodes[c.homeNode].line, c.arrive]),
    [[2, "2", 85000], [3, "4", 85000]],
  );
  const ctx = { net, tt, tag: "DAY", dayType: "weekday", dists: data.dists, modelB: data.modelB, probIndex: null, homeNodes, memo: new Map() };
  const pick = chooseJourney(ctx, cands, 0);
  assert.equal(pick.res, cands[1]);
  close(pick.ev.p_home, 1);
  assert.equal(chooseJourney(ctx, [], 0), null);
});

// ── serviceDayOf ────────────────────────────────────────────

test("serviceDayOf: 02:30 은 전날 운영일, nowSec 86400 이상", () => {
  // 2026-10-07(수) 02:30 → 10-06(화) 운영일
  assert.deepEqual(serviceDayOf(new Date(2026, 9, 7, 2, 30)), {
    serviceDate: "20261006",
    tag: "DAY",
    dayType: "weekday",
    nowSec: 86400 + 2 * 3600 + 30 * 60,
  });
  // 03:00 부터는 그날 운영일
  const r = serviceDayOf(new Date(2026, 9, 7, 3, 0, 0));
  assert.equal(r.serviceDate, "20261007");
  assert.equal(r.nowSec, 10800);
  // 월초 02:00 → 전달 말일
  assert.equal(serviceDayOf(new Date(2026, 10, 1, 2, 0)).serviceDate, "20261031");
});

test("serviceDayOf: 일요일 END, 토요일 SAT, 평일 DAY", () => {
  assert.equal(serviceDayOf(new Date(2026, 9, 4, 22, 0)).tag, "END"); // 10-04 일
  assert.equal(serviceDayOf(new Date(2026, 9, 10, 23, 0)).tag, "SAT"); // 10-10 토
  assert.equal(serviceDayOf(new Date(2026, 9, 10, 23, 0)).dayType, "weekend");
  assert.equal(serviceDayOf(new Date(2026, 9, 8, 23, 0)).tag, "DAY"); // 10-08 목
  // 일요일 01:00 은 토요일 운영일
  assert.equal(serviceDayOf(new Date(2026, 9, 11, 1, 0)).tag, "SAT");
});

test("serviceDayOf: 공휴일은 END(토요일 공휴일 포함), 공휴일 다음날 새벽은 전날(공휴일) 운영일", () => {
  assert.deepEqual([...HOLIDAYS].sort(), ["20260924", "20260925", "20260926", "20261003", "20261005", "20261009", "20261225", "20270101"]);
  assert.equal(serviceDayOf(new Date(2026, 9, 5, 22, 0)).tag, "END"); // 10-05 월 대체공휴일
  assert.equal(serviceDayOf(new Date(2026, 11, 25, 23, 0)).tag, "END"); // 12-25 금 성탄절
  assert.equal(serviceDayOf(new Date(2027, 0, 1, 23, 30)).tag, "END"); // 01-01 금 신정
  assert.equal(serviceDayOf(new Date(2026, 9, 9, 22, 0)).tag, "END"); // 10-09 금 한글날
  assert.equal(serviceDayOf(new Date(2026, 9, 3, 22, 0)).tag, "END"); // 10-03 토 개천절
  assert.equal(serviceDayOf(new Date(2026, 8, 24, 22, 0)).dayType, "weekend"); // 09-24 목 추석 연휴
  const dawn = serviceDayOf(new Date(2026, 9, 6, 1, 30)); // 10-06 화 01:30 → 10-05 운영일
  assert.equal(dawn.serviceDate, "20261005");
  assert.equal(dawn.tag, "END");
  assert.equal(dawn.nowSec, 86400 + 5400);
});

// ── nearestStations ─────────────────────────────────────────

test("nearestStations: 직선거리 순 k곳, walk_sec = 거리 × 1.3 ÷ 1.2", () => {
  // 픽스처 역 좌표: O 37.50, X 37.51, W 37.52(노드 2·3 중 앞 노드), H 37.55 (경도 127.0 동일)
  const r = nearestStations(data, 37.5, 127.0);
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map((s) => s.station),
    ["O", "X", "W"],
  );
  assert.equal(r[0].distance_m, 0);
  assert.equal(r[0].walk_sec, 0);
  // 위도 0.01° ≈ 1111.95m (지구 반지름 6371008.8m) → 도보 1111.95 × 1.3 / 1.2 ≈ 1204.6초
  assert.ok(Math.abs(r[1].distance_m - 1112) <= 1, String(r[1].distance_m));
  assert.ok(Math.abs(r[1].walk_sec - 1205) <= 1, String(r[1].walk_sec));
  assert.equal(nearestStations(data, 37.56, 127.0, 1)[0].station, "H");
  assert.equal(nearestStations(data, 37.5, 127.0, 10).length, 4);
});

// ── loadRouteData ───────────────────────────────────────────

test("loadRouteData: fetchJson 으로 6개 파일(model_b 포함)을 읽고, prob_table 이 실패해도 진행한다", async () => {
  const raw = makeRaw(TRIPS);
  const files = {
    network: raw.network,
    trips_DAY: raw.trips.DAY,
    trips_SAT: raw.trips.SAT,
    trips_END: raw.trips.END,
    route_dists: raw.route_dists,
    model_b: { meta: {}, coef: { 절편: 0, el10: 0 }, resid: [-60, -30, 0, 30] },
  };
  const asked = [];
  const fetchJson = async (name) => {
    asked.push(name);
    if (!(name in files)) throw new Error(`없음: ${name}`);
    return files[name];
  };
  const loaded = await loadRouteData(fetchJson);
  assert.deepEqual(asked.sort(), ["model_b", "network", "prob_table", "route_dists", "trips_DAY", "trips_END", "trips_SAT"]);
  assert.equal(loaded.probIndex, null);
  assert.equal(loaded.modelB.n, 4);
  const r = planTrip(loaded, { origin: "O", home: "H", tag: "DAY", nowSec: 82000 });
  assert.equal(r.status, "ok");
  assert.equal(r.best.arrive_sec, 84700);
});

test("best: 같은 시각에 도착해도 먼저 떠나는 안의 확률이 높으면 그 안(지금 떠나면 93%인데 63%로 보이던 문제)", () => {
  // 1001(82800 출발, X 여유 640초 → p 1)과 1003(83400 출발, 여유 40초 → p .75, 놓치면 2호선 없음 q 0)이 모두 84700 도착.
  // 늦게 떠나는 1003 은 확률이 낮아 1001 을 지배하지 못한다 → 둘 다 남고 best 는 먼저 떠나는 1001
  // (서울역→강남 00:15 평일: 00:16 출발 93%, 00:27 출발 63%, 둘 다 00:54 도착이던 사례의 축소판)
  const trips = [
    trip("1", "1001", "UP", [["1:O", null, 82800], ["1:X", 83400, null]]),
    trip("1", "1003", "UP", [["1:O", null, 83400], ["1:X", 84000, null]]),
    trip("2", "2001", "OUT", [["2:X", null, 84100], ["2:H", 84700, null]]),
  ];
  const r = planTrip(buildRouteData(makeRaw(trips)), { origin: "O", home: "H", tag: "DAY", nowSec: 82000 });
  assert.deepEqual(
    r.options.map((o) => [firstTrip(o.journey), o.arrive_sec]),
    [["1001", 84700], ["1003", 84700]],
  );
  close(r.options[1].p_home, 0.75);
  assert.equal(firstTrip(r.best), "1001");
  close(r.best.p_home, 1);
});

test("q: 갈아탈 열차를 놓쳐도 같은 역 다른 노선으로 집에 갈 수 있으면 결정적 환승이 아니다", () => {
  // X역에 1·2·3호선. 1호선 O→X(83000 도착) → 2호선 X→H(83090 출발, 여유 30초, p .75).
  // 2호선을 놓치면 같은 X역 3호선(83500 출발)으로 H에 간다 → q = 1, P = .75 + .25 · 1 = 1
  const ids = ["1:O", "1:X", "2:X", "3:X", "2:H", "3:H"];
  const ix = new Map(ids.map((id, i) => [id, i]));
  const nodes = ids.map((id, i) => {
    const [line, nm] = id.split(":");
    return { id, line, nm, station: nm, lat: 37.5 + i * 0.01, lon: 127.0 };
  });
  const stations = ["O", "X", "H"].map((s) => ({
    id: s, name: s, lines: [], lat: 37.5, lon: 127.0,
    nodes: ids.map((id, i) => [id, i]).filter(([id]) => id.endsWith(`:${s}`)).map(([, i]) => i),
  }));
  const tr = (f, t) => ({ from: ix.get(f), to: ix.get(t), walk_sec: 60, src: "csv", same_line: false });
  const A = { samples: [[-30, 0.25], [0, 0.25], [30, 0.25], [60, 0.25]], n_nights: 9, fallback: null };
  const D = { samples: [[0, 1]], n_nights: 9, fallback: null };
  const t = (line, code, stops) => ({
    line, code, dir: "UP", express: false, dest: "H",
    stops: stops.map(([id, arr, dep]) => [ix.get(id), arr, dep, 0]),
  });
  const raw = {
    network: {
      meta: {}, line_colors: {}, nodes, stations,
      transfers: [tr("1:X", "2:X"), tr("1:X", "3:X"), tr("2:X", "3:X"), tr("3:X", "2:X")],
    },
    trips: {
      DAY: { meta: {}, trips: [
        t("1", "1001", [["1:O", null, 82400], ["1:X", 83000, null]]),
        t("2", "2001", [["2:X", null, 83090], ["2:H", 83600, null]]),
        t("3", "3001", [["3:X", null, 83500], ["3:H", 84100, null]]),
      ] },
      SAT: { meta: {}, trips: [] },
      END: { meta: {}, trips: [] },
    },
    route_dists: {
      meta: { round_sec: 5, lastk_a_lines: [], band_members: { all: ["22", "23", "24"] } },
      arr_cells: { "1|weekday|all": { line: "1", day_type: "weekday", hour_band: "all", ...A } },
      arr_last3: {}, dep_last3: {},
      dep_all: { "2|weekday": D, "3|weekday": D },
    },
  };
  const r = planTrip(buildRouteData(raw), { origin: "O", home: "H", tag: "DAY", nowSec: 82000 });
  const x = r.best.transfers[0];
  assert.equal(x.to_line, "2");
  close(x.p, 0.75);
  close(x.q, 1);
  assert.equal(x.critical, false);
  close(r.best.p_home, 1);
});
