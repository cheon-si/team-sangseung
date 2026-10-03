import { useMemo, useState } from "react";
import { pct } from "../data";

// 탭 2. 환승역 위험 지도. 지도 타일 없이 위경도를 그대로 찍은 산점도(키·외부 호출 없음).
// 색 = 그 역에서 시간표상 갈아탈 수 있는 평일 조합 중 최악 성공 확률, 크기 = 23시·0시 하차 인원(2026-07).
export default function MapTab({ data, onPick }) {
  const pts = data.alt.stations.filter((s) => s.lat && s.lon);
  const [hover, setHover] = useState(null);
  const box = useMemo(() => {
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) };
  }, [pts]);
  const W = 800, H = 640, PAD = 30;
  const kx = Math.cos((37.55 * Math.PI) / 180); // 위도 37.5도에서 경도 1도는 위도 1도보다 짧다
  const sx = (W - 2 * PAD) / ((box.maxLon - box.minLon) * kx);
  const sy = (H - 2 * PAD) / (box.maxLat - box.minLat);
  const s = Math.min(sx, sy);
  const X = (lon) => PAD + (lon - box.minLon) * kx * s;
  const Y = (lat) => H - PAD - (lat - box.minLat) * s;
  const maxN = Math.max(...pts.map((p) => p.night_alight || 0));
  const R = (n) => 4 + 14 * Math.sqrt((n || 0) / maxN);
  const color = (p) => (p == null ? "#94a3b8" : p >= 0.8 ? "#10b981" : p >= 0.5 ? "#f59e0b" : "#e11d48");

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        색은 그 역에서 <b>시간표상으로는 갈아탈 수 있는</b> 평일 막차 조합 중 <b>가장 낮은 실측 성공 확률</b>, 크기는 <b>23시·0시 하차 인원</b>입니다. 원을 누르면
        탭 1에서 그 역을 엽니다.
      </p>
      <div className="rounded-xl border border-slate-200 bg-white p-2 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {pts
            .slice()
            .sort((a, b) => (b.night_alight || 0) - (a.night_alight || 0))
            .map((p) => (
              <g key={p.station} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                 onClick={() => onPick(p.station)} className="cursor-pointer">
                <circle cx={X(p.lon)} cy={Y(p.lat)} r={R(p.night_alight)} fill={color(p.worst_p)}
                        fillOpacity={0.75} stroke="white" strokeWidth={1.5} />
                <text x={X(p.lon)} y={Y(p.lat) - R(p.night_alight) - 3} textAnchor="middle" fontSize="11" fill="#334155">
                  {p.station}
                </text>
              </g>
            ))}
        </svg>
      </div>
      <div className="text-sm min-h-6">
        {hover && (
          <span>
            <b>{hover.station}</b> ({hover.lines.join("·")}호선) · 최악 {pct(hover.worst_p)} · 중앙 {pct(hover.median_p)} ·
            심야 하차 {hover.night_alight?.toLocaleString()}명/월
          </span>
        )}
      </div>
      <div className="flex gap-4 text-xs text-slate-500">
        <Legend c="#10b981" t="80% 이상" /><Legend c="#f59e0b" t="50~80%" /><Legend c="#e11d48" t="50% 미만" /><Legend c="#94a3b8" t="시간표상 가능한 조합 없음" />
      </div>
    </div>
  );
}

function Legend({ c, t }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-full" style={{ background: c }} />
      {t}
    </span>
  );
}
