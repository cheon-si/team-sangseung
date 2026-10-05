import Icon from "./Icon";
import { minSecText } from "../format";

// B 모형 환승 안내(환승 상세·타임라인·위험한 환승역 공용).
// s90 = 90% 확률로 타는 최소 시간표 여유(초, 여유 선호 포함), slack = 지금 시간표 여유(B 정의, W = 환승거리 ÷ 걸음 속도),
// toLine = 갈아탈 노선, margin = 여유 선호(초, 0 이면 표시 안 함).
// 8·9호선: 막차가 시간표에 가깝게 떠나 90%에 2분 이상 여유가 필요(B 보고서 11.1). 2호선: 오차가 가장 큰 환승(B 보고서 10·13장).
export const needText = (s90, margin = 0) =>
  `90% 확률로 타려면 시간표 여유 ${minSecText(Math.ceil(s90))} 이상 필요${margin > 0 ? `(내 여유 ${margin}초 포함)` : ""}`;
export const isLateLine = (line) => line === "8" || line === "9";
export const isLowTrust = (line) => line === "2";

export default function ModelBNote({ s90, slack, toLine, margin = 0, compact = false }) {
  if (s90 == null) return null;
  const ok = slack >= s90;
  return (
    <div className={compact ? "mt-1.5 space-y-1 text-[13px]" : "mt-3 space-y-2 text-[14px]"}>
      <div className={`leading-snug tabular-nums ${compact ? "text-muted" : "rounded-2xl bg-canvas px-3 py-2.5 text-text"}`}>
        {needText(s90, margin)}
        <span className={ok ? "text-safe-ink" : "text-gamble-ink"}> (지금 여유 {minSecText(slack, true)})</span>
      </div>
      {isLateLine(toLine) && (
        <div className="flex items-center gap-1.5 font-medium text-gamble-ink">
          <Icon name="clock" className="h-4 w-4 shrink-0" strokeWidth={2.2} /> 8·9호선 막차는 시간표에 가깝게 떠나요
        </div>
      )}
      {isLowTrust(toLine) && (
        <div className="flex items-center gap-1.5 font-medium text-muted">
          <Icon name="info" className="h-4 w-4 shrink-0" strokeWidth={2.2} /> 확률 신뢰 낮음(2호선 환승은 오차가 큼)
        </div>
      )}
    </div>
  );
}
