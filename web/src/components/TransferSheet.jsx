import { lazy, Suspense, useState } from "react";
import { useJson } from "../data";
import { hhmm, minText, pctText, signedMinText, TONE, toneOf, withYeok } from "../format";
import { lineColorOf } from "../usePlan";
import Icon from "./Icon";
import LinePill from "./LinePill";
import MissedAlt from "./MissedAlt";

// 그래프 라이브러리(recharts)는 무거워서 "지연 분포 보기"를 눌렀을 때만 불러온다
const CdfChart = lazy(() => import("./CdfChart"));

// 화면 3. 위험 환승 상세 — 확률·95% 구간·시간표 여유·도보·쉬운 설명 한 문장. 분포 그래프는 접어 둔다.
export default function TransferSheet({ data, transfer: t }) {
  const cdf = useJson("delay_cdf");
  const [showChart, setShowChart] = useState(false);
  const tone = toneOf(t.p);
  const dist = arrivalDist(cdf, t.a_dist_key);
  const row = t.prob_row;

  return (
    <div className="px-5 pt-2 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="transfer-title" className="truncate text-[24px] font-bold">{t.at_station}</h2>
          <div className="mt-1.5 flex items-center gap-1.5 text-[14px] text-ink-300">
            <LinePill line={t.from_line} color={lineColorOf(data, t.from_line)} />
            <span className="text-ink-500">→</span>
            <LinePill line={t.to_line} color={lineColorOf(data, t.to_line)} />
            <span>환승</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[44px] leading-none font-extrabold tracking-[-0.03em] tabular-nums ${TONE[tone].text}`}>{pctText(t.p)}</div>
          <div className="mt-1 text-[12px] text-ink-400">환승 성공 확률</div>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-ink-400 tabular-nums">
        {row?.ci_low != null ? `95% 구간 ${pctText(row.ci_low)}~${pctText(row.ci_high)}` : "95% 구간 미산출"}
        {` · ${basisText(t)}`}
        {cdf?.meta?.provisional ? " · 잠정" : ""}
      </p>

      {t.critical && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-danger/15 px-3 py-2.5 text-[14px] font-semibold text-danger">
          <Icon name="warning" className="h-5 w-5 shrink-0" strokeWidth={2.4} />
          {/* 엔진은 놓친 뒤 갈아탈 노선 승강장(D 노드)에서만 다시 찾는다(계약 2장). 같은 역 다른 노선으로 걸어가는 길은 보지 않으므로 그 범위로만 말한다 */}
          놓치면 이 역에서 지하철로는 집에 못 가요
        </div>
      )}

      <dl className="mt-4 divide-y divide-night-700 rounded-2xl bg-night-900 px-4 text-[15px]">
        <Fact k="시간표 여유" v={signedMinText(t.buffer_sec)} strong />
        <Fact k="환승 도보" v={minText(t.walk_sec)} strong />
        <Fact k={`${t.from_line}호선 도착 (시간표)`} v={hhmm(t.arr_A)} />
        <Fact k={`${t.to_line}호선 출발 (시간표)`} v={hhmm(t.dep_D)} />
        {!t.critical && <Fact k="놓쳤을 때 귀가 확률" v={pctText(t.q)} />}
      </dl>

      <p className="mt-4 text-[16px] leading-relaxed text-ink-100">{plainSentence(t, dist)}</p>

      {t.critical && (
        <div className="mt-4">
          <div className="text-[13px] font-semibold text-ink-400">놓치면 · {withYeok(t.at_station)} 근처</div>
          <MissedAlt station={t.at_station} compact />
        </div>
      )}

      {dist && (
        <>
          <button
            type="button"
            aria-expanded={showChart}
            onClick={() => setShowChart((v) => !v)}
            className="mt-5 flex min-h-12 w-full items-center justify-between rounded-2xl bg-night-700 px-4 text-[15px] font-semibold"
          >
            지연 분포 보기
            <Icon name="chevronDown" className={`h-5 w-5 transition-transform ${showChart ? "rotate-180" : ""}`} />
          </button>
          {showChart && (
            <div className="mt-3">
              <p className="mb-2 text-[13px] leading-relaxed text-ink-400">
                {t.from_line}호선이 이 시간대에 늦게 들어온 정도의 누적분포예요. 빨간 선(시간표 여유) 왼쪽 높이가 “갈아탈 열차가 정시에 떠난다면”의 성공 확률이에요.
                위 확률은 갈아탈 열차의 출발 지연까지 반영해 이 값과 조금 다를 수 있어요.
              </p>
              <Suspense fallback={<div className="h-64" />}>
                <CdfChart dist={dist} gridSec={cdf.meta.grid_sec} bufferSec={t.buffer_sec} dark />
              </Suspense>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Fact({ k, v, strong }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-ink-400">{k}</dt>
      <dd className={`tabular-nums ${strong ? "text-[17px] font-bold text-ink-100" : "text-ink-300"}`}>{v}</dd>
    </div>
  );
}

// 엔진의 a_dist_key → delay_cdf.json 분포. 엔진은 delay_cdf 와 같은 키("2|weekday|23", "2|weekday|last3")를 준다.
// "|last3" 이 빠진 막차 키("2|weekday")도 받아 둔다.
function arrivalDist(cdf, key) {
  if (!cdf || !key) return null;
  return cdf.dists[key] ?? cdf.dists[`${key}|last3`] ?? null;
}

// 확률 근거: 실제로 쓴 지연 기록의 밤 수(엔진 a_nights·d_nights). 주말 기록이 3밤 미만이라 평일 기록을 빌린 쪽은 그렇게 밝힌다.
// 막차 조합표(prob_table)의 n_nights 는 도착·출발 밤의 합집합이라 쓰지 않는다.
function basisText(t) {
  const weekend = `${t.a_dist_key ?? ""}${t.d_dist_key ?? ""}`.includes("|weekend");
  const day = weekend ? "주말 " : "";
  const { a_nights: a, d_nights: d, a_fallback: aFb, d_fallback: dFb } = t;
  if (a == null && d == null) return "실측 지연 분포 기준";
  if (!aFb && !dFb && (a === d || d == null)) return `실측 ${day}${a ?? d}밤 기준`;
  if (aFb && dFb && a === d) return `주말 기록이 부족해 평일 ${a}밤 기록을 빌려 계산`;
  const part = (label, n, fb) => (n == null ? null : fb ? `${label} 평일 ${n}밤(주말 기록 부족)` : `${label} ${day}${n}밤`);
  return [part("도착 지연", a, aFb), part("출발 지연", d, dFb)].filter(Boolean).join(" · ");
}

// 쉬운 설명 한 문장
function plainSentence(t, dist) {
  if (t.buffer_sec < 0) {
    return `시간표대로면 ${t.to_line}호선이 먼저 떠나요. ${t.to_line}호선이 늦게 출발하는 밤에만 갈아탈 수 있어요.`;
  }
  if (t.p >= 0.95) return "시간표 여유가 넉넉해서 거의 매번 갈아탈 수 있어요.";
  const miss = Math.max(1, Math.round((1 - t.p) * 10));
  const median = dist?.median_sec != null ? Math.round(dist.median_sec) : null;
  if (median != null && median > t.buffer_sec) {
    return `시간표 여유는 ${Math.round(t.buffer_sec)}초인데 ${t.from_line}호선은 보통 ${median}초 늦게 들어와요. 10번 중 ${miss}번쯤은 놓쳐요.`;
  }
  return `시간표대로면 갈아탈 수 있어요. 하지만 ${t.from_line}호선이 늦게 들어오는 밤이 있어 10번 중 ${miss}번쯤은 놓쳐요.`;
}
