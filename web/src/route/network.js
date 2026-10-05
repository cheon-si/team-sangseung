// 경로 엔진 1/4: network.json·trips_{TAG}.json 을 탐색용 인덱스로 바꾼다.
// 순수 ES 모듈(React·DOM 없음, Node에서 그대로 import). 형식은 route_contract.md 1장.
// 탐색이 수만 번 도는 배열(정차·연결)은 typed array로 둔다. 객체 배열보다 메모리가 작고 순회가 빠르다.

export const NONE = -1; // 시각 null(시발역 도착, 종착역 출발) 표시

// network.json → 노드·물리 역 조회와 환승 인접 목록(CSR: 노드 i의 환승은 adjTo[adjStart[i] .. adjStart[i+1]])
export function buildNetwork(raw) {
  const nodes = raw.nodes;
  const n = nodes.length;
  const nodeIndex = new Map(nodes.map((node, i) => [node.id, i]));
  const stations = raw.stations;
  const stationById = new Map(stations.map((s) => [s.id, s]));

  // 같은 노드끼리의 환승(same_line 지선 환승)은 "같은 노드 다른 열차" 대기 0초 대신 그 도보를 쓴다.
  // 같은 (from, to) 행이 여러 개면 가장 짧은 도보를 쓴다.
  // 환승거리(distance_m, B 모형 걸음 시간 W = 거리 ÷ 1.2)는 그 가장 짧은 도보 행의 값(동률이면 먼저 나온 행)을 쓴다.
  const sameNodeWalk = new Int32Array(n);
  const sameNodeDist = new Map(); // 노드 → 같은 노드 환승 행의 distance_m
  const best = new Map(); // "from>to" → walk_sec
  const distByEdge = new Map(); // "from>to" → distance_m(없으면 null)
  for (const t of raw.transfers) {
    const dist = t.distance_m ?? null;
    if (t.from === t.to) {
      if (!(sameNodeWalk[t.from] > 0) || t.walk_sec < sameNodeWalk[t.from]) {
        sameNodeWalk[t.from] = t.walk_sec;
        sameNodeDist.set(t.from, dist);
      }
      continue;
    }
    const key = `${t.from}>${t.to}`;
    if (!best.has(key) || t.walk_sec < best.get(key)) {
      best.set(key, t.walk_sec);
      distByEdge.set(key, dist);
    }
  }
  const edges = [...best].map(([key, walk]) => [...key.split(">").map(Number), walk]);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const adjStart = new Int32Array(n + 1);
  const adjTo = new Int32Array(edges.length);
  const adjWalk = new Int32Array(edges.length);
  edges.forEach(([from, to, walk], k) => {
    adjStart[from + 1] += 1;
    adjTo[k] = to;
    adjWalk[k] = walk;
  });
  for (let i = 0; i < n; i++) adjStart[i + 1] += adjStart[i];

  return {
    raw,
    nodes,
    nodeIndex,
    stations,
    stationById,
    lineColors: raw.line_colors ?? {},
    sameNodeWalk,
    sameNodeDist,
    distByEdge,
    adjStart,
    adjTo,
    adjWalk,
  };
}

// 노드 from 에서 내려 노드 to 의 열차를 탈 때의 환승거리(m). 환승 자료에 거리가 없으면 null.
// 같은 노드: 지선 환승 행이 있으면 그 거리, 없으면(같은 승강장 다른 열차) 0
export function transferDistance(net, from, to) {
  if (from === to) return net.sameNodeDist.has(from) ? net.sameNodeDist.get(from) : 0;
  return net.distByEdge.get(`${from}>${to}`) ?? null;
}

// trips_{TAG}.json → 정차 평탄화 배열 + 연결(연속 정차쌍) 배열. 연결은 출발 시각 오름차순.
// 요일 태그별로 한 번만 만든다(캐시는 plan.js timetableOf).
export function buildTimetable(raw, nNodes) {
  const trips = raw.trips;
  const nTrips = trips.length;
  let nStops = 0;
  for (const t of trips) nStops += t.stops.length;

  // 1) 정차: 열차 i의 정차는 stop*[tripStart[i] .. tripStart[i+1]) 에 운행 순서대로
  const tripStart = new Int32Array(nTrips + 1);
  const stopNode = new Int32Array(nStops);
  const stopArr = new Int32Array(nStops);
  const stopDep = new Int32Array(nStops);
  const stopFlags = new Uint8Array(nStops);
  let k = 0;
  for (let i = 0; i < nTrips; i++) {
    tripStart[i] = k;
    for (const [node, arr, dep, flags] of trips[i].stops) {
      stopNode[k] = node;
      stopArr[k] = arr ?? NONE;
      stopDep[k] = dep ?? NONE;
      stopFlags[k] = flags ?? 0;
      k++;
    }
  }
  tripStart[nTrips] = k;

  // 2) 연결: dep = 앞 정차 출발, arr = 뒤 정차 도착(없으면 뒤 정차 출발). 앞 정차 index(s)로 표현, 뒤 정차 = s + 1
  const tmpStop = [];
  const tmpDep = [];
  const tmpArr = [];
  const tmpTrip = [];
  for (let i = 0; i < nTrips; i++) {
    for (let s = tripStart[i]; s < tripStart[i + 1] - 1; s++) {
      const dep = stopDep[s] !== NONE ? stopDep[s] : stopArr[s];
      const arr = stopArr[s + 1] !== NONE ? stopArr[s + 1] : stopDep[s + 1];
      if (dep === NONE || arr === NONE) continue;
      tmpStop.push(s);
      tmpDep.push(dep);
      tmpArr.push(arr);
      tmpTrip.push(i);
    }
  }
  // 출발 → 도착 → 정차 순서로 정렬. 같은 열차의 0초 구간(dep == arr)이 운행 순서대로 오게 하려고 정차 index로 마지막 동률을 끊는다.
  const order = tmpStop.map((_, i) => i);
  order.sort((a, b) => tmpDep[a] - tmpDep[b] || tmpArr[a] - tmpArr[b] || tmpStop[a] - tmpStop[b]);
  const nConn = order.length;
  const cDep = new Int32Array(nConn);
  const cArr = new Int32Array(nConn);
  const cFrom = new Int32Array(nConn);
  const cTo = new Int32Array(nConn);
  const cTrip = new Int32Array(nConn);
  const cStop = new Int32Array(nConn);
  order.forEach((j, c) => {
    cDep[c] = tmpDep[j];
    cArr[c] = tmpArr[j];
    cStop[c] = tmpStop[j];
    cFrom[c] = stopNode[tmpStop[j]];
    cTo[c] = stopNode[tmpStop[j] + 1];
    cTrip[c] = tmpTrip[j];
  });

  return {
    trips,
    nTrips,
    nNodes,
    tripStart,
    stopNode,
    stopArr,
    stopDep,
    stopFlags,
    nConn,
    cDep,
    cArr,
    cFrom,
    cTo,
    cTrip,
    cStop,
  };
}

// 정렬된 배열에서 v 이상인 첫 위치
export function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
