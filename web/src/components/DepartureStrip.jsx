import { useEffect, useRef } from "react";
import { hhmm, pctText, TONE, toneOf } from "../format";

// 출발 시각별 귀가 확률 띠: "23:30 98% · 23:44 96% · 23:52 62%".
// 시각은 시간표(회색), 확률은 실측 지연 기반 추정(판정 색)으로 구분한다(Transit 앱의 실시간/시간표 구분).
export default function DepartureStrip({ options, selectedDep, leaveBy, onSelect }) {
  const rowRef = useRef(null);

  // 고른 칩이 보이도록 가로 스크롤만 옮긴다(세로 스크롤은 건드리지 않음)
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector("[aria-pressed='true']");
    if (chip) row.scrollLeft = chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2;
  }, [selectedDep, options]);

  if (!options?.length) return null;
  const safeDep = leaveBy?.safe?.depart_sec;
  const lastDep = leaveBy?.last?.depart_sec;

  return (
    <section className="pt-4" aria-labelledby="strip-title">
      <div className="flex items-baseline justify-between px-4">
        <h3 id="strip-title" className="text-[15px] font-bold">출발 시각별 귀가 확률</h3>
        <span className="text-[12px] text-ink-500">시각은 시간표 · %는 실측 지연 기반</span>
      </div>
      <div ref={rowRef} className="no-scrollbar relative mt-2 flex gap-2 overflow-x-auto scroll-smooth px-4 pt-2 pb-1">
        {options.map((o, i) => {
          const tone = toneOf(o.p_home);
          const on = o.depart_sec === selectedDep;
          const tag = o.depart_sec === lastDep ? "막차" : o.depart_sec === safeDep ? "마감" : null;
          // key 에 순서를 붙인다: 반대 방향 두 열차가 같은 시각에 떠나면 출발 시각이 겹친다
          return (
            <button
              key={`${o.depart_sec}-${i}`}
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(o.depart_sec)}
              className={`relative flex min-h-[60px] min-w-[84px] shrink-0 flex-col items-start justify-center rounded-2xl border px-3 pb-2 text-left transition-colors ${
                on ? "border-ink-100 bg-night-700" : "border-night-600 bg-night-800 hover:border-night-500"
              }`}
            >
              <span className={`text-[13px] tabular-nums ${on ? "text-ink-100" : "text-ink-400"}`}>{hhmm(o.depart_sec)}</span>
              <span className={`text-[18px] leading-tight font-bold tabular-nums ${TONE[tone].text}`}>{pctText(o.p_home)}</span>
              <span className="absolute inset-x-3 bottom-1.5 h-[3px] overflow-hidden rounded-full bg-night-600">
                <span className={`block h-full ${TONE[tone].bg}`} style={{ width: `${Math.round(o.p_home * 100)}%` }} />
              </span>
              {tag && (
                <span
                  className={`absolute -top-2 right-2 rounded-full px-1.5 py-px text-[10px] leading-4 font-bold ${
                    tag === "막차" ? "bg-danger text-night-950" : "bg-ink-100 text-night-900"
                  }`}
                >
                  {tag}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
