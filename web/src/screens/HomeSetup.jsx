import Icon from "../components/Icon";
import StationPicker from "../components/StationPicker";
import { DEMO_PRESETS } from "../config";
import { TONE } from "../format";

// 화면 0. 집 역 등록 (첫 방문 한 번). 집은 역으로만 받는다 — 주소는 지오코딩·도보 계산이 더 필요하고 확률과 무관.
// onPreset: 시연 프리셋 열기(집을 등록하지 않아도 시연 경로를 바로 볼 수 있게)
export default function HomeSetup({ data, onPick, onPreset }) {
  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col px-4 pt-[max(env(safe-area-inset-top),20px)]">
      <p className="text-[13px] font-bold tracking-wide text-ink-400">막차 러시아룰렛</p>
      <h1 className="mt-6 text-[27px] leading-snug font-bold">집이 어느 역 근처인가요?</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-300">
        한 번만 정해 두면, 오늘 밤 집에 갈 확률과
        <br />
        몇 시까지 타야 하는지 바로 알려 드려요.
      </p>
      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <StationPicker data={data} onPick={onPick} placeholder="집 근처 역 이름" autoFocus />
      </div>
      {/* 375px에서 세 번째(거의 불가) 칩이 화면 밖에 숨지 않게 줄을 넘긴다 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pt-3" aria-label="시연 프리셋">
        <span className="shrink-0 text-[13px] text-ink-500">시연</span>
        {DEMO_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p)}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-night-800 px-3 text-[13px] font-semibold text-ink-100"
          >
            <span className={`h-2 w-2 rounded-full ${TONE[p.tone].bg}`} aria-hidden />
            <span className={TONE[p.tone].text}>{p.label}</span>
            <span className="text-ink-300">{p.from}→{p.home} {p.t}</span>
          </button>
        ))}
      </div>
      <p className="flex items-center justify-center gap-1.5 py-4 pb-[max(env(safe-area-inset-bottom),16px)] text-[13px] text-ink-400">
        <Icon name="lock" className="h-4 w-4" />
        브라우저에만 저장되고 서버로 보내지 않습니다.
      </p>
    </div>
  );
}
