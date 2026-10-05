import { DEMO_PRESETS } from "../config";
import { TONE } from "../format";
import Icon from "./Icon";

// 시연 프리셋 목록(config.js DEMO_PRESETS). 메뉴와 화면 0에서 같이 쓴다.
export default function PresetList({ onPick }) {
  return (
    <ul className="grid gap-1">
      {DEMO_PRESETS.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onPick(p)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left hover:bg-canvas">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE[p.tone].bg}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-semibold">{p.from} → {p.home}</span>
              <span className="block text-[13px] text-muted">
                <span className={`font-semibold ${TONE[p.tone].text}`}>{p.label}</span> · {p.t} 출발 기준
              </span>
            </span>
            <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-muted" />
          </button>
        </li>
      ))}
    </ul>
  );
}
