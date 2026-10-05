// 선 아이콘 모음 (24×24, stroke). 이모지 대신 써서 기기마다 모양이 달라지지 않게 한다.
// 원은 호(arc) 두 개로 그린다: M (cx-r) cy a r r 0 1 0 2r 0 a r r 0 1 0 -2r 0
const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const PATHS = {
  home: "M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z",
  clock: `${circle(12, 12, 9)}M12 7.5V12l3 2`,
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  locate: `${circle(12, 12, 7)}${circle(12, 12, 2.5)}M12 2v3M12 19v3M2 12h3M19 12h3`,
  menu: "M4 7h16M4 12h16M4 17h16",
  walk: `${circle(13, 4.5, 1.6)}M10 21l1.6-6.4 2.9 2.9V21M8 11.5l2.4-3.3 3.4 1 1.8 3.3 2.4 1M11.6 14.6 12.6 9`,
  warning: "M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.6v.2",
  close: "M6 6l12 12M18 6 6 18",
  search: `${circle(11, 11, 7)}M20.5 20.5l-4.6-4.6`,
  pin: `M12 21s-7-6.1-7-11.4a7 7 0 0 1 14 0C19 14.9 12 21 12 21z${circle(12, 9.6, 2.4)}`,
  bus: "M6 3h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 11h16M7.5 21v-3M16.5 21v-3M8 14.5h.01M16 14.5h.01",
  bike: `${circle(5.5, 16.5, 3.5)}${circle(18.5, 16.5, 3.5)}M5.5 16.5 9 9h6l3.5 7.5M9 9 12 16.5h-1M14 5.5h2.5L18 9`,
  chart: "M4 20V11M10 20V5M16 20v-6M2.5 20h19",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3",
  info: `${circle(12, 12, 9)}M12 16.5v-5M12 8h.01`,
  // 하단 탭바·카드용 (레퍼런스 UI 키트의 아이콘 자리)
  train: "M7 3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM4 11h16M8.5 14h.01M15.5 14h.01M8 17l-2.5 4M16 17l2.5 4",
  play: `${circle(12, 12, 9)}M10 8.5v7l5.5-3.5z`,
  ticket: "M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4zM14 6v2.5M14 11v2M14 15.5V18",
};

export default function Icon({ name, className = "h-5 w-5", strokeWidth = 2 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// 지도 오버레이(React 밖 DOM)용 SVG 문자열
export function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
}
