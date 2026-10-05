import { useState } from "react";
import { hhmm, pctText, shownMinutes, TONE, toneOf, untilText } from "../format";
import Icon from "./Icon";
import { RouteChips } from "./SummaryCard";

const VISIBLE = 3; // 접힌 상태에서 보여 줄 카드 수(고른 출발이 항상 그 안에 들어가게 자른다)

// 추천 출발(레퍼런스 "Suggested Routes" 카드 목록): 출발 시각마다 카드 한 장.
// 도보 > [노선 칩] · 소요 · 출발 시각(N분 후) · 티켓 자리에 귀가 확률(판정 색).
// 시각은 시간표(진한 회색 값), 확률은 실측 지연 기반 추정(판정 색)으로 구분한다(Transit 앱의 실시간/시간표 구분).
export default function DepartureStrip({ data, options, selectedDep, leaveBy, nowSec, onSelect }) {
  const [all, setAll] = useState(false);
  if (!options?.length) return null;
  const safeDep = leaveBy?.safe?.depart_sec;
  const lastDep = leaveBy?.last?.depart_sec;
  const selIdx = Math.max(0, options.findIndex((o) => o.depart_sec === selectedDep));
  const start = Math.max(0, Math.min(selIdx - 1, options.length - VISIBLE));
  const shown = all ? options : options.slice(start, start + VISIBLE);

  return (
    <section className="px-3 pt-5" aria-labelledby="strip-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
        <h3 id="strip-title" className="text-[16px] font-bold">추천 출발</h3>
        <span className="text-[12px] text-muted">시각은 시간표 · %는 실측 지연 기반</span>
      </div>
      <ul className="mt-2.5 grid gap-2.5">
        {shown.map((o, i) => {
          const tone = toneOf(o.p_home);
          const on = o.depart_sec === selectedDep;
          const tag = o.depart_sec === lastDep ? "막차" : o.depart_sec === safeDep ? "마감" : null;
          const waitMin = nowSec != null && o.depart_sec >= nowSec ? shownMinutes(nowSec, o.depart_sec) : null;
          const wait = waitMin == null ? null : waitMin === 0 ? "지금 출발" : `${untilText(waitMin * 60)} 후`;
          // key 에 순서를 붙인다: 반대 방향 두 열차가 같은 시각에 떠나면 출발 시각이 겹친다
          return (
            <li key={`${o.depart_sec}-${i}`}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(o.depart_sec)}
                // 그림자는 Tailwind shadow 로 준다(.card-shadow 의 box-shadow 는 선택 테두리 ring 을 덮어 버린다)
                className={`relative w-full shadow-[0_6px_20px_rgb(61_152_251/0.1)] rounded-2xl bg-surface p-3.5 text-left ring-2 transition ${
                  on ? "ring-brand" : "ring-transparent hover:ring-line"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <RouteChips data={data} journey={o.journey} />
                  <span className="shrink-0 text-[13px] text-muted">
                    소요 <b className="text-[15px] font-bold text-text tabular-nums">{Math.round((o.arrive_sec - o.depart_sec) / 60)}분</b>
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-[13px] text-muted">
                    출발 <b className="text-[15px] font-bold text-text tabular-nums">{hhmm(o.depart_sec)}</b>
                    {wait && <span className="tabular-nums"> · {wait}</span>}
                  </span>
                  <span className="flex items-center gap-1 text-[13px] text-muted">
                    <Icon name="home" className="h-4 w-4 text-brand" />
                    귀가 확률 <b className={`text-[17px] font-extrabold tabular-nums ${TONE[tone].text}`}>{pctText(o.p_home)}</b>
                  </span>
                </div>
                {tag && (
                  <span
                    className={`absolute -top-2 right-3 rounded-full px-2 py-px text-[11px] leading-4 font-bold text-white ${
                      tag === "막차" ? "bg-danger-ink" : "bg-brand-strong"
                    }`}
                  >
                    {tag}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {options.length > VISIBLE && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="mt-1.5 flex min-h-11 w-full items-center justify-center gap-1 rounded-2xl text-[14px] font-semibold text-brand-ink hover:bg-chip/50"
        >
          {all ? "접기" : `출발 시각 ${options.length}개 모두 보기`}
          <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${all ? "rotate-180" : ""}`} />
        </button>
      )}
    </section>
  );
}
