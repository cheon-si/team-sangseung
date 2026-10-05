import { useState } from "react";
import { DAY_TYPES } from "../config";
import { hhmm, parseHHMM } from "../format";

const QUICK = ["23:00", "23:40", "00:10", "00:30"];

// 시연 모드: 시각·요일을 바꿔 그때 기준으로 계산한다(낮에 시연하기 위함). URL 의 ?t=&day= 와 같은 효과.
export default function TimePanel({ clock, onApply, onReset }) {
  const [time, setTime] = useState(hhmm(clock.nowSec));
  const [tag, setTag] = useState(clock.tag);
  const sec = parseHHMM(time);

  return (
    <div className="px-5 pt-2 pb-6">
      <h2 id="time-title" className="text-[20px] font-bold">시각·요일 바꾸기</h2>
      <p className="mt-1 text-[14px] text-muted">시연 모드예요. 고른 시각에 출발한다고 보고 계산해요.</p>

      <label className="mt-5 block text-[13px] font-semibold text-muted" htmlFor="demo-time">출발 시각</label>
      <input
        id="demo-time"
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="mt-1.5 h-13 w-full rounded-2xl border border-line bg-canvas px-4 text-[22px] font-bold text-text tabular-nums [color-scheme:light] focus:border-brand focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setTime(q)}
            className={`min-h-11 rounded-xl px-3.5 text-[15px] font-semibold tabular-nums ${time === q ? "bg-brand-strong text-white" : "bg-chip text-brand-ink"}`}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="mt-5 text-[13px] font-semibold text-muted">요일</div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-2xl bg-canvas p-1" role="radiogroup" aria-label="요일">
        {DAY_TYPES.map((d) => (
          <button
            key={d.tag}
            type="button"
            role="radio"
            aria-checked={tag === d.tag}
            onClick={() => setTag(d.tag)}
            className={`min-h-11 rounded-xl text-[14px] font-semibold ${tag === d.tag ? "bg-surface text-brand-ink shadow-sm" : "text-muted"}`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button type="button" onClick={onReset} className="min-h-12 rounded-2xl bg-chip font-semibold text-brand-ink">
          지금 시각으로
        </button>
        <button
          type="button"
          disabled={sec == null}
          onClick={() => onApply({ nowSec: sec, tag })}
          className="min-h-12 rounded-2xl bg-brand-strong font-bold text-white disabled:opacity-40"
        >
          적용
        </button>
      </div>
    </div>
  );
}
