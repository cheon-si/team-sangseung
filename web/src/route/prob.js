// 경로 엔진 3/4: 환승 성공 확률과 경로 귀가 확률.
//   환승 하나(B 모형, 팀 최종 채택 — export_model_b.py · model_b.json):
//     Δ = 막차 출발 지연 − 도착열차 도착 지연, 성공 ⟺ S + Δ ≥ 0, S = dep_D − arr_A − W, W = 환승거리 ÷ 1.2m/s
//     ŷ = 절편 + F(도착노선) + L(갈아탈 노선) + 주말·공휴일 + el10 × (경과운행시간 분 / 10),  A_status = 실측(0)
//     p = 1 − #(잔차 < −S − ŷ) / n   (잔차 경험분포, 노선 공통)
//   경로: P = Π p_k + Σ_k (Π_{j<k} p_j)(1 − p_k) · q_k,  q_k = 놓친 시점에서 다시 찾은 최선 경로의 P (깊이 2까지)
//
//   B 채택 전 모형(2차 합성곱, 계약 2장 · Python validate.conv_matrix): p = Σ_{δ∈D} w_δ · F_A(B + δ).
//   아래 buildDists·pickArrDist·pickDepDist·transferProb 가 그 코드다. 지우지 않고 남겨 두지만, model_b.json 을 읽은
//   앱에서는 확률에 쓰지 않는다(model_b 가 없을 때만 대체로 쓰고, 화면의 "지연 분포 보기" 참고 그래프 키만 pickArrDist 로 고른다).

import { searchJourney } from "./csa.js";
import { lowerBound, transferDistance } from "./network.js";

export const MAX_DEPTH = 2; // 놓친 뒤 재탐색 깊이. 이 깊이의 경로는 q = 0(보수적)

// export_for_app.BAND_MEMBERS 와 같은 기본값. route_dists.json meta.band_members 가 있으면 그것을 쓴다
const DEFAULT_BAND_MEMBERS = {
  22: ["22"],
  23: ["23"],
  24: ["24"],
  "23-24": ["23", "24"],
  "22-23": ["22", "23"],
  all: ["22", "23", "24"],
};

// 표본 [[지연, 가중치], ...] → 누적 가중치 배열. 표본이 없으면 null.
// 가중치는 소수 6자리 반올림이라 합이 1 ± 2e-5 정도 어긋난다. 합으로 나눠 F(∞) = 1로 맞춘다
// (안 맞추면 여유가 아무리 커도 p가 0.99998에 머물거나 1을 넘는다).
function prepDist(key, entry) {
  if (!entry || !entry.samples || entry.samples.length === 0) return null;
  const n = entry.samples.length;
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  const cum = new Float64Array(n);
  let acc = 0;
  entry.samples.forEach(([delay, weight], i) => {
    x[i] = delay;
    w[i] = weight;
    acc += weight;
    cum[i] = acc;
  });
  for (let i = 0; i < n; i++) {
    w[i] /= acc;
    cum[i] /= acc;
  }
  return { key, x, w, cum, fallback: entry.fallback ?? null, n_nights: entry.n_nights ?? null };
}

// 표 하나 → Map(조회 키 → 분포). 분포의 key(화면에 보이는 a_dist_key/d_dist_key)는 labelOf로 만든다
function prepTable(obj, labelOf = (k) => k) {
  const out = new Map();
  for (const [key, entry] of Object.entries(obj ?? {})) {
    const d = prepDist(labelOf(key), entry);
    if (d) out.set(key, d);
  }
  return out;
}

// route_dists.json → 조회용 분포 묶음.
// 표시 키: arr_cells 는 delay_cdf.json 과 같은 dist_key, arr_last3 는 delay_cdf.json 의 "노선|요일|last3",
// D 분포는 두 표의 키가 같아서 "dep_last3:노선|요일" / "dep_all:노선|요일" 로 구분한다.
export function buildDists(raw) {
  const meta = raw?.meta ?? {};
  const bandMembers = meta.band_members ?? DEFAULT_BAND_MEMBERS;
  const arrCells = prepTable(raw?.arr_cells);
  // (노선, 요일 유형) → 그 노선의 시간대 셀 목록 [{key, members}]
  const cellsByLineDay = new Map();
  for (const [key, cell] of Object.entries(raw?.arr_cells ?? {})) {
    if (!arrCells.has(key)) continue;
    const ld = `${cell.line}|${cell.day_type}`;
    if (!cellsByLineDay.has(ld)) cellsByLineDay.set(ld, []);
    cellsByLineDay.get(ld).push({ key, members: new Set(bandMembers[cell.hour_band] ?? [cell.hour_band]) });
  }
  return {
    arrCells,
    cellsByLineDay,
    arrLast3: prepTable(raw?.arr_last3, (k) => `${k}|last3`),
    depLast3: prepTable(raw?.dep_last3, (k) => `dep_last3:${k}`),
    depAll: prepTable(raw?.dep_all, (k) => `dep_all:${k}`),
    lastkALines: new Set(meta.lastk_a_lines ?? []),
  };
}

// 시간표 도착 시각 → 시간대. 22시 전 도착은 "22"로 본다(common.HOUR_BANDS)
export function hourBandOf(sec) {
  if (sec >= 86400) return "24";
  if (sec >= 82800) return "23";
  return "22";
}

// A(타고 온 열차) 도착 지연 분포. LASTK 노선의 마지막 3편 도착(flags&1)이면 arr_last3, 아니면 시간대 셀
export function pickArrDist(dists, line, dayType, arrSec, flags) {
  if (dists.lastkALines.has(line) && flags & 1) {
    const d = dists.arrLast3.get(`${line}|${dayType}`);
    if (d) return d;
  }
  const band = hourBandOf(arrSec);
  for (const cell of dists.cellsByLineDay.get(`${line}|${dayType}`) ?? []) {
    if (cell.members.has(band)) return dists.arrCells.get(cell.key);
  }
  return null;
}

// D(갈아탈 열차) 출발 지연 분포. 마지막 3편 출발(flags&2)이면 dep_last3, 아니면 dep_all.
// 고른 쪽이 없으면 다른 쪽으로 대체한다(계약에 없는 보조 규칙, d_dist_key로 어느 쪽인지 보인다)
export function pickDepDist(dists, line, dayType, flags) {
  const key = `${line}|${dayType}`;
  const first = flags & 2 ? dists.depLast3 : dists.depAll;
  const second = flags & 2 ? dists.depAll : dists.depLast3;
  return first.get(key) ?? second.get(key) ?? null;
}

// F(x) = Σ_{a ≤ x} w_a (이진 탐색)
export function cdfAt(dist, x) {
  let lo = 0;
  let hi = dist.x.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dist.x[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? dist.cum[lo - 1] : 0;
}

/**
 * 환승 성공 확률 p = Σ_δ w_δ · F_A(B + δ).
 * D 표본 δ가 오름차순이라 B + δ도 오름차순 → A 쪽 포인터를 한 방향으로만 옮기면 된다(O(nA + nD)).
 * 분포가 없을 때: D 없음 → F_A(B)(1차, prob_table first_order_fallback 과 같음), A 없음 → A 지연 0, 둘 다 없음 → 시간표 1[B ≥ 0].
 */
export function transferProb(aDist, dDist, buffer) {
  if (!aDist && !dDist) return buffer >= 0 ? 1 : 0;
  if (!dDist) return Math.min(1, cdfAt(aDist, buffer));
  if (!aDist) {
    let p = 0;
    for (let j = 0; j < dDist.x.length; j++) if (buffer + dDist.x[j] >= 0) p += dDist.w[j];
    return Math.min(1, p);
  }
  let p = 0;
  let i = 0; // A에서 x ≤ B + δ 인 표본 개수
  const nA = aDist.x.length;
  for (let j = 0; j < dDist.x.length; j++) {
    const lim = buffer + dDist.x[j];
    while (i < nA && aDist.x[i] <= lim) i++;
    if (i > 0) p += dDist.w[j] * aDist.cum[i - 1];
  }
  return Math.min(1, p);
}

// ── B 모형 ────────────────────────────────────────────────────

export const WALK_SPEED_B = 1.2; // m/s. B 정의 W = 환승거리 ÷ 1.2
const WEEKEND_KEY = "daytype[주말·공휴일]";

// model_b.json → { coef, resid(정렬 Float64Array), n, meta }. 없거나 비었으면 null
export function buildModelB(raw) {
  if (!raw || !raw.coef || !raw.resid || raw.resid.length === 0) return null;
  return { coef: raw.coef, resid: Float64Array.from(raw.resid), n: raw.resid.length, meta: raw.meta ?? {} };
}

// 노선 + 열차코드 → 모형 범주. 2호선 지선 열차는 코드가 1xxx(성수지선)·5xxx(신정지선), 본선은 2xxx
export function lineLabelB(line, code) {
  if (line === "2" && !String(code).startsWith("2")) return "2호선지선";
  return `${line}호선`;
}

// ŷ(예측 Δ, 초). 더하는 순서는 Python export_model_b.predict_delta 와 같다(부동소수 결과까지 같게)
export function predictDeltaB(model, fLabel, lLabel, weekend, el10) {
  const cf = model.coef;
  let y = cf["절편"];
  y += cf[`F[${fLabel}]`] ?? 0;
  y += cf[`L[${lLabel}]`] ?? 0;
  y += weekend ? (cf[WEEKEND_KEY] ?? 0) : 0;
  y += cf.el10 * el10;
  return y;
}

// p = 1 − #(잔차 < −S − ŷ) / n  (Python np.searchsorted(side="left")와 같음)
export function probB(model, slack, yhat) {
  return 1 - lowerBound(model.resid, -slack - yhat) / model.n;
}

// p ≥ target 이 되는 최소 시간표 여유 S.
// p(S) ≥ target ⟺ #(잔차 < −S − ŷ) ≤ k, k = ⌊n(1 − target)⌋ ⟺ −S − ŷ ≤ 잔차[k] ⟺ S ≥ −잔차[k] − ŷ
export function requiredSlackB(model, yhat, target) {
  const k = Math.floor(model.n * (1 - target) + 1e-9);
  return -model.resid[k] - yhat;
}

// W(초): 환승거리 ÷ 1.2. 거리 자료가 없으면 환승 소요시간
export const walkB = (distanceM, walkSec) => (distanceM != null ? distanceM / WALK_SPEED_B : walkSec);

/**
 * 환승 하나의 B 확률과 근거.
 * 입력: 타고 온 열차(aLine, aCode, aStart = 시발역 출발 초), 갈아탈 열차(dLine, dCode), arrA, depD, walkW(초), dayType.
 * el10 = (arrA − aStart) / 600. 시발 시각이 없으면 el10 = 0(구버전 trips 데이터).
 * 출력: p, yhat(예측 Δ), slack(S), s90·s80(그 확률이 되는 최소 S), el10, 범주 이름
 */
export function transferProbB(model, { aLine, aCode, aStart, arrA, dLine, dCode, depD, walkW, dayType }) {
  const el10 = aStart != null ? (arrA - aStart) / 600 : 0;
  const fLabel = lineLabelB(aLine, aCode);
  const lLabel = lineLabelB(dLine, dCode);
  const yhat = predictDeltaB(model, fLabel, lLabel, dayType === "weekend", el10);
  const slack = depD - arrA - walkW;
  return {
    p: probB(model, slack, yhat),
    yhat,
    slack,
    s90: requiredSlackB(model, yhat, 0.9),
    s80: requiredSlackB(model, yhat, 0.8),
    el10,
    fLabel,
    lLabel,
  };
}

// 경로 확률 공식(환승 간 독립 가정). ps[k] = 환승 k 성공 확률, qs[k] = 놓쳤을 때 귀가 확률
export function routeProbability(ps, qs) {
  let prefix = 1; // Π_{j<k} p_j
  let missed = 0;
  for (let k = 0; k < ps.length; k++) {
    missed += prefix * (1 - ps[k]) * qs[k];
    prefix *= ps[k];
  }
  return prefix + missed;
}

// prob_table.json 행을 (태그, 역, 노선·방향) 키로 묶는다. 경로의 환승이 막차 조합이면 그 행(p_b·s90_sec 등)을 붙인다
export function buildProbIndex(probTable) {
  if (!probTable || !probTable.rows) return null;
  const index = new Map();
  for (const r of probTable.rows) {
    const key = [r.tt_tag, r.station, r.to_station, r.from_line, r.in_dir, r.to_line, r.out_dir].join("|");
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(r);
  }
  return index;
}

// 환승이 prob_table 막차 조합과 같은지: 같은 역·노선·방향·태그이고 A 도착·D 출발 시각까지 같으면 그 행
function matchProbRow(ctx, aNode, dNode, tripA, tripD, arrA, depD) {
  if (!ctx.probIndex) return null;
  const { nodes } = ctx.net;
  const key = [ctx.tag, nodes[aNode].nm, nodes[dNode].nm, tripA.line, tripA.dir, tripD.line, tripD.dir].join("|");
  return (ctx.probIndex.get(key) ?? []).find((r) => r.arrive_sec === arrA && r.depart_sec === depD) ?? null;
}

/**
 * 탑승 구간 목록의 귀가 확률과 환승별 상세.
 * ctx = { net, tt, dists, modelB, dayType, tag, homeNodes, probIndex, memo(Map) } — 한 번의 planTrip 동안 공유
 * depth = 재탐색 깊이(최상위 경로 0). depth ≥ MAX_DEPTH 이면 q = 0.
 */
export function evaluateJourney(ctx, segments, depth = 0) {
  const { net, tt, dists, dayType } = ctx; // ctx.modelB = buildModelB(model_b.json) (없으면 B 채택 전 모형)
  const transfers = [];
  for (let k = 1; k < segments.length; k++) {
    const aConn = segments[k - 1].alight;
    const dConn = segments[k].board;
    const aNode = tt.cTo[aConn];
    const dNode = tt.cFrom[dConn];
    const tripA = tt.trips[tt.cTrip[aConn]];
    const tripD = tt.trips[tt.cTrip[dConn]];
    const arrA = tt.cArr[aConn];
    const depD = tt.cDep[dConn];
    const walk = segments[k].walk;
    const buffer = depD - arrA - walk;
    // "지연 분포 보기" 참고 그래프용 키(B 채택 전 모형의 도착 지연 분포). 확률에는 쓰지 않는다
    const aDist = pickArrDist(dists, tripA.line, dayType, arrA, tt.stopFlags[tt.cStop[aConn] + 1]);
    let b = null;
    let p;
    if (ctx.modelB) {
      // B 모형: W = 환승거리 ÷ 1.2 (탐색·결정적 환승 판단은 지금처럼 환승 소요시간 walk 로 한다)
      const walkW = walkB(transferDistance(net, aNode, dNode), walk);
      b = transferProbB(ctx.modelB, {
        aLine: tripA.line, aCode: tripA.code, aStart: tripA.start ?? null, arrA,
        dLine: tripD.line, dCode: tripD.code, depD, walkW, dayType,
      });
      p = b.p;
    } else {
      // model_b.json 이 없을 때만(구버전 데이터·옛 테스트) B 채택 전 모형
      const dDist = pickDepDist(dists, tripD.line, dayType, tt.stopFlags[tt.cStop[dConn]]);
      p = transferProb(aDist, dDist, buffer);
    }
    const t = {
      at_station: net.nodes[aNode].station,
      from_line: tripA.line,
      to_line: tripD.line,
      from_trip: tripA.code,
      to_trip: tripD.code,
      from_node: aNode,
      to_node: dNode,
      arr_A: arrA,
      dep_D: depD,
      walk_sec: walk,
      buffer_sec: buffer,
      p,
      q: 0,
      critical: false,
      model: b ? "B" : "pre_b",
      // B 근거(화면 문구용): S(B 정의 시간표 여유, W = 거리 ÷ 1.2), ŷ, 90%·80% 확률이 되는 최소 S, 경과운행시간(분)
      slack_sec: b ? b.slack : buffer,
      yhat: b ? b.yhat : null,
      s90: b ? b.s90 : null,
      s80: b ? b.s80 : null,
      el_min: b ? b.el10 * 10 : null,
      a_dist_key: aDist ? aDist.key : null,
    };
    if (depth === 0) {
      const row = matchProbRow(ctx, aNode, dNode, tripA, tripD, arrA, depD);
      if (row) t.prob_row = row;
    }
    transfers.push(t);
  }

  // q_k: 환승 k를 놓치면 다시 찾은 최선 경로의 귀가 확률. 놓쳤다 = A에서 내린 시각이 dep_D − walk 뒤라는 뜻이므로
  // A에서 내린 노드에 dep_D − walk + 1초에 서 있는 것으로 보고, 같은 역 다른 노드(다른 노선)는 환승 도보만큼 뒤에 출발한다.
  // D 노드에는 dep_D + 1초에 닿으므로 놓친 D는 다시 탈 수 없다. (예전에는 D 노드에서만 다시 찾아, 같은 역의 다른 노선으로
  // 집에 갈 수 있어도 결정적 환승(⚠)으로 표시됐다: 평일 결정적 환승 958건 중 42건)
  // 최상위(depth 0)는 화면의 결정적 환승 표시 때문에 모두 계산하고, 그 아래는 결과에 영향이 있을 때만 계산한다.
  let prefix = 1;
  for (const t of transfers) {
    const matters = depth === 0 || (t.p < 1 && prefix > 0);
    if (depth < MAX_DEPTH && matters) t.q = missedProb(ctx, t.from_node, t.dep_D - t.walk_sec + 1, depth + 1);
    t.critical = t.q === 0;
    prefix *= t.p;
  }
  const p_home = routeProbability(
    transfers.map((t) => t.p),
    transfers.map((t) => t.q),
  );
  return { p_home, transfers };
}

// A에서 내린 노드에 sec 시각에 서 있을 때 다시 탐색한 최선 경로의 귀가 확률(메모이즈).
// 출발 노드 = 그 노드(같은 노드 다른 열차는 sameNodeWalk 뒤) + 환승으로 이어진 노드(도보 뒤)
function missedProb(ctx, node, sec, depth) {
  const key = `${node}|${sec}|${depth}`;
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  const { sameNodeWalk, adjStart, adjTo, adjWalk } = ctx.net;
  const startNodes = [node];
  const startTimes = [sec + sameNodeWalk[node]];
  for (let k = adjStart[node]; k < adjStart[node + 1]; k++) {
    startNodes.push(adjTo[k]);
    startTimes.push(sec + adjWalk[k]);
  }
  const res = searchJourney(ctx.net, ctx.tt, { startNodes, startTimes, homeNodes: ctx.homeNodes });
  const p = res ? evaluateJourney(ctx, res.segments, depth).p_home : 0;
  ctx.memo.set(key, p);
  return p;
}
