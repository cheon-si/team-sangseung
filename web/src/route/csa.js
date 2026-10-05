// 경로 엔진 2/4: Connection Scan Algorithm(earliest arrival), 라운드 방식.
// 라운드 k = 열차를 k번 이하로 타고 각 노드에 몇 시에 서 있을 수 있나. 라운드마다 연결을 출발 시각 순으로 한 번 훑는다.
// 가장 이른 도착 시각에 처음 닿는 라운드의 여정 = "가장 일찍 도착하는 여정 중 탑승 수가 가장 적은 여정"(계약 3장 동률 규칙).
// 한 번 훑기(단일 라벨)로는 이 규칙이 깨진다: 같은 시각에 닿는 2회 탑승 여정이 있어도 중간 역에 먼저 닿은 3회 탑승 여정이 남는다
// (예: 9:종합운동장 23:14 → 논현. 9호선 급행 → 고속터미널 7호선 대신 2호선 → 교대 3호선 → 고속터미널 7호선).
// 같은 라운드에서 같은 열차를 여러 정차에서 탈 수 있으면 시간표 여유(출발 − 탈 준비 시각 = 환승 B)가 가장 큰 정차에서 탄다.
// 예: 안양→부천은 1호선 S510을 신도림까지 갔다 K227로 되돌아오는(B 0초) 대신 구로에서 갈아탄다(B 360초).
// 기준 구현 check_route.py csa()와 같은 규칙이다.

import { lowerBound } from "./network.js";

const INF = 0x7fffffff;
const MAX_ROUNDS = 10; // 탑승 수 상한(막차 귀가 경로는 실제로 4회를 넘지 않는다)

// 탐색용 작업 배열. 시간표(요일 태그)마다 한 벌 만들어 재사용한다(탐색 한 번마다 새로 만들지 않음).
// 재귀 확률 계산이 탐색을 다시 부르지만, 탐색은 결과를 일반 배열로 복원한 뒤 끝나므로 공유해도 안전하다.
// 라운드별 배열은 [라운드 × 노드] 한 줄로 편다. ready 쪽은 라운드 0(출발)~MAX_ROUNDS, alight 쪽은 라운드 1~MAX_ROUNDS.
function scratchOf(tt) {
  if (!tt.scratch) {
    const n = tt.nNodes;
    const R = MAX_ROUNDS + 1;
    tt.scratch = {
      readyTime: new Int32Array(R * n), // 라운드 k까지 이 노드에서 열차를 탈 수 있는 가장 이른 시각
      readyRound: new Int32Array(R * n), // 그 시각을 만든 하차 기록의 라운드(-1 = 출발 노드)
      readyFrom: new Int32Array(R * n), // 그 하차 노드
      readyWalk: new Int32Array(R * n), // 하차 노드에서 걸어온 시간(초)
      arrTime: new Int32Array(R * n), // 라운드 k에 열차로 이 노드에 도착한 가장 이른 시각
      arrConn: new Int32Array(R * n), // 내린 연결
      arrBoard: new Int32Array(R * n), // 그 열차를 탄 연결
      isHome: new Uint8Array(n),
      tripBoard: new Int32Array(tt.nTrips), // 이번 라운드에 열차를 탄 연결(-1 = 아직 못 탐)
      tripSlack: new Int32Array(tt.nTrips), // 그 정차의 시간표 여유
    };
  }
  return tt.scratch;
}

/**
 * 가장 빨리 집 역에 도착하는 여정(동률이면 탑승 수가 적은 여정).
 * opts.startNodes  출발 노드들(그 시각에 이미 서 있음)
 * opts.startSec    출발 시각(운영일 초)
 * opts.startTimes  (선택) startNodes와 같은 길이. 노드마다 다른 출발 시각(놓친 뒤 같은 역 다른 노선으로 걸어가는 재탐색용)
 * opts.homeNodes   집 물리 역의 노드들(아무 노드나 도착하면 끝)
 * opts.firstConn   ≥ 0이면 이 연결(정렬 위치)의 열차를 첫 열차로 고정한다. startNodes는 무시.
 * 반환: { arrive, homeNode, segments: [{ board, alight, walk }] } 또는 null(도착 불가).
 *   segments = 열차 탑승 구간. board/alight = 탄·내린 연결 위치, walk = 그 구간을 타기 전 환승 도보(첫 구간 0).
 */
export function searchJourney(net, tt, opts) {
  const { startNodes = [], startSec, startTimes = null, homeNodes, firstConn = -1 } = opts;
  const n = tt.nNodes;
  const sc = scratchOf(tt);
  const { readyTime, readyRound, readyFrom, readyWalk, arrTime, arrConn, arrBoard, isHome, tripBoard, tripSlack } = sc;
  const { cDep, cArr, cFrom, cTo, cTrip, nConn } = tt;
  const { sameNodeWalk, adjStart, adjTo, adjWalk } = net;

  isHome.fill(0);
  for (const h of homeNodes) isHome[h] = 1;
  readyTime.fill(INF, 0, n); // 라운드 0 = 출발
  let startIdx;
  if (firstConn >= 0) {
    startIdx = firstConn;
  } else {
    let minStart = INF;
    startNodes.forEach((s, i) => {
      const t = startTimes ? startTimes[i] : startSec;
      if (t < readyTime[s]) {
        readyTime[s] = t;
        readyRound[s] = -1;
      }
      minStart = Math.min(minStart, t);
    });
    for (const s of startNodes) {
      if (isHome[s]) return { arrive: readyTime[s], homeNode: s, segments: [] };
    }
    startIdx = lowerBound(cDep, minStart);
  }

  let bestArr = INF;
  let bestRound = -1;
  let rounds = 0;
  for (let k = 1; k <= MAX_ROUNDS; k++) {
    const prev = (k - 1) * n; // 이번 라운드에 탈 수 있는 시각 = 앞 라운드까지의 ready
    const cur = k * n;
    // 이번 라운드의 ready는 앞 라운드 것을 이어받고, 이번 하차로 더 이른 시각이 생기면 갱신한다
    readyTime.copyWithin(cur, prev, prev + n);
    readyRound.copyWithin(cur, prev, prev + n);
    readyFrom.copyWithin(cur, prev, prev + n);
    readyWalk.copyWithin(cur, prev, prev + n);
    arrTime.fill(INF, cur, cur + n);
    tripBoard.fill(-1);
    tripSlack.fill(-1);
    let changed = false;

    for (let c = startIdx; c < nConn; c++) {
      const dep = cDep[c];
      if (dep >= bestArr) break; // 이보다 늦게 떠나면 집에 더 일찍 닿을 수 없다
      const trip = cTrip[c];
      if (firstConn >= 0 && k === 1) {
        // 첫 열차 고정: 1라운드에는 그 열차만 탄다
        if (c === firstConn) {
          tripBoard[trip] = c;
          tripSlack[trip] = INF;
        }
      } else {
        const ready = readyTime[prev + cFrom[c]];
        if (ready <= dep && dep - ready > tripSlack[trip]) {
          tripBoard[trip] = c;
          tripSlack[trip] = dep - ready;
        }
      }
      if (tripBoard[trip] < 0) continue;

      const to = cTo[c];
      const arr = cArr[c];
      if (arr >= arrTime[cur + to]) continue;
      arrTime[cur + to] = arr;
      arrConn[cur + to] = c;
      arrBoard[cur + to] = tripBoard[trip];
      if (isHome[to] && arr < bestArr) {
        bestArr = arr;
        bestRound = k;
      }
      // (a) 같은 노드의 다른 열차: 0초(same_line 자기 환승이 있으면 그 도보), (b) 환승 자료의 다른 노드: 도보 후
      const relax = (m, walk) => {
        const t = arr + walk;
        if (t < readyTime[cur + m]) {
          readyTime[cur + m] = t;
          readyRound[cur + m] = k;
          readyFrom[cur + m] = to;
          readyWalk[cur + m] = walk;
          changed = true;
        }
      };
      relax(to, sameNodeWalk[to]);
      for (let e = adjStart[to]; e < adjStart[to + 1]; e++) relax(adjTo[e], adjWalk[e]);
    }
    rounds = k;
    if (!changed) break; // 더 탈 수 있는 곳이 없다
  }
  if (bestRound < 0) return null;

  // 도착 라운드의 집 노드(같은 시각이면 번호가 작은 노드)에서 거꾸로 따라가며 탑승 구간을 복원한다
  let node = -1;
  for (const h of homeNodes) {
    const t = arrTime[bestRound * n + h];
    if (t === bestArr && (node < 0 || h < node)) node = h;
  }
  const segments = [];
  let k = bestRound;
  for (let guard = 0; guard <= rounds; guard++) {
    const board = arrBoard[k * n + node];
    const alight = arrConn[k * n + node];
    const from = cFrom[board];
    const src = (k - 1) * n + from; // 이 열차를 탄 정차의 ready 기록(앞 라운드)
    if (board === firstConn || readyRound[src] === -1) {
      segments.push({ board, alight, walk: 0 });
      segments.reverse();
      return { arrive: bestArr, homeNode: segments.length ? cTo[segments.at(-1).alight] : node, segments };
    }
    segments.push({ board, alight, walk: readyWalk[src] });
    const nextK = readyRound[src];
    node = readyFrom[src];
    k = nextK;
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
