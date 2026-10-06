// CSA 탐색 단위 테스트. 실제 데이터 대신 계약 1장 형식의 작은 합성 노선망을 쓴다.
// 실행: node --test "web/src/route/*.test.js"   (디렉터리만 주면 Node 24에서 테스트 파일을 돌리지 않는다)

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildNetwork, buildTimetable } from "./network.js";
import { journeyLegs, searchCandidates, searchJourney } from "./csa.js";

// ── 합성 픽스처 ──────────────────────────────────────────────
// 노드 id "노선:역명", 물리 역 = 역명. 1:B ↔ 2:B 환승 도보 120초, 2:D 는 같은 노드 same_line 환승 90초.
const NODE_IDS = ["1:A", "1:B", "1:C", "2:B", "2:D", "2:G"];
const IDX = new Map(NODE_IDS.map((id, i) => [id, i]));

function makeNetwork(nodeIds, transfers) {
  const nodes = nodeIds.map((id, i) => {
    const [line, nm] = id.split(":");
    return { id, line, nm, station: nm, lat: 37.5 + i * 0.001, lon: 127.0 };
  });
  const stations = [];
  nodes.forEach((n, i) => {
    let s = stations.find((x) => x.id === n.station);
    if (!s) {
      s = { id: n.station, name: n.station, lines: [], lat: n.lat, lon: n.lon, nodes: [] };
      stations.push(s);
    }
    s.lines.push(n.line);
    s.nodes.push(i);
  });
  const idx = new Map(nodeIds.map((id, i) => [id, i]));
  return {
    meta: {},
    line_colors: {},
    nodes,
    stations,
    transfers: transfers.map(([f, t, w]) => ({
      from: idx.get(f),
      to: idx.get(t),
      walk_sec: w,
      src: "csv",
      same_line: f.split(":")[0] === t.split(":")[0],
    })),
  };
}

// stops: [[노드 id, 도착 or null, 출발 or null, flags?], ...]
function makeTrip(line, code, stops) {
  return {
    line,
    code,
    dir: "UP",
    express: false,
    dest: stops.at(-1)[0].split(":")[1],
    stops: stops.map(([id, arr, dep, flags = 0]) => [IDX.get(id), arr, dep, flags]),
  };
}

const RAW_NET = makeNetwork(NODE_IDS, [
  ["1:B", "2:B", 120],
  ["2:B", "1:B", 120],
  ["2:D", "2:D", 90],
]);

const RAW_TRIPS = {
  meta: {},
  trips: [
    // 직행·1회 환승
    makeTrip("1", "1001", [["1:A", null, 82800], ["1:B", 83400, 83430], ["1:C", 84000, null]]),
    makeTrip("2", "2001", [["2:B", null, 83700], ["2:D", 84300, null]]),
    makeTrip("2", "2002", [["2:B", null, 83500], ["2:D", 84100, null]]), // 1001에서 도보 120초면 83520이라 못 탐
    // 같은 노드 다른 열차(1:B 종착 → 1:B 시발)
    makeTrip("1", "1003", [["1:A", null, 84600], ["1:B", 85200, null]]),
    makeTrip("1", "1004", [["1:B", null, 85300], ["1:C", 85800, null]]),
    // 같은 노드 same_line 환승 도보(2:D, 90초)
    makeTrip("2", "2003", [["2:B", null, 86000], ["2:D", 86400, null]]),
    makeTrip("2", "2004", [["2:D", null, 86450], ["2:G", 87000, null]]), // 86400 + 90 > 86450 이라 못 탐
    makeTrip("2", "2005", [["2:D", null, 86500], ["2:G", 87100, null]]),
    // 동률: 직행 1005와 환승(1006 → 1007)이 같은 시각 도착. 환승 쪽 마지막 연결이 먼저 처리된다
    makeTrip("1", "1005", [["1:A", null, 88000], ["1:B", 88600, 88640], ["1:C", 89200, null]]),
    makeTrip("1", "1006", [["1:A", null, 88100], ["1:B", 88500, null]]),
    makeTrip("1", "1007", [["1:B", null, 88630], ["1:C", 89200, null]]),
  ],
};

const net = buildNetwork(RAW_NET);
const tt = buildTimetable(RAW_TRIPS, NODE_IDS.length);
const stationNodes = (id) => net.stationById.get(id).nodes;

function search(from, to, startSec) {
  return searchJourney(net, tt, { startNodes: stationNodes(from), startSec, homeNodes: stationNodes(to) });
}

function rides(res) {
  return journeyLegs(net, tt, res.segments).filter((l) => l.type === "ride");
}

// ── 테스트 ──────────────────────────────────────────────────

test("연결 배열은 출발 시각 오름차순이고 연속 정차쌍 수와 같다", () => {
  const expected = RAW_TRIPS.trips.reduce((s, t) => s + t.stops.length - 1, 0);
  assert.equal(tt.nConn, expected);
  for (let c = 1; c < tt.nConn; c++) assert.ok(tt.cDep[c - 1] <= tt.cDep[c]);
});

test("직행: A → C 는 1001 하나로 84000 도착, 정차 목록 포함", () => {
  const res = search("A", "C", 82000);
  assert.equal(res.arrive, 84000);
  const legs = journeyLegs(net, tt, res.segments);
  assert.equal(legs.length, 1);
  assert.deepEqual(
    { type: legs[0].type, line: legs[0].line, trip: legs[0].trip, dep: legs[0].dep, arr: legs[0].arr },
    { type: "ride", line: "1", trip: "1001", dep: 82800, arr: 84000 },
  );
  assert.deepEqual(legs[0].stops, [IDX.get("1:A"), IDX.get("1:B"), IDX.get("1:C")]);
});

test("열차는 중간 정차에서도 탈 수 있다: B → C 는 1:B 에서 1001 탑승", () => {
  const res = search("B", "C", 83000);
  const r = rides(res);
  assert.equal(r.length, 1);
  assert.equal(r[0].trip, "1001");
  assert.equal(r[0].from_node, IDX.get("1:B"));
  assert.equal(r[0].dep, 83430);
});

test("1회 환승(도보 포함): 도보 120초가 모자란 2002 대신 2001", () => {
  const res = search("A", "D", 82000);
  assert.equal(res.arrive, 84300);
  const legs = journeyLegs(net, tt, res.segments);
  assert.deepEqual(
    legs.map((l) => l.type),
    ["ride", "transfer", "ride"],
  );
  assert.equal(legs[0].trip, "1001");
  assert.equal(legs[1].from_node, IDX.get("1:B"));
  assert.equal(legs[1].to_node, IDX.get("2:B"));
  assert.equal(legs[1].walk_sec, 120);
  assert.equal(legs[1].at_station, "B");
  assert.equal(legs[2].trip, "2001"); // 2002(83500)는 83400 + 120 = 83520 보다 먼저 떠난다
});

test("같은 노드 다른 열차: 1:B 종착 1003 → 1:B 시발 1004, 도보 0", () => {
  const res = search("A", "C", 84500);
  assert.equal(res.arrive, 85800);
  const legs = journeyLegs(net, tt, res.segments);
  assert.deepEqual(
    legs.map((l) => l.trip ?? l.type),
    ["1003", "transfer", "1004"],
  );
  assert.equal(legs[1].from_node, IDX.get("1:B"));
  assert.equal(legs[1].to_node, IDX.get("1:B"));
  assert.equal(legs[1].walk_sec, 0);
});

test("같은 노드 same_line 환승이 있으면 0초 대신 그 도보(90초)를 쓴다", () => {
  const res = search("B", "G", 85900);
  assert.equal(res.arrive, 87100);
  const legs = journeyLegs(net, tt, res.segments);
  assert.deepEqual(
    legs.map((l) => l.trip ?? l.type),
    ["2003", "transfer", "2005"],
  );
  assert.equal(legs[1].walk_sec, 90);
});

test("동률이면 환승이 적은 여정: 1006 → 1007 대신 직행 1005", () => {
  const res = search("A", "C", 87900);
  assert.equal(res.arrive, 89200);
  const r = rides(res);
  assert.equal(r.length, 1);
  assert.equal(r[0].trip, "1005");
});

test("후보: 같은 시각 도착이라도 탑승 수가 다르면 각각 후보(라운드 1 직행 1005, 라운드 2 환승 1006 → 1007)", () => {
  // 확률로 고를 수 있게 둘 다 돌려준다. searchJourney(가장 이른 도착 중 탑승 수 최소)는 그중 첫 후보인 직행
  const cands = searchCandidates(net, tt, { startNodes: stationNodes("A"), startSec: 87900, homeNodes: stationNodes("C") });
  assert.deepEqual(
    cands.map((c) => [c.arrive, rides(c).map((l) => l.trip)]),
    [
      [89200, ["1005"]],
      [89200, ["1006", "1007"]],
    ],
  );
  assert.deepEqual(searchCandidates(net, tt, { startNodes: stationNodes("A"), startSec: 90000, homeNodes: stationNodes("C") }), []);
});

test("도착 불가면 null: 마지막 열차 뒤, 또는 열차가 없는 방향", () => {
  assert.equal(search("A", "C", 90000), null);
  assert.equal(search("C", "A", 82000), null);
});

test("첫 열차 고정: 1001 을 첫 열차로 타면 A → D 는 2001 환승", () => {
  const c0 = [...tt.cTrip].findIndex((trip, c) => RAW_TRIPS.trips[trip].code === "1001" && tt.cFrom[c] === IDX.get("1:A"));
  const res = searchJourney(net, tt, { startSec: tt.cDep[c0], homeNodes: stationNodes("D"), firstConn: c0 });
  assert.deepEqual(
    rides(res).map((l) => l.trip),
    ["1001", "2001"],
  );
});

test("동률(같은 도착·같은 탑승 수)이면 여유가 가장 큰 정차에서 갈아탄다: 분기역 J에서 환승, 종점 F까지 갔다 오지 않음", () => {
  // 1호선 S → J → F 로 가는 열차 X 와, F → J → H(J에서 갈라지는 지선)로 되돌아오는 열차 Y.
  // F에서 갈아타면 여유 0초(같은 노드 0초 환승), J에서 갈아타면 여유 200초. 도착(H 1400)과 탑승 수(2)는 같다.
  // 안양→부천(구로 분기)에서 S510을 신도림까지 갔다 K227로 되돌아오던 문제의 축소판.
  const ids = ["1:S", "1:J", "1:F", "1:H"];
  const ix = new Map(ids.map((id, i) => [id, i]));
  const trip = (code, stops) => ({
    line: "1",
    code,
    dir: "UP",
    express: false,
    dest: stops.at(-1)[0].split(":")[1],
    stops: stops.map(([id, arr, dep]) => [ix.get(id), arr, dep, 0]),
  });
  const bnet = buildNetwork(makeNetwork(ids, []));
  const btt = buildTimetable(
    {
      meta: {},
      trips: [
        trip("X", [["1:S", null, 1000], ["1:J", 1100, 1110], ["1:F", 1200, null]]),
        trip("Y", [["1:F", null, 1200], ["1:J", 1290, 1300], ["1:H", 1400, null]]),
      ],
    },
    ids.length,
  );
  const st = (id) => bnet.stationById.get(id).nodes;
  const res = searchJourney(bnet, btt, { startNodes: st("S"), startSec: 900, homeNodes: st("H") });
  assert.equal(res.arrive, 1400);
  const legs = journeyLegs(bnet, btt, res.segments);
  assert.deepEqual(
    legs.map((l) => l.trip ?? l.type),
    ["X", "transfer", "Y"],
  );
  assert.equal(legs[1].at_station, "J");
  assert.equal(legs[1].dep - legs[1].arr - legs[1].walk_sec, 200);
});
