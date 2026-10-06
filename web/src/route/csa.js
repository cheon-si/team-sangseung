// 경로 엔진 2/4: Connection Scan Algorithm, 라운드 방식. 귀가 확률로 고를 후보 여정을 모은다.
// 라운드 k = 열차를 k번 이하로 타고 각 노드에 몇 시에 서 있을 수 있나. 라운드마다 연결을 출발 시각 순으로 한 번 훑는다.
// 후보 = 라운드 k(탑승 ≤ k회)마다, 집 역의 노드(노선)마다 가장 일찍 닿는 여정 중 "가장 이른 도착 + ARRIVAL_SLACK" 이내인 것.
//   도착 시각 vs 탑승 수 파레토 집합을 집 노드별로 나눈 것이다. 집 역이 여러 노선이면 같은 시각에 다른 노선으로 닿는 여정이
//   따로 남는다(마포→잠실 00:05: 5호선→천호→8호선 잠실, 5호선→을지로4가→2호선→성수→2호선 잠실 둘 다 00:54 도착).
// 어느 후보를 쓸지는 귀가 확률로 고른다(prob.js chooseJourney). 예전에는 가장 이른 도착 여정 하나(그중 탑승 수 최소)만
// 돌려줘서, 같은 시각에 닿는 더 안전한 경로를 버렸다.
// 단일 라벨(한 번 훑기)이 아니라 라운드로 나누는 이유: 같은 시각에 닿는 2회 탑승 여정이 있어도 중간 역에 먼저 닿은
// 3회 탑승 여정만 남는 일이 생긴다(예: 9:종합운동장 23:14 → 논현).
// 같은 라운드에서 같은 열차를 여러 정차에서 탈 수 있으면 시간표 여유(출발 − 탈 준비 시각 = 환승 B)가 가장 큰 정차에서 탄다.
// 예: 안양→부천은 1호선 S510을 신도림까지 갔다 K227로 되돌아오는(B 0초) 대신 구로에서 갈아탄다(B 360초).
// 기준 구현 check_route.py csa_candidates()와 같은 규칙이다.

import { lowerBound } from "./network.js";

const INF = 0x7fffffff;
const MAX_ROUNDS = 10; // 탑승 수 상한(막차 귀가 경로는 실제로 4회를 넘지 않는다)
// 후보로 볼 도착 지연 상한(초): 가장 이른 도착 + 20분. 막차 시간대 배차 간격(10~20분)이면 "한 편 늦은 열차로 가는 다른 길"까지
// 후보에 들어온다. 그보다 늦게 닿는 여정은 확률이 높아도 귀가 안내로 권하기 어렵고, 탐색이 이 시각을 넘겨 떠나는 연결에서
// 끊으므로 값이 클수록 느려진다(라운드마다 훑는 연결 수와 확률을 계산할 후보 수가 같이 는다).
export const ARRIVAL_SLACK = 1200;

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
 * 집 역까지의 후보 여정들: 라운드 k(탑승 ≤ k회) × 집 노드마다 가장 이른 도착 여정, 가장 이른 도착 + ARRIVAL_SLACK 이내.
 * opts.startNodes  출발 노드들(그 시각에 이미 서 있음)
 * opts.startSec    출발 시각(운영일 초)
 * opts.startTimes  (선택) startNodes와 같은 길이. 노드마다 다른 출발 시각(놓친 뒤 같은 역 다른 노선으로 걸어가는 재탐색용)
 * opts.homeNodes   집 물리 역의 노드들
 * opts.firstConn   ≥ 0이면 이 연결(정렬 위치)의 열차를 첫 열차로 고정한다. startNodes는 무시.
 * 반환: [{ arrive, homeNode, segments: [{ board, alight, walk }] }, ...] — 도착 불가면 빈 배열.
 *   순서 = 라운드 오름차순, 같은 라운드는 집 노드 번호 오름차순. 같은 여정(탑승 구간이 모두 같음)은 처음 것만 남긴다.
 *   segments = 열차 탑승 구간. board/alight = 탄·내린 연결 위치, walk = 그 구간을 타기 전 환승 도보(첫 구간 0).
 */
export function searchCandidates(net, tt, opts) {
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
      if (isHome[s]) return [{ arrive: readyTime[s], homeNode: s, segments: [] }];
    }
    startIdx = lowerBound(cDep, minStart);
  }

  let limit = INF; // 후보 도착 상한 = 지금까지 찾은 가장 이른 집 도착 + ARRIVAL_SLACK
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
      // 상한보다 늦게 떠나면 상한 안에 집에 닿을 수 없다. 상한 안에 닿는 여정의 연결은 모두 상한 전에 떠나므로
      // 여기서 끊어도 라운드·집 노드별 가장 이른 도착(상한 이내)은 끊지 않은 경우와 같다(라운드마다 자기 최선 기준)
      if (dep > limit) break;
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
      if (isHome[to] && arr + ARRIVAL_SLACK < limit) limit = arr + ARRIVAL_SLACK;
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

  // 라운드 k 의 집 노드 도착 기록에서 거꾸로 따라가며 탑승 구간을 복원한다
  const restore = (k, node) => {
    const arrive = arrTime[k * n + node];
    const segments = [];
    for (let guard = 0; guard <= rounds; guard++) {
      const board = arrBoard[k * n + node];
      const alight = arrConn[k * n + node];
      const src = (k - 1) * n + cFrom[board]; // 이 열차를 탄 정차의 ready 기록(앞 라운드)
      if (board === firstConn || readyRound[src] === -1) {
        segments.push({ board, alight, walk: 0 });
        segments.reverse();
        return { arrive, homeNode: cTo[segments.at(-1).alight], segments };
      }
      segments.push({ board, alight, walk: readyWalk[src] });
      node = readyFrom[src];
      k = readyRound[src];
    }
    return null; // 복원이 끝나지 않음(자료 이상). 후보에서 뺀다
  };
  const homes = [...homeNodes].sort((a, b) => a - b);
  const out = [];
  const seen = new Set();
  for (let k = 1; k <= rounds; k++) {
    for (const h of homes) {
      const t = arrTime[k * n + h];
      if (t === INF || t > limit) continue; // 못 닿았거나 상한 밖
      const res = restore(k, h);
      if (!res) continue;
      const sig = journeySignature(res.segments);
      if (seen.has(sig)) continue; // 앞 라운드와 같은 여정(더 타도 더 일찍 못 닿음)
      seen.add(sig);
      out.push(res);
    }
  }
  return out;
}

/**
 * 가장 빨리 집 역에 도착하는 여정(동률이면 탑승 수가 적은 여정 = 먼저 닿은 라운드, 그다음 번호가 작은 집 노드).
 * = 후보 중 도착이 가장 이른 첫 후보. 경로 선택(planTrip·놓친 뒤 재탐색)은 귀가 확률로 고르는 prob.js chooseJourney 를 쓰고,
 * 이 함수는 테스트·점검용으로 남긴다. 반환: { arrive, homeNode, segments } 또는 null(도착 불가).
 */
export function searchJourney(net, tt, opts) {
  let best = null;
  for (const r of searchCandidates(net, tt, opts)) if (!best || r.arrive < best.arrive) best = r;
  return best;
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
