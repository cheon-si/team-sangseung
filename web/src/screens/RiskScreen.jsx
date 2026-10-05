import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import LinePill from "../components/LinePill";
import Modal from "../components/Modal";
import RiskDetail from "../components/RiskDetail";
import RiskMap from "../components/RiskMap";
import { DAY_TYPES } from "../config";
import { loadJson, stationId } from "../data";
import { hhmm, minText, pctText, signedMinText, TONE, toneOf } from "../format";

const PAGE = 20; // 목록은 20개씩 더 보기
const SURPRISE_MIN_P = 0.3; // "시간표로는 안 되는데 실제로는 되는" 환승으로 보여 줄 최소 확률
const TONE_LABEL = { danger: "위험", gamble: "아슬아슬", safe: "안전" };
const DAY_SHORT = { DAY: "평일", SAT: "토요일", END: "휴일" };

// 보조 화면 "위험한 환승역" (보고서·심사용). 막차 조합표(prob_table)를 위험한 순서로 훑어보는 화면.
// 메인 화면과 같은 밝은 테마(연하늘 배경 + 흰 카드, index.css 토큰). 요일을 고르면 지도(역별 최악 확률)·요약 수·목록이 함께 바뀐다.
export default function RiskScreen({ onBack }) {
  const [src, setSrc] = useState(null); // { prob, alt, network }
  const [failed, setFailed] = useState(false);
  const [tag, setTag] = useState("DAY");
  const [tone, setTone] = useState(null); // 요약 타일로 거르기
  const [station, setStation] = useState(null); // 지도 점으로 거르기
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    Promise.all([loadJson("prob_table"), loadJson("station_alt"), loadJson("network")]).then(
      ([prob, alt, network]) => setSrc({ prob, alt, network }),
      () => setFailed(true),
    );
  }, []);
  useEffect(() => setLimit(PAGE), [tag, tone, station, query]);

  const rows = useMemo(() => (src ? src.prob.rows.filter((r) => r.tt_tag === tag && r.p_success != null) : []), [src, tag]);
  // 시간표상 갈아탈 수 있는(여유 ≥ 0) 막차 환승을 위험한 순서로
  const feasible = useMemo(() => rows.filter((r) => r.buffer_sec >= 0).sort((a, b) => a.p_success - b.p_success), [rows]);
  // 시간표상 불가인데 갈아탈 막차가 늦게 떠나 실제로는 꽤 성공하는 환승
  const surprises = useMemo(
    () => rows.filter((r) => r.buffer_sec < 0 && r.p_success >= SURPRISE_MIN_P).sort((a, b) => b.p_success - a.p_success),
    [rows],
  );
  const counts = useMemo(() => {
    const c = { danger: 0, gamble: 0, safe: 0 };
    feasible.forEach((r) => (c[toneOf(r.p_success)] += 1));
    return c;
  }, [feasible]);
  const worst = useMemo(() => {
    const m = new Map();
    for (const r of feasible) {
      const id = stationId(r.station);
      if (!m.has(id) || r.p_success < m.get(id)) m.set(id, r.p_success);
    }
    return m;
  }, [feasible]);
  const q = query.trim();
  const shown = useMemo(
    () =>
      feasible.filter(
        (r) =>
          (!tone || toneOf(r.p_success) === tone) &&
          (!station || stationId(r.station) === station) &&
          (!q || stationId(r.station).includes(q)),
      ),
    [feasible, tone, station, q],
  );
  const lineColor = (l) => src?.network.line_colors?.[l] ?? "#64748b";
  const m = src?.prob.meta;

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
              {DAY_SHORT[tag]} 막차 환승 {feasible.length}개의 실측 성공 확률이에요.
              {m?.provisional && ` 평일 ${m.nights.weekday}밤 · 주말 ${m.nights.weekend}밤 기준 잠정 결과.`}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="판정별 개수">
              {["danger", "gamble", "safe"].map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tone === t}
                  onClick={() => setTone(tone === t ? null : t)}
                  className={`card-shadow rounded-2xl bg-surface px-3 py-3 text-left transition ${tone === t ? "ring-2 ring-brand-strong" : ""}`}
                >
                  <div className={`text-[28px] font-extrabold leading-none tabular-nums ${TONE[t].text}`}>{counts[t]}</div>
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
              서울 열린데이터광장 실시간 지하철 위치·도착 정보를 22:00~02:00, 3분 간격으로 직접 수집해 계산했어요. 노선 단위 지연 분포를 각 역에
              적용한 값이라 역별 개별 추정은 아니에요. 확률은 타고 온 막차의 도착 지연과 갈아탈 막차의 출발 지연을 모두 반영했어요. 2026
              통계최강자전 · 팀 상승.
            </footer>
          </main>
        </div>
      )}

      {detail && (
        <Modal onClose={() => setDetail(null)} labelledBy="risk-title">
          <RiskDetail row={detail} lineColor={lineColor} />
        </Modal>
      )}
    </div>
  );
}

// 목록 한 줄: 역 · 노선 → 노선 · 확률(판정 색) · 방면 · 여유 · 도보 · 구간
function RiskCard({ row: r, lineColor, onClick, muted = false }) {
  const tone = muted ? "none" : toneOf(r.p_success);
  const ci = r.ci_low != null ? `95% ${pctText(r.ci_low)}~${pctText(r.ci_high)}` : null;
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
            여유 {signedMinText(r.buffer_sec)} · 도보 {minText(r.walk_sec)}
            {ci && ` · ${ci}`}
          </span>
        </span>
        <span className={`shrink-0 self-center text-[26px] font-extrabold tabular-nums tracking-[-0.02em] ${muted ? "text-muted" : TONE[tone].text}`}>
          {pctText(r.p_success)}
        </span>
      </button>
    </li>
  );
}
