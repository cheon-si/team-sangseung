import { MARGIN_OPTIONS, WALK_OPTIONS } from "../config";
import { paceOptions } from "../settings";
import Icon from "./Icon";

// 걸음 속도·여유 선호 고르기(「내 역」 탭과 헤더 칩 시트 공용). 3단 세그먼트 두 개.
// pace = { walk: slow|normal|fast, margin: "0"|"30"|"60" } (settings.js). 바꾸면 귀가 확률·출발 마감·위험한 환승역이 다시 계산된다.
export default function PaceSettings({ pace, onChange }) {
  return (
    <div className="space-y-5">
      <Segment
        title="걸음 속도"
        options={WALK_OPTIONS}
        value={pace.walk}
        onPick={(walk) => onChange({ ...pace, walk })}
      />
      <Segment
        title="여유"
        options={MARGIN_OPTIONS}
        value={pace.margin}
        onPick={(margin) => onChange({ ...pace, margin })}
      />
      <p className="text-[12px] leading-relaxed text-muted">
        걸음 속도는 환승할 때 걷는 시간(환승 거리 ÷ 속도)에, 여유는 성공 기준에 들어가요. 느리게 걸으면 시간표상 못 갈아타는 환승이 생겨
        경로가 바뀔 수 있어요. 이 브라우저에만 저장돼요.
      </p>
    </div>
  );
}

function Segment({ title, options, value, onPick }) {
  const sel = options.find((o) => o.id === value) ?? options[0];
  return (
    <fieldset>
      <legend className="text-[15px] font-bold">{title}</legend>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-2xl bg-canvas p-1" role="radiogroup" aria-label={title}>
        {options.map((o) => {
          const on = o.id === sel.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(o.id)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl px-1 text-center transition-colors ${
                on ? "bg-brand-strong text-white shadow-[0_4px_12px_rgb(21_101_192/0.25)]" : "text-text hover:bg-chip"
              }`}
            >
              <span className="text-[15px] leading-5 font-bold">{o.label}</span>
              <span className={`text-[12px] leading-4 tabular-nums ${on ? "text-white/85" : "text-muted"}`}>{o.short}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 px-1 text-[13px] text-muted">{sel.desc}</p>
    </fieldset>
  );
}

// 헤더 칩: 지금 설정("보통 걸음 · 여유 0초"). 누르면 설정 시트를 연다. 기본이 아니면 강조색(시연 배지와 같은 주황)
export function PaceChip({ pace, onClick }) {
  const o = paceOptions(pace);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`걸음 속도·여유 설정: ${o.label}`}
      className={`flex h-11 min-w-0 items-center gap-1.5 rounded-full pr-2.5 pl-3 text-[13px] font-semibold ${
        o.isDefault ? "header-pill" : "bg-gamble text-[#1f2333] shadow-[0_4px_12px_rgb(154_69_8/0.25)]"
      }`}
    >
      <Icon name="walk" className="h-4 w-4 shrink-0" strokeWidth={2.3} />
      <span className="truncate whitespace-nowrap">{o.label}</span>
      <Icon name="chevronDown" className="h-4 w-4 shrink-0" />
    </button>
  );
}
