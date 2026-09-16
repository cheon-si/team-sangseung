# 막차 러시아룰렛 · 수집기

2026 통계최강자전 팀 상승. 서울 지하철 심야 실시간 데이터를 4주간 수집한다.

**실시간 데이터는 과거분을 다시 받을 수 없다.** 수집이 하루 끊기면 그날 밤은 영영 사라진다.

---

## 0. 지금 당장 필요한 것

**서울 열린데이터광장 인증키 두 개.** 하나가 아니다. 도메인이 다르면 키도 다르다.

| 키 | 도메인 | 쓰는 곳 | 환경변수 |
|---|---|---|---|
| 실시간 지하철 인증키 | `swopenapi.seoul.go.kr` | 야간 수집 (`collect.py`) | `SEOUL_SUBWAY_KEY` |
| 일반 인증키 | `openapi.seoul.go.kr:8088` | 참조 데이터 (`fetch_reference.py`) | `SEOUL_API_KEY` |

서로 바꿔 넣으면 인증 오류가 난다. 샘플키는 모든 API에서 5행까지만 주므로 실수집에 쓸 수 없다.

### 발급 절차

1. https://data.seoul.go.kr 회원가입
2. [Open API 소개](https://data.seoul.go.kr/together/guide/useGuide.do) 페이지에서 **'일반 인증키 신청'과 '실시간 지하철 인증키 신청'을 각각** 누른다. 둘 다 즉시 발급된다.
3. 프로젝트 폴더에서:

```bash
cp .env.example .env
```

`.env`를 열어 두 키를 채운다. PowerShell 세션 변수로도 된다.

```powershell
$env:SEOUL_SUBWAY_KEY = "실시간지하철키"
$env:SEOUL_API_KEY = "일반키"
```

4. **활용사례(갤러리) 등록**도 신청한다. 실시간 지하철 API의 일일 1,000건 제한이 심사 후 풀린다. 당장은 제한 안에서 돌아가지만, 풀리면 수집 간격을 촘촘하게 할 수 있다.

### 나중에 필요한 키

**공공데이터포털(data.go.kr) 키** — 열린데이터광장과 완전히 별개의 사이트다. 기상 데이터를 지연 설명 변수로 넣기로 하면 그때 발급받으면 된다. 노선별 지연시간 CSV는 로그인 후 브라우저로 직접 내려받으면 되므로 키가 필요 없다.

---

## 1. 설치

추가 라이브러리가 없다. 파이썬 표준 라이브러리만 쓴다.

```bash
C:\Users\ASUS\AppData\Local\Programs\Python\Python311\python.exe --version
```

---

## 2. 동작 확인

키 없이 파싱 로직만 검증한다. 파일에 아무것도 쓰지 않는다.

```bash
python collect.py --dry-run --no-bulk
```

9개 노선에서 각 5행씩 45행이 나오면 정상이다.

---

## 3. 참조 데이터 (키 발급 후 1회)

역 마스터를 먼저 받아야 나머지가 돌아간다.

```bash
python fetch_reference.py --step master
python fetch_reference.py --step lasttrain --limit 800
python fetch_reference.py --step timetable --limit 800
```

역 × 요일 × 방향 조합이 많아 한 번에 다 못 받는다. **이미 받은 조합은 건너뛰므로 며칠에 나눠 돌려도 된다.** 같은 명령을 다시 치면 이어서 진행한다.

| 단계 | 대상 | 대략 호출 수 |
|---|---|---:|
| master | 전체 역 799건 | 1 |
| lasttrain | 서울교통공사 운영 역 × 요일 3 × 방향 2 | 약 1,800 |
| timetable | 환승역만 × 요일 3 × 방향 2 | 대상 수에 따라 변동 |

막차 시간표가 분석의 기준선이므로 `lasttrain`을 먼저 끝낸다.

---

## 4. 야간 수집

```bash
python collect.py
```

22:00부터 다음 날 02:00까지 3분 간격으로 수집한다. 창 시작 전에 실행하면 시작까지 대기한다.

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--start-hour` | 22 | 수집 시작 시각 |
| `--end-hour` | 2 | 수집 종료 시각 |
| `--interval` | 180 | 수집 간격 (초) |
| `--budget` | 950 | 일일 호출 상한 |
| `--once` | | 1회만 수집하고 종료 |
| `--no-bulk` | | 도착정보 일괄 조회 건너뛰기 |

### 호출 예산

일일 한도가 1,000건이고 기본 설정은 950에서 멈춘다.

- 노선별 열차 위치 9콜 + 도착정보 일괄 1콜 = 틱당 10콜
- 3분 간격 × 240분 = 80틱 → 800콜

창을 02:00까지 잡은 이유: 운행시각표 기준 평일 최종 도착이 25:14다. 01:00에 끊으면 2·4·7·9호선 막차의 종착 도착을 놓친다.

일괄 조회가 400이나 500을 돌려주면 `--no-bulk`로 끄고 위치정보만 모은다. 로그에 기록되므로 첫날 밤 확인할 것.

### 인증 오류가 날 때

키를 서로 바꿔 넣었을 가능성을 먼저 본다. `collect.py`는 실시간 지하철 키, `fetch_reference.py`는 일반 키다. 로그에 `INFO-100`(인증키 오류)이 찍히면 이 경우다.

---

## 5. 결과물

```
data/raw/position_20260915.jsonl    노선별 열차 위치 원본
data/raw/arrival_20260915.jsonl     전체 역 도착정보 원본
data/reference/station_master.json  역 마스터
data/reference/last_train.jsonl     막차 시간표
data/reference/timetable.jsonl      역별 시간표
data/call_budget.json               운영일별 누적 호출 수
logs/collect.log                    수집 로그 (실패 포함)
```

응답 원본을 그대로 남기고 각 행에 세 개 필드를 덧붙인다.

- `_collected_at` 수집 시각
- `_service_date` 운영일 (새벽 4시 기준. 22시~익일 1시가 한 파일로 묶인다)
- `_line_query` 요청한 노선명

전처리에서 뭘 잘못해도 원본에서 다시 시작할 수 있게 한 구조다.

---

## 6. 팀 합의 사항

**자정 넘김 시각은 `utils.parse_service_time`만 쓴다.** 막차 시각이 `24:48:00`으로 온다. 각자 따로 처리하면 지연 계산이 하루씩 어긋난다.

**운영일은 `utils.service_date`로 구한다.** 새벽 4시 이전은 전날로 친다.

**분석 대상은 서울교통공사 운영 1~9호선으로 한정한다.** 시간표와 막차, 환승소요시간 API가 이 범위만 제공한다. 코레일 연장 구간, 신분당선, 경의중앙선, 공항철도는 빠진다. **보고서 앞부분에 먼저 밝힐 것.** 나중에 지적당하는 것보다 스스로 밝히는 쪽이 유리하다.

**역코드 매핑을 아직 검증하지 않았다.** 실시간은 `1001000133`, 시간표는 `0150`과 `133`을 쓴다. 끝 세 자리가 일치하는 패턴이 보이지만 `P148`처럼 문자가 섞인 코드가 있다. 799건 전수 대조가 수집 첫 주 최우선 작업이다.

---

## 7. 수집이 끊기지 않게

노트북이 꺼지면 그날 밤 데이터가 사라진다. 둘 중 하나를 첫날에 정한다.

**A. 상시 켜두는 PC** 절전 모드를 끄고 스크립트를 띄워둔다. 가장 단순하지만 사람이 매일 확인해야 한다.

**B. 작업 스케줄러** 매일 21:55에 자동 실행하도록 걸어둔다.

```powershell
schtasks /create /tn "lastcall" /tr "C:\Users\ASUS\AppData\Local\Programs\Python\Python311\python.exe C:\Users\ASUS\Desktop\tong\lastcall-collector\collect.py" /sc daily /st 21:55
```

어느 쪽이든 **매일 아침 `logs/collect.log`와 `data/raw/` 파일 크기를 확인한다.** 조용히 실패하는 게 가장 위험하다.
