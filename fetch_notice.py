"""작업 5-6. 지하철 이상상황 공지(getNtceList) 재수집과 밤 단위 플래그.

기존 data/aux/getNtceList.jsonl 은 2021-10-20 ~ 2026-09-15 범위라 수집 기간 공지가 없다.
fetch_aux.py 에는 이 서비스가 없고, 돌리면 CardBusTimeNew 를 1페이지로 덮어쓰므로 별도 스크립트로 받는다.
응답 형식이 다른 일반 API와 달리 {"response": {"header", "body": {"items": {"item": [...]}}}} 이다.

출력:
    data/aux/getNtceList_YYYYMMDD.jsonl     받은 날짜를 붙여 저장(기존 파일은 그대로)
    output/qa/notice_flags.csv              (밤, 노선)별 22:00~02:00과 겹친 공지 수와 제목
사용: python fetch_notice.py            # 받고 플래그 계산
      python fetch_notice.py --no-fetch # 가장 최근 받은 파일로 플래그만
"""

import argparse
import json
import os
from datetime import date, datetime, timedelta

import pandas as pd

import common as c
from utils import fetch_json, load_env

AUX = c.BASE_DIR / "data" / "aux"
PAGE = 1000


def fetch() -> pd.DataFrame:
    load_env()
    key = os.environ.get("SEOUL_API_KEY", "").strip()
    if not key:
        raise SystemExit("SEOUL_API_KEY가 없습니다. (일반 인증키)")
    rows, start, total = [], 1, None
    while total is None or start <= total:
        d = fetch_json(f"http://openapi.seoul.go.kr:8088/{key}/json/getNtceList/{start}/{start + PAGE - 1}/",
                       timeout=60)["response"]
        if d["header"].get("resultCode") != "00":
            raise SystemExit(f"공지 API 오류: {d['header']}")
        total = int(d["body"]["totalCount"])
        items = d["body"]["items"]
        it = items.get("item", []) if isinstance(items, dict) else items
        rows += it if isinstance(it, list) else [it]
        start += PAGE
    path = AUX / f"getNtceList_{date.today():%Y%m%d}.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"공지 {len(rows)}건 저장: {path.relative_to(c.BASE_DIR)}")
    return pd.DataFrame(rows)


def flags(df: pd.DataFrame) -> pd.DataFrame:
    """수집한 밤마다 22:00~익일 02:00 사이에 발생했거나 그 시간대에 걸친 공지를 노선별로 센다."""
    df = df.copy()
    df["t0"] = pd.to_datetime(df["noftOcrnDt"], errors="coerce")
    meta = pd.read_csv(c.PROCESSED_DIR / "night_meta.csv", dtype={"night": str})
    out = []
    for n in meta["night"]:
        start = datetime.strptime(n, "%Y%m%d") + timedelta(hours=22)
        end = start + timedelta(hours=4)
        hit = df[(df["t0"] >= start - timedelta(hours=2)) & (df["t0"] < end)]
        for _, r in hit.iterrows():
            for line in str(r.get("lineNmLst") or "").split(","):
                line = line.strip().replace("호선", "")
                if line in [str(i) for i in range(1, 10)]:
                    out.append({"night": n, "line": line, "time": r["t0"].strftime("%m-%d %H:%M"),
                                "title": r.get("noftTtl"), "nonstop": r.get("nonstopYn")})
    return pd.DataFrame(out, columns=["night", "line", "time", "title", "nonstop"])


def main() -> None:
    parser = argparse.ArgumentParser(description="이상상황 공지 재수집 (plan.md 5-6)")
    parser.add_argument("--no-fetch", action="store_true")
    args = parser.parse_args()
    if args.no_fetch:
        path = sorted(AUX.glob("getNtceList_*.jsonl"))[-1]
        df = pd.read_json(path, lines=True, dtype=False)
    else:
        df = fetch()
    t0 = pd.to_datetime(df["noftOcrnDt"], errors="coerce")
    print(f"공지 기간 {t0.min():%Y-%m-%d} ~ {t0.max():%Y-%m-%d}, 수집 기간(9/16~) 공지 {int((t0 >= '2026-09-16').sum())}건")
    f = flags(df)
    (c.OUTPUT_DIR / "qa").mkdir(parents=True, exist_ok=True)
    f.to_csv(c.OUTPUT_DIR / "qa" / "notice_flags.csv", index=False, encoding="utf-8-sig")
    if f.empty:
        print("수집 밤과 겹친 공지 없음")
    else:
        g = f.drop_duplicates(["night", "line", "title"]).groupby(["night", "line"])["title"].apply(lambda x: " / ".join(x)[:80])
        print(g.to_string())


if __name__ == "__main__":
    main()
