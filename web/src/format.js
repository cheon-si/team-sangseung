import { THRESHOLDS } from "./config";

// 화면 공통 표시 함수. 시각은 운영일 00:00 기준 초(자정 넘으면 86400 이상, 계약 0장).

// 초 → "HH:MM" (24시 이후는 00:xx 로 보여 준다)
export function hhmm(sec) {
  if (sec == null) return "--:--";
  const m = Math.floor(sec / 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// "HH:MM" → 운영일 초. 03시 전은 자정을 넘긴 시각으로 본다(00:30 → 88200). "24:30" 표기도 받는다.
export function parseHHMM(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 27 || min > 59) return null;
  return (h < 3 ? h + 24 : h) * 3600 + min * 60;
}

// 확률 표시. 99.5% 이상·0.5% 미만은 100%·0% 로 단정하지 않는다.
export function pctText(p) {
  if (p == null) return "-";
  if (p >= 0.995) return ">99%";
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

// 역 이름 + "역" (이름이 이미 "역"으로 끝나면 그대로: 서울역 → "서울역", 강남 → "강남역")
export const withYeok = (name) => (name?.endsWith("역") ? name : `${name}역`);

// 도보·여유 시간: 0.1분 단위
export const minText = (sec) => `${Math.round(sec / 6) / 10}분`;
// 시간표 여유는 1분 미만이면 초로 보여 준다(여유 1초가 "+0분"으로 보이지 않게)
export const signedMinText = (sec) =>
  Math.abs(sec) < 60 ? `${sec > 0 ? "+" : ""}${Math.round(sec)}초` : `${sec > 0 ? "+" : ""}${Math.round(sec / 6) / 10}분`;

// 화면에 보이는 두 시각(hhmm, 초는 버림) 사이의 분. 00:27:30 마감을 "00:27"로 보여 주면서 남은 시간을 반올림해
// "13분 남음"(실제 12.5분)으로 쓰면 보이는 시각보다 길게 남은 것처럼 보인다. 막차 앱에서는 위험한 쪽이라 보이는 분끼리 뺀다.
export const shownMinutes = (fromSec, toSec) => Math.floor(toSec / 60) - Math.floor(fromSec / 60);

// 남은 시간: "46분" / "1시간 5분"
export function untilText(sec) {
  const m = Math.max(0, Math.round(sec / 60));
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
}

// 판정 색: config.js THRESHOLDS 기준 (≥0.8 safe, 0.5~0.8 gamble, <0.5 danger)
export function toneOf(p) {
  if (p == null) return "none";
  if (p >= THRESHOLDS.safe) return "safe";
  if (p < THRESHOLDS.alternative) return "danger";
  return "gamble";
}

// Tailwind 가 찾을 수 있도록 클래스 이름을 문자열 그대로 둔다.
// text 는 글씨용 진한 색(*-ink, 흰·연하늘 배경 4.5:1 이상), bg·hex 는 막대·점·지도 배지용 기본색
export const TONE = {
  safe: { text: "text-safe-ink", bg: "bg-safe", soft: "bg-safe/10", border: "border-safe/45", hex: "#10b981" },
  gamble: { text: "text-gamble-ink", bg: "bg-gamble", soft: "bg-gamble/10", border: "border-gamble/50", hex: "#f59e0b" },
  danger: { text: "text-danger-ink", bg: "bg-danger", soft: "bg-danger/10", border: "border-danger/45", hex: "#f43f5e" },
  none: { text: "text-muted", bg: "bg-soft", soft: "bg-canvas", border: "border-line", hex: "#b9cbe2" },
};
