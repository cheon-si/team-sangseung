// 실패했을 때 대안: 역 근처 올빼미버스 정류장과 따릉이 대여소.
export default function AltList({ station }) {
  if (!station) return null;
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">올빼미버스 정류장 (500m 안)</h3>
        {station.owl_bus.length === 0 ? (
          <p className="text-sm text-slate-500 mt-2">없음. 가장 가까운 정류장 {station.nearest_owl_m}m</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {station.owl_bus.map((o) => (
              <li key={o.stop_name + o.distance_m}>
                {o.stop_name} <span className="text-slate-500">· {o.distance_m}m</span>
                <div className="text-xs text-indigo-700">{o.routes.join(", ")}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-400 mt-2">정류장 위치만 제공합니다. 운행 시각과 배차 정보는 없습니다.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">따릉이 대여소 (300m 안)</h3>
        {station.bike.length === 0 ? (
          <p className="text-sm text-slate-500 mt-2">없음. 가장 가까운 대여소 {station.nearest_bike_m}m</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {station.bike.map((b) => (
              <li key={b.name + b.distance_m}>
                {b.name} <span className="text-slate-500">· {b.distance_m}m</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
