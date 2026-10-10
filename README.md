# 막차타KU · 서울 지하철 막차 환승 성공 확률

2026 통계최강자전 팀 상승.

서울 지하철 1~9호선의 심야 실시간 열차 위치·도착 정보를 직접 수집했다. 이 자료로 **막차로 갈아탈 때 실제로 탈 수 있을 확률**을 추정했고, 그 결과를 귀가 경로 웹앱으로 만들었다.

- **웹앱**: https://makchataku.vercel.app
- 출발역(현위치)과 집 역을 넣으면 경로, 귀가 확률, 출발 마감이 나온다. 걸음 속도와 여유 선호를 바꿀 수 있다.

---

## 결과 요약

| 항목 | 내용 |
|---|---|
| 수집 | 2026-09-16 ~ 10-09 매일 22:00~02:00, 3분 간격. 21밤(9/17, 9/26, 10/7 없음) |
| 주 모형 (팀 B 모형) | 지연 차이 Δ(막차 출발 지연 − 내 열차 도착 지연)를 다중회귀(도착·환승 노선, 요일, 경과 운행시간)로 예측하고, 잔차의 경험분포로 성공 확률 P(시간표 여유 + Δ ≥ 0)를 계산 |
| 학습 | 9/16~10/1 13밤, 1~9호선 환승 111개 조합의 막차 연결 4,160행. R² 0.096: 지연 차이 대부분이 그날 밤의 우연이라 "탈 수 있다/없다" 대신 확률로 안내한다 |
| 검증 (13밤, 밤 단위 교차검증) | Brier: 시간표만 보는 판단 0.0913 → B 모형 0.0544 (40% 감소), 13밤 모두 개선 |
| 외부 검증 (학습에 안 쓴 10/2 이후 7밤) | Brier: 0.0608 → 0.0492 (19.0% 감소, 밤 단위 붓스트랩 95% 구간 3.3~26.2%), 7밤 중 4밤 개선. 평가 행 범위가 달라 위 40%와 직접 비교하지 않는다. [holdout_7nights.md](holdout_7nights.md) |
| 핵심 발견 | 8·9호선 막차는 시간표에 가깝게 떠난다(1호선 막차 대비 여유 −112초·−88초). 90% 확률로 타려면 시간표 여유가 8호선 2분 10초, 9호선 2분 5초 이상 필요하다(평일 중앙값). 평일 마지막 연결 1,299개 중 166개(12.8%)는 성공 확률이 90% 미만이다 |

한계: 평범한 밤 기준이라 사고나 대형 지연은 예측하지 못한다. 환승이 여럿이면 환승끼리 서로 독립이라고 가정한다. 분석 대상은 서울교통공사 운영 1~9호선이다(코레일 연장 구간의 환승역 포함, 신분당선·경의중앙선·공항철도 제외).

---

## 구성

```
수집 (GitHub Actions, collect.py)
  → collected/YYYYMMDD/*.jsonl.gz
분석 파이프라인 (run_pipeline.py)
  → 전처리 · 막차 쌍 · 밤별 점검 · 실측 Y · 지연 분포 · 검증
웹앱 데이터 (export_for_app.py)
  → B 모형 · 경로망 · 시간표 · 막차 조합표 (web/public/data/*.json)
웹앱 (web/, Vite + React, 카카오맵)
  → 브라우저 안에서 경로 탐색 + 귀가 확률 계산 → Vercel 배포
```

| 파일 | 역할 |
|---|---|
| `collect.py`, `.github/workflows/collect.yml` | 심야 실시간 수집 (아래 "수집기 운영") |
| `fetch_reference.py`, `fetch_aux.py`, `fetch_notice.py` | 역 마스터·막차 시간표·보조 자료·운행 공지 |
| `preprocess.py`, `common.py`, `utils.py` | 전처리(원 스탬프 → 열차·역별 도착/출발 사건, 시간표 매칭) |
| `lasttrain.py` | 환승역별 막차 연결(조합) 목록 |
| `night_qa.py` | 밤별 수집 품질 점검 |
| `label_y.py` | 막차 환승 실측 성공 여부(Y) |
| `fit_delay.py`, `validate.py` | 지연 분포 적합과 B 채택 전 모형(2차 합성곱) 검증 |
| `export_model_b.py` | 팀 B 공통테이블로 B 모형 적합 → `model_b.json` |
| `export_route.py`, `export_for_app.py`, `build_station_alt.py` | 웹앱 JSON(경로망, 시간표, 막차 조합표, 역 대안) |
| `check_route.py` | 웹앱 경로 엔진의 Python 기준 구현(결과 대조) |
| `holdout_b.py` | 새 7밤 외부 검증 |
| `web/src/route/` | 브라우저 경로 엔진(라운드 방식 CSA, 놓친 뒤 재탐색까지 포함한 귀가 확률), `node --test` 테스트 |
| `plan.md`, `웹앱_설계.md`, `프로젝트_방향_결정.md` 등 | 작업 계획·설계·결정 기록 |

## 재현

```bash
# 분석 (Python 3.11)
python -m pip install -r requirements-analysis.txt
python run_pipeline.py          # collected/ 전체 → data/processed/, output/, web/public/data/
python holdout_b.py             # 외부 검증

# 웹앱
cd web
npm install
cp .env.example .env.local      # VITE_KAKAO_JS_KEY 에 카카오맵 JavaScript 키
npm run dev                     # http://localhost:3000
node --test "src/route/*.test.js"
```

- B 모형 적합(`export_model_b.py`)은 팀 B 공통테이블(`../B/공통테이블_v3.1.csv`, 저장소 밖)을 읽는다.
- Windows에서 출력을 파일로 보낼 때는 `PYTHONUTF8=1`을 켠다(cp949 콘솔 인코딩 오류 방지).

---

## 수집기 운영 (기록)

**실시간 데이터는 과거분을 다시 받을 수 없다.** 수집이 하루 끊기면 그날 밤은 영영 사라진다. 수집은 10/9 밤으로 끝났고, 예약 워크플로(`collect-night`)는 10/10에 비활성화했다.

### 인증키

서울 열린데이터광장 인증키가 두 개 필요하다. 도메인이 다르면 키도 다르다.

| 키 | 도메인 | 쓰는 곳 | 환경변수 |
|---|---|---|---|
| 실시간 지하철 인증키 | `swopenapi.seoul.go.kr` | 야간 수집 (`collect.py`) | `SEOUL_SUBWAY_KEY` |
| 일반 인증키 | `openapi.seoul.go.kr:8088` | 참조 데이터 (`fetch_reference.py`) | `SEOUL_API_KEY` |

- 서로 바꿔 넣으면 인증 오류(`INFO-100`)가 난다. 샘플키는 모든 API에서 5행까지만 준다.
- 발급: https://data.seoul.go.kr 회원가입 → [Open API 소개](https://data.seoul.go.kr/together/guide/useGuide.do)에서 '일반 인증키 신청'과 '실시간 지하철 인증키 신청'을 각각 누른다.
- `cp .env.example .env` 후 값을 채운다. `.env`는 git에 올라가지 않는다.

**웹앱 지도 키(카카오맵 JavaScript 키)**
- `web/.env.example`을 `web/.env.local`로 복사해 채운다.
- Kakao Developers > 앱 > 플랫폼 > Web 사이트 도메인에 `http://localhost:3000`과 배포 도메인을 등록한다.
- Vercel에는 Settings > Environment Variables에 `VITE_KAKAO_JS_KEY`를 넣는다. 빠지면 지도 자리에 "지도를 불러오지 못했어요"가 뜬다(경로·확률은 그대로 동작).
- JavaScript 키는 브라우저 번들에 들어가는 공개 전제 키다. 사용처 제한은 도메인 등록으로 한다.

### 수집기 실행

수집기(`collect.py`, `fetch_reference.py`)는 파이썬 표준 라이브러리만 쓴다. 분석 파이프라인은 위 `requirements-analysis.txt`가 필요하다.

```bash
python collect.py --dry-run --no-bulk   # 키 없이 파싱만 확인(9개 노선 × 5행 = 45행이면 정상)
python fetch_reference.py --step master
python fetch_reference.py --step lasttrain --limit 800
python fetch_reference.py --step timetable --limit 800   # 이미 받은 조합은 건너뛴다
python collect.py                        # 22:00~02:00, 3분 간격
```

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--start-hour` | 22 | 수집 시작 시각 |
| `--end-hour` | 2 | 수집 종료 시각 |
| `--interval` | 180 | 수집 간격 (초) |
| `--budget` | 950 | 일일 호출 상한 |
| `--once` | | 1회만 수집하고 종료 |
| `--no-bulk` | | 도착정보 일괄 조회 건너뛰기 |

**호출 예산**: 틱당 10콜(노선별 위치 9 + 도착 일괄 1) × 80틱(3분 간격 × 240분) = 800콜. 일일 한도는 1,000건이다. 창을 02:00까지 잡은 이유는 평일 최종 도착이 25:14라서다. 01:00에 끊으면 2·4·7·9호선 막차의 종착 도착을 놓친다.

### 결과물

```
collected/YYYYMMDD/{position,arrival}_YYYYMMDD.jsonl.gz   GitHub Actions가 커밋한 하룻밤 수집분 (gzip, 약 8~10MB)
collected/YYYYMMDD/collect.log                            그 밤의 수집 로그
data/reference/   역 마스터, 막차 시간표, 역별 시간표 (로컬 전용)
data/raw/, logs/  로컬 수집 원본과 로그 (로컬 전용)
```

- 응답 원본을 그대로 남기고 각 행에 `_collected_at`(수집 시각), `_service_date`(운영일, 새벽 4시 기준), `_line_query`(요청 노선)를 덧붙인다.
- 전처리에서 뭘 잘못해도 원본에서 다시 시작할 수 있게 한 구조다.

### 팀 합의 사항

- **자정 넘김 시각은 `utils.parse_service_time`만 쓴다.** 막차 시각이 `24:48:00`으로 온다.
- **운영일은 `utils.service_date`로 구한다.** 새벽 4시 이전은 전날로 친다.
- 실시간과 시간표의 역 코드 체계가 달라(`1001000133` 대 `0150`·`133`) 전처리(`preprocess.py`)에서 역 이름·노선 기준으로 맞춘다.

### GitHub Actions 수집

| 항목 | 값 |
|---|---|
| 워크플로 | `.github/workflows/collect.yml` (10/10부터 비활성) |
| 예약 | 매일 14:00~21:00 KST 매시 정각, 8개. GitHub 예약이 4시간 15분~6시간 39분 늦게 뜨고(9/17~9/24 실측) 폭이 매일 달라 여러 개를 걸었다. 창 시작 1.5시간 전보다 일찍 뜬 실행은 21:00까지 기다렸다가 새 실행을 요청하고 끝난다(릴레이). 02:00~12:00에 뜬 실행은 어젯밤 수집분이 없을 때만 실패로 표시한다 |
| 시간대 | `TZ: Asia/Seoul`. 빼면 러너가 UTC로 돌아 22:00 대기가 다음 날 아침 7시를 겨냥한다 |
| 키 | 저장소 Secrets `SEOUL_SUBWAY_KEY`, `SEOUL_API_KEY` |
| 결과 | 수집분을 gzip해 `collected/YYYYMMDD/`에 커밋한다 |
| 실패 대비 | 수집이 중간에 죽어도 그때까지 받은 것은 압축·커밋한다(`if: always()`). 10/7 밤에 push가 GitHub 500 에러로 거부돼 하룻밤을 잃은 뒤로는 그 밤 폴더를 아티팩트(7일 보존)로도 올리고, push를 30초 간격으로 3번까지 다시 시도한다 |

수동 실행은 Actions 탭 → `collect-night` → Run workflow. `once`를 켜면 1틱만 받고 끝난다. 다시 켜려면 `gh workflow enable collect-night`.
