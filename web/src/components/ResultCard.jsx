import { VERDICT_TEXT, verdictOf } from "../config";
import { pct } from "../data";

const TONE = {
  emerald: "bg-emerald-50 border-emerald-300 text-emerald-800",
  amber: "bg-amber-50 border-amber-300 text-amber-800",
  rose: "bg-rose-50 border-rose-300 text-rose-800",
  slate: "bg-slate-100 border-slate-300 text-slate-700",
};

// 확률, 구간, 판정, 시간표 대비를 한 카드에 보여준다.
export default function ResultCard({ row }) {
  const v = verdictOf(row);
  const t = v ? VERDICT_TEXT[v] : null;
  const ci =
    row.ci_low != null ? `${pct(row.ci_low)} ~ ${pct(row.ci_high)}` : `구간 산출 불가 (${row.n_nights}밤 기준)`;
  return (
    <div className={`rounded-xl border p-5 ${t ? TONE[t.color] : TONE.slate}`}>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm opacity-80">막차 환승 성공 확률</div>
          <div className="text-5xl font-bold tabular-nums">{pct(row.p_success)}</div>
          <div className="text-sm mt-1">95% 구간 {ci}</div>
        </div>
        {t && (
          <div className="text-right">
            <div className="text-2xl font-bold">{t.label}</div>
            <div className="text-sm max-w-xs">{t.desc}</div>
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-slate-700">
        <Fact k="타고 온 막차 도착" v={`${row.arrive} (${row.a_dest}행)`} />
        <Fact k="갈아탈 막차 출발" v={`${row.depart} (${row.d_dest}행)`} />
        <Fact k="환승 도보" v={`${Math.round((row.walk_sec / 60) * 10) / 10}분`} />
        <Fact k="시간표상 여유" v={`${row.buffer_min > 0 ? "+" : ""}${row.buffer_min}분`} />
      </div>
      <p className="mt-3 text-sm text-slate-700">
        시간표만 보면 <b>{row.p_timetable ? "갈아탈 수 있습니다" : "갈아탈 수 없습니다"}</b>. 타고 온 열차의 도착
        지연과 갈아탈 막차의 출발 지연을 모두 반영하면 성공 확률은 <b>{pct(row.p_success)}</b>입니다. 갈아탈 막차가
        시간표대로 정시에 떠난다고만 가정하면 {pct(row.p_first)}입니다.
        {row.thin && " 이 노선·시간대는 밤마다 지연 차이가 커서 구간이 넓습니다."}
        {(row.dep_fallback || row.arr_fallback) && " 이 요일의 막차 기록이 부족해 다른 요일 기록을 빌려 썼습니다."}
      </p>
    </div>
  );
}

function Fact({ k, v }) {
  return (
    <div className="bg-white/70 rounded-lg px-3 py-2">
      <div className="text-xs text-slate-500">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}
