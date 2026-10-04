// 경로 엔진(src/route/)을 실제 데이터(public/data)로 돌려, check_route.py 의 Python 기준 구현과 대조할 결과를 JSON으로 쓴다.
// 실행: node web/scripts/route_check.mjs <질의.json> <결과.json>   (보통 저장소 루트의 check_route.py 가 부른다)
// 질의 = { transfers: [ {tag, B, a:[line, code, 정차 i], d:[line, code, 정차 i]} | null ],
//          plans: [ {id, tag, origin, home, nowSec} ] }
// 결과 = { transfers: [ {p, a_dist_key, d_dist_key} | null ], plans: [ {id, ms, status, best, options, leave_by} ] }

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { loadRouteData, planTrip, timetableOf } from "../src/route/index.js";
import { pickArrDist, pickDepDist, transferProb } from "../src/route/prob.js";
import { NONE } from "../src/route/network.js";

const DATA_DIR = new URL("../public/data/", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, DATA_DIR), "utf8"));

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("사용법: node web/scripts/route_check.mjs <질의.json> <결과.json>");
  process.exit(2);
}
const queries = JSON.parse(readFileSync(inPath, "utf8"));
const data = await loadRouteData(async (name) => readJson(name));

// 요일 태그별 (노선|열차코드) → 열차 index. 시간표는 여기서 미리 만들어 planTrip 시간에서 뺀다
const tripIdx = {};
for (const tag of ["DAY", "SAT", "END"]) {
  timetableOf(data, tag);
  tripIdx[tag] = new Map(data.rawTrips[tag].trips.map((t, i) => [`${t.line}|${t.code}`, i]));
}

// prob_table 행 하나: 엔진의 분포 선택(pickArrDist·pickDepDist)과 transferProb 를 그대로 쓴다
function transferQuery(q) {
  if (!q) return null;
  const tt = timetableOf(data, q.tag);
  const dayType = q.tag === "DAY" ? "weekday" : "weekend";
  const stopOf = ([line, code, i]) => ({ line, s: tt.tripStart[tripIdx[q.tag].get(`${line}|${code}`)] + i });
  const a = stopOf(q.a);
  const d = stopOf(q.d);
  const arrA = tt.stopArr[a.s] !== NONE ? tt.stopArr[a.s] : tt.stopDep[a.s];
  const aDist = pickArrDist(data.dists, a.line, dayType, arrA, tt.stopFlags[a.s]);
  const dDist = pickDepDist(data.dists, d.line, dayType, tt.stopFlags[d.s]);
  return { p: transferProb(aDist, dDist, q.B), a_dist_key: aDist?.key ?? null, d_dist_key: dDist?.key ?? null };
}

// 결과 크기를 줄인다: legs 의 stops 배열과 prob_row 원본 행은 빼고 combo_id 만 남긴다
function slim(j) {
  if (!j) return null;
  return {
    ...j,
    legs: j.legs.map(({ stops, ...rest }) => rest),
    transfers: j.transfers.map(({ prob_row, ...rest }) => ({ ...rest, prob_row: prob_row ? prob_row.combo_id : null })),
  };
}

const out = { transfers: queries.transfers.map(transferQuery), plans: [] };
for (const q of queries.plans) {
  const t0 = performance.now();
  const r = planTrip(data, q);
  const ms = performance.now() - t0;
  out.plans.push({
    id: q.id,
    ms,
    status: r.status,
    best: slim(r.best),
    options: r.options.map((o) => ({ ...o, journey: slim(o.journey) })),
    leave_by: r.leave_by,
  });
}
writeFileSync(outPath, JSON.stringify(out));
console.log(`route_check: 환승 질의 ${out.transfers.length}, planTrip ${out.plans.length} → ${outPath}`);
