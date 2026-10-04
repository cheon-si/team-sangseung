// 경로 엔진 2/4: Connection Scan Algorithm(earliest arrival).
// 연결을 출발 시각 순으로 한 번 훑으며 "이 노드에 몇 시에 서 있을 수 있나"를 갱신한다. 계약 3장 탐색 규칙.
// 동률(같은 도착 시각)이면 탑승 횟수가 적은 쪽을 남긴다 → 환승 수가 적은 여정 우선.
// 탑승 횟수까지 같으면 갈아탈 열차를 시간표 여유(B)가 가장 큰 정차에서 탄 것으로 본다.
// 예: 안양→부천은 1호선 S510을 신도림까지 갔다 K227로 되돌아오는(B 0초) 대신 구로에서 갈아탄다(B 360초).

import { lowerBound } from "./network.js";

const INF = 0x7fffffff;

// 탐색용 작업 배열. 시간표(요일 태그)마다 한 벌 만들어 재사용한다(탐색 한 번마다 새로 만들지 않음).
// 재귀 확률 계산이 탐색을 다시 부르지만, 탐색은 결과를 일반 배열로 복원한 뒤 끝나므로 공유해도 안전하다.
function scratchOf(tt) {
  if (!tt.scratch) {
    const n = tt.nNodes;
    tt.scratch = {
      readyTime: new Int32Array(n), // 이 노드에서 열차를 탈 수 있는 가장 이른 시각
      readyRides: new Int32Array(n), // 그때까지 탄 열차 수
      readyPrev: new Int32Array(n), // 내려서 걸어온 노드(-1 = 출발 노드)
      readyWalk: new Int32Array(n), // 그 도보(초)
      arrTime: new Int32Array(n), // 열차로 이 노드에 도착한 가장 이른 시각
      arrRides: new Int32Array(n),
      arrConn: new Int32Array(n), // 내린 연결
      arrBoard: new Int32Array(n), // 그 열차를 탄 연결
      isHome: new Uint8Array(n),
      tripBoard: new Int32Array(tt.nTrips), // 열차를 탄 연결(-1 = 아직 못 탐)
      tripRides: new Int32Array(tt.nTrips),
      tripSlack: new Int32Array(tt.nTrips), // 그 열차를 탄 정차의 시간표 여유(출발 − 탈 준비 시각)
    };
  }
  return tt.scratch;
}

/**
 * 가장 빨리 집 역에 도착하는 여정.
 * opts.startNodes  출발 노드들(그 시각에 이미 서 있음)
 * opts.startSec    출발 시각(운영일 초)
 * opts.homeNodes   집 물리 역의 노드들(아무 노드나 도착하면 끝)
 * opts.firstConn   ≥ 0이면 이 연결(정렬 위치)의 열차를 첫 열차로 고정한다. startNodes는 무시.
 * 반환: { arrive, homeNode, segments: [{ board, alight, walk }] } 또는 null(도착 불가).
 *   segments = 열차 탑승 구간. board/alight = 탄·내린 연결 위치, walk = 그 구간을 타기 전 환승 도보(첫 구간 0).
 */
export function searchJourney(net, tt, opts) {
  const { startNodes = [], startSec, homeNodes, firstConn = -1 } = opts;
  const sc = scratchOf(tt);
  const { readyTime, readyRides, readyPrev, readyWalk, arrTime, arrRides, arrConn, arrBoard, isHome } = sc;
  const { tripBoard, tripRides, tripSlack } = sc;
  const { cDep, cArr, cFrom, cTo, cTrip, nConn } = tt;
  const { sameNodeWalk, adjStart, adjTo, adjWalk } = net;

  readyTime.fill(INF);
  arrTime.fill(INF);
  tripBoard.fill(-1);
  isHome.fill(0);
  for (const h of homeNodes) isHome[h] = 1;

  // 내려서(또는 걸어서) 노드 m에 t 시각에 탈 준비가 된다. (시각, 탑승 수) 사전식으로 더 나을 때만 갱신
  const relax = (m, t, rides, prev, walk) => {
    if (t < readyTime[m] || (t === readyTime[m] && rides < readyRides[m])) {
      readyTime[m] = t;
      readyRides[m] = rides;
      readyPrev[m] = prev;
      readyWalk[m] = walk;
    }
  };

  let startIdx;
  if (firstConn >= 0) {
    // 첫 열차 고정: 출발 노드에서 다른 열차는 타지 않는다
    tripBoard[cTrip[firstConn]] = firstConn;
    tripRides[cTrip[firstConn]] = 1;
    tripSlack[cTrip[firstConn]] = INF;
    startIdx = firstConn;
  } else {
    for (const s of startNodes) {
      if (isHome[s]) return { arrive: startSec, homeNode: s, segments: [] };
      relax(s, startSec, 0, -1, 0);
    }
    startIdx = lowerBound(cDep, startSec);
  }

  let bestArr = INF;
  let bestRides = INF;
  let bestNode = -1;
  for (let c = startIdx; c < nConn; c++) {
    const dep = cDep[c];
    if (dep > bestArr) break; // 이후 연결은 더 일찍 도착할 수 없다
    const trip = cTrip[c];
    const from = cFrom[c];
    // 이 정차에서 탈 수 있으면 탄다. 이미 탄 열차라도 더 적은 탑승 수로, 또는 같은 탑승 수에 더 큰 여유로 탈 수 있으면
    // 여기서 다시 탄 것으로 본다. 여유 = dep − 탈 준비 시각 = 환승의 B(dep_D − arr_A − walk).
    // 먼저 닿는 정차에서 타면, 갈아탈 열차가 반대 방향일 때 분기역을 지나 더 간 역(여유가 가장 작은 곳)에서 갈아타게 된다
    if (readyTime[from] <= dep) {
      const r = readyRides[from] + 1;
      const slack = dep - readyTime[from];
      if (tripBoard[trip] < 0 || r < tripRides[trip] || (r === tripRides[trip] && slack > tripSlack[trip])) {
        tripBoard[trip] = c;
        tripRides[trip] = r;
        tripSlack[trip] = slack;
      }
    }
    if (tripBoard[trip] < 0) continue;

    const to = cTo[c];
    const arr = cArr[c];
    const rides = tripRides[trip];
    if (arr < arrTime[to] || (arr === arrTime[to] && rides < arrRides[to])) {
      arrTime[to] = arr;
      arrRides[to] = rides;
      arrConn[to] = c;
      arrBoard[to] = tripBoard[trip];
      if (isHome[to]) {
        if (arr < bestArr || (arr === bestArr && rides < bestRides)) {
          bestArr = arr;
          bestRides = rides;
          bestNode = to;
        }
        continue;
      }
      // (a) 같은 노드의 다른 열차: 0초(same_line 자기 환승이 있으면 그 도보), (b) 환승 자료의 다른 노드: 도보 후
      relax(to, arr + sameNodeWalk[to], rides, to, sameNodeWalk[to]);
      for (let e = adjStart[to]; e < adjStart[to + 1]; e++) {
        relax(adjTo[e], arr + adjWalk[e], rides, to, adjWalk[e]);
      }
    }
  }
  if (bestNode < 0) return null;

  // 도착 노드에서 거꾸로 따라가며 탑승 구간을 복원한다
  const segments = [];
  let node = bestNode;
  for (let guard = 0; guard < 64; guard++) {
    const board = arrBoard[node];
    const alight = arrConn[node];
    const from = cFrom[board];
    if (board === firstConn || readyPrev[from] === -1) {
      segments.push({ board, alight, walk: 0 });
      segments.reverse();
      return { arrive: bestArr, homeNode: bestNode, segments };
    }
    segments.push({ board, alight, walk: readyWalk[from] });
    node = readyPrev[from];
  }
  return null; // 복원이 끝나지 않음(자료 이상). 도착 불가로 처리
}

// 탑승 구간 → 화면용 legs(계약 3장 형식). 노드는 network.json nodes 배열 인덱스.
export function journeyLegs(net, tt, segments) {
  const legs = [];
  segments.forEach((s, i) => {
    const fromNode = tt.cFrom[s.board];
    if (i > 0) {
      const prevTo = tt.cTo[segments[i - 1].alight];
      legs.push({
        type: "transfer",
        from_node: prevTo,
        to_node: fromNode,
        walk_sec: s.walk,
        at_station: net.nodes[prevTo].station,
        arr: tt.cArr[segments[i - 1].alight],
        dep: tt.cDep[s.board],
      });
    }
    const trip = tt.trips[tt.cTrip[s.board]];
    const firstStop = tt.cStop[s.board];
    const lastStop = tt.cStop[s.alight] + 1;
    legs.push({
      type: "ride",
      line: trip.line,
      trip: trip.code,
      dir: trip.dir,
      express: trip.express,
      dest: trip.dest,
      from_node: fromNode,
      to_node: tt.cTo[s.alight],
      dep: tt.cDep[s.board],
      arr: tt.cArr[s.alight],
      stops: Array.from(tt.stopNode.subarray(firstStop, lastStop + 1)),
    });
  });
  return legs;
}

// 같은 여정인지 비교하는 서명: 탑승 구간마다 (탄 연결, 내린 연결).
// 노드만 쓰면 2호선 순환 열차가 같은 역을 두 번 지날 때 서로 다른 출발이 같은 여정으로 합쳐진다.
export function journeySignature(segments) {
  return segments.map((s) => `${s.board}>${s.alight}`).join("|");
}
