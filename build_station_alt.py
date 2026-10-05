"""작업 7. 환승역 좌표·심야 하차 인원·근처 N버스·따릉이 (앱 station_alt.json의 바탕).

수집과 무관해 지금 완성한다. 확률 필드(worst_p, median_p)는 export_for_app.py가 채운다.

입력:
    시간표 CSV(역사코드) → station_coords.json(BLDN_ID, LAT, LOT)   역 좌표, 코드로 직접 결합
    CardSubwayTime.jsonl   2026-07 역별 시간대 승하차, 23시·0시 하차 = 심야 하차 인원
    CardBusTimeNew.jsonl   2026-07 버스 노선·정류장 승하차, 교통수단 코드 051 = N버스(심야버스)
    busStopLocationXyInfo.jsonl   정류장 좌표(XCRD=경도, YCRD=위도)
    tbCycleStationInfo.jsonl      따릉이 대여소 좌표
출력: data/processed/station_alt_base.json

사용: python build_station_alt.py
"""

import json
from datetime import datetime

import numpy as np
import pandas as pd

import common as c

AUX = c.BASE_DIR / "data" / "aux"
OWL_RADIUS_M, BIKE_RADIUS_M, TOP_K = 500, 300, 3
# 승하차 자료 노선명 → 1~9호선. 1호선 코레일 구간은 경부·경원·경인·장항선, 3호선 일산선, 4호선 과천·안산선으로 적혀 있다.
CARD_LINE = {f"{n}호선": str(n) for n in range(1, 10)} | {
    "경부선": "1", "경원선": "1", "경인선": "1", "장항선": "1", "일산선": "3",
    "과천선": "4", "안산선": "4", "9호선2~3단계": "9"}
MANUAL_COORDS = {}   # 코드 결합이 안 되는 역의 수동 좌표 {(노선, 역명): (위도, 경도)}


def read_jsonl(path) -> pd.DataFrame:
    with open(path, encoding="utf-8") as f:
        return pd.DataFrame([json.loads(line) for line in f])


def haversine_m(lat1, lon1, lat2, lon2):
    """두 좌표 사이 거리(m). numpy 배열끼리 브로드캐스트."""
    r = 6371000.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2) - np.radians(lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def station_coords(st: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    """(노선, 역명) → 시간표 역사코드 → 좌표. 역명만으로 결합하지 않는다(같은 이름 다른 역: 양평 53km 차이)."""
    tt = pd.read_csv(c.TIMETABLE_CSV, encoding="cp949", dtype=str, usecols=["호선", "역사코드", "역사명"])
    tt["line"] = tt["호선"].str.extract(r"(\d)")[0]
    codes = tt.drop_duplicates(["line", "역사명"]).set_index(["line", "역사명"])["역사코드"]
    with open(c.REF_DIR / "station_coords.json", encoding="utf-8") as f:
        raw = json.load(f)
    coords = pd.DataFrame(raw if isinstance(raw, list) else next(v for v in raw.values() if isinstance(v, list)))
    coords = coords.drop_duplicates("BLDN_ID").set_index("BLDN_ID")[["LAT", "LOT"]].astype(float)
    st = st.copy()
    st["code"] = [codes.get((l, s)) for l, s in zip(st["line"], st["station"])]
    st["lat"] = st["code"].map(coords["LAT"])
    st["lon"] = st["code"].map(coords["LOT"])
    for (l, s), (la, lo) in MANUAL_COORDS.items():
        m = (st["line"] == l) & (st["station"] == s)
        st.loc[m, ["lat", "lon"]] = la, lo
    missing = st[st["lat"].isna()][["line", "station", "code"]].values.tolist()
    return st, missing


def station_points(st: pd.DataFrame) -> pd.DataFrame:
    """물리 역 하나의 대표 좌표 = 노선별 좌표 평균. 노선 좌표 간 최대 거리를 함께 남긴다."""
    rows = []
    for sid, g in st.dropna(subset=["lat"]).groupby("station_id"):
        lat, lon = g["lat"].mean(), g["lon"].mean()
        spread = 0.0
        if len(g) > 1:
            la, lo = g["lat"].to_numpy(), g["lon"].to_numpy()
            spread = float(haversine_m(la[:, None], lo[:, None], la[None, :], lo[None, :]).max())
        rows.append({"station": sid, "lines": sorted(g["line"].unique()), "lat": round(lat, 6),
                     "lon": round(lon, 6), "coord_spread_m": round(spread)})
    return pd.DataFrame(rows)


def night_alight() -> pd.Series:
    """역별 23시·0시 하차 인원(2026-07 월합계). 원자료가 두 번씩 들어 있어 중복을 지운다."""
    s = read_jsonl(AUX / "CardSubwayTime.jsonl").drop_duplicates(["SBWY_ROUT_LN_NM", "STTN"])
    s["line"] = s["SBWY_ROUT_LN_NM"].map(CARD_LINE)
    s = s.dropna(subset=["line"])
    s["station"] = c.norm_station(s["STTN"]).replace({"이수": "총신대입구"})
    s["night_off"] = s["HR_23_GET_OFF_NOPE"].astype(float) + s["HR_0_GET_OFF_NOPE"].astype(float)
    return s.groupby("station")["night_off"].sum()


def owl_stops() -> pd.DataFrame:
    """N버스 정류장: 정류장 좌표 + 그 정류장에 서는 N노선 목록."""
    b = read_jsonl(AUX / "CardBusTimeNew.jsonl")
    b = b[b["TRFC_MNS_TYPE_CD"] == "051"][["RTE_NO", "STOPS_ID"]].drop_duplicates()
    b = b[~b["STOPS_ID"].astype(str).str.startswith("998")]       # 좌표 체계가 다른 가상 정류장 ID
    loc = read_jsonl(AUX / "busStopLocationXyInfo.jsonl")[["STOPS_NO", "STOPS_NM", "XCRD", "YCRD"]]
    m = b.merge(loc, left_on="STOPS_ID", right_on="STOPS_NO", how="inner")
    g = m.groupby(["STOPS_ID", "STOPS_NM", "XCRD", "YCRD"])["RTE_NO"].apply(lambda x: sorted(set(x))).reset_index()
    return pd.DataFrame({"name": g["STOPS_NM"], "lat": g["YCRD"].astype(float), "lon": g["XCRD"].astype(float),
                         "routes": g["RTE_NO"]})


def bike_stations() -> pd.DataFrame:
    k = read_jsonl(AUX / "tbCycleStationInfo.jsonl")
    k["lat"], k["lon"] = k["STA_LAT"].astype(float), k["STA_LONG"].astype(float)
    k = k[(k["lat"] > 30) & (k["lon"] > 120)]          # (0,0) 좌표 행 제외
    return pd.DataFrame({"name": k["RENT_NM"], "lat": k["lat"], "lon": k["lon"]})


def nearest(pt: pd.Series, cands: pd.DataFrame, radius: float, extra=("routes",)) -> tuple[list, float]:
    d = haversine_m(pt["lat"], pt["lon"], cands["lat"].to_numpy(), cands["lon"].to_numpy())
    order = np.argsort(d)
    near_m = float(d[order[0]]) if len(d) else np.nan
    out = []
    for i in order[:TOP_K]:
        if d[i] > radius:
            break
        r = cands.iloc[i]
        item = {"name": r["name"], "distance_m": int(round(d[i])), "lat": round(r["lat"], 6),
                "lon": round(r["lon"], 6)}
        for col in extra:
            if col in cands:
                item[col] = list(r[col])
        out.append(item)
    return out, round(near_m)


def main() -> None:
    st, missing = station_coords(c.transfer_stations())
    pts = station_points(st)
    alight = night_alight()
    owl, bike = owl_stops(), bike_stations()
    stations = []
    for _, p in pts.iterrows():
        o, o_near = nearest(p, owl, OWL_RADIUS_M)
        b, b_near = nearest(p, bike, BIKE_RADIUS_M, extra=())
        na = alight.get(p["station"])
        stations.append({
            "station": p["station"], "lines": p["lines"], "lat": p["lat"], "lon": p["lon"],
            "coord_spread_m": p["coord_spread_m"],
            "night_alight": int(na) if na is not None and not np.isnan(na) else None,
            "nearest_owl_m": o_near, "nearest_bike_m": b_near,
            "owl_bus": [{"stop_name": x["name"], "routes": x["routes"], "distance_m": x["distance_m"],
                         "lat": x["lat"], "lon": x["lon"]} for x in o],
            "bike": b, "worst_p": None, "median_p": None})
    out = {"meta": {"generated_at": datetime.now().isoformat(timespec="seconds"),
                    "sources": {"bus_card": "202607", "subway_card": "202607"},
                    "radius_m": {"owl_bus": OWL_RADIUS_M, "bike": BIKE_RADIUS_M},
                    "note": "N버스는 정류장 위치와 노선만 제공(운행 시각·배차 정보 없음)"},
           "stations": stations}
    c.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with open(c.PROCESSED_DIR / "station_alt_base.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    df = pd.DataFrame(stations)
    print(f"역 {len(df)}개 (목록 {c.transfer_stations()['station_id'].nunique()}개), 좌표 결측 (노선,역): {missing or '없음'}")
    print(f"심야 하차 인원 결측 역: {df.loc[df['night_alight'].isna(), 'station'].tolist() or '없음'}")
    print(f"500m 안 N버스 정류장 있는 역 {int((df['owl_bus'].str.len() > 0).sum())}개, "
          f"300m 안 따릉이 있는 역 {int((df['bike'].str.len() > 0).sum())}개")
    print(f"노선 좌표 간 최대 거리 상위: "
          f"{df.nlargest(3, 'coord_spread_m')[['station', 'coord_spread_m']].values.tolist()}")
    print(f"심야 하차 상위 5: {df.nlargest(5, 'night_alight')[['station', 'night_alight']].values.tolist()}")


if __name__ == "__main__":
    main()
