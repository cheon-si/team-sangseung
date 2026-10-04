import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// 타고 온 노선의 도착 지연 누적분포. 버퍼 B 세로선 왼쪽 높이가 곧 성공 확률이다.
// dark: 귀가 앱의 어두운 바텀시트(화면 3)에서 쓸 때 선·글자 색을 밝게 바꾼다.
export default function CdfChart({ dist, gridSec, bufferSec, dark = false }) {
  if (!dist) return null;
  const ink = dark ? "#b9c4de" : "#334155";
  const mark = dark ? "#fb7185" : "#e11d48";
  const bMin = bufferSec / 60;
  const data = gridSec
    .map((s, i) => ({ m: s / 60, cdf: dist.cdf[i] }))
    .filter((d) => d.m <= 15)
    .map((d) => ({ ...d, ok: d.m <= bMin ? d.cdf : null }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 24, right: 16, bottom: 20, left: 0 }}>
          <XAxis
            dataKey="m"
            type="number"
            domain={[-2, 15]}
            ticks={[-2, 0, 2, 4, 6, 8, 10, 12, 14]}
            stroke={ink}
            tick={{ fill: ink, fontSize: 12 }}
            label={{ value: "타고 온 열차의 도착 지연(분)", position: "insideBottom", offset: -10, fill: ink, fontSize: 12 }}
          />
          <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} stroke={ink} tick={{ fill: ink, fontSize: 12 }} />
          <Tooltip
            formatter={(v) => `${Math.round(v * 100)}%`}
            labelFormatter={(m) => `지연 ${m.toFixed(2)}분 이하`}
            contentStyle={dark ? { background: "#111d3a", border: "1px solid #26395f", color: "#eef2fb" } : undefined}
          />
          <Area dataKey="ok" stroke="none" fill="#10b981" fillOpacity={dark ? 0.3 : 0.25} isAnimationActive={false} />
          <Line dataKey="cdf" stroke={dark ? "#eef2fb" : "#334155"} dot={false} strokeWidth={2} isAnimationActive={false} />
          {bMin >= -2 && bMin <= 15 && (
            <ReferenceLine
              x={bMin}
              stroke={mark}
              strokeDasharray="4 3"
              label={{ value: `여유 ${bMin.toFixed(1)}분`, position: "top", fill: mark, fontSize: 12 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
