import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import LinePill from "../components/LinePill";
import Modal from "../components/Modal";
import RiskDetail from "../components/RiskDetail";
import RiskMap from "../components/RiskMap";
import { DAY_TYPES } from "../config";
import { loadJson, stationId, useJson } from "../data";
import { hhmm, minSecText, minText, pctText, signedMinText, TONE, toneOf } from "../format";
import { paceOptions } from "../settings";
import { rowsForPace } from "../usePlan";

const PAGE = 20; // 목록은 20개씩 더 보기
const SURPRISE_MIN_P = 0.3; // "시간표로는 안 되는데 실제로는 되는" 환승으로 보여 줄 최소 확률
const TONE_LABEL = { danger: "위험", gamble: "아슬아슬", safe: "안전" };
const DAY_SHORT = { DAY: "평일", SAT: "토요일", END: "휴일" };

// 보조 화면 "위험한 환승역" (보고서·심사용). 막차 조합표(prob_table)를 위험한 순서로 훑어보는 화면.
// 확률은 B 모형(p_b, 팀 최종 채택). B 채택 전 모형 값(p_success)은 prob_table 에 비교용으로만 남아 있다.
// 메인 화면과 같은 밝은 테마(연하늘 배경 + 흰 카드, index.css 토큰). 요일을 고르면 지도(역별 최악 확률)·요약 수·목록이 함께 바뀐다.
// pace = 걸음 속도·여유 선호(settings.js). prob_table 의 p_b 는 기본 설정 값이라, 기본이 아니면 행마다 엔진 B 함수로 다시 계산한다
// (확률·필요 여유·시간표 여유·도보, 느린 걸음이면 시간표상 불가가 되는 행도 생긴다). 지도 색·요약 수·정렬 모두 그 값으로.
export default function RiskScreen({ onBack, onOpenMethod, pace }) {
  const [src, setSrc] = useState(null); // { prob, alt, network, model }
  const [failed, setFailed] = useState(false);
  const [tag, setTag] = useState("DAY");
  const [tone, setTone] = useState(null); // 요약 타일로 거르기
  const [station, setStation] = useState(null); // 지도 점으로 거르기
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    Promise.all([loadJson("prob_table"), loadJson("station_alt"), loadJson("network"), loadJson("model_b")]).then(
      ([prob, alt, network, model]) => setSrc({ prob, alt, network, model }),
      () => setFailed(true),
    );
  }, []);
  useEffect(() => setLimit(PAGE), [tag, tone, station, query]);

  const po = paceOptions(pace);
  const { walkSpeed, marginSec, isDefault } = po;
  const rows = useMemo(
    () =>
      src
        ? rowsForPace(src.model, src.prob.rows.filter((r) => r.tt_tag === tag && r.p_b != null), { walkSpeed, marginSec, isDefault })
        : [],
    [src, tag, walkSpeed, marginSec, isDefault],
  );
  // 시간표상 갈아탈 수 있는(여유 ≥ 0) 막차 환승을 위험한 순서로
  const feasible = useMemo(() => rows.filter((r) => r.buffer_sec >= 0).sort((a, b) => a.p_b - b.p_b), [rows]);
  // 시간표상 불가인데 갈아탈 막차가 늦게 떠나 실제로는 꽤 성공하는 환승
  const surprises = useMemo(
    () => rows.filter((r) => r.buffer_sec < 0 && r.p_b >= SURPRISE_MIN_P).sort((a, b) => b.p_b - a.p_b),
    [rows],
  );
  const counts = useMemo(() => {
    const c = { danger: 0, gamble: 0, safe: 0 };
    feasible.forEach((r) => (c[toneOf(r.p_b)] += 1));
    return c;
  }, [feasible]);
  const worst = useMemo(() => {
    const m = new Map();
    for (const r of feasible) {
      const id = stationId(r.station);
      if (!m.has(id) || r.p_b < m.get(id)) m.set(id, r.p_b);
    }
    return m;
  }, [feasible]);
  const q = query.trim();
  const shown = useMemo(
    () =>
      feasible.filter(
        (r) =>
          (!tone || toneOf(r.p_b) === tone) &&
          (!station || stationId(r.station) === station) &&
          (!q || stationId(r.station).includes(q)),
      ),
    [feasible, tone, station, q],
  );
  const lineColor = (l) => src?.network.line_colors?.[l] ?? "#64748b";
  const m = src?.prob.meta;
  const fd = useJson("model_b_findings")?.data; // B 모형 학습 밤(평일·주말·공휴일)

  return (
    <div className="min-h-dvh bg-canvas text-text">
      <header className="brand-header sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 md:px-4">
          <div className="header-pill flex items-center rounded-full pr-4">
            <button type="button" onClick={onBack} aria-label="귀가 경로로 돌아가기" className="flex h-11 w-11 items-center justify-center rounded-full">
              <Icon name="chevronLeft" className="h-6 w-6" />
            </button>
            <h1 className="text-[16px] font-bold">위험한 환승역</h1>
          </div>
          <div className="card-shadow ml-auto flex rounded-full bg-surface p-1" role="tablist" aria-label="요일">
            {DAY_TYPES.map((d) => (
              <button
                key={d.tag}
                type="button"
                role="tab"
                aria-selected={tag === d.tag}
                onClick={() => setTag(d.tag)}
                className={`min-h-9 rounded-full px-3 text-[13px] font-semibold ${tag === d.tag ? "bg-brand-strong text-white" : "text-brand-ink"}`}
              >
                {DAY_SHORT[d.tag]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {failed && <p className="px-4 py-10 text-center text-muted">데이터를 불러오지 못했어요.</p>}
      {!src && !failed && <p className="px-4 py-10 text-center text-muted">불러오는 중…</p>}

      {src && (
        <div className="mx-auto max-w-6xl md:grid md:grid-cols-[minmax(0,1fr)_440px] md:gap-6 md:px-4">
          {/* 지도: 모바일은 위, 넓은 화면은 오른쪽에 고정 */}
          <section
            className="card-shadow h-[42dvh] md:sticky md:top-[72px] md:order-2 md:mt-4 md:h-[calc(100dvh-88px)] md:overflow-hidden md:rounded-3xl"
            aria-label="위험한 환승역 지도"
          >
            <RiskMap stations={src.alt.stations} worst={worst} selected={station} onSelect={setStation} />
          </section>

          <main className="px-4 pb-20 md:order-1 md:px-0">
            <h2 className="mt-5 text-[22px] font-bold leading-snug tracking-[-0.01em]">
              시간표로는 갈아탈 수 있는데,
              <br />
              실제로는 놓치는 막차 환승
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              {DAY_SHORT[tag]} 막차 환승 {feasible.length}개의 성공 확률(다중회귀 + 과거 오차 분포)이에요.
              {m?.provisional && fd && ` 평일 ${fd.weekday_nights}밤 · 주말·공휴일 ${fd.weekend_nights}밤 기준 잠정 결과.`}
            </p>
            {!isDefault && (
              <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-gamble/10 px-3 py-2 text-[13px] leading-relaxed text-gamble-ink">
                <Icon name="walk" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.3} />
                <span>{po.label} 기준으로 다시 계산했어요(기본: 보통 걸음 · 여유 0초).</span>
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="판정별 개수">
              {["danger", "gamble", "safe"].map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tone === t}
                  onClick={() => setTone(tone === t ? null : t)}
                  className={`card-shadow rounded-2xl bg-surface px-3 py-3 text-left transition ${tone === t ? "ring-2 ring-brand-strong" : ""}`}
                >
                  <div className={`text-[28px] font-extrabold leading-none tabular-nums ${TONE[t].big}`}>{counts[t]}</div>
                  <div className="mt-1 text-[13px] text-muted">{TONE_LABEL[t]}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <label className="flex min-h-11 flex-1 items-center gap-2 rounded-2xl border border-line bg-surface px-3">
                <Icon name="search" className="h-5 w-5 shrink-0 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="환승역 이름"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-text placeholder:text-muted outline-none"
                />
              </label>
              {station && (
                <button type="button" onClick={() => setStation(null)} className="flex min-h-11 items-center gap-1 rounded-2xl bg-brand-strong px-3 text-[14px] font-semibold text-white">
                  {station}
                  <Icon name="close" className="h-4 w-4" />
                </button>
              )}
            </div>

            <h3 className="mt-7 flex items-baseline gap-2 text-[16px] font-bold">
              위험한 순서
              <span className="text-[13px] font-medium text-muted">{shown.length}개</span>
            </h3>
            {shown.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-surface px-4 py-6 text-center text-[14px] text-muted">조건에 맞는 막차 환승이 없어요.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {shown.slice(0, limit).map((r) => (
                  <RiskCard key={r.combo_id} row={r} lineColor={lineColor} onClick={() => setDetail(r)} />
                ))}
              </ul>
            )}
            {shown.length > limit && (
              <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="mt-3 min-h-12 w-full rounded-2xl bg-chip text-[15px] font-semibold text-brand-ink">
                더 보기 · {shown.length - limit}개 남음
              </button>
            )}

            {surprises.length > 0 && (
              <>
                <h3 className="mt-10 text-[16px] font-bold">시간표로는 못 갈아타는데, 실제로는 되는 곳</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">갈아탈 막차가 시간표보다 늦게 떠나는 밤에만 성공해요. 믿고 가지는 마세요.</p>
                <ul className="mt-3 space-y-2">
                  {surprises.map((r) => (
                    <RiskCard key={r.combo_id} row={r} lineColor={lineColor} onClick={() => setDetail(r)} muted />
                  ))}
                </ul>
              </>
            )}

            <footer className="mt-12 border-t border-line pt-5 text-[12px] leading-relaxed text-muted">
              서울 열린데이터광장 실시간 지하철 위치·도착 정보를 22:00~02:00, 3분 간격으로 직접 수집해 계산했어요. 확률은 노선·요일·경과
              운행시간으로 지연 차이(막차 출발 지연 − 내 열차 도착 지연)를 예측하고 과거 오차 분포로 매긴 값이라 역별 개별 추정은 아니에요.
              2026 통계최강자전 · 팀 상승.
              {onOpenMethod && (
                <button type="button" onClick={onOpenMethod} className="mt-1 flex min-h-11 items-center gap-1 font-semibold text-brand-ink">
                  어떻게 계산했나요 <Icon name="chevronRight" className="h-4 w-4" />
                </button>
              )}
            </footer>
          </main>
        </div>
      )}

      {detail && (
        <Modal onClose={() => setDetail(null)} labelledBy="risk-title">
          <RiskDetail row={detail} lineColor={lineColor} margin={marginSec} />
        </Modal>
      )}
    </div>
  );
}

// 목록 한 줄: 역 · 노선 → 노선 · 확률(판정 색) · 방면 · 여유 · 도보 · 90%에 필요한 여유
function RiskCard({ row: r, lineColor, onClick, muted = false }) {
  const tone = muted ? "none" : toneOf(r.p_b);
  const need = r.s90_sec != null ? `90%엔 ${minSecText(Math.ceil(r.s90_sec))} 필요` : null;
  return (
    <li>
      <button type="button" onClick={onClick} className="card-shadow flex w-full items-stretch gap-3 rounded-2xl bg-surface p-3 text-left hover:bg-chip">
        <span className={`w-1 shrink-0 rounded-full ${TONE[tone].bg}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[17px] font-bold">{r.station}</span>
            <LinePill line={r.from_line} color={lineColor(r.from_line)} size="sm" />
            <span className="text-muted" aria-hidden="true">→</span>
            <LinePill line={r.to_line} color={lineColor(r.to_line)} size="sm" />
          </span>
          <span className="mt-1 block truncate text-[13px] text-muted">
            {r.a_dest}행 {hhmm(r.arrive_sec)} 도착 → {r.d_dest}행 {hhmm(r.depart_sec)} 출발
          </span>
          <span className="mt-0.5 block text-[12px] text-muted tabular-nums">
            여유 {signedMinText(r.slack_b_sec ?? r.buffer_sec)} · 도보 {minText(r.walk_sec)}
            {need && ` · ${need}`}
          </span>
        </span>
        <span className={`shrink-0 self-center text-[26px] font-extrabold tabular-nums tracking-[-0.02em] ${muted ? "text-muted" : TONE[tone].big}`}>
          {pctText(r.p_b)}
        </span>
      </button>
    </li>
  );
}
