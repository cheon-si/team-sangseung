"""첫날 밤(9/16) 실시간 데이터 검증.

1. 노선별 열차번호 매칭률 (실시간 ↔ 시간표 열차코드 숫자부)
2. 2호선 불일치 원인 (본선 번호 체계 차이 → 뒷 세 자리 규칙)
3. recptnDt가 초 단위 사건 시각인지
4. 관측 도착 시각 - 시간표 도착 시각의 첫 분포

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
