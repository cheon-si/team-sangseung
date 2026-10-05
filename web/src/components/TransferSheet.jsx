import { lazy, Suspense, useState } from "react";
import { useJson } from "../data";
import { hhmm, minText, pctText, signedMinText, TONE, toneOf, withYeok } from "../format";
import { lineColorOf } from "../usePlan";
import Icon from "./Icon";
import LinePill from "./LinePill";
import MissedAlt from "./MissedAlt";
import ModelBNote from "./ModelBNote";

// 그래프 라이브러리(recharts)는 무거워서 "지연 분포 보기"를 눌렀을 때만 불러온다
const CdfChart = lazy(() => import("./CdfChart"));

// 화면 3. 위험 환승 상세 — 확률(B 모형)·90%에 필요한 여유·시간표 여유·도보·쉬운 설명 한 문장. 참고 분포 그래프는 접어 둔다.
export default function TransferSheet({ data, transfer: t }) {
  const cdf = useJson("delay_cdf");
  const model = useJson("model_b");
  const [showChart, setShowChart] = useState(false);
  const tone = toneOf(t.p);
  const dist = arrivalDist(cdf, t.a_dist_key);

  return (
    <div className="px-5 pt-2 pb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="transfer-title" className="truncate text-[24px] font-bold">{t.at_station}</h2>
          <div className="mt-1.5 flex items-center gap-1.5 text-[14px] text-muted">
            <LinePill line={t.from_line} color={lineColorOf(data, t.from_line)} />
            <span className="text-muted">→</span>
            <LinePill line={t.to_line} color={lineColorOf(data, t.to_line)} />
            <span>환승</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[44px] leading-none font-extrabold tracking-[-0.03em] tabular-nums ${TONE[tone].text}`}>{pctText(t.p)}</div>
          <div className="mt-1 text-[12px] text-muted">환승 성공 확률</div>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted tabular-nums">
        {basisText(model)}
        {cdf?.meta?.provisional ? " · 잠정" : ""}
      </p>

      <ModelBNote s90={t.s90} slack={t.slack_sec} toLine={t.to_line} />

      {t.critical && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-danger/10 px-3 py-2.5 text-[14px] font-semibold text-danger-ink">
          <Icon name="warning" className="h-5 w-5 shrink-0" strokeWidth={2.4} />
          {/* 엔진은 놓친 뒤 갈아탈 노선 승강장(D 노드)에서만 다시 찾는다(계약 2장). 같은 역 다른 노선으로 걸어가는 길은 보지 않으므로 그 범위로만 말한다 */}
          놓치면 이 역에서 지하철로는 집에 못 가요
        </div>
      )}

      <dl className="mt-4 divide-y divide-line rounded-2xl bg-canvas px-4 text-[15px]">
        <Fact k="시간표 여유" v={signedMinText(t.slack_sec)} strong />
        <Fact k="환승 도보" v={minText(t.walk_sec)} strong />
        <Fact k={`${t.from_line}호선 도착 (시간표)`} v={hhmm(t.arr_A)} />
        <Fact k={`${t.to_line}호선 출발 (시간표)`} v={hhmm(t.dep_D)} />
        {!t.critical && <Fact k="놓쳤을 때 귀가 확률" v={pctText(t.q)} />}
      </dl>

      <p className="mt-4 text-[16px] leading-relaxed text-text">{plainSentence(t)}</p>

      {t.critical && (
        <div className="mt-4">
          <div className="text-[13px] font-semibold text-muted">놓치면 · {withYeok(t.at_station)} 근처</div>
          <MissedAlt station={t.at_station} compact />
        </div>
      )}

      {dist && (
        <>
          <button
            type="button"
            aria-expanded={showChart}
            onClick={() => setShowChart((v) => !v)}
            className="mt-5 flex min-h-12 w-full items-center justify-between rounded-2xl bg-chip px-4 text-[15px] font-semibold text-brand-ink"
          >
            지연 분포 보기 (참고)
            <Icon name="chevronDown" className={`h-5 w-5 transition-transform ${showChart ? "rotate-180" : ""}`} />
          </button>
          {showChart && (
            <div className="mt-3">
              <p className="mb-2 text-[13px] leading-relaxed text-muted">
                참고 자료: {t.from_line}호선이 이 시간대에 늦게 들어온 정도의 누적분포(실측)예요. 위 확률은 노선·요일·경과 운행시간으로 예측한
                지연 차이와 과거 오차 분포로 계산해서, 이 그래프 값과 바로 같지는 않아요.
              </p>
              <Suspense fallback={<div className="h-64" />}>
                <CdfChart dist={dist} gridSec={cdf.meta.grid_sec} bufferSec={t.slack_sec} />
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
      <dt className="text-muted">{k}</dt>
      <dd className={`tabular-nums ${strong ? "text-[17px] font-bold text-text" : "text-muted"}`}>{v}</dd>
    </div>
  );
}

// 엔진의 a_dist_key → delay_cdf.json 분포. 엔진은 delay_cdf 와 같은 키("2|weekday|23", "2|weekday|last3")를 준다.
// "|last3" 이 빠진 막차 키("2|weekday")도 받아 둔다.
function arrivalDist(cdf, key) {
  if (!cdf || !key) return null;
  return cdf.dists[key] ?? cdf.dists[`${key}|last3`] ?? null;
}

// 확률 근거 한 줄: B 모형과 학습 밤 수(model_b.json meta)
function basisText(model) {
  const n = model?.meta?.nights?.length;
  return `다중회귀 + 과거 오차 분포${n ? ` · 실측 ${n}밤 기준` : ""}`;
}

// 쉬운 설명 한 문장(B 모형: 예측 지연 차이 ŷ = 막차가 내 열차보다 평균 몇 초 더 늦게 움직이는가)
function plainSentence(t) {
  const late = t.yhat != null && t.yhat > 0 ? ` 이 조합은 보통 ${t.to_line}호선이 ${Math.round(t.yhat)}초쯤 늦게 떠나 여유가 늘어요.` : "";
  if (t.slack_sec < 0) {
    return `시간표대로면 ${t.to_line}호선이 먼저 떠나요. ${t.to_line}호선이 늦게 출발하는 밤에만 갈아탈 수 있어요.${late}`;
  }
  if (t.p >= 0.95) return "시간표 여유가 넉넉해서 거의 매번 갈아탈 수 있어요.";
  const miss = Math.max(1, Math.round((1 - t.p) * 10));
  return `시간표대로면 갈아탈 수 있어요. 하지만 그날 밤 열차 지연에 따라 10번 중 ${miss}번쯤은 놓쳐요.`;
}
