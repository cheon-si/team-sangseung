import { useJson } from "../data";
import { withYeok } from "../format";
import Icon from "./Icon";

const NEAR_LIMIT_M = 500; // 그 역 자료가 없을 때 대신 보여 줄 가까운 역의 최대 거리(1.3km 떨어진 역 정보는 그 역 대안이 아님)

// "놓치면" 대안: 위험 환승역(또는 출발역) 근처 N버스 정류장·따릉이 대여소 (station_alt.json).
// 위치 정보만 있다. 운행 시각·배차·남은 자전거 수는 없다.
// station_alt.json 은 환승역만 담고 있어, 그 역이 없으면 near(좌표)에서 가장 가까운 역을 대신 보여 준다.
// title: 놓친 환승이 있으면 "놓치면", 출발역 대안(경로 없음·확률 낮음)이면 "대안"
export default function MissedAlt({ station, near, compact = false, title = "놓치면" }) {
  const alt = useJson("station_alt");
  if (!alt) return null;
  let s = alt.stations.find((x) => x.station === station);
  let distance = null;
  if (!s && near) {
    const best = alt.stations
      .filter((x) => x.lat && x.lon)
      .map((x) => ({ x, d: distanceM(near, x) }))
      .sort((a, b) => a.d - b.d)[0];
    if (best && best.d <= NEAR_LIMIT_M) {
      s = best.x;
      distance = Math.round(best.d / 10) * 10;
    }
  }
  if (!s) {
    return compact ? null : (
      <section className="px-4 pt-6">
        <h3 className="text-[16px] font-bold">{title}</h3>
        <p className="mt-1 text-[14px] text-muted">{withYeok(station)} 주변 N버스·따릉이 정보는 아직 없어요.</p>
      </section>
    );
  }
  const routes = [...new Set(s.owl_bus.flatMap((o) => o.routes))];
  const owl = s.owl_bus[0];
  const bike = s.bike[0];

  return (
    <section className={compact ? "" : "px-3 pt-6"} aria-label={`${withYeok(s.station)} 근처 대안`}>
      {!compact && (
        <h3 className="px-1 text-[16px] font-bold">
          {title}{" "}
          <span className="font-medium text-muted">
            · {withYeok(s.station)} 근처{distance != null && ` (${station}에서 ${distance}m)`}
          </span>
        </h3>
      )}
      <div className="mt-2 grid gap-2">
        <Item
          compact={compact}
          icon="bus"
          title={routes.length ? `N버스 ${routes.join("·")}` : "N버스 정류장 없음 (500m 안)"}
          sub={owl ? `${owl.stop_name} · ${owl.distance_m}m` : `가장 가까운 정류장 ${s.nearest_owl_m}m`}
        />
        <Item
          compact={compact}
          icon="bike"
          title={bike ? "따릉이 대여소" : "따릉이 대여소 없음 (300m 안)"}
          sub={bike ? `${bike.name} · ${bike.distance_m}m` : `가장 가까운 대여소 ${s.nearest_bike_m}m`}
        />
      </div>
      {!compact && <p className="mt-2 px-1 text-[12px] text-muted">위치만 알려 드려요. 운행 시각·배차·남은 자전거 정보는 없어요.</p>}
    </section>
  );
}

function Item({ icon, title, sub, compact }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${compact ? "bg-canvas" : "card-shadow bg-surface"}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-chip text-brand-ink">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold">{title}</div>
        <div className="truncate text-[13px] text-muted">{sub}</div>
      </div>
    </div>
  );
}

function distanceM(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return 6371000 * Math.hypot(x, y);
}
