"""보조 데이터 일괄 수집 + 사용 가능 여부 판정.

프로젝트에 쓸 만한 공공데이터를 한 번에 받아보고, 각각이 실제로 쓸 수 있는지
판정해 결과를 표로 남긴다. 받은 데이터는 data/aux/ 에, 판정 결과는
data/aux/_판정.csv 에 떨어진다.

페이지가 여러 장인 데이터는 1,000행씩 끊어 전부 받는다.
"""

import json
import sys
from pathlib import Path

from utils import fetch_json, log_line

BASE_DIR = Path(__file__).resolve().parent
AUX_DIR = BASE_DIR / "data" / "aux"
LOG_PATH = BASE_DIR / "logs" / "aux.log"

API_HOST = "http://openapi.seoul.go.kr:8088"
PAGE = 1000

# (서비스명, 응답 최상위 키, 추가 인자, 설명, 전부 받을지)
# 응답 최상위 키가 서비스명과 다른 경우가 있어 따로 적는다.
TARGETS = [
    ("CardSubwayTime", "CardSubwayTime", "202607/",
     "지하철 시간대별 승하차", True),
    ("CardSubwayStatsNew", "CardSubwayStatsNew", "20260701/",
     "지하철 일별 승하차", True),
    ("busStopLocationXyInfo", "busStopLocationXyInfo", "",
     "버스정류장 좌표", True),
    ("tbCycleStationInfo", "stationInfo", "",
     "따릉이 대여소 마스터", True),
    ("bikeList", "rentBikeStatus", "",
     "따릉이 실시간 잔여", True),
    ("CardBusTimeNew", "CardBusTimeNew", "202607/",
     "버스 시간대별 승하차", False),  # 4만행이라 1페이지만 표본으로
    ("SearchSTNBySubwayLineInfo", "SearchSTNBySubwayLineInfo", "",
     "역 마스터 (재확인)", True),
]


def api_key() -> str:
    import os
    key = os.environ.get("SEOUL_API_KEY", "").strip()
    if not key:
        raise SystemExit("SEOUL_API_KEY가 없습니다.")
    return key


def fetch_all(key: str, service: str, root: str, extra: str,
              take_all: bool) -> tuple[list, str, int]:
    """한 서비스를 끝까지 받는다. 반환: (행, 결과코드, 전체건수)."""
    rows, start, total = [], 1, None
    while True:
        url = f"{API_HOST}/{key}/json/{service}/{start}/{start + PAGE - 1}/{extra}"
        payload = fetch_json(url, timeout=60)
        if root not in payload:
            # 오류 응답은 {"RESULT": {...}} 형태로 서비스 키가 없다
            result = payload.get("RESULT", {})
            return rows, result.get("CODE", "UNKNOWN"), total or 0
        body = payload[root]
        code = (body.get("RESULT") or {}).get("CODE", "UNKNOWN")
        if code != "INFO-000":
            return rows, code, total or 0
        total = int(body.get("list_total_count") or 0)
        page_rows = body.get("row") or []
        rows.extend(page_rows)
        if not take_all or not page_rows or len(rows) >= total:
            return rows, code, total
        start += PAGE


def judge(name: str, rows: list, code: str, total: int) -> dict:
    """받은 결과로 사용 가능 여부를 판정한다."""
    if code != "INFO-000":
        return {"상태": "불가", "사유": f"응답 코드 {code}"}
    if not rows:
        return {"상태": "불가", "사유": "행이 비어있음"}
    complete = total and len(rows) >= total
    return {
        "상태": "사용 가능",
        "사유": "전량 수신" if complete else f"부분 수신 {len(rows)}/{total}",
    }


def main() -> None:
    AUX_DIR.mkdir(parents=True, exist_ok=True)
    key = api_key()
    report = []

    for service, root, extra, desc, take_all in TARGETS:
        try:
            rows, code, total = fetch_all(key, service, root, extra, take_all)
            verdict = judge(service, rows, code, total)
            if rows:
                path = AUX_DIR / f"{service}.jsonl"
                with path.open("w", encoding="utf-8") as f:
                    for r in rows:
                        f.write(json.dumps(r, ensure_ascii=False) + "\n")
                size_mb = path.stat().st_size / 1e6
            else:
                size_mb = 0
            report.append({
                "서비스명": service, "설명": desc, "코드": code,
                "전체건수": total, "수신행": len(rows),
                "용량MB": round(size_mb, 2),
                "필드수": len(rows[0]) if rows else 0,
                **verdict,
            })
            log_line(LOG_PATH, f"{desc:<22} {verdict['상태']:<7} "
                               f"{len(rows):>6}/{total:<6} {verdict['사유']}")
        except Exception as error:
            report.append({
                "서비스명": service, "설명": desc, "코드": "EXC",
                "전체건수": 0, "수신행": 0, "용량MB": 0, "필드수": 0,
                "상태": "불가", "사유": f"{type(error).__name__}: {error}",
            })
            log_line(LOG_PATH, f"{desc:<22} 불가    {type(error).__name__} {error}")

    import pandas as pd
    df = pd.DataFrame(report)
    df.to_csv(AUX_DIR / "_판정.csv", index=False, encoding="utf-8-sig")
    print(df.to_string(index=False))
    print(f"\n저장: {AUX_DIR}")


if __name__ == "__main__":
    main()
