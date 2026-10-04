// 노선 번호 배지 (노선 공식 색). 카카오맵·네이버지도 길찾기의 노선 표시를 따른다.
export default function LinePill({ line, color, size = "md" }) {
  const box = size === "sm" ? "h-5 min-w-5 text-[11px]" : "h-6 min-w-6 text-[13px]";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full px-1.5 font-bold leading-none text-white tabular-nums ${box}`}
      style={{ background: color, textShadow: "0 1px 1px rgb(0 0 0 / 0.25)" }}
      aria-label={`${line}호선`}
    >
      {line}
    </span>
  );
}
