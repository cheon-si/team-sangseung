"""첫날 밤(9/16) 실시간 데이터 검증.

1. 노선별 열차번호 매칭률 (실시간 ↔ 시간표 열차코드 숫자부)
2. 2호선 불일치 원인 (본선 번호 체계 차이 → 뒷 세 자리 규칙)
3. recptnDt가 초 단위 사건 시각인지
4. 관측 도착 시각 - 시간표 도착 시각의 첫 분포
5~11. 전처리 규칙(2호선·역명 별칭) 적용 후 매칭률, 오매칭 컷, 9호선 음수,
       환승역별 도착 시각 확보율(위치 API → 도착 API → 앞뒤 스탬프), 3호선 도착 API 불일치 열차

결과 요약은 프로젝트_방향_결정.md 6장. 사용: python verify_realtime.py [YYYYMMDD]
"""
import gzip
import sys
from pathlib import Path
import pandas as pd

BASE = Path(__file__).resolve().parent
DAY = sys.argv[1] if len(sys.argv) > 1 else "20260916"
pd.set_option("display.width", 200); pd.set_option("display.max_columns", 30)

pos = pd.read_json(gzip.open(f"{BASE}/collected/{DAY}/position_{DAY}.jsonl.gz"), lines=True, dtype=str)
arr = pd.read_json(gzip.open(f"{BASE}/collected/{DAY}/arrival_{DAY}.jsonl.gz"), lines=True, dtype=str)
tt = pd.read_csv(f"{BASE}/data/reference/서울교통공사_서울 도시철도 열차운행시각표_20260901.csv", encoding="cp949", dtype=str)
tt["digits"] = tt["열차코드"].str.extract(r"(\d+)")[0]
tt["dep_h"] = pd.to_numeric(tt["열차출발시간"].str[:2], errors="coerce")
tt["arr_h"] = pd.to_numeric(tt["열차도착시간"].str[:2], errors="coerce")
tt["late"] = (tt["dep_h"] >= 21) | (tt["arr_h"] >= 21)

pos["_collected_at"] = pos["_collected_at"].astype(str); pos["recptnDt"] = pos["recptnDt"].astype(str)
pos["line"] = pos["subwayId"].str[-1]
arr = arr[arr["subwayId"].str.match(r"100[1-9]$")].copy()
arr["_collected_at"] = arr["_collected_at"].astype(str); arr["recptnDt"] = arr["recptnDt"].astype(str)
arr["line"] = arr["subwayId"].str[-1]

def sep(t): print("\n" + "=" * 90 + f"\n{t}\n" + "=" * 90)

# ── 1. 노선별 열차번호 매칭률 ───────────────────────────────
sep("1. 노선별 열차번호 매칭률 (실시간 번호 → 평일(DAY) 시간표 열차코드 숫자부)")
rows = []
for line in "123456789":
    day = tt[(tt["호선"] == line) & (tt["주중주말"] == "DAY")]
    codes_all = set(day["digits"].dropna())
    codes_late = set(day.loc[day["late"], "digits"].dropna())
    p = set(pos.loc[pos["line"] == line, "trainNo"])
    a = set(arr.loc[arr["line"] == line, "btrainNo"])
    def rate(s, codes):
        if not s: return float("nan")
        return sum(1 for x in s if x in codes or x.lstrip("0") in codes) / len(s)
    seen = p | a | {x.lstrip("0") for x in p | a}
    rows.append(dict(line=line, pos_n=len(p), pos_match=round(rate(p, codes_all), 3),
                     arr_n=len(a), arr_match=round(rate(a, codes_all), 3),
                     tt_late_n=len(codes_late), tt_late_seen=round(sum(1 for c in codes_late if c in seen) / max(len(codes_late), 1), 3),
                     tt_prefix=sorted(day["열차코드"].str[0].unique())))
print(pd.DataFrame(rows).to_string(index=False))
print("\n※ pos_match: 위치 API 번호 중 시간표에 있는 비율. tt_late_seen: 21시 이후 시간표 열차 중 실시간에서 관측된 비율(커버리지).")

# ── 2. 2호선 불일치 원인 ────────────────────────────────────
sep("2. 2호선 불일치 진단")
day2 = tt[(tt["호선"] == "2") & (tt["주중주말"] == "DAY")]
codes2 = set(day2["digits"])
p2 = pos[pos["line"] == "2"].copy()
p2["match"] = p2["trainNo"].isin(codes2) | p2["trainNo"].str.lstrip("0").isin(codes2)
print("시간표 2호선 코드 구조 (첫자리 → 개수, 예시):")
for k, g in day2.groupby(day2["열차코드"].str[0]):
    print(f"  {k}xxx: {g['열차코드'].nunique():4d}개 열차  방향={sorted(g['방향'].unique())}  역 예시={g['역사명'].unique()[:5].tolist()}")
print("\n실시간 2호선 번호 첫자리 → (관측 행수, 매칭률):")
print(p2.groupby(p2["trainNo"].str[0]).agg(n=("trainNo", "size"), uniq=("trainNo", "nunique"), match=("match", "mean")).round(3).to_string())
um = p2[~p2["match"]]
print(f"\n불일치 행 {len(um)} / {len(p2)}, 고유 번호 {um['trainNo'].nunique()}개")
print("불일치 번호 예시:", sorted(um["trainNo"].unique())[:40])
print("\n불일치 열차가 관측된 역 (상위 15):")
print(um["statnNm"].value_counts().head(15).to_dict())
print("\n불일치 열차 종착(statnTnm) 분포:", um["statnTnm"].value_counts().head(10).to_dict())
print("매칭 열차 종착(statnTnm) 분포:", p2[p2["match"]]["statnTnm"].value_counts().head(10).to_dict())
print("\n불일치 시각대 분포(collected hour):", um["_collected_at"].str[11:13].value_counts().sort_index().to_dict())
print("매칭  시각대 분포(collected hour):", p2[p2["match"]]["_collected_at"].str[11:13].value_counts().sort_index().to_dict())
sat2 = set(tt[(tt["호선"] == "2") & (tt["주중주말"] != "DAY")]["digits"])
other = set(tt[tt["호선"] != "2"]["digits"])
u = set(um["trainNo"]); us = {x.lstrip("0") for x in u}
print(f"\n불일치 번호 중 주말 2호선 시간표에 있음: {len((u|us) & sat2)}/{len(u)}  다른 노선 시간표에 있음: {len((u|us) & other)}/{len(u)}")
def near(x, codes, k):
    try: n = int(x)
    except ValueError: return False
    return any(str(n + d).zfill(4) in codes or str(n + d) in codes for d in range(-k, k + 1) if d)
print("불일치 번호 ±1~2 가 시간표에 있음:", sum(near(x, codes2, 2) for x in u), "/", len(u))

# 가설: 실시간 첫 자리는 다른 의미, 뒷 세 자리가 시간표 2xxx의 운행번호
main2 = day2[day2["열차코드"].str[0] == "2"]
suf_tt = set(main2["digits"].str[-3:])
um_suf = um["trainNo"].str[-3:]
print(f"\n[가설] 불일치 번호 뒷 3자리가 시간표 2xxx 뒷 3자리에 있음: {um_suf.isin(suf_tt).mean():.3f} (행 기준), 고유 {um_suf.drop_duplicates().isin(suf_tt).mean():.3f}")
late_suf = set(main2.loc[main2["late"], "digits"].str[-3:])
print(f"        21시 이후 시간표 2xxx 뒷 3자리에 있음: {um_suf.isin(late_suf).mean():.3f}")
# 뒷 3자리 매칭 시 방향(내선/외선)과 시간표 IN/OUT이 맞는지: 실시간 updnLine 0/1 vs 시간표 방향
um2 = um.assign(suf=um_suf).merge(main2[["digits", "방향"]].assign(suf=main2["digits"].str[-3:]).drop_duplicates("suf"), on="suf", how="left")
print("        뒷3자리 매칭 후 updnLine × 시간표 방향 교차표:"); print(pd.crosstab(um2["updnLine"], um2["방향"].fillna("없음")).to_string())
# 첫 자리와 종착/시각의 관계
print("        첫 자리별 종착 분포:", um.groupby(um["trainNo"].str[0])["statnTnm"].agg(lambda s: s.value_counts().head(3).to_dict()).to_dict())
print("        첫 자리별 관측 시각 범위:", um.groupby(um["trainNo"].str[0])["_collected_at"].agg(lambda s: f"{s.min()[11:16]}~{s.max()[11:16]}").to_dict())
# 같은 뒷3자리를 가진 실시간 번호가 첫자리만 바꿔 여러 번 나오나(재번호)
dup = um.groupby(um["trainNo"].str[-3:])["trainNo"].nunique()
print("        같은 뒷3자리에 첫자리가 다른 번호가 2개 이상:", (dup > 1).sum(), "/", len(dup))
a2 = arr[arr["line"] == "2"]
print("\n도착 API 2호선 번호 첫자리 분포:", a2["btrainNo"].str[0].value_counts().to_dict())
print("도착 API 2호선 불일치 번호 예시:", sorted(set(a2["btrainNo"]) - codes2 - {c.zfill(4) for c in codes2})[:30])
d2 = pd.to_numeric(day2["digits"]); print(f"\n시간표 2호선 코드 범위: {d2.min()}~{d2.max()},  실시간 범위: {pd.to_numeric(p2['trainNo']).min()}~{pd.to_numeric(p2['trainNo']).max()}")
print("시간표 21시 이후 2호선 코드 범위(첫자리별):", day2[day2["late"]].groupby(day2["열차코드"].str[0])["digits"].agg(lambda s: f"{pd.to_numeric(s).min()}~{pd.to_numeric(s).max()} ({s.nunique()}개)").to_dict())

# ── 3. recptnDt 정밀도 ──────────────────────────────────────
sep("3. recptnDt 가 초 단위 사건 시각인가 (위치 API)")
pos["rt"] = pd.to_datetime(pos["recptnDt"]); pos["ct"] = pd.to_datetime(pos["_collected_at"])
pos["lag"] = (pos["ct"] - pos["rt"]).dt.total_seconds()
print("collected_at - recptnDt (초) 분포:"); print(pos["lag"].describe().round(1).to_string())
print("틱당 고유 recptnDt 개수 (1이면 배치 타임스탬프, 많으면 행별 사건 시각):")
print(pos.groupby("_collected_at")["recptnDt"].nunique().describe().round(1).to_string())
print("\nlag 히스토그램(초 구간):", pd.cut(pos["lag"], [-1, 0, 30, 60, 120, 180, 300, 600, 1e9]).value_counts().sort_index().to_dict())
pos = pos.sort_values(["subwayId", "trainNo", "ct"])
g = pos.groupby(["subwayId", "trainNo"])
pos["state"] = pos["statnId"] + "|" + pos["trainSttus"]
pos["prev_state"] = g["state"].shift()
pos["prev_rt"] = g["rt"].shift()
pos["prev_ct"] = g["ct"].shift()
consec = pos[(pos["ct"] - pos["prev_ct"]).dt.total_seconds().between(170, 190)]
same = consec[consec["state"] == consec["prev_state"]]
chg = consec[consec["state"] != consec["prev_state"]]
print(f"\n연속 틱 쌍 {len(consec)}: 상태 불변 {len(same)}, 상태 변경 {len(chg)}")
print(f"  상태 불변인데 recptnDt 그대로: {(same['rt'] == same['prev_rt']).mean():.3f}  (1.0이면 recptnDt=마지막 상태변경 시각)")
print(f"  상태 변경 시 recptnDt 갱신됨:  {(chg['rt'] != chg['prev_rt']).mean():.3f}")
print("  상태 변경 행의 lag(초) 분포:", chg["lag"].describe()[["min", "25%", "50%", "75%", "max"]].round(0).to_dict())
print("  상태 변경 행 lag 초 구간:", pd.cut(chg["lag"], [-1, 0, 30, 60, 120, 180, 300, 1e9]).value_counts().sort_index().to_dict())
print("\ntrainSttus 분포:", pos["trainSttus"].value_counts().to_dict(), " (0진입 1도착 2출발 3전역출발)")
print("recptnDt 초(sec) 자릿수 분포 (0/30 편중이면 반올림):", pos["rt"].dt.second.value_counts().head(8).to_dict())

sep("3b. 도착 API recptnDt")
arr["rt"] = pd.to_datetime(arr["recptnDt"]); arr["ct"] = pd.to_datetime(arr["_collected_at"])
arr["lag"] = (arr["ct"] - arr["rt"]).dt.total_seconds()
print("lag 분포:", arr["lag"].describe()[["min", "25%", "50%", "75%", "max"]].round(0).to_dict())
print("틱당 고유 recptnDt:", arr.groupby("_collected_at")["recptnDt"].nunique().describe()[["min", "50%", "max"]].to_dict())
print("노선별 lag 중앙값(초):", arr.groupby("line")["lag"].median().round(0).to_dict())
print("arvlCd별 barvlDt==0 비율:", arr.assign(z=arr["barvlDt"] == "0").groupby("arvlCd")["z"].mean().round(2).to_dict())

# ── 4. 종합: 관측 도착시각 vs 시간표 → 지연 분포 sanity ─────
sep("4. 위치 API '도착(1)' 사건의 recptnDt vs 시간표 도착시각 (열차번호+역명 매칭)")
def to_min(s):
    h, m, sec = s.split(":"); return int(h) * 60 + int(m) + int(sec) / 60
day = tt[(tt["주중주말"] == "DAY") & tt["열차도착시간"].notna()].copy()
day["tt_min"] = day["열차도착시간"].map(to_min)
arrived = pos[pos["trainSttus"] == "1"].copy()
arrived["digits"] = arrived["trainNo"].str.lstrip("0")
arrived["obs_min"] = arrived["rt"].dt.hour * 60 + arrived["rt"].dt.minute + arrived["rt"].dt.second / 60
arrived.loc[arrived["rt"].dt.hour < 4, "obs_min"] += 24 * 60
day["nm"] = day["역사명"].str.replace("역$", "", regex=True)
arrived["nm"] = arrived["statnNm"].str.replace("역$", "", regex=True)
day["digits"] = day["digits"].str.lstrip("0")
m = arrived.merge(day[["호선", "digits", "nm", "tt_min", "열차코드"]], left_on=["line", "digits", "nm"], right_on=["호선", "digits", "nm"], how="left")
m = m.drop_duplicates(["subwayId", "trainNo", "statnId", "rt"])
m["delay"] = m["obs_min"] - m["tt_min"]
print("도착 사건 행수, 시간표 매칭 성공 행수:", len(m), m["tt_min"].notna().sum())
ok = m[m["tt_min"].notna()]
print("노선별 매칭 도착사건 수와 지연(분) 분위:")
print(ok.groupby("line")["delay"].describe(percentiles=[.1, .5, .9])[["count", "10%", "50%", "90%"]].round(1).to_string())
print("\n|지연|>30분 (번호 재사용/오매칭 의심) 비율:", (ok["delay"].abs() > 30).mean().round(3))
print("역명 불일치로 매칭 실패한 실시간 역명 예시:", sorted(set(m.loc[m["tt_min"].isna(), "statnNm"]) - set(tt["역사명"]))[:20])


# ════════════════════════════════════════════════════════════════
# 둘째 검증: 전처리 규칙 적용, 환승역 도착 시각 확보율, 오매칭, 3호선 도착 API
# ════════════════════════════════════════════════════════════════
tr = pd.read_csv(f"{BASE}/data/reference/transfer_time.csv", encoding="utf-8", dtype=str)
pd.set_option("display.max_rows", 200)

# ── 전처리 규칙 ─────────────────────────────────────────────
STATION_ALIAS = {
    # (노선, 실시간 표기) → 시간표 역사명. 괄호 제거만으로 안 되는 것들
    ("2", "성수종착"): "성수", ("2", "성수지선"): "성수", ("2", "신도림지선"): "신도림",
    ("4", "총신대입구(이수)"): "총신대입구", ("7", "총신대입구(이수)"): "이수",
    ("7", "뚝섬유원지"): "자양", ("7", "춘의역"): "춘의",
}

def norm_station(s: pd.Series, line: pd.Series | None = None) -> pd.Series:
    """역명 정규화: 노선별 별칭 → 괄호 이하 제거 → '서울'은 '서울역'.

    '성수종착'·'성수지선'·'신도림지선'은 종착 표시가 아니라 그 역에 있는 열차의 역명 자리에 찍히는 값이다.
    버리면 성수·신도림 확보율이 0이 된다(첫날 밤 검증).
    """
    out = s.copy()
    if line is not None:
        alias = pd.Series([STATION_ALIAS.get((l, n)) for l, n in zip(line, s)], index=s.index)
        out = alias.fillna(out)
    out = out.str.replace(r"\(.*\)$", "", regex=True).str.strip()
    return out.replace({"서울": "서울역"})

def match_key(line: pd.Series, trainno: pd.Series) -> pd.Series:
    """실시간 열차번호 → 시간표 열차코드 숫자부. 2호선 본선(첫자리 2 아님·지선 1/5 아님)은 '2'+뒷3자리."""
    digits = trainno.str.lstrip("0")
    is_main2 = (line == "2") & ~trainno.str[0].isin(["1", "2", "5"])
    return digits.where(~is_main2, "2" + trainno.str[-3:])

tt["digits"] = tt["열차코드"].str.extract(r"(\d+)")[0].str.lstrip("0")
tt["nm"] = norm_station(tt["역사명"])
def to_min(s):
    if pd.isna(s): return float("nan")
    h, m, sec = s.split(":"); return int(h) * 60 + int(m) + int(sec) / 60
day = tt[tt["주중주말"] == "DAY"].copy()
day["arr_min"] = day["열차도착시간"].map(to_min); day["dep_min"] = day["열차출발시간"].map(to_min)

pos["key"] = match_key(pos["line"], pos["trainNo"]); pos["nm"] = norm_station(pos["statnNm"], pos["line"])
pos["rt"] = pd.to_datetime(pos["recptnDt"])
pos["obs_min"] = pos["rt"].dt.hour * 60 + pos["rt"].dt.minute + pos["rt"].dt.second / 60
pos.loc[pos["rt"].dt.hour < 4, "obs_min"] += 1440

# ── 1. 규칙 적용 후 매칭률 ──────────────────────────────────
sep("5. 전처리 규칙 적용 후 노선별 매칭률 (위치 API, 고유 번호 기준)")
codes = day.groupby("호선")["digits"].apply(set).to_dict()
u = pos.drop_duplicates(["line", "trainNo"])
u = u.assign(ok=[k in codes[l] for l, k in zip(u["line"], u["key"])])
print(u.groupby("line")["ok"].agg(n="size", match="mean").round(3).T.to_string())
print("2호선 규칙 적용 전 57% → 후", round(u.loc[u["line"] == "2", "ok"].mean(), 3))

# ── 2. 도착 사건 ↔ 시간표 (열차+역, 시각 가장 가까운 행 선택) ──
sep("6. 도착(trainSttus=1) 사건의 지연 분포, 규칙 적용 후")
arrived = pos[(pos["trainSttus"] == "1") & pos["nm"].notna()].drop_duplicates(["line", "trainNo", "statnId", "recptnDt"])
m = arrived.merge(day[["호선", "digits", "nm", "arr_min", "dep_min", "방향", "급행여부"]],
                  left_on=["line", "key", "nm"], right_on=["호선", "digits", "nm"], how="left")
m["delay"] = m["obs_min"] - m["arr_min"]
# 같은 열차코드·역이 시간표에 여러 번(순환 등) 있으면 관측에 가장 가까운 행만
m["absd"] = m["delay"].abs()
m = m.sort_values("absd").drop_duplicates(["line", "trainNo", "statnId", "recptnDt"], keep="first")
ok = m[m["arr_min"].notna()]
print(f"도착 사건 {len(m)}행 중 시간표 매칭 {len(ok)}행 ({len(ok)/len(m):.1%}), 규칙 적용 전 6,208행")
print(ok.groupby("line")["delay"].describe(percentiles=[.1, .5, .9, .99])[["count", "10%", "50%", "90%", "99%"]].round(1).to_string())
print("\n매칭 실패 역명 (규칙 적용 후 남은 것):", m.loc[m["arr_min"].isna(), "statnNm"].value_counts().head(15).to_dict())

# ── 3. 오매칭 컷 ────────────────────────────────────────────
sep("7. 오매칭 컷 기준: |지연| 꼬리")
bins = [0, 5, 10, 15, 20, 30, 60, 120, 1e9]
print(pd.cut(ok["absd"], bins).value_counts().sort_index().to_string())
big = ok[ok["absd"] > 20]
print(f"\n|지연|>20분 {len(big)}행. 부호:", (big["delay"] > 0).value_counts().to_dict())
print("노선별:", big["line"].value_counts().to_dict())
print("같은 열차번호가 밤 동안 관측된 시간 폭(분) — 큰 값이면 번호 재사용:")
span = pos.groupby(["line", "trainNo"])["obs_min"].agg(lambda s: s.max() - s.min())
print("  전체 분포:", span.describe()[["50%", "75%", "max"]].round(0).to_dict())
print("  |지연|>20 열차의 시간 폭 중앙값:", round(span.reindex(list(zip(big["line"], big["trainNo"]))).median(), 0),
      " vs 정상 열차:", round(span.reindex(list(zip(ok[ok["absd"] <= 5]["line"], ok[ok["absd"] <= 5]["trainNo"]))).median(), 0))
print("  |지연|>20 예시:"); print(big[["line", "trainNo", "statnNm", "recptnDt", "arr_min", "delay"]].head(8).to_string(index=False))

# ── 4. 9호선 음수 ───────────────────────────────────────────
sep("8. 9호선 중앙값이 음수인 이유")
n9 = ok[ok["line"] == "9"]
print("급행(directAt)별 지연 중앙값:", n9.groupby("directAt")["delay"].agg(["size", "median"]).round(2).to_dict())
print("관측 - 시간표 '출발' 기준 중앙값:", round((n9["obs_min"] - n9["dep_min"]).median(), 2), " (도착 기준:", round(n9["delay"].median(), 2), ")")
print("시간표 9호선 도착→출발 정차시간 중앙값(초):", round(((day.loc[day['호선']=='9','dep_min'] - day.loc[day['호선']=='9','arr_min']) * 60).median(), 0),
      " 전체 노선:", round(((day['dep_min'] - day['arr_min']) * 60).median(), 0))
print("노선별 지연 중앙값 (도착 기준 / 출발 기준):")
print(ok.assign(d_dep=ok["obs_min"] - ok["dep_min"]).groupby("line")[["delay", "d_dep"]].median().round(2).T.to_string())

# ── 5. 환승역별 도착 스탬프 확보율 ──────────────────────────
sep("9. 환승역별 도착 스탬프 확보율 (1~9호선 간 환승, 22시 이후 시간표 열차 기준)")
tr["line"] = tr["호선"].str.strip(); tr["nm"] = norm_station(tr["환승역명"])
tr9 = tr[tr["line"].isin(list("123456789")) & tr["환승노선"].str.match(r"^[1-9]호선$")]
xfer = tr9[["line", "nm"]].drop_duplicates()
print(f"환승역×노선 조합 {len(xfer)}개")
# 분모: 그 역에 22시 이후 도착하는 평일 시간표 열차 중, 실시간에서 어디서든 관측된 열차
seen = set(zip(u.loc[u["ok"], "line"], u.loc[u["ok"], "key"]))
late = day[(day["arr_min"] >= 22 * 60) | (day["dep_min"] >= 22 * 60)].copy()
late["seen"] = [ (l, d) in seen for l, d in zip(late["호선"], late["digits"]) ]
expected = late[late["seen"]].merge(xfer, left_on=["호선", "nm"], right_on=["line", "nm"])[["line", "nm", "digits", "방향", "arr_min", "dep_min"]].drop_duplicates(["line", "nm", "digits", "방향"])
# 관측: 그 역에서 잡힌 스탬프 종류
st = pos[pos["nm"].notna()].groupby(["line", "key", "nm"])["trainSttus"].agg(set).rename("stamps").reset_index()
e = expected.merge(st, left_on=["line", "digits", "nm"], right_on=["line", "key", "nm"], how="left")
e["stamps"] = e["stamps"].apply(lambda s: s if isinstance(s, set) else set())
e["arr_stamp"] = e["stamps"].apply(lambda s: "1" in s)
e["any_stamp"] = e["stamps"].apply(bool)
e["dep_stamp"] = e["stamps"].apply(lambda s: "2" in s)
e["enter_stamp"] = e["stamps"].apply(lambda s: "0" in s)
print(f"기대 열차×환승역 {len(e)}건")
print(f"  도착(1) 스탬프 있음: {e['arr_stamp'].mean():.1%}")
print(f"  도착 없지만 그 역 진입(0) 또는 출발(2) 스탬프 있음: {(~e['arr_stamp'] & e['any_stamp']).mean():.1%}")
print(f"  그 역 스탬프 전무: {(~e['any_stamp']).mean():.1%}")
print("\n노선별 도착 스탬프 확보율:"); print(e.groupby("line")["arr_stamp"].agg(n="size", arr="mean").round(2).T.to_string())
print("\n확보율 낮은 환승역 (하위 12):")
low = e.groupby(["line", "nm"]).agg(n=("arr_stamp", "size"), arr=("arr_stamp", "mean"), any=("any_stamp", "mean")).round(2)
print(low.sort_values("arr").head(12).to_string())

# 막차만: 조합(역×노선×방향)별 시간표 마지막 열차
last = late.sort_values("arr_min").groupby(["호선", "nm", "방향"]).tail(1)
last = last.merge(xfer, left_on=["호선", "nm"], right_on=["line", "nm"])
last = last.merge(st, left_on=["line", "digits", "nm"], right_on=["line", "key", "nm"], how="left")
last["stamps"] = last["stamps"].apply(lambda s: s if isinstance(s, set) else set())
print(f"\n[막차] 환승역×노선×방향 조합 {len(last)}개")
print(f"  막차가 실시간에서 어디서든 관측됨: {last['seen'].mean():.1%}")
print(f"  막차의 그 역 도착(1) 스탬프: {last['stamps'].apply(lambda s: '1' in s).mean():.1%}")
print(f"  도착 없고 진입/출발만: {last['stamps'].apply(lambda s: bool(s) and '1' not in s).mean():.1%}")
print(f"  그 역 스탬프 전무: {last['stamps'].apply(lambda s: not s).mean():.1%}")
# 도착 없는 경우 인접 역 스탬프로 구간 좁힐 수 있나: 같은 열차의 다른 역 스탬프 중 시간상 가장 가까운 것과의 간격
no_arr = e[~e["arr_stamp"]]
trains_pos = pos[pos["nm"].notna()].groupby(["line", "key"])["obs_min"].agg(list)
gaps = []
for _, r in no_arr.iterrows():
    obs = trains_pos.get((r["line"], r["digits"]))
    if not obs: continue
    before = [o for o in obs if o <= r["arr_min"] + 2]; after = [o for o in obs if o >= r["arr_min"] - 2]
    if before and after: gaps.append(min(after) - max(before))
gaps = pd.Series(gaps)
print(f"\n도착 스탬프 없는 {len(no_arr)}건 중 앞뒤 스탬프로 감싼 {len(gaps)}건, 감싼 구간 길이(분) 분위:", gaps.describe()[["25%", "50%", "75%"]].round(1).to_dict())

# ── 6. 3호선 도착 API 79% ───────────────────────────────────
sep("10. 3호선 도착 API 열차번호 불일치 원인")
a3 = arr[arr["line"] == "3"].copy(); a3["key"] = a3["btrainNo"].str.lstrip("0")
a3["ok"] = a3["key"].isin(codes["3"])
bad = a3[~a3["ok"]]
print(f"3호선 도착 API 행 {len(a3)}, 불일치 {len(bad)}행, 고유 번호 {bad['btrainNo'].nunique()}개:", sorted(bad["btrainNo"].unique())[:20])
print("불일치 행의 역:", bad["statnNm"].value_counts().head(8).to_dict())
print("불일치 행의 종착(bstatnNm):", bad["bstatnNm"].value_counts().head(6).to_dict())
print("불일치 행의 열차 상태(btrainSttus):", bad["btrainSttus"].value_counts().to_dict())
print("불일치 행의 arvlCd:", bad["arvlCd"].value_counts().to_dict())
print("불일치 번호가 위치 API 3호선에 있나:", bad["btrainNo"].isin(set(pos.loc[pos["line"] == "3", "trainNo"])).mean().round(3))
print("불일치 번호가 다른 요일(SAT/END) 3호선 시간표에 있나:", bad["key"].isin(set(tt[(tt["호선"] == "3") & (tt["주중주말"] != "DAY")]["digits"])).mean().round(3))
print("불일치 시각대:", bad["_collected_at"].str[11:13].value_counts().sort_index().to_dict())

# ── 11. 추가 확인 ────────────────────────────────────────────
sep("11a. 오매칭 재점검: 열차×역당 첫 도착 스탬프만 남기면")
first = ok.sort_values("rt").drop_duplicates(["line", "trainNo", "statnId"], keep="first")
print("행수", len(ok), "→", len(first))
print(pd.cut(first["absd"], bins).value_counts().sort_index().to_dict())
big2 = first[first["absd"] > 20]
print("|지연|>20 남은", len(big2), "행. 역:", big2["statnNm"].value_counts().to_dict())
term = set(day["도착역"].unique())
print("  그중 종착역(시간표 도착역 집합)에서 관측:", big2["statnNm"].isin(term).mean().round(2) if len(big2) else "-")
print("첫 도착 기준 노선별 지연 분위:"); print(first.groupby("line")["delay"].describe(percentiles=[.5, .9, .99])[["count", "50%", "90%", "99%"]].round(1).T.to_string())

sep("11b. 9호선: 노선별 trainSttus 분포 (진입 0을 아예 안 주는 노선?)")
print(pd.crosstab(pos["line"], pos["trainSttus"], normalize="index").round(2).to_string())

sep("11c. 성수·이수 역명 문제")
print("2호선 위치 API에서 '성수' 포함 statnNm:", pos.loc[(pos["line"] == "2") & pos["statnNm"].str.contains("성수"), "statnNm"].value_counts().to_dict())
print("2호선 시간표 '성수' 포함 역사명:", day.loc[(day["호선"] == "2") & day["역사명"].str.contains("성수"), "역사명"].value_counts().to_dict())
print("7호선 위치 API '이수|총신대' statnNm:", pos.loc[(pos["line"] == "7") & pos["statnNm"].str.contains("이수|총신대"), "statnNm"].value_counts().to_dict(),
      " 시간표:", day.loc[(day["호선"] == "7") & day["역사명"].str.contains("이수|총신대"), "역사명"].unique().tolist())
print("4호선 위치 API:", pos.loc[(pos["line"] == "4") & pos["statnNm"].str.contains("이수|총신대"), "statnNm"].value_counts().to_dict(),
      " 시간표:", day.loc[(day["호선"] == "4") & day["역사명"].str.contains("이수|총신대"), "역사명"].unique().tolist())
# 실시간 역명 중 정규화 후에도 시간표에 없는 것 전체 (노선별)
allnm = set(day["nm"].dropna())
miss = pos[pos["nm"].notna() & ~pos["nm"].isin(allnm)].groupby("line")["statnNm"].apply(lambda s: sorted(s.unique())).to_dict()
print("정규화 후에도 시간표에 없는 실시간 역명(노선별):", miss)

sep("11d. 도착 스탬프 없는 환승역 통과를 앞뒤 역 스탬프로 감싸기 (수정)")
gaps = []
for _, r in no_arr.iterrows():
    obs = trains_pos.get((r["line"], r["digits"]))
    if not obs: continue
    before = [o for o in obs if o < r["arr_min"]]; after = [o for o in obs if o > r["arr_min"]]
    if before and after: gaps.append(min(after) - max(before))
gaps = pd.Series(gaps)
print(f"도착 스탬프 없는 {len(no_arr)}건 중 앞뒤로 감싼 {len(gaps)}건 ({len(gaps)/len(no_arr):.0%}). 구간 길이(분):", gaps.describe(percentiles=[.25, .5, .75, .9])[["25%", "50%", "75%", "90%"]].round(1).to_dict())
print("  구간 ≤3분:", (gaps <= 3).mean().round(2), " ≤6분:", (gaps <= 6).mean().round(2))

sep("11e. 도착 API로 빈칸 메우기: 위치 API에 그 역 도착 스탬프가 없는 열차가 도착 API에는 있나")
arr["key"] = match_key(arr["line"], arr["btrainNo"]); arr["nm"] = norm_station(arr["statnNm"], arr["line"])
arr["rt"] = pd.to_datetime(arr["recptnDt"])
arr["obs_min"] = arr["rt"].dt.hour * 60 + arr["rt"].dt.minute + arr["rt"].dt.second / 60
arr.loc[arr["rt"].dt.hour < 4, "obs_min"] += 1440
ast = arr[arr["nm"].notna()].groupby(["line", "key", "nm"])["arvlCd"].agg(set).rename("acodes").reset_index()
e2 = e.merge(ast, left_on=["line", "digits", "nm"], right_on=["line", "key", "nm"], how="left")
e2["acodes"] = e2["acodes"].apply(lambda s: s if isinstance(s, set) else set())
none = e2[~e2["any_stamp"]]
print(f"위치 API 스탬프 전무 {len(none)}건 중 도착 API에 같은 열차·역 행 있음: {none['acodes'].apply(bool).mean():.1%}")
print(f"  그중 arvlCd 1(도착) 있음: {none['acodes'].apply(lambda s: '1' in s).mean():.1%},  0/1/2(진입·도착·출발) 중 하나: {none['acodes'].apply(lambda s: bool(s & {'0','1','2'})).mean():.1%}")
print(f"  99(운행중)만: {none['acodes'].apply(lambda s: s == {'99'}).mean():.1%}")
# 도착 API arvlCd=1의 recptnDt 가 위치 API 도착 recptnDt와 얼마나 맞나 (둘 다 있는 경우)
a1 = arr[(arr["arvlCd"] == "1") & arr["nm"].notna()].groupby(["line", "key", "nm"])["obs_min"].min().rename("a_min")
p1 = pos[(pos["trainSttus"] == "1") & pos["nm"].notna()].groupby(["line", "key", "nm"])["obs_min"].min().rename("p_min")
both = pd.concat([a1, p1], axis=1).dropna(); d = (both["a_min"] - both["p_min"]) * 60
print(f"둘 다 있는 {len(both)}건: 도착API - 위치API 도착시각 차(초) 중앙값 {d.median():.0f}, IQR {d.quantile(.25):.0f}~{d.quantile(.75):.0f}, |차|≤60초 비율 {(d.abs() <= 60).mean():.2f}")
# 종합 확보율: 위치 도착 ∪ 도착API 도착
e2["arr_any_api"] = e2["arr_stamp"] | e2["acodes"].apply(lambda s: "1" in s)
print(f"\n환승역 도착 시각 확보율: 위치 API만 {e2['arr_stamp'].mean():.1%} → 도착 API 합치면 {e2['arr_any_api'].mean():.1%}")
last2 = last.merge(ast, left_on=["line", "digits", "nm"], right_on=["line", "key", "nm"], how="left")
last2["acodes"] = last2["acodes"].apply(lambda s: s if isinstance(s, set) else set())
print(f"[막차] 그 역 도착 시각 확보율: 위치 API만 {last2['stamps'].apply(lambda s: '1' in s).mean():.1%} → 합치면 {(last2['stamps'].apply(lambda s: '1' in s) | last2['acodes'].apply(lambda s: '1' in s)).mean():.1%}")
print("  도착 API 노선별 arvlCd=1 기여 (막차):", last2.assign(a=last2["acodes"].apply(lambda s: "1" in s)).groupby("line")["a"].mean().round(2).to_dict())

sep("11f. 3호선 도착 API 불일치 열차의 정체")
print("불일치 번호별 관측 역 순서(시각순) 예시 2개:")
for tn in sorted(bad["btrainNo"].unique())[:2] + ["3981"]:
    b = bad[bad["btrainNo"] == tn].sort_values("recptnDt")
    print(f"  {tn}: {b['recptnDt'].iloc[0][11:16]}~{b['recptnDt'].iloc[-1][11:16]}  역: {b['statnNm'].drop_duplicates().tolist()[:8]}  종착: {b['bstatnNm'].unique().tolist()}  trainLineNm: {b['trainLineNm'].unique().tolist()[:2]}")
