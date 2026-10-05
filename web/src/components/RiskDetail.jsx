import { lazy, Suspense, useState } from "react";
import { useJson } from "../data";
import { hhmm, minText, pctText, signedMinText, TONE, toneOf, withYeok } from "../format";
import Icon from "./Icon";
import LinePill from "./LinePill";
import MissedAlt from "./MissedAlt";
import ModelBNote from "./ModelBNote";

// 그래프 라이브러리(recharts)는 무거워서 "지연 분포 보기"를 눌렀을 때만 불러온다
const CdfChart = lazy(() => import("./CdfChart"));

// 위험한 환승역 화면의 상세(바텀시트). 막차 조합표(prob_table) 한 행을 화면 3(TransferSheet)과 같은 짜임새로 보여 준다.
// 화면 3과 다른 점: 경로 문맥(놓친 뒤 귀가 확률 q)이 없다. 확률은 B 모형(p_b, s90_sec, slack_b_sec — export_for_app.py).
export default function RiskDetail({ row: r, lineColor }) {
  const cdf = useJson("delay_cdf");
  const model = useJson("model_b");
  const [showChart, setShowChart] = useState(false);
  const tone = toneOf(r.p_b);
  const dist = cdf?.dists?.[r.dist_key] ?? null;
  const slack = r.slack_b_sec ?? r.buffer_sec;

  return (
    <div className="px-5 pt-2 pb-6 text-text">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="risk-title" className="truncate text-[24px] font-bold">{r.station}</h2>
          <div className="mt-1.5 flex items-center gap-1.5 text-[14px] text-muted">
            <LinePill line={r.from_line} color={lineColor(r.from_line)} />
            <span>{r.a_dest}행</span>
            <span aria-hidden="true">→</span>
            <LinePill line={r.to_line} color={lineColor(r.to_line)} />
            <span>{r.d_dest}행</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[44px] leading-none font-extrabold tracking-[-0.03em] tabular-nums ${TONE[tone].text}`}>
            {pctText(r.p_b)}
          </div>
          <div className="mt-1 text-[12px] text-muted">막차 환승 성공 확률</div>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted tabular-nums">
        다중회귀 + 과거 오차 분포{model?.meta?.nights ? ` · 실측 ${model.meta.nights.length}밤 기준` : ""}
        {cdf?.meta?.provisional ? " · 잠정" : ""}
      </p>

      <ModelBNote s90={r.s90_sec} slack={slack} toLine={r.to_line} />

      {r.buffer_sec < 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-chip px-3 py-2.5 text-[14px] font-semibold text-brand-ink">
          <Icon name="info" className="h-5 w-5 shrink-0" strokeWidth={2.2} />
          시간표대로면 갈아탈 막차가 먼저 떠나요
        </div>
      )}

      <dl className="mt-4 divide-y divide-line rounded-2xl bg-canvas px-4 text-[15px]">
        <Fact k="시간표 여유" v={signedMinText(slack)} strong />
        <Fact k="환승 도보" v={minText(r.walk_sec)} strong />
        <Fact k={`${r.from_line}호선 막차 도착 (시간표)`} v={hhmm(r.arrive_sec)} />
        <Fact k={`${r.to_line}호선 막차 출발 (시간표)`} v={hhmm(r.depart_sec)} />
      </dl>

      <p className="mt-4 text-[16px] leading-relaxed">{plainSentence(r, slack)}</p>

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-muted">놓치면 · {withYeok(r.station)} 근처</div>
        <MissedAlt station={r.station} compact />
      </div>

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
                참고 자료: {r.from_line}호선이 이 시간대에 늦게 들어온 정도의 누적분포(실측)예요. 위 확률은 노선·요일·경과 운행시간으로
                예측한 지연 차이와 과거 오차 분포로 계산해서, 이 그래프 값과 바로 같지는 않아요.
              </p>
              <Suspense fallback={<div className="h-64" />}>
                <CdfChart dist={dist} gridSec={cdf.meta.grid_sec} bufferSec={slack} />
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
    <div className="flex items-center justify-between gap-3 py-3">
      <dt className="text-muted">{k}</dt>
      <dd className={`shrink-0 tabular-nums ${strong ? "text-[17px] font-bold text-text" : "text-text"}`}>{v}</dd>
    </div>
  );
}

// 쉬운 설명 한 문장 (화면 3과 같은 규칙)
function plainSentence(r, slack) {
  if (slack < 0) {
    const late = r.yhat_b > 0 ? ` 이 조합은 보통 막차가 ${Math.round(r.yhat_b)}초쯤 늦게 떠나 여유가 늘어요.` : "";
    return `시간표대로면 ${r.to_line}호선 막차가 먼저 떠나요. ${r.to_line}호선이 늦게 출발하는 밤에만 갈아탈 수 있어요.${late}`;
  }
  if (r.p_b >= 0.95) return "시간표 여유가 넉넉해서 거의 매번 갈아탈 수 있어요.";
  const miss = Math.max(1, Math.round((1 - r.p_b) * 10));
  return `시간표대로면 갈아탈 수 있어요. 하지만 그날 밤 열차 지연에 따라 10번 중 ${miss}번쯤은 놓쳐요.`;
}
