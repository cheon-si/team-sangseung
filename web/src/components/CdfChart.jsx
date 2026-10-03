import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// 타고 온 노선의 도착 지연 누적분포. 버퍼 B 세로선 왼쪽 높이가 곧 성공 확률이다.
export default function CdfChart({ dist, gridSec, bufferSec }) {
  if (!dist) return null;
  const bMin = bufferSec / 60;
  const data = gridSec
    .map((s, i) => ({ m: s / 60, cdf: dist.cdf[i] }))
    .filter((d) => d.m <= 15)
    .map((d) => ({ ...d, ok: d.m <= bMin ? d.cdf : null }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
          <XAxis
            dataKey="m"
            type="number"
            domain={[-2, 15]}
            ticks={[-2, 0, 2, 4, 6, 8, 10, 12, 14]}
            label={{ value: "타고 온 열차의 도착 지연(분)", position: "insideBottom", offset: -10 }}
          />
          <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} />
          <Tooltip formatter={(v) => `${Math.round(v * 100)}%`} labelFormatter={(m) => `지연 ${m.toFixed(2)}분 이하`} />
          <Area dataKey="ok" stroke="none" fill="#10b981" fillOpacity={0.25} isAnimationActive={false} />
          <Line dataKey="cdf" stroke="#334155" dot={false} strokeWidth={2} isAnimationActive={false} />
          {bMin >= -2 && bMin <= 15 && (
            <ReferenceLine
              x={bMin}
              stroke="#e11d48"
              strokeDasharray="4 3"
              label={{ value: `여유 ${bMin.toFixed(1)}분`, position: "top", fill: "#e11d48", fontSize: 12 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
