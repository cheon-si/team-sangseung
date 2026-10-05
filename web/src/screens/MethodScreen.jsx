import Icon from "../components/Icon";
import { useJson } from "../data";
import { minSecText } from "../format";

// 보조 화면 「어떻게 계산했나요」: 팀이 채택한 B 모형(다중회귀 + 잔차 경험분포)을 카드 5장으로 설명한다.
// 수치는 model_b_findings.json 에서만 읽는다(export_model_b.py 가 B 보고서 값과 모형 적합 결과를 적어 넣음, 하드코딩은 그 한 곳).
// 위험한 환승역 화면과 같은 밝은 테마(연하늘 배경 + 흰 카드, index.css 토큰).
export default function MethodScreen({ onBack }) {
  const f = useJson("model_b_findings");

  return (
    <div className="min-h-dvh bg-canvas text-text">
      <header className="brand-header sticky top-0 z-20">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2 md:px-4">
          <div className="header-pill flex items-center rounded-full pr-4">
            <button type="button" onClick={onBack} aria-label="귀가 경로로 돌아가기" className="flex h-11 w-11 items-center justify-center rounded-full">
              <Icon name="chevronLeft" className="h-6 w-6" />
            </button>
            <h1 className="text-[16px] font-bold">어떻게 계산했나요</h1>
          </div>
        </div>
      </header>

      {!f && <p className="px-4 py-10 text-center text-muted">불러오는 중…</p>}
      {f && <Cards f={f} />}
    </div>
  );
}

function Cards({ f }) {
  const { data: d, judge: j, model: m, validation: v, findings: k, sensitivity: sn } = f;
  return (
    <main className="mx-auto max-w-3xl px-4 pb-20">
      <h2 className="mt-5 text-[22px] leading-snug font-bold tracking-[-0.01em]">
        막차 환승 성공 확률은
        <br />
        이렇게 계산했어요
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        내 열차가 늦게 들어오는 정도와 막차가 늦게 떠나는 정도의 차이(지연 차이)를 예측하고, 과거 예측이 빗나간 폭으로 확률을 매겨요.
      </p>

      <ol className="mt-5 grid gap-3 md:grid-cols-2">
        <Card n={1} title="데이터" stat={`${d.nights}밤`} statSub={`${d.period} · 평일 ${d.weekday_nights} · 주말·공휴일 ${d.weekend_nights}`}>
          서울 열린데이터광장 실시간 위치·도착 정보를 밤마다 직접 수집해 1~9호선 <b>{d.combos}개 환승 조합</b>의 막차 연결을 모았어요.
          막차 연결의 지연 차이 {d.rows_delta.toLocaleString()}건으로 학습했어요({d.excluded} 제외).
        </Card>

        <Card n={2} title="성공 판정" stat="막차 실측 출발" statSub="막차가 실제로 떠난 시각 기준">
          표준 걸음(1.2m/s)으로 걸었을 때 막차가 <b>실제로 떠나기 전</b>에 닿으면 성공이에요. 막차 도착 시각으로 판정하면 서 있는 막차를 놓친
          것으로 봐서 성공률을 <b>{j.arrival_gap_pp}%p</b> 낮게 봐요({j.success_departure_pct}% vs {j.success_arrival_pct}%).
          {sn && (
            <span className="mt-2 block text-muted">
              걸음 속도·여유를 바꾸면 결과가 달라져요. 시간표 여유 0초 근처에서 갈리는 환승이 많아, 여유를 <b className="text-text">60초</b> 두면
              평일 위험 연결이 <b className="text-text">{sn.margin60_risky_from_pct}%→{sn.margin60_risky_to_pct}%</b>로 늘어요(B 보고서 12장). 「내 역」에서 내
              걸음에 맞출 수 있어요.
            </span>
          )}
        </Card>

        <Card n={3} title="모형" stat="다중회귀 + 과거 오차 분포" statSub={`설명력 R² ${m.r2}`}>
          도착 노선·갈아탈 노선·요일·경과 운행시간으로 지연 차이를 예측하고, 실제와의 오차(잔차) 분포로 “여유가 깎이지 않을 확률”을 셉니다.
          R² {m.r2}는 지연 차이의 <b>대부분이 그날 밤의 우연한 지연</b>이라는 뜻이라, 탈 수 있다/없다 대신 확률로 안내해요.
        </Card>

        <Card n={4} title="검증" stat={`오차 ${v.reduction_pct}% 감소`} statSub={`Brier ${v.brier_baseline} → ${v.brier_model}`}>
          밤 하나를 통째로 빼고 학습해 그 밤을 맞히는 교차검증에서 시간표만 보는 판단보다 정확했고,{" "}
          <b>{v.nights_total}밤 중 {v.nights_improved}밤 모두</b> 개선됐어요.
          <BrierBars base={v.brier_baseline} model={v.brier_model} />
        </Card>

        <Card n={5} title="핵심 발견" stat="8·9호선 막차가 가장 불리" statSub="1호선 막차 기준 여유 차이" wide>
          <ul className="mt-1 space-y-1.5">
            <li>
              8·9호선 막차는 시간표에 가깝게 떠나요. 1호선 막차보다 여유가 <b>{Math.abs(k.l8_coef_sec)}초·{Math.abs(k.l9_coef_sec)}초</b> 적어요.
            </li>
            <li>
              90% 확률로 잡으려면 시간표 여유가 8호선 <b>{minSecText(k.s90_l8_sec)}</b>, 9호선 <b>{minSecText(k.s90_l9_sec)}</b> 이상 필요해요(평일 중앙값).
            </li>
            <li>
              평일 시간표상 마지막 연결 {k.weekday_last_links.toLocaleString()}개 중 <b>{k.below90}개({Math.round(k.below90_pct)}%)</b>는 성공 확률이 90% 미만이에요.
            </li>
          </ul>
        </Card>
      </ol>

      <footer className="mt-8 border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
        잠정 결과예요. 평범한 밤 기준이라 사고·대형 지연은 예측하지 못해요. 환승이 여럿이면 환승끼리 서로 영향이 없다고 가정한 추정치예요. 출처: {f.source}.
        2026 통계최강자전 · 팀 상승.
      </footer>
    </main>
  );
}

function Card({ n, title, stat, statSub, wide = false, children }) {
  return (
    <li className={`card-shadow rounded-2xl bg-surface p-4 ${wide ? "md:col-span-2" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-chip text-[13px] font-bold text-brand-ink">{n}</span>
        <h3 className="text-[15px] font-bold text-muted">{title}</h3>
      </div>
      <div className="mt-3 text-[22px] leading-tight font-extrabold tracking-[-0.02em] text-brand-ink">{stat}</div>
      <div className="mt-0.5 text-[13px] text-muted tabular-nums">{statSub}</div>
      <div className="mt-3 text-[14px] leading-relaxed text-text">{children}</div>
    </li>
  );
}

// Brier 비교 막대 두 개(작을수록 정확). 시간표 판단을 100% 폭으로
function BrierBars({ base, model }) {
  const rows = [
    { label: "시간표만", value: base, cls: "bg-soft" },
    { label: "B 모형", value: model, cls: "bg-brand" },
  ];
  return (
    <div className="mt-3 space-y-1.5" aria-label={`Brier 점수 시간표만 ${base}, B 모형 ${model}`}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12px] text-muted tabular-nums">
          <span className="w-14 shrink-0">{r.label}</span>
          <span className="h-2.5 flex-1 rounded-full bg-canvas">
            <span className={`block h-2.5 rounded-full ${r.cls}`} style={{ width: `${(r.value / base) * 100}%` }} />
          </span>
          <span className="w-12 shrink-0 text-right">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
