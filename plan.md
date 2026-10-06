# 수집 완료 전 작업 계획

2026 통계최강자전 · 팀 상승 · 2026-09-26 작성 (외부 모델 리뷰 반영 2판)

이 계획은 9/25~9/26에 저장소를 직접 점검한 결과로 짰습니다. 점검 범위는 코드, `collected/` 8밤, `data/reference/`, `data/aux/`입니다. 초안을 쓴 뒤 세 방향에서 검토했습니다. 근거·실현성, 통계 설계, 그리고 다른 계열 모델(gpt-6-astra)의 구현 계약 검토입니다. 확인하지 않은 내용은 "추정"으로 표시했습니다. 소요 시간은 모두 추정입니다.

## 진행 현황 (10/5)

| 작업 | 상태 | 산출물 |
|---|---|---|
| 0 준비 | 완료 | `.gitignore`, `requirements-analysis.txt`, `run_pipeline.py` |
| 1 전처리 | 완료 | `common.py`, `preprocess.py` |
| 2 밤별 점검 | 완료 | `night_qa.py` (TRUNC_W 690, EARLY_E 70 확정) |
| 3a 막차 쌍 | 완료 | `lasttrain.py` |
| 3b 실측 Y | 완료 | `label_y.py` |
| 4 지연 분포 | 완료 | `fit_delay.py` |
| 5 미해결 | 완료 | `issues.py`, `fetch_notice.py`, `프로젝트_방향_결정.md` 9장 |
| 6 검증 | 드라이런 완료, 확증·최종은 10/10 낮 | `validate.py --mode dry/confirm/final` |
| 7 역 대안 | 완료 | `build_station_alt.py` |
| 8 웹 | 귀가 경로 앱("막차될까") 로컬 완료, Vercel 연결 대기(시원) | `export_for_app.py`, `export_route.py`, `check_route.py`, `web/` |
| 9 보고서 | 초안(저장소 밖 `../report/draft.md`) | `fill_report.py` |

**일정 변경 (10/5).** 제출일이 10/11로 확정됐다. 마지막 수집 밤은 10/9(10/10 02:00 종료)이고, 10/10 낮에 수집 예약을 해제하고 최종 실행을 돌린다. 10/11 오전에는 결과 점검과 해석 문장만 확정한다. 이에 따라 평일 확증 밤이 6밤에서 4밤(10/2, 10/6, 10/7, 10/8)으로, 전체 밤이 22밤에서 22밤(평일 13, 주말·공휴일 9)으로 줄었다. 확증 4밤으로는 2차 모형과 logistic(B)의 차이를 가려내기 더 어렵다(검출 가능 최소 차이는 6밤 기준 0.016보다 커짐, 재계산 필요). 아래 표와 절의 날짜는 이 기준으로 고쳤다.

계획 대비 바뀐 결정은 `프로젝트_방향_결정.md` 9장에 모았다. 주요 변경: 2차 모형을 주 모형으로, 2·4·5호선 타고 온 열차 분포를 마지막 3편으로, 셀 병합은 표본 수로만, 시간표 적합 기준 0.6, 위치 API 새벽 공백은 밤 상태에서 제외, 8호선 도착 API 도착 제외. 10/2 체크포인트는 일정이 밀려 "확증 전 밤으로만 판단"하는 방식으로 대신했다.

## 목적

1. 10/9까지 파이프라인 전체를 `run_pipeline.py` 한 번으로 돌게 만듭니다. 순서는 전처리 → 실측 Y → 지연 분포 → 검증 → 앱 JSON입니다. 10/10 최종 실행에는 코드를 고치지 않고 데이터만 바꿔 다시 돌립니다.
2. 9/30까지 막차 환승 실측 Y가 한 밤에 몇 건 나오는지 확정합니다. 그 숫자로 검증 설계를 정합니다.
3. 9/28 Vercel URL 확보, 10/2 중간 점검, 10/11 제출 일정을 지킵니다. 결론은 평일 데이터로 내고, 주말 결과는 끝까지 "잠정"으로 표기합니다.

원칙은 네 가지입니다.
- 작업 1을 건너뛰고 작업 4부터 하지 않습니다(재현성).
- 강수 공변량은 넣지 않습니다.
- 모든 판단 규칙은 코드에 넣습니다. 그래야 최종 데이터로 자동 재판정할 수 있습니다.
- **10/2 이후 수집분은 확증 세트입니다.** 10/2에 규칙과 파라미터를 고른 밤으로 최종 성능을 평가하면 결과가 낙관적으로 나오기 때문입니다.

## 계획을 바꾼 점검 결과

초안 단계에서 드러나 계획 전체에 영향을 준 사실입니다.

- **9/24 추석 밤은 2·5·6·7·8호선이 공식 시간표와 맞지 않습니다.** 23시 이후 휴일(END) 시간표 열차의 관측률이 0~39%였습니다. 일반 일요일인 9/20은 100%였습니다. 가장 가까운 시간표 행에 붙이면 지연 중앙값이 115~316분으로 나옵니다. 1·3·4·9호선은 정상입니다. 명절 특별 시간표로 추정하며, 확인하지 않았습니다. 9/25·9/26 밤도 같을 수 있습니다. 그래서 (밤, 노선) 단위로 시간표 적합을 판정하는 단계를 작업 1에 넣었습니다.
- **큰 지연일수록 라벨에서 빠집니다.** 매칭 창 상한(+30분)을 넘는 막차는 결측이 되는데, 이것이 가장 확실한 실패 사례입니다. 그대로 두면 검증이 성공률을 과대평가합니다. 그래서 실측 Y는 시간표 매칭 전의 원 스탬프에서 열차와 역으로 직접 찾게 바꿨습니다. 매칭된 사건 테이블만 넘기면 창 밖 스탬프가 이미 사라져 있어 이 목적을 이룰 수 없으므로, 전처리가 원 스탬프 파일을 따로 남깁니다.
- **도착만 관측된 막차의 출발을 "도착 + 시간표 정차"로 잡으면 성공을 잘못 확정합니다.** 늦게 들어온 열차는 정차를 줄여 회복하므로 이 값은 출발의 하한이 아닙니다. 확실한 하한은 도착 관측 자체뿐입니다. 그리고 도착만 있는 경우는 성공만 확정되고 실패는 판정 불가로 빠지므로, 이 라벨은 주 라벨에서 제외하고 민감도로만 씁니다.
- **10/2 동결과 22밤 재판정을 분리합니다.** 확증 평가는 10/2 동결 설정을 그대로 쓰고, 최종 앱 수치만 22밤으로 재적합합니다. 둘을 섞으면 확증 밤의 데이터가 평가 대상과 전처리를 바꿔 확증 세트를 둔 의미가 사라집니다.
- **토요일과 일요일·공휴일은 막차 시각이 다른 조합이 있습니다.** 지연 분포는 주말로 묶되, 막차 시각과 버퍼는 요일 유형 세 가지(평일·토요일·일요일 및 공휴일)로 나눠 제공합니다.
- **`.gitignore`의 `data/`가 `web/public/data/`까지 무시합니다.** 이대로면 앱 JSON이 커밋되지 않아 Vercel 빌드에 데이터가 없습니다.
- **주말 막차는 23시대에 몰려 있습니다.** 주말 막차 도착 430건 중 302건이 23시대입니다. 평일 경합 조합은 전부 24시대입니다. "막차 셀 = 24시대"는 평일에만 맞습니다.
- **공식 시간표 CSV에 코레일 구간이 들어 있습니다.** 1호선 102역, 4호선 진접~오이도 51역입니다. "1·4호선 결손 = 시간표 미수록 코레일 열차"라는 기존 가설은 약해졌습니다.

## 일정

오늘 아침(9/26) 기준 가용 밤은 8~9밤입니다. 9/25 밤 수집 여부에 따라 달라집니다. 날짜별 가용 밤은 그날 아침 기준입니다.

| 기간 | 가용 밤 (평일/주말·공휴일) | 주력 작업 | 병행 | 이정표 |
|---|---|---|---|---|
| 9/26(토)~9/27(일) | 9~10 (5/4~5/5) | 0단계 준비 → 1 전처리 → 3a 막차·B 테이블 | 7 착수 | 9/27: 8밤 사건 테이블, 막차 쌍 테이블 |
| 9/27(일)~9/28(월) | 10~11 (5/5~5/6) | 4 quick → 확률 잠정 계산 → 8 web + URL | 7 완료 | **9/28: Vercel URL** |
| 9/29(화)~9/30(수) | 12~13 (6/6~7/6) | 2 밤별 점검 → 3b 실측 Y → 컨볼루션 필요성 점검 | 5-6 공지 재수집, 5-9 문서 정정 | 9/30: 밤별 Y 건수표 |
| 9/30(수)~10/1(목) | 13~14 (7/6~8/6) | 4 정식 코드, 6 검증 드라이런, 5-3·5-4·5-8 판정 규칙 코드화 | 주 평가지표 문서 고정, 검출 가능 최소 차이 계산 | 10/1: 드라이런 완주 |
| 10/2(금) | 15 (9/6) | 전체 실행, 결정표 자동 판정, 파라미터 동결, JSON 교체 | | **10/2 중간 점검** |
| 10/3(토)~10/6(화) | 16~19 | 5-1·5-2·5-7 한계 기술, 민감도 분석 | 9 보고서 세 절 초안, 팀 피드백 | 10/6: 탭 3 결정 |
| 10/7(수)~10/8(목) | 20~21 | 보고서 결과 절 틀(자리표시자), 웹 다듬기, Vercel 배포 | 발표 시나리오(팀원) | |
| 10/9(금) | 21 (12/9) | 코드 동결 태그, 전체 재실행과 소요 시간 측정 | | 동결 |
| 10/10(토) 02:00 이후 낮 | 22 (13/9) | **수집 예약 해제**, 최종 실행(확증·최종 검증, JSON, 보고서 수치) | | 최종 수치 |
| 10/11(일) 오전 | — | 결과 점검, 결과 절 해석 문장 확정, 제출 | | **제출** |

**매일 아침 루틴** (작업 2가 끝난 뒤부터, 약 5분)
1. `git pull`
2. `python preprocess.py --nights <어젯밤>`
3. `python night_qa.py --night <어젯밤>`

틱 수가 40 미만이거나 첫 틱이 22:05보다 늦으면 그날 Actions 로그를 바로 확인합니다.

**밤 구성** (계획서 규칙대로 센 값)
- 평일 13밤: 10/2 전 9밤(9/16, 9/18, 9/21, 9/22, 9/23, 9/28, 9/29, 9/30, 10/1), 확증 4밤(10/2, 10/6, 10/7, 10/8)
- 주말·공휴일 9밤: 10/2 전 5밤(9/19, 9/20, 9/24, 9/25, 9/27; 9/26 유실), 확증 4밤(10/3, 10/4, 10/5, 10/9)
- 휴일 시간표(END) 8밤, 토요일 시간표(SAT) 1밤(9/19). 10/3은 토요일이지만 개천절이라 END
- 유실 2밤: 9/17(예약 지연), 9/26(API 장애)
- 추석 세 밤(9/24~9/26)을 빼면 10/2 시점 주말은 3밤입니다.

## 작업 의존 관계

```
수집 (GitHub Actions, ~10/10 02:00) ──> collected/YYYYMMDD/{position,arrival}_YYYYMMDD.jsonl.gz, collect.log
                                               │
 common.py (규칙·시각·캘린더·환승역 목록, 신규) ─┤
                                               ▼
 [1] preprocess.py ──> data/processed/events/, night_meta.csv, tt_fit.csv
        │
        ├──> [3a] lasttrain.py (시간표 CSV + transfer_time.csv) ──> last_train_pairs.csv (B)
        │          │
        │          ├──> [4 quick] ──> [8] export_for_app.py ──> web/public/data/*.json ──> Vercel
        │          │                          ▲
        │          │     [7] build_station_alt.py ──> station_alt_base.json
        │          │
        ├──> [2] night_qa.py ──> night_qa.csv, night_status.csv
        │          │
        └──────────┴──> [3b] label_y.py ──> y_events.csv, y_counts.csv
                                   │
             [4] fit_delay.py <────┤ (막차 A 지연과 셀 분포 비교)
                    │              │
                    └──> [6] validate.py (잭나이프 + LONO) ──> p_table.csv, output/validation/*
                                   │
 [5] 판정 규칙(5-3·5-4·5-8)은 4·6 안에서 자동 실행. 나머지 5-x는 한계 기술용
 [9] 보고서: 1~6 산출물을 자리표시자로 참조
```

- 9/28 URL에는 3b가 필요 없습니다. 1 → 3a → 4 quick → 8 순서로 먼저 갑니다.
- 3b는 1, 2, 3a가 끝나야 시작합니다.
- 4의 정식 실행은 2에서 밤 상태와 시간표 적합이 확정된 뒤에 합니다.
- `run_pipeline.py`(신규)는 작업 1에서 만들고, 작업이 끝날 때마다 단계를 추가합니다.

## 공통 규약

| 항목 | 규약 | 근거 |
|---|---|---|
| 시각 | 운영일 00:00 기준 초(int)로 통일합니다. 관측은 `recptnDt − _service_date`의 초, 시간표 `HH:MM:SS`는 h·3600+m·60+s입니다. 24·25시 표기는 그대로 둡니다. | 파서 3종(`to_min` 2개, `eda_timetable.py`의 `to_seconds`)과 `hour<4 → +1440` 하드코딩 3곳을 하나로 합칩니다. |
| 미래 시각 제거 | `obs_sec ≤ collected_sec + 5`인 스탬프만 씁니다. | 도착 API에 수집 시각보다 1시간 넘게 미래인 `recptnDt`가 있습니다(9/16에 35행). 그대로 두면 23:58 시간표 행에 지연 0인 가짜 사건이 생깁니다. |
| 시간표 결측 | `열차도착시간`·`열차출발시간`이 null이거나 `00:00:00`이면 NaN으로 봅니다. 도착 `00:00:00`이면서 `급행여부=1`인 행은 `pass_through=True`로 두고 매칭과 막차 후보에서 뺍니다. | 도착 `00:00:00` 7,072행 중 7,071행이 급행 통과 행으로 추정됩니다(경인선 비정차역). |
| 시간표 소스 | 공식 CSV(`서울교통공사_서울 도시철도 열차운행시각표_20260901.csv`, cp949, 12컬럼)만 씁니다. API 수집분 `timetable.jsonl`은 쓰지 않습니다. | API 시간표는 9호선 토요일 시각이 CSV와 94.5% 행에서 다릅니다. 어느 쪽이 맞는지는 9/19·10/10 밤 지연으로 판정합니다(5-9). |
| 요일 | `common.day_info(night)`가 `tt_tag`를 정합니다. 공휴일과 일요일은 END, 그 밖의 토요일은 SAT, 나머지는 DAY입니다. HOLIDAYS = 0924, 0925, 0926, 1003, 1005, 1009입니다. `day_type`은 DAY면 weekday, 그 외 weekend입니다. | 요일 판정 함수가 저장소에 없습니다. |
| 시간대 | `hour_band`는 **시간표 시각(`sched_sec`) 기준**으로 붙입니다. 22 = [79200, 82800), 23 = [82800, 86400), 24 = 86400 이상입니다. | 관측 시각으로 붙이면 늦은 23시대 열차가 24시대로 넘어가 24시대 지연이 부풀려집니다. 단위 테스트를 둡니다. |
| 노선 | `"1"`~`"9"` = `subwayId` 끝자리입니다. arrival은 `subwayId`가 `100[1-9]`인 행만 씁니다. **8호선 도착 API의 도착(`arvlCd=1`)은 쓰지 않습니다.** | 도착 API의 26~31%가 1~9호선이 아닙니다. 8호선 도착 API 도착은 같은 열차·역의 위치 API 도착보다 15밤 모두 12~18분 이르게 찍혔습니다(10/3 확인). 같은 노선 출발은 차이 0분이라 그대로 씁니다. |
| 역·열차 키 | `STATION_ALIAS`, `norm_station`, `match_key`를 verify_realtime.py 173~197행에서 옮깁니다. 시간표 `digits`는 `열차코드`의 첫 숫자열에서 앞자리 0을 뗀 값입니다. | verify_realtime.py는 import하면 전체가 실행되므로 옮겨 적어야 합니다. digits 충돌은 (호선, 주중주말, digits) 기준 0건으로 확인했습니다. |
| 환승역 | 환승역 목록과 노선 간 역명 별칭(4호선 총신대입구 = 7호선 이수)을 `common.py`에 둡니다. 대상은 물리 역 51개, 방향쌍 113개(자료 96 + 역방향 보충 17)입니다. 환승 자료의 `경원선`은 1호선으로 읽고(석계), 같은 노선 지선 환승 3개(성수, 신도림, 강동)는 `same_line`으로 표시해 남깁니다. | 작업 2와 3a가 같은 목록을 씁니다. 10/3 구현에서 확정했습니다. |
| 방향 | 조인에 쓰지 않습니다. 매칭된 시간표 행의 `방향`을 가져다 씁니다. `updnLine`은 점검 보고에만 씁니다. | 9호선 `updnLine` 대응이 조사마다 반대로 나왔고, 도착 API 2호선 라벨은 약 10%가 어긋납니다. |
| 부등호 | 성공은 여유 ≥ 0, 즉 관측 도착 + 도보 ≤ 관측 출발입니다. P(성공) = F(B) = P(지연 ≤ B)입니다. | CDF 정의와 맞춥니다. 기존 문서의 "D < B"는 폐기합니다. |
| 가중 | 분포와 확률은 **밤 균등 가중**으로 계산합니다. 밤마다 ECDF를 구해 평균합니다. 사건 가중과의 차이는 민감도로만 봅니다. | 사건이 적은 부분 수집 밤이 과소 반영되는 것을 막고, "임의의 한 밤"이라는 추정 대상과 맞춥니다. |
| 저장 | CSV(utf-8-sig)로 저장합니다. 키 컬럼은 `dtype=str`로 읽습니다. | pyarrow가 설치돼 있지 않고, 팀원이 엑셀로 열 수 있습니다. |
| 난수 | seed 20260916, `numpy.random.default_rng` | 재현성 |
| 경로 | 중간 산출물 `data/processed/`, 점검·검증 결과 `output/`, 둘 다 git 제외입니다. 앱 JSON만 `web/public/data/`에 두고 커밋합니다. | `.gitignore`를 고쳐야 합니다(0단계). |
| 라이브러리 | pandas·numpy·matplotlib에 scikit-learn을 추가합니다(`GaussianMixture`, `LogisticRegression`). 정규분포 CDF는 `math.erf`로 씁니다. 목록은 `requirements-analysis.txt`로 두고 Actions 수집 환경에는 넣지 않습니다. | scipy는 필요 없습니다. EM과 벌점 로지스틱을 직접 짜는 것보다 검증된 구현이 안전합니다. 밤당 15만 행 이하라 DuckDB는 쓰지 않습니다. |
| 보안 | API 키는 `.env`에만 둡니다. `web/`에는 키도 API 호출도 없습니다. 앱 JSON에는 집계값만 넣습니다. | 저장소가 공개입니다. |

---

## 작업 1. 전처리 모듈화

**목표**
- verify_realtime.py의 규칙을 import 가능한 함수로 옮깁니다.
- 8밤 전부를 같은 규칙으로 처리해 관측 사건 테이블을 만듭니다. 이후 모든 작업의 유일한 입력입니다.
- (밤, 노선)마다 시간표가 맞는지 판정합니다.

**입력**
- `collected/YYYYMMDD/position_YYYYMMDD.jsonl.gz`: `subwayId, statnId, statnNm, trainNo, recptnDt, updnLine, trainSttus, directAt, statnTnm, _collected_at, _service_date`
- `collected/YYYYMMDD/arrival_YYYYMMDD.jsonl.gz`: `subwayId, statnId, statnNm, btrainNo, recptnDt, arvlCd, updnLine, bstatnNm, _collected_at, _service_date`
- `collected/YYYYMMDD/collect.log`: 틱별 API 코드
- 시간표 CSV: `고유번호, 호선, 역사코드, 역사명, 주중주말, 방향, 급행여부, 열차코드, 열차도착시간, 열차출발시간, 출발역, 도착역`
- `utils.py`: `SERVICE_DAY_CUTOFF_HOUR`, `log_line`

**구현 단계**

0단계, 준비 (9/26)
- `.gitignore`의 `data/`를 `/data/`로 바꾸고 `output/`, `web/node_modules/`, `web/dist/`를 추가합니다.
- 확인: `git check-ignore -v --no-index web/public/data/x.json` 결과가 비어 있어야 합니다.
- `requirements-analysis.txt`, `run_pipeline.py` 틀을 만듭니다.
- 미커밋 문서(`프로토타입_데모.md`, `프로젝트_방향_결정.md` 수정분)와 이 계획서를 커밋합니다. 팀원이 JSON 스펙을 볼 수 있어야 하기 때문입니다.

1단계, `common.py` (신규)
- 옮겨 올 것: `STATION_ALIAS`, `norm_station`, `match_key`
- 새로 쓸 것: `HOLIDAYS`, `day_info`, `hms_to_sec`, `obs_sec`, `TRANSFER_STATIONS`, `LINE_ALIAS`
- 상수: `MATCH_WIN = (-600, 1800)`, `HOUR_BANDS`, `TRUNC_W = 600`(잠정, 작업 2에서 확정)
- verify_realtime.py는 고치지 않고 진단 기록으로 남깁니다.

2단계, `preprocess.py` (신규)

| 함수 | 하는 일 |
|---|---|
| `load_night(night)` | `read_json(lines=True, dtype=str, convert_dates=False)`로 읽습니다. 페이징 컬럼을 지우고 arrival은 1~9호선만 남깁니다. 미래 시각 스탬프를 제거하고 건수를 기록합니다. |
| `load_timetable(tt_tag)` | `주중주말`로 거르고 `arr_sec, dep_sec, digits, nm, pass_through`를 만듭니다. 운행 순서 `seq`와 앞뒤 역 `prev_uid, next_uid`를 만듭니다. |
| `night_meta(pos, arr, log)` | 첫 틱, 마지막 틱, API별 틱 수를 셉니다. 위치 공백은 `collect.log`에서 **전 노선이 `INFO-200`인 틱**으로 판정합니다. 정체 행 하나에 기대지 않기 위해서입니다. |
| `extract_pos_stamps(pos)` | `trainSttus` 1, 2, 3을 arr, dep, prev_dep로 바꾸고 `src="pos"`를 붙입니다. |
| `extract_arr_stamps(arr)` | `arvlCd` 1, 2, 3을 같은 방식으로 바꾸고 `src="arr_api"`를 붙입니다. 3호선 3802~3983을 제외하고 건수를 기록합니다. |
| `save_stamps(stamps)` | 두 출처의 정제 스탬프를 (line, key, station, status, src)별 첫 관측 시각만 남겨 **시간표 매칭 전 상태로** `stamps_YYYYMMDD.csv`에 저장합니다. 작업 3b가 막차를 창 없이 찾는 입력입니다. |
| `match_timetable(stamps, tt)` | (line, key, nm)으로 후보를 잡고, status에 맞는 기준 시각(도착, 출발, 앞 역 출발)과 가장 가까운 행을 `MATCH_WIN` 안에서 고릅니다. 두 후보의 시각 차이가 2×\|지연\|보다 작으면 `ambiguous`입니다. 창 밖 후보는 `out_of_window`로 남기고 부호(+/−)를 기록합니다. |
| `first_stamp(matched)` | (night, uid, status, src)마다 최소 `obs_sec` 하나를 남기고 원래 스탬프 수를 `n_raw`로 둡니다. 재방문은 시간표 행 단위로 분리됩니다(22시 이후 38건: 2호선 21, 6호선 17). |
| `tt_fit(events, tt)` | (밤, 노선)마다 23시 이후 시간표 열차 관측률과 지연 중앙값을 셉니다. 관측률 < 0.6이거나 \|중앙값\| > 600초이면 `tt_unknown`입니다. 0.9로 두면 평일 5호선(매번 79%, 59xx번대 미관측)이 매일 걸려서 0.6으로 낮췄습니다. 추석 불일치 노선은 0~39%입니다. |
| `flag_events(events, meta)` | `hour_band, pos_gap, in_window`를 붙입니다. `in_window`는 시간표 시각이 [첫 틱 + E, 마지막 틱 − TRUNC_W] 안에 있고, 위치 공백 밤의 pos 사건은 공백 시작 − TRUNC_W 이전이어야 합니다. E는 정상 밤 지연 1백분위의 절댓값입니다. |
| `process_night`, `main` | `--nights all\|YYYYMMDD,...`, `--force`. 밤 목록은 `collected/*`에서 자동으로 찾습니다. |

`in_window`가 없으면 늦게 시작한 밤(9/18 22:27, 9/21 22:39)에 선택 편향이 생깁니다. 첫 틱 전에 예정됐던 열차 중 늦게 온 열차만 잡히기 때문입니다.

**산출물**
- `data/processed/events/events_YYYYMMDD.csv`, `data/processed/delay_events.csv`(합본)

| 컬럼 | 내용 |
|---|---|
| night, tt_tag, day_type | 운영일, 시간표 태그, weekday/weekend |
| line, train_no, key | 노선, 원본 열차번호, 매칭 키 |
| station, statn_id | 정규화 역명, 실시간 역 ID |
| status, src | arr / dep / prev_dep, pos / arr_api |
| obs_sec | 관측 시각(초) |
| uid, sched_code, direction, express, dest | 시간표 고유번호, 열차코드, 방향, 급행여부, 도착역 |
| sched_sec, delay_sec | 기준 시각, 관측 − 기준 |
| hour_band | 22 / 23 / 24 / pre |
| n_raw, ambiguous, in_window, pos_gap | 품질 플래그 |

- `data/processed/events/stamps_YYYYMMDD.csv`: `night, line, train_no, key, station, statn_id, status, src, obs_sec, collected_sec, n_raw`. 시간표 매칭 전 원 스탬프입니다.
- `data/processed/night_meta.csv`: `night, tt_tag, day_type, first_tick, last_tick, n_ticks_pos, n_ticks_arr, pos_gap_start_sec, pos_gap_end_sec, n_future_dropped, n_excl_3line_deadhead`
- `data/processed/tt_fit.csv`: `night, line, obs_rate_23plus, delay_med_23plus, tt_unknown`
- `data/processed/events/unmatched_YYYYMMDD.csv`: 사유(`no_train_code` / `no_station` / `out_of_window_pos` / `out_of_window_neg`)

**완료 기준**
1. `python preprocess.py --nights all --force` 한 번으로 8밤이 처리되고, 다시 `--force`로 돌려도 산출 CSV 해시가 같아야 합니다.
2. 회귀 비교는 verify_realtime.py 11a절(첫 스탬프 기준)과 합니다. 9/16 위치 API 도착 사건 수 차이 2% 이하, 노선별 지연 중앙값 차이 10초 이하여야 합니다. 넘으면 원인(재방문 분리, 매칭 창)을 기록합니다.
3. 스탬프 단위 매칭률과 unmatched 사유별 비율이 밤×노선으로 출력돼야 합니다.
4. `tt_fit.csv`에서 9/20은 전 노선 정상, 9/24는 2·5·6·7·8호선 `tt_unknown`으로 나와야 합니다(점검 결과 재현).
5. 매칭된 사건의 `obs_sec`, `uid`, `delay_sec` 결측이 0건이어야 합니다.
6. `hour_band` 단위 테스트를 통과해야 합니다(시간표 23:58, 관측 00:03인 사건이 23으로 분류).
7. `updnLine` 대 시간표 방향 교차표를 노선별로 출력합니다. 기준치 없이 보고만 합니다.

**소요와 담당**: Claude 4~5시간 작성, 시원 2~3시간 규칙 검토와 회귀 판단. 9/26~9/27.

**리스크와 대응**

| 리스크 | 대응 |
|---|---|
| 새 매칭 규칙 때문에 문서 수치(확보율 41%/76% 등)와 달라짐 | 차이를 원인별로 기록하고 문서 수치는 5-5에서 새 값으로 바꿉니다. |
| pandas 3.0 문자열 dtype, copy-on-write 때문에 verify와 동작이 달라짐 | 회귀 비교로 잡습니다. |
| 9/25·9/26 밤도 특별 시간표 | `tt_fit`이 자동으로 걸러냅니다. 걸러진 (밤, 노선)은 작업 3b·4에서 빠집니다. |

---

## 작업 2. 밤별 재현성 점검

**목표**
- 같은 규칙이 밤마다 같은 품질을 내는지 수치로 확인합니다.
- 밤 상태(정상/부분/이상)를 정합니다. 작업 4·6의 포함 기준과 민감도 기준이 됩니다.

**입력**: `events_*.csv`, `night_meta.csv`, `tt_fit.csv`, `unmatched_*.csv`, `last_train_pairs.csv`(3a)

**구현 단계**: `night_qa.py` (신규)
- `tick_status(meta)`
  - 정상: 두 API 틱 ≥ 76/80, 첫 틱 ≤ 22:05, 위치 공백 없음
  - 부분: 정상 조건을 하나 이상 못 채웠지만 틱 ≥ 40
  - 이상: 그 밖
- `match_rates`: 노선×API별 스탬프 매칭률
- `transfer_coverage`: 환승역 확보율. 분모는 22시 이후 환승역 도착 예정 시간표 행 중 해당 열차가 그 밤 어디서든 관측된 행입니다. 막차 A 도착, 막차 D 출발 확보율을 출처 단계별로 함께 셉니다.
- `stamp_rule_stats`: 중복 제거 비율, `out_of_window_pos` 비율, 정체 사건(01:05 이후 `n_raw` ≥ 6) 수, ambiguous 비율
- `delay_summary`: `in_window` 도착 사건의 노선별 지연 중앙값, p90, p99
- `flag_outliers`: 같은 day_type 정상 밤들의 범위를 벗어난 항목 표시
- CLI: `--night YYYYMMDD` 또는 `--all`

**산출물**
- `output/qa/night_qa.csv` (밤×노선): `night, day_type, tt_tag, night_status, tt_unknown, first_tick, n_ticks_pos, n_ticks_arr, pos_gap_start, line, pos_match_rate, arr_match_rate, cov_transfer_any, cov_last_a_any, cov_last_d_direct, cov_last_d_any, dup_ratio, oow_pos_ratio, n_stale, n_ambiguous, delay_med_sec, delay_p90_sec, delay_p99_sec, flags`
- `output/qa/night_status.csv` (밤 단위): `night, day_type, night_status, reason`

**완료 기준**
1. 밤 × 9노선 행이 모두 나오고, 모든 밤에 상태와 사유가 붙어야 합니다.
2. 같은 day_type 정상 밤 사이에서 노선별 매칭률 범위 ≤ 2%p, 환승역 확보율 범위 ≤ 5%p, 지연 중앙값 범위 ≤ 30초인지 봅니다. 넘은 항목은 `flags`에 남기고, 원인을 확인하기 전에는 제외하지 않습니다.
3. TRUNC_W를 정상 평일 밤 도착 지연 p99를 30초 단위로 올림한 값으로 확정합니다.
4. 기준치는 첫 실행 분포를 보고 10/1까지 고정하고, 이후 바꾸지 않습니다.

**소요와 담당**: Claude 2~3시간, 시원 1~2시간 검토. 9/29. 매일 아침 판정은 시원이 맡습니다.

---

## 작업 3. 막차 환승 실측 Y

**목표**
- 시간표 막차 쌍마다, 밤마다 실제 환승 성공 여부를 관측으로 판정한 라벨 Y를 만듭니다.
- Y는 작업 6 검증의 정답지입니다.

### 정의

**조합과 막차**
- 조합 c = (환승역 s, from_line, in_dir, to_line, out_dir, tt_tag)입니다. 방향은 시간표 `방향` 값입니다.
- 타고 온 막차 A(c): tt_tag 시간표의 (from_line, s, in_dir) 행 중 `arr_sec`가 있고 `pass_through`가 아닌 행에서 도착이 가장 늦은 행입니다. s에서 종착하는 열차도 포함합니다.
- 갈아탈 막차 D(c): (to_line, s, out_dir) 행 중 `dep_sec`가 있는 행에서 출발이 가장 늦은 행입니다. 행선은 판정에 쓰지 않고 `d_dest`로 보존합니다.

**도보와 버퍼**
- 도보 w(c)는 `transfer_time.csv`의 `환승소요시간`(MM:SS)을 초로 바꾼 값입니다. 반대 방향 행이 없는 16쌍은 역방향 값으로 채우고 `walk_src="mirror"`를 붙입니다.
- 버퍼 B(c) = dep_sched(D) − arr_sched(A) − w
- 추정 대상은 "공식 환승 소요시간대로 걷는 사람"입니다. 경합 구간에서는 w가 ±30초만 달라도 라벨이 뒤집히므로 w×{0.8, 1.2} 민감도를 봅니다.

**라벨**
- 밤 n의 실측 여유 S_n(c) = D_obs − A_obs − w
- **Y_n(c) = 1[S_n ≥ 0]**, 즉 (A 지연 − D 지연) ≤ B
- 보조 라벨 Y^arr_n(c) = 1[A 지연 ≤ B]. 갈아탈 막차가 정시 출발한다고 가정한 라벨이고, 1차 모형이 예측하는 사건입니다.
- **경합 구간**에서 Y와 Y^arr가 다른 비율이 2차 컨볼루션을 주 모형으로 올릴지 정합니다.

### 관측값 찾는 방법

Y용 관측은 **매칭 전 원 스탬프(`stamps_*.csv`)에서** 찾습니다. 막차 A·D의 열차코드 숫자부(`digits`)와 환승역 정규화 역명을 키로 (line, key, station, status)를 직접 조회합니다. 매칭된 사건 테이블(`events_*.csv`)에는 창 밖 스탬프가 없어서 30분 넘게 늦은 막차를 찾을 수 없기 때문입니다.
- 스탬프가 여러 개면 시간표 시각 − 600초 이후의 첫 스탬프를 씁니다. 막차는 그 역을 한 번만 지나므로 이것으로 충분하고, 재방문 노선(2호선 순환, 6호선 응암)도 같은 규칙으로 처리됩니다.
- 보간(`interp`)만은 앞뒤 역의 매칭된 사건(`events_*.csv`)을 씁니다.

**A_obs** (A가 s에 도착한 시각)

| 순위 | 출처 | 방법 |
|---|---|---|
| 1 | `pos` | 위치 API `trainSttus=1` 첫 스탬프 |
| 2 | `arr_api` | 도착 API `arvlCd=1` 첫 스탬프 |
| 3 | `interp` | s 앞뒤 역 측정 지연을 시간표 경과시간 비례로 보간. 앞뒤 시간표 간격 10분 이하일 때만. s가 종착이면 불가(199건 중 33건) |
| — | `a_late_unseen` | 상류에서는 관측됐는데 s에서 `D_sched + w + 600초`까지 도착 스탬프가 없음 |
| — | 없음 | NA |

**D_obs** (D가 s에서 출발한 시각)

| 순위 | 출처 | 방법 |
|---|---|---|
| 1 | `dep` | s에서 `trainSttus=2` 또는 `arvlCd=2` 첫 스탬프 |
| 2 | `prev_dep` | 다음 역에서 `trainSttus=3` 또는 `arvlCd=3` 첫 스탬프. "전역출발 = s 출발" 가정이 필요합니다. |
| 3 | `arr_bound` | s 도착 스탬프만 있을 때. **점값으로 쓰지 않고 단측 하한으로만 씁니다.** 하한은 D의 도착 관측 시각 자체입니다. A_obs + w ≤ D 도착 관측이면 y=1로 확정하고, 그 밖이면 `d_censored`로 둡니다. |
| 4 | `interp` | A와 같은 보간 |

`arr_bound`에 시간표 정차시간을 더하지 않는 이유는 두 가지입니다. 첫째, 늦게 들어온 열차는 정차를 줄여 회복하므로 "도착 + 시간표 정차"는 출발의 하한이 아닙니다. 예정 24:00 도착·24:02 출발인 D가 24:03에 와서 24:03:30에 떠나면, 승객이 24:04에 도착해도 그 규칙은 성공으로 확정합니다. 둘째, 반대로 A가 늦고 D가 기다린 경우에는 출발을 너무 이르게 잡아 실패로 오분류합니다. 도착 관측만이 어느 쪽으로도 틀리지 않는 하한입니다.

**라벨 등급**
- **주 라벨**(`main`): A가 {pos, arr_api}이고 D가 {dep, prev_dep}인 경우만입니다.
- **단측 확정 라벨**(`one_sided`): D가 `arr_bound`로 y=1 확정된 경우. 이 등급은 성공만 확정되고 실패는 `d_censored`로 빠지므로, 주 라벨에 넣으면 성공 쪽으로 치우칩니다. 큰 지연이 결측으로 빠지는 문제와 같은 방향의 편향입니다. 그래서 **민감도 분석에만** 씁니다.
- **보간 포함 라벨**(`interp`): interp를 하나라도 포함한 경우. 민감도 분석에만 씁니다.
- `a_late_unseen`: 주 분석에서는 NA로 두고, 민감도 분석에서 y=0으로 처리합니다.
- NA 사유 코드: `a_not_seen`, `d_not_seen`, `d_censored`, `pos_gap`, `tt_unknown`
- 공백과 창 절단에 따른 제외는 모두 **시간표 시각 기준**으로 판정합니다.

**가정 검증** (`label_y.py`가 실행할 때마다 출력)
- prev_dep 동등성: dep와 prev_dep가 둘 다 있는 사건에서 차이의 \|중앙값\| ≤ 30초이고 p90 ≤ 60초이면 주 라벨로 인정합니다.
- 보간 검증: 주 라벨에서 A(또는 D)를 가리고 보간으로 다시 만든 y의 **불일치율**을 \|S\| 구간(0~60, 60~180, 180초 초과)별로 봅니다. 경합 구간 불일치율이 5% 이하일 때만 보간 포함 라벨을 씁니다.
- 막차 정차 연장: 출발이 직접 관측된 막차 D만으로 (출발 − 도착) − 시간표 정차 분포를 따로 추정하고 n을 보고합니다.
- 단측 확정의 편향 크기: 출발이 직접 관측된 막차 D에서 "도착 관측 기준 확정"과 실제 y의 일치율을 봅니다. 이 값이 `one_sided` 등급을 민감도에서 해석하는 근거입니다.
- 출처 간 오프셋: 같은 uid·status가 두 출처에 다 있는 사건으로 (노선, status, src)별 쌍차 중앙값을 구합니다. 9호선은 도착 −0.3분, 출발 −0.8분이라 S가 약 30초 편향될 수 있습니다. 노선 셀은 F의 오프셋만 흡수하고 Y의 오프셋은 흡수하지 못하므로, 오프셋만큼 S를 흔든 민감도가 필수입니다.

### 한 밤당 기대 건수

**사전 추정** (점검 스크립트 결과, 추정치)
- 조합 수는 공식 CSV 기준 역방향 보충 없이 366개, 별칭 통일과 역방향 보충을 하면 438개입니다. EDA의 346개는 API 시간표 기준이라 9호선 출발이 빠져 있습니다.
- 경합 구간 조합은 평일 142개, 휴일 146개입니다.
- 밤당 경합 라벨은 약 93건으로 추정되고, 평일 15밤이면 약 1,400건입니다.
- 실제 제약은 라벨 수가 아니라 **고유 A 열차 수**입니다. 여러 조합이 같은 A 열차를 공유하기 때문입니다.

**실측**: 밤, 등급, day_type, NA 사유별 건수와 "밤 × 고유 A 열차" 수를 셉니다.

### 작업 6에서 쓰는 방식
- LONO fold n의 평가 대상은 밤 n의 라벨(NA 제외)이고, 모형은 밤 n을 뺀 밤들로 적합합니다.
- Y^arr로는 1차 분포 자체의 보정을, Y로는 서비스가 내놓는 확률의 보정을 봅니다.
- 누수 방지: 밤 n의 A_obs는 밤 n의 지연 사건이므로, F 학습에서 밤 n의 사건을 전부 뺍니다.

### 구현 단계

**3a `lasttrain.py`** (신규, 9/27)
- `load_transfer()`: `common.TRANSFER_STATIONS`와 별칭을 써서 1~9호선끼리의 환승 행만 남기고, 역방향 16쌍을 채웁니다.
- `last_arrivals(tt)`, `last_departures(tt)`: NaN과 `pass_through`를 먼저 제거한 뒤 (호선, nm, 방향)별 최대 행을 고릅니다. verify_realtime.py 287행의 NaN 정렬 버그(174조합 중 11개가 시발 열차 행)를 막습니다.
- 1호선 도착시각 결측 역 목록과 영향받는 조합 수를 출력합니다.
- `build_pairs(tt_tag)`: DAY, SAT, END 세 벌을 만들고 SAT와 END의 B가 다른 조합 수를 출력합니다. 앱은 세 벌을 모두 싣습니다. 지연 분포는 SAT와 END를 weekend로 묶어 쓰지만, 막차 시각과 B는 요일 유형별로 다르기 때문입니다. 토요일 사용자에게 END 막차 시각을 보여주면 틀린 여유시간을 주게 됩니다.
- `compare_eda()`: `data/eda/환승여유시간.csv`와의 차이를 원인별로 집계합니다.

**3b `label_y.py`** (신규, 9/29~9/30)
- 입력: `last_train_pairs.csv`, `stamps_*.csv`(A·D 직접 조회), `events_*.csv`(보간용), `night_meta.csv`, `night_status.csv`, `tt_fit.csv`, 시간표 CSV
- `attach_obs(pairs, stamps, events, tt, night)`, `interp_delay(...)`, `assumption_checks(...)`, `label(night)`, `main()`

### 산출물
- `data/processed/last_train_pairs.csv`: `combo_id, tt_tag, day_type, station, from_line, in_dir, to_line, out_dir, a_uid, a_code, a_arr_sec, a_dest, a_terminal, a_express, d_uid, d_code, d_dep_sec, d_dest, d_express, walk_sec, walk_src, distance_m, buffer_sec, a_hour_band`
- `data/processed/y_events.csv`: `night, tt_tag, day_type, night_status, combo_id, buffer_sec, a_obs_sec, a_src, a_delay_sec, d_obs_sec, d_src, d_delay_sec, slack_sec, y, y_arr, label_grade(main/one_sided/interp), na_reason, contested`
- `output/qa/y_counts.csv`: `night, day_type, n_combos, n_main, n_one_sided, n_interp, n_na_<사유>, n_contested_main, y_rate, n_unique_a`
- `output/qa/y_assumptions.csv`: 가정 검증 항목별 n, 중앙값, p90, 통과 여부

### 완료 기준
1. A 행 `a_arr_sec`, D 행 `d_dep_sec` NaN이 0건이어야 합니다(assert).
2. 모든 (밤, 조합)에 `label_grade`나 `na_reason`이 붙어야 합니다(미분류 0).
3. 가정 검증 수치가 나오고, 통과 여부에 따라 등급 규칙이 자동으로 적용돼야 합니다.
4. "평일 밤당 경합 구간 주 라벨 수"와 "고유 A 열차 수"가 확정돼야 합니다.
5. 시원이 무작위 조합 5건을 원본 행과 대조해 A_obs, D_obs, y가 모두 일치해야 합니다.
6. 9/30에 경합 구간 Y ≠ Y^arr 비율과 막차 D 출발 지연 분포가 나와야 합니다.

**소요와 담당**: 3a Claude 2~3시간·시원 1시간(9/27), 3b Claude 4~5시간·시원 2~3시간(9/29~9/30).

### 리스크와 대응

| 리스크 | 대응 |
|---|---|
| D 출발 직접 확보율이 19~24%, 전역출발을 더해도 34~43%라 주 라벨이 적고 노선별로 치우침. 3호선 직접 출발 0~16%, 2호선은 도착 포함해도 48~57% | 노선별 라벨 수를 함께 보고하고, 부족한 노선은 "라벨 부족"으로 명시합니다. |
| 9/18, 9/21은 위치 공백 이후 막차 라벨이 도착 API에만 의존함 | `night_status`로 민감도 분석을 합니다. |
| 행선 무시: 갈아탈 막차 199개 중 166개가 그 노선의 최빈 종착역이 아닌 곳에서 끝남 | 앱에 `d_dest`를 표시하고, 행선 반영은 범위 밖이라고 명시합니다. |

---

## 작업 4. 지연 분포 첫 적합

**목표**
- 노선 × 요일 × 시간대 셀마다 경험적 CDF와 로그정규 혼합 평활을 적합합니다.
- 시간대를 합칠지 수치 기준으로 정합니다.
- 셀 분포가 막차 자체의 지연을 대표하는지 확인합니다.

**대상 변수**
- 1차 F_A: 도착 지연 = 관측 − `열차도착시간`. 조건은 status=arr, src ∈ {pos, arr_api}, `in_window`, 시간표 도착 ≥ 22:00, `tt_unknown` 아님입니다. 노선의 모든 역을 풀링합니다. 같은 사건이 두 API에 다 있으면 pos 쪽 1건만 씁니다.
- 2차 F_Dep: **방향별 마지막 k편(k=3~5) 출발 지연**입니다. 일반 열차 출발 지연은 막차 D와 다른 모집단이라 쓰지 않습니다. 컨볼루션에만 씁니다.

**조건 셀**
- 기본은 노선(9) × day_type(2) × hour_band(22/23/24) = 54셀입니다. `dist_key` 예: `5|weekday|24`
- 넣지 않는 조건: 방향, 행선, 역, 급행. 9호선 급행만 5-1에서 따로 봅니다.
- 앱이 실제로 쓰는 셀은 평일이 24시대, 주말이 23시대입니다.

**셀 유효 조건과 병합 규칙** (LONO fold마다 같은 규칙을 다시 적용)
1. 유효 조건: n_nights ≥ 4 **이고** 밤 잭나이프로 구한 경합 구간 [−120, 600]초 F의 95% 반폭 최댓값 ≤ 0.05
   - 표본 수 기준(DKW 738건)은 쓰지 않습니다. 같은 밤 안 사건끼리 상관이 있어서, 설계효과 1+(m−1)ρ 때문에 유효 표본이 크게 줄어듭니다.
   - 드라이런에서 셀별 ICC(밤 간 상관)를 보고합니다.
2. 무효이면 같은 노선·요일 안에서 사다리를 올라갑니다. {22, 23, 24} → {22, 23-24} → {all}. 막차 셀에 가장 먼 22시대가 섞이지 않게 하려는 순서입니다.
3. 합쳐도 무효이면 `thin=True`로 두고 앱에 "표본 부족"을 표시합니다. 평일과 주말, 노선끼리는 합치지 않습니다.

**시간대 분리 판단** (평일 데이터, 노선마다)
- 비교: 23-24 대 22, 그다음 23 대 24
- 두 조건을 모두 만족할 때만 분리합니다.
  - (a) 실질: 경합 구간에서 sup\|F_a − F_b\| > 0.05. 앱 확률이 5%p 넘게 바뀐다는 뜻입니다.
  - (b) 밤 간 일관성: 밤별 mean_{x∈[−120,600]}(F_a − F_b)의 부호로 양측 부호검정 p < 0.05. N=8이면 8/8, 9면 8/9, 14면 12/14, 15면 12/15 이상입니다.
- 검정은 노선 9개 × 비교 2개 = 18개라 다중성이 있습니다. (a)의 실질 기준을 함께 요구해 오탐을 줄이고, 보고서에 검정 수를 적습니다.
- 주말은 밤 수가 적어 평일 결정을 따릅니다.

**막차 대표성 점검** (3b 이후)
- 노선별로 셀 F와 막차 A 실측 지연(`y_events.a_delay_sec`) ECDF를 비교합니다. 판단은 밤 순열 귀무분포로 합니다.
- 차이가 크면(순열 p < 0.05이고 경합 구간 sup 차이 > 0.05) 셀을 "방향별 마지막 k편"으로 재정의합니다.
- 종착 도착(`a_terminal`)은 따로 봅니다.

**길이 편향 점검**
- 포착 확률이 상태 지속시간/180초에 비례합니다. 정차가 긴 역과 대기하는 열차가 과대표집될 수 있습니다.
- 점검 1: 역 균등 가중 ECDF와 현행 ECDF의 sup 차이
- 점검 2: 역의 도착 포착 여부를 앞뒤 역으로 만든 보간 지연에 회귀(노선 고정효과)해, 포착이 지연과 무관한지 봅니다.

**경험적 CDF**
- 격자는 −120 ~ +1800초, 15초 간격, 129점입니다.
- p_success는 격자가 아니라 정확한 B에서 계산합니다.
- 셀별로 `out_of_window_pos` 비율(오른쪽 꼬리 절단)을 기록합니다. cdf(1800)은 구조상 1이므로 이것으로 완료를 판단하지 않습니다.

**모수 적합** (평활)
- 이동 로그정규 2성분 혼합: log(D + c)에 `GaussianMixture(n_components=2, random_state=0)`, c = 180초
- D ≤ −c인 사건은 제외하고 건수를 기록합니다. c ∈ {120, 300}으로 민감도를 봅니다.
- 비교 지표: 경합 구간 sup\|ECDF − F_param\|, 경합 구간 [−120, 600]으로 한정한 가중 CRPS(LONO)
- 주 결과는 ECDF입니다. thin 셀에서 모수 적합의 CRPS가 더 낮을 때만 모수를 쓰고 `param_used`를 표시합니다.

**구현 단계**: `fit_delay.py` (신규)
- `load_delays`, `assign_cells`, `cell_valid`, `merge_bands`, `band_test`, `ecdf_night_weighted`, `fit_lognorm_mix`, `mix_cdf`, `crps_lono`, `last_train_check`, `length_bias_check`
- `main(--quick)`: quick 모드는 ECDF만 계산하고 병합하지 않습니다. 빈 셀은 `p_success=null`로 둡니다. 9/27~9/28 잠정 JSON용입니다.

**산출물**
- `data/processed/delay_cells.csv`: `dist_key, line, day_type, hour_band, status, n_obs, n_nights, icc, jack_halfwidth_max, median_sec, p90_sec, p99_sec, oow_pos_ratio, thin, param_used, mix_w1, mix_mu1, mix_s1, mix_mu2, mix_s2, shift_c, sup_diff_param, crps_ecdf, crps_param`
- `data/processed/delay_grid.csv`: `dist_key, grid_sec, cdf_ecdf, cdf_param`
- `output/fit/band_test.csv`: `line, day_type, comparison, sup_diff, n_nights_same_sign, n_nights, sign_p, decision`
- `output/fit/last_train_check.csv`, `output/fit/length_bias.csv`
- `output/figures/cdf_line{N}.png`

**완료 기준**
1. 모든 `dist_key`의 CDF가 단조 증가해야 합니다.
2. 평일 셀마다 `oow_pos_ratio`가 기록되고, 1%를 넘는 셀이 있으면 10/2 결정표 9번에서 매칭 창 상한을 3600초로 넓힐지 판정합니다.
3. 평일 셀의 중앙값과 p90이 밤 단위 구간과 함께 표로 나와야 합니다.
4. 시간대 분리 결정이 `band_test.csv`에 기록되고 규칙만으로 다시 만들어져야 합니다.
5. 8밤 드라이런은 10/1까지, 정식 실행은 10/2에 합니다.

**소요와 담당**: Claude 4~5시간, 시원 3시간 해석. quick 모드 9/27~9/28, 정식 코드 9/30~10/1.

**리스크와 대응**

| 리스크 | 대응 |
|---|---|
| 10/2 기준 주말은 6밤, 추석을 빼면 3밤이라 대부분 thin | 주말 결과는 `meta.provisional=true`로 표시합니다. |
| 창 절단으로 늦게 시작한 밤의 22시대 표본이 줄어듦 | 의도된 것입니다. 편향을 없애는 대가입니다. |
| 막차가 셀 분포와 다름 | 막차 대표성 점검 결과에 따라 셀을 재정의합니다. 판정 규칙은 10/1까지 코드에 넣습니다. |

---

## 작업 5. 미해결 정리

**원칙**
- 10/2 결정에 영향을 주는 항목(5-3, 5-4, 5-8)은 **판정 규칙을 10/1까지 코드로 넣고 10/2 실행에서 자동 판정**합니다. 10/2 동결보다 판단이 늦어지면 안 되기 때문입니다.
- 나머지는 결정에 영향이 없고 한계 기술용입니다.
- 포함 여부 판정은 "차이가 작다"가 아니라 **무작위 대조**로 합니다. 같은 day_type 정상 밤에서 같은 수의 밤을 무작위로 뺐을 때 나오는 sup 차이의 95백분위를 기준으로 삼습니다. 검정력 없는 점검을 동등성의 근거로 쓰지 않기 위해서입니다.

| # | 항목 | 확인 방법 | 판단 기준 → 결정 | 기한 | 10/2 영향 |
|---|---|---|---|---|---|
| 5-1 | 9호선 음수 오프셋과 방향 대응 | 밤별·역별·급행별 지연 중앙값, 출처 간 오프셋(작업 3) | 밤별 중앙값 범위 ≤ 20초이고 특정 구간에 몰리지 않으면 상수 오프셋으로 봅니다. 급행과 일반 차이가 30초를 넘고 둘 다 유효 셀이면 급행 셀 분리를 검토합니다. | 10/5 | 없음 |
| 5-2 | 1·4호선 매칭 결손 3~4% | `unmatched_*.csv`의 번호대, 역 구간, 시각 분포 | 코레일 구간이 시간표에 있으므로 "미수록" 가설은 재검토합니다. 막차 A·D가 결손에 들어 있으면 NA 조합 목록을 명시합니다. | 10/5 | 없음 |
| 5-3 | 위치 공백 두 밤(9/18, 9/21)과 늦은 시작 | (i) 공백 창 막차 A·D 중 도착 API로 채워진 비율 (ii) 두 밤을 넣고 뺐을 때 평일 24시대 ECDF sup 차이 | sup 차이가 무작위 대조 95백분위 이하이면 포함합니다(기본값). 넘으면 공백 창 이후 사건만 제외합니다. | 10/1 코드화 | 결정 3 |
| 5-4 | 추석 연휴(9/24~9/26) | (i) `tt_fit` 결과 (ii) 정상 노선의 ECDF sup 차이 | `tt_unknown` 노선은 자동 제외합니다. 나머지 노선은 무작위 대조 95백분위 이하이면 포함합니다. **추석 제외 분석은 결과와 상관없이 필수 민감도**입니다. | 10/1 코드화 | 결정 2 |
| 5-5 | 막차 확보율 재계산 | `night_qa.csv`의 `cov_last_*` | 문서의 41%/76%를 새 값으로 바꿉니다. | 10/2 | 없음 |
| 5-6 | 이상상황 공지 재수집 | 공지 1종만 받는 스크립트 `fetch_notice.py`(신규)로 받습니다. | 현재 파일은 2021-10-20~2026-09-15라 수집 기간 공지가 0건입니다. 1,000건 상한 여부를 확인하고, 10/10에 한 번 더 받습니다. | 9/30, 10/10 | 없음 |
| 5-7 | 3호선 도착 API 매칭률 79% | 회송 제외 후 재계산, unmatched 사유 분해 | 90%를 넘으면 종결, 아니면 한계에 기록합니다. | 10/5 | 없음 |
| 5-8 | 풀링 가정(전 역 대 환승역, 셀 대 막차) | 작업 4의 막차 대표성 점검, 환승역 한정 ECDF | sup 차이 0.05 이하면 현행 유지, 넘으면 규칙대로 셀 재정의 | 10/1 코드화 | 결정 11 |
| 5-9 | 문서 정합과 9호선 토요일 시간표 | 아래 목록 | 정정 후 커밋. 9호선 토요일은 9/19 밤 지연 중앙값으로 CSV와 API 중 어느 쪽이 맞는지 판정 | 9/30 | 없음 |

**5-6 주의**: `fetch_aux.py`에는 공지 서비스가 없습니다. 그대로 돌리면 `CardBusTimeNew`가 1페이지(1,000행)만 받아 현재 43,171행 파일을 덮어씁니다. 작업 7 입력이 망가지므로 `fetch_aux.py`는 돌리지 않습니다.

**5-9 정정 대상**
- 요일: 9/24 목요일, 9/25 금요일
- 밤 수: 평일 15밤, END 10밤·SAT 2밤
- 예약: 14:00~21:00 KST 매시 8개
- 9호선 토요일: 방향 라벨 차이가 아니라 API 시각 차이
- 118,824명은 1시 컬럼이 빠진 값이고 실제는 328,702명(`HR_1_GET_ON_NOPE` 컬럼명 불일치)
- `getNtceList`: "있음"이 아니라 "재수집 필요"
- 분석 범위와 `collect.py` 주석의 "서울교통공사 구간 한정"을 코레일 구간 포함 여부 결정에 맞춰 수정
- `프로토타입_데모.md`: 신뢰구간 방법(잭나이프), `verdict`를 앱에서 계산, `a_dest`·`d_dest`·방면 추가, 인원 필드

**산출물**: `output/qa/issue_5-N.csv`. 결정은 결정표와 보고서 데이터·한계 절에 반영합니다.

**소요와 담당**: 시원 4~5시간, Claude 3시간.

---

## 작업 6. 불확실성과 LONO 검증

**목표**
- p_success의 불확실성을 밤 단위로 냅니다.
- 밤을 하나씩 빼고 만든 예측이 실측 Y와 맞는지, 비교 모형보다 나은지 수치로 보입니다.
- 코드 틀은 10/1까지, 결론 수치는 확증 세트와 최종 데이터로 냅니다.

### 불확실성: 밤 단위 잭나이프 + t 분포

백분위 클러스터 붓스트랩은 쓰지 않습니다. 밤이 15개여도 구간이 실제보다 좁고, 3~4개면 분위수 자체가 불안정합니다. 베이지안 계층 모형은 일정과 팀 설명 비용을 보면 맞지 않습니다.

- 점추정: p = (1/N) Σ_n F_n(B). 밤별 ECDF를 B에서 읽어 평균합니다.
- 구간: logit 척도에서 p ± t_{N−1} · SE_jack를 구하고 되돌립니다. SE_jack는 LONO fold 적합을 재사용하므로 추가 비용이 없습니다.
- 경계 처리: 잭나이프 LOO 추정치 p_(−n) 중 하나라도 0 또는 1이면 logit이 정의되지 않습니다. 전체 p가 안쪽 값이어도 일어납니다(밤별 값이 0.2, 0, 0, 0이면 첫 밤을 뺀 추정치가 0). 규칙은 다음과 같습니다.
  - 모든 p_(−n)이 (0, 1) 안이면 logit 척도 잭나이프를 씁니다.
  - 하나라도 경계면 p 척도에서 잭나이프 SE를 구하고 t_{N−1} 구간을 [0, 1]로 자릅니다.
  - N < 3이면 구간을 내지 않고 `ci_low = ci_high = null`, `ci_note = "insufficient_nights"`로 둡니다. 앱은 "구간 산출 불가(N밤)"로 표시합니다.
- 층화: 평일과 주말을 따로 계산합니다.
- 붓스트랩(R=2,000)은 중앙값, p90 같은 비평활 통계량에만 씁니다.
- 모의실험: 알려진 F에 밤 효과를 더한 가짜 밤 G ∈ {3, 4, 6, 12, 15}개로 잭나이프와 붓스트랩의 95% 포함률을 비교합니다. 코드 정확성은 루프 구현과 행렬 구현의 수치 일치로 따로 테스트합니다.

### 확증 세트와 주 평가지표

- **확증 세트**: 10/2 이후 수집분. 평일 4밤(10/2, 10/6, 10/7, 10/8), 주말·공휴일 4밤(10/3, 10/4, 10/5, 10/9). 제출일(10/11) 때문에 원래 계획한 6밤·6밤에서 줄었다
- **주 결과**: 확증 밤에 대한 LONO 예측으로 냅니다. 22밤 전체 결과는 보조입니다.
- **주 평가지표**를 10/1까지 문서로 고정합니다. 기본안은 "평일, 경합 구간, 주 라벨 Y, 1차 모형 대 logistic(B), 밤 균등 평균 ΔBrier"입니다.

### LONO 절차

```
for n in 라벨이 있는 모든 밤:
    train = 전체 밤 − {n}
    cells = fit_cells(events[night ∈ train])          # 병합·시간대 규칙을 fold 안에서 다시 판정
    p_model[c] = F_A(B_c)                             # 1차: 갈아탈 노선 지연 0
    p_conv[c]  = Σ_k F_A(B_c + d_k) · ΔF_Dep(d_k)     # 2차: P(A 지연 − D 지연 ≤ B)
    p_param[c] = F_A^param(B_c)
    p_tt[c]    = 1[B_c ≥ 0]                           # 기준선 1: 시간표 결정론
    p_clim     = 학습 밤 경합 구간 성공률              # 기준선 2: 기후값
    p_logit[c] = logistic(B) 적합 (학습 밤 Y)         # 주 비교 대상
    평가 ← y_events[night == n]
```

**누수 방지**
1. 밤 n의 지연 사건을 전부 학습에서 뺍니다.
2. 셀 병합과 시간대 판정은 fold마다 학습 밤만으로 다시 합니다. 규칙은 고정이고 결과만 fold별로 달라집니다. 병합 결과가 전체와 다른 fold 수를 보고합니다.
3. 경합 구간, TRUNC_W, 매칭 창, 보정 구간 수, c, 밤 포함 결정(추석·부분 수집 밤), 부분집합 목록은 10/2에 동결합니다. **확증 평가는 이 동결 설정만 씁니다.** 데이터로 고르는 값(셀 병합, 시간대 분리, 막차 대표성)은 각 fold의 학습 밤만으로 판정합니다.
4. 단위 테스트: 밤 n의 사건과 라벨을 교란해도 fold n의 예측이 바뀌지 않아야 합니다.

**두 가지 실행 모드** (`validate.py --mode confirm|final`)
- `confirm`: 확증 평가. 10/2 동결 설정 고정, 확증 밤을 LONO로 예측, 주 평가지표 산출. 보고서의 검증 절은 이 결과입니다.
- `final`: 최종 앱 수치. 22밤 전체로 재적합. 동결한 하이퍼파라미터는 그대로 두고, 데이터로 고르는 값만 22밤으로 다시 판정합니다. 10/2 판정과 달라진 항목은 그대로 보고합니다.

**비교 모형**
- p_tt는 0/1 예측이라 Brier가 오분류율과 같습니다. 이기는 것이 거의 자명하므로 주 비교 대상으로 쓰지 않습니다.
- **주 비교 대상은 logistic(B)**입니다. 노선 더미 없이 B만 쓰고, B ∈ [−300, 900]초 범위에서만 학습합니다. 벌점 C는 내부 LONO로 고릅니다. 전 범위에서 학습하면 완전분리 때문에 기울기가 왜곡됩니다.
- 모든 모형을 같은 (밤, 조합) 교집합에서 평가합니다.

**2차 컨볼루션**
- 9/30에 경합 구간 Y ≠ Y^arr 비율이 10% 이상이면 2차 모형을 주 모형으로 올립니다.
- 두 노선 지연의 의존성은 밤 평균을 뺀 Spearman ρ로 봅니다. A 지연 상위 25%일 때 D 지연의 조건부 분포도 비교합니다. 연계 대기가 있으면 독립 가정이 깨지므로 한계에 적습니다.

### 지표
- **Brier**: 밤 균등 평균. **ΔBrier**(모형 − 비교 모형)는 밤별 값의 대응 t 구간으로 냅니다. "비교 모형보다 낫다"는 구간 상한 < 0일 때만 씁니다.
- **보정 절편·기울기** (주 보정 지표): 이항 로지스틱 회귀 logit P(Y=1) = a + b · logit(p). y는 0/1이라 logit을 취할 수 없으므로 y를 종속변수로 두고 적합합니다. p는 [0.01, 0.99]로 잘라 넣습니다. p_tt는 0/1이라 이 적합에서 빼고 Brier로만 봅니다. 구간은 밤 잭나이프입니다. 잘 보정됐으면 a ≈ 0, b ≈ 1입니다.
- **신뢰도 도표**: 등빈도 5구간. 구간마다 n, 고유 조합 수, 밤 수를 표기합니다. 구간당 고유 조합 ≥ 10이고 유효 n ≥ 96일 때만 10구간으로 늘립니다. 한 조합이 여러 밤에 반복되고(조합 클러스터) 같은 밤이 여러 조합에 충격을 주는(밤 클러스터) 이중 구조라, 원자료 건수로 구간을 나누면 과신하게 되기 때문입니다.
- ECE는 소표본에서 위로 편향되므로 보조로만 둡니다. 로그손실은 p_tt가 0/1이라 쓰지 않습니다.
- **조합 단위 과산포**: 조합별 Σ(y − p)를 밤에 걸쳐 모아 Pearson χ²/df를 계산합니다. 크면 "역 단위 효과 미반영"을 한계 첫 항목으로 올립니다.
- **검출 가능한 최소 차이**: 8밤 드라이런에서 밤별 ΔBrier 표준편차 σ̂를 구합니다. α=0.05, 검정력 80% 기준으로 15밤이면 약 0.78σ̂, 확증 6밤이면 약 1.43σ̂입니다. 10/1 문서에 기록합니다.
- 밤별 ΔBrier를 날짜순으로 그립니다. LONO가 미래 밤으로 학습하는 문제를 눈으로 확인하기 위해서입니다.

**부분집합** (10/1에 고정)
- (i) 경합 구간 B ∈ [−120, 600]초 **평일, 주 라벨: 주 결과**
- (ii) 전체, (iii) 주말, (iv) 주 라벨 대 단측 확정 포함 대 보간 포함, (v) 정상 밤만, (vi) 추석 포함과 제외, (vii) 금요일·연휴 전날 제외(9/18, 9/23, 10/2, 10/8), (viii) w×{0.8, 1.2}, (ix) 출처 오프셋 보정, (x) `a_late_unseen`을 y=0으로

### 구현 단계
`validate.py` (신규): `night_ecdf_matrix`, `jackknife_p`, `bootstrap_quantiles`, `lono`, `fit_logit`, `metrics`, `calibration_fit`, `reliability_table`, `overdispersion`, `mde`, `simulate_coverage`
- `--mode confirm|final`(위 "두 가지 실행 모드"), `--dry-run`: 산출물에 "DRY RUN"을 표기합니다.
- `jackknife_p`의 간이판은 9/28 잠정 JSON에 쓰기 위해 먼저 만듭니다. 경계 처리 규칙까지 포함합니다.

### 산출물
- `data/processed/p_table.csv`: `combo_id, tt_tag, day_type, dist_key, p_success, ci_low, ci_high, ci_note, p_conv, ci_low_conv, ci_high_conv, n_delay_obs, n_nights`. `tt_tag`별로 행이 있고(DAY/SAT/END), SAT와 END는 같은 weekend 분포에 각자의 B를 넣은 값입니다.
- `output/validation/lono_predictions.csv`: `night, confirm_set, combo_id, y, y_arr, label_grade, contested, p_model, p_param, p_conv, p_tt, p_clim, p_logit`
- `output/validation/metrics.csv`: `subset, target, model, comparator, n_labels, n_combos, n_nights, brier, dbrier, dbrier_ci_low, dbrier_ci_high, calib_a, calib_b, ece`
- `output/validation/calibration_<subset>.png`, `coverage_sim.csv`, `mde.csv`, `overdispersion.csv`

### 완료 기준
1. 10/1까지 8밤 드라이런이 끝까지 돌고 실행 시간이 기록돼야 합니다.
2. 두 번 실행한 결과가 같아야 합니다.
3. 누수 테스트와 루프·행렬 수치 일치 테스트를 통과해야 합니다.
4. 모의실험 포함률 표가 G별·방법별로 나와야 합니다.
5. 주 평가지표와 부분집합 문서가 10/1까지 커밋돼야 합니다.

**소요와 담당**: Claude 5~6시간, 시원 3~4시간 설계 검토와 해석. 틀 9/30~10/1, 정식 실행 10/2 이후.

### 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 모형이 비교 모형보다 낫다는 결과가 나오지 않음 | 그대로 보고합니다. 보정 절편·기울기로 확률이 잘 맞는지를 서술합니다. 부분집합은 10/1에 고정했으므로 골라서 좋게 만들지 않습니다. |
| 확증 6밤으로는 검출력이 부족함 | 검출 가능한 최소 차이를 함께 보고합니다. "차이 없음"이 아니라 "이 크기 미만은 검출 불가"로 씁니다. |
| 주말 구간이 넓음 | 모의 포함률을 옆에 적고, 앱에 n_nights를 표시합니다. |

---

## 작업 7. station_alt.json 완성

**목표**: 역 좌표, 올빼미버스, 따릉이, 심야 인원 지표를 지금 완성합니다. 수집과 무관합니다.

**입력**
- 시간표 CSV의 `역사코드`, `station_master.json`의 `STATION_CD`, `station_coords.json`의 `BLDN_ID, LAT, LOT`
- `data/aux/CardBusTimeNew.jsonl`: `RTE_NO, TRFC_MNS_TYPE_CD, STOPS_ID`
- `busStopLocationXyInfo.jsonl`: `STOPS_NO, STOPS_NM, XCRD, YCRD`
- `tbCycleStationInfo.jsonl`: `RENT_ID, RENT_NM, STA_LAT, STA_LONG`
- `CardSubwayTime.jsonl`: `SBWY_ROUT_LN_NM, STTN, HR_{h}_GET_OFF_NOPE`

**구현 단계**: `build_station_alt.py` (신규)
- `station_list()`: `common.TRANSFER_STATIONS`(50개)를 씁니다.
- `station_coords()`: 시간표 `역사코드` = `STATION_CD` = `BLDN_ID`로 **코드 직접 결합**합니다. 458개 중 456개가 맞고, 빠진 둘(창동 1022, 까치산 0200)은 수동 보정합니다. 역명으로 결합하지 않습니다(양평은 53km 차이). 대표 좌표는 1~9호선 좌표 평균이고, 좌표 간 최대 거리 `coord_spread_m`을 기록합니다(서울역 1·4호선 382m, 전 역 최대 510m).
- `owl_stops()`: `TRFC_MNS_TYPE_CD == "051"`로 N노선 14개를 고르고, (RTE_NO, STOPS_ID) 쌍을 `STOPS_NO`로 좌표에 붙입니다(1,503개 중 1,479개). `998`로 시작하는 ID 17행은 제외합니다.
- `bike_stations()`: (0,0) 좌표 3행을 뺍니다. `bikeList`는 1,000행에서 잘려 있어 쓰지 않습니다.
- `nearest(points, cands, radius, k=3)`, `haversine_m()`
- `night_alight()`: `CardSubwayTime` 중복을 제거(621행)하고 23시·0시 하차 인원을 합칩니다. 1호선 코레일 구간 노선명(`경부선`·`경원선`·`경인선`), `총신대입구(이수)`/`이수` 분리, 2호선 까치산 누락을 역 단위 별칭으로 처리합니다.

**산출물**: `data/processed/station_alt_base.json`. export 단계에서 `worst_p`, `median_p`를 채워 `web/public/data/station_alt.json`으로 씁니다.
- `meta{generated_at, nights, commit, sources{bus_card: "202607", subway_card: "202607"}}`
- `stations[]`: `station, lines, lat, lon, coord_spread_m, night_alight, nearest_owl_m, nearest_bike_m, owl_bus[{stop_name, routes, distance_m, lat, lon}](500m, 최대 3), bike[{name, distance_m, lat, lon}](300m, 최대 3), worst_p, median_p`

**완료 기준**
1. 50개 역 전부 좌표가 있어야 합니다(결측 0).
2. 반경 안에 없으면 빈 배열로 두고 `nearest_*_m`을 채웁니다.
3. 50개 역 모두 `night_alight`가 채워지거나, 못 채운 역이 사유와 함께 목록으로 나와야 합니다.
4. 팀원이 지도 서비스로 5개 역을 대조합니다. 기준점은 역 중심(대표 좌표)이고, 좌표와 가장 가까운 정류장 거리 오차가 100m 미만이어야 합니다.

**소요와 담당**: Claude 3시간, 팀원 1시간(대조). 9/27~9/28.

**리스크와 대응**

| 리스크 | 대응 |
|---|---|
| 생활이동은 도착 행정동 기준이고 행정동 경계 파일이 없음 | 인원 지표 기본값은 `night_alight`입니다. 생활이동은 경계 GeoJSON을 확보했을 때 보고서 보조 지표로만 씁니다. |
| 올빼미버스 데이터에 정류장 순서·방향·시각·배차가 없음 | "근처에 N버스 정류장이 있다" 수준까지만 표시하고, 앱 문구에 "정류장 위치만 제공"이라고 적습니다. |
| 7월 승하차 기록 기반이라 기록 없는 정류장이 빠짐 | 한계에 적습니다. |

---

## 작업 8. web/ 뼈대와 URL 확보

**목표**: 9/28까지 Vercel URL에서 탭 1·2가 잠정 JSON으로 동작하게 합니다.

**입력**: `last_train_pairs.csv`, `delay_cells.csv`, `delay_grid.csv`(quick), `p_table.csv`(간이), `station_alt_base.json`

**구현 단계**

1단계, `export_for_app.py` (신규)
- `build_prob_table()`: 프로토타입 스펙을 따르되 `margin_*` 대신 `buffer_*`, `p_timetable = 1[buffer_sec ≥ 0]`, `a_dest`·`d_dest` 추가, 시각은 `"24:48"`과 `*_sec`를 둘 다 둡니다.
- `build_delay_cdf()`, `build_station_alt()`
- `validate_json()`: 실패하면 exit 1. `dist_key`가 `delay_cdf`에 있는지, `station`이 `station_alt`에 있는지, cdf 단조 증가, p가 있으면 0 ≤ ci_low ≤ p ≤ ci_high ≤ 1인지 봅니다. `p_success=null`은 허용합니다.
- `meta`: `generated_at, nights{weekday, weekend, list}, commit, provisional, ci_method`
- `verdict`는 JSON에 넣지 않고 앱의 `config.js` 임계값으로 계산합니다. 팀원이 파이썬 없이 임계값을 바꿀 수 있게 하려는 것입니다.

2단계, `web/` (신규, Vite + React JS)
- Vite 템플릿으로 만들고 recharts, tailwindcss(`@tailwindcss/vite`)를 설치합니다. 비대화형으로 실행되도록 옵션을 확인합니다. Node v24, npm 11 설치를 확인했습니다.
- 파일
  - `src/config.js`: 임계값 0.8/0.5와 문구. 팀원이 고치는 곳입니다.
  - `src/data.js`: JSON 로드와 조회
  - `src/App.jsx`: 탭 구성
  - `src/tabs/ProbabilityTab.jsx`, `src/tabs/MapTab.jsx`
  - `src/components/CdfChart.jsx`: Recharts 선 그래프에 B 위치 기준선
  - `src/components/ResultCard.jsx`: 확률, 구간, 시간표 대비, 판정
  - `src/components/AltList.jsx`
- 탭 1 입력: 환승역 → 타고 온 노선 → 갈아탈 노선 → **요일 유형(평일 / 토요일 / 일요일·공휴일)** → 방면(행선명). 방면이 없으면 같은 입력에 최대 4행이 붙습니다. 요일 유형은 `tt_tag`로 막차 시각·B를 고르고, 지연 분포는 토요일과 일요일·공휴일이 같은 weekend 분포를 씁니다. 화면에 "지연 분포는 주말 전체 기준"이라고 적습니다.
- `prob_table.json`의 `rows`는 `tt_tag`를 포함하고, `validate_json`은 (combo, tt_tag) 중복이 없는지 확인합니다.
- 탭 2: 9/28에는 SVG 산점도입니다. 색은 `worst_p`, 크기는 `night_alight`입니다. MapLibre는 10/2~10/6에 여유가 있으면 바꿉니다.

3단계, Vercel
- 계정 연결과 GitHub 권한 부여는 시원이 직접 합니다.
- Root Directory `web`, Framework Vite, Build `npm run build`, Output `dist`
- Ignored Build Step으로 `web/` 밖 변경(매일 밤 수집 커밋)에는 빌드하지 않게 합니다. 연결 후 한 번 동작을 확인합니다.

**산출물**: `web/` 소스, `web/public/data/{prob_table,delay_cdf,station_alt}.json`, Vercel URL. `replay_YYYYMMDD.json`은 탭 3을 결정한 뒤 만듭니다.

**완료 기준**
1. 9/28까지 URL에서, 폭 375px와 데스크톱 모두 다음이 돼야 합니다. 탭 1에서 조합을 골라 확률(또는 "잠정 미산출")과 시간표 여유, 분포 그래프가 뜨고, 탭 2에서 50개 역이 찍혀야 합니다.
2. `validate_json`을 통과하고, 팀원이 데모 시나리오 5개를 수동으로 확인합니다.
3. `public/data` 합계 1MB 이하(목표치)
4. `meta.provisional=true`가 화면에 "잠정(N밤 기준)"으로 보여야 합니다.
5. `web/`에 비밀값이 0개여야 합니다.

**소요와 담당**: Claude 5~6시간, 시원 1시간(Vercel 연결), 팀원(문구, 시나리오 초안). 9/27~9/28.

**리스크와 대응**

| 리스크 | 대응 |
|---|---|
| 9/28까지 4 quick이 끝나지 않음 | `p_success=null`, `p_timetable`만 표시하는 JSON으로 URL부터 확보합니다. |
| Vercel 빌드 실패 | `package.json`에 `engines`를 지정하고, 로컬 `npm run build`를 통과한 뒤 push합니다. |

---

## 작업 9. 보고서 초안 (방법론, 데이터, 한계)

**목표**: 세 절 초안을 10/6까지 씁니다. 결과 절은 자리표시자로 틀만 잡습니다. 10/10 최종 실행 이후에는 숫자를 손으로 옮기지 않습니다.

**입력**: 이 계획서의 정의, `night_status.csv`, `night_qa.csv`, `tt_fit.csv`, `y_counts.csv`, `y_assumptions.csv`, `band_test.csv`, `metrics.csv`, `프로젝트_방향_결정.md` 2장

**구현 단계**
- `report/draft.md` (신규). 제출 형식을 모르므로 마크다운으로 씁니다. **저장소가 공개라 제출 전에 공개됩니다.** 대회 규정을 확인하고, 문제가 되면 저장소 밖에 둡니다.
- 데이터 절: 수집 설계, 확보 현황(밤 상태, 유실, 부분 수집, 추석 특별 시간표), 전처리 규칙(기존 5개 + 신규: 시간표 행 단위 첫 스탬프, 매칭 창, 관측 창 절단, 미래 시각 제거, 시간표 적합 판정), 확보율
- 방법론 절: B, Y, F 정의(부등호 규약), 라벨 등급, 셀과 병합 규칙, 1차·2차 모형, ECDF와 모수 적합, 밤 잭나이프, 확증 세트, LONO와 누수 방지, 지표와 비교 모형
- 한계 절: 역 단위 추정 불가, 막차 셀 표본이 가장 적음, 주말 밤 수와 구간 포함률, 도보시간 환산값, 행선 무시, 두 노선 지연 독립 가정, 출발 관측 보완 가정, 길이 편향, 출처 간 오프셋, 4주 단일 계절, 이상상황 플래그 한계, 강수를 넣지 않은 이유(22밤 중 비 온 밤으로는 추정 불가), 환승 소요시간 자료가 없는 코레일 쪽 환승역 2개(노량진, 금정) 제외. 석계는 자료에 `경원선`으로 들어 있어 포함, 운영 주체 혼재(1·3·4호선 코레일 구간)
- `fill_report.py` (신규, 약 20줄): `{{key}}` 자리표시자를 산출 CSV 값으로 치환해 `report/draft_filled.md`를 만듭니다.

**완료 기준**
1. 세 절 초안이 10/6까지 나와야 합니다.
2. `fill_report.py`가 본문에서 자리표시자 밖 숫자를 찾아 목록으로 출력합니다. 목록의 모든 숫자에 출처 주석이 달려 있어야 합니다.
3. 팀원 1명이 초안만 읽고 B, Y, P(성공) 정의를 다시 설명할 수 있어야 합니다.

**소요와 담당**: 시원 6~8시간(집필), Claude 3시간(방법론 초고, 표), 팀원 2시간(교정, 그림). 10/3~10/6.

---

## 10/2 체크포인트 결정 목록

진행 순서
1. 15밤 전체 파이프라인 실행
2. 아래 표를 코드가 자동 판정(1~3, 9~11)하고 사람이 확인
3. 파라미터 동결 태그 `checkpoint-1002`
4. JSON 교체(provisional 유지)
5. 팀 회의(12~16)

| # | 결정 항목 | 판단 기준 | 기본값 |
|---|---|---|---|
| 1 | 시간대 분리(노선별) | 작업 4: 경합 구간 sup 차이 > 0.05 **그리고** 부호검정 p < 0.05 | 분리 조건을 못 채우면 병합. 주말은 평일 결정을 따름 |
| 2 | 추석 연휴 포함 | 5-4: `tt_unknown` 자동 제외, 나머지는 무작위 대조 | 정상 노선 포함, 추석 제외는 필수 민감도 |
| 3 | 부분 수집 밤(9/18, 9/21) | 5-3: 무작위 대조 | 포함하고 민감도 분석 |
| 4 | 라벨 등급 | 3b 가정 검증 | 주 라벨 = 직접 관측(`main`)만. 단측 확정과 보간 포함은 민감도 |
| 5 | 경합 구간 | 라벨 수와 B 분포 | [−120, 600]초 |
| 6 | 신뢰도 도표 구간 수 | 구간당 고유 조합 ≥ 10이고 유효 n ≥ 96 | 5구간 |
| 7 | 앱 주 확률(1차 대 2차) | 9/30 경합 구간 Y ≠ Y^arr 비율 ≥ 10%, 또는 ΔBrier(2차 − 1차) 구간 상한 < 0 | 1차를 주로, 2차 병기 |
| 8 | ECDF 대 모수 | 경합 구간 가중 CRPS | ECDF 주, thin 셀만 모수 |
| 9 | 동결 파라미터 | 작업 4 `oow_pos_ratio` | TRUNC_W = 평일 p99 올림, 매칭 창 (−600, +1800)(1% 초과 셀 있으면 상한 3600), seed 20260916, c = 180 |
| 10 | 9호선 급행 분리 | 5-1 | 분리 안 함 |
| 11 | 셀 정의(전 역 풀링 대 막차 k편) | 5-8, 막차 대표성 점검 | 전 역 풀링 유지 |
| 12 | 판정 임계값 | 팀 결정 | 0.8 / 0.5, 점추정 기준(구간은 표시만) |
| 13 | 탭 1 방면 선택 | 팀 결정 | 추가 |
| 14 | 인원 지표 | 팀 결정 | `night_alight` |
| 15 | 탭 3 포함 | 10/6에 탭 1·2 완료 여부 | 제외 |
| 16 | 강수 | 어떤 밤의 전 노선 지연 중앙값이 다른 밤보다 60초 넘게 높을 때만 그날 날씨 확인 | 넣지 않음 |

10/1까지 미리 고정할 것: 주 평가지표, 부분집합 목록, 작업 2의 품질 기준치, 검출 가능한 최소 차이.

**동결 범위.** 위 표의 1~11번은 10/2 판정 결과가 확증 평가(`--mode confirm`)에 그대로 고정됩니다. 최종 앱 수치(`--mode final`)에서는 1·8·11번처럼 데이터로 고르는 항목만 22밤으로 다시 판정하고, 나머지 값(경합 구간, TRUNC_W, 매칭 창, c, 구간 수, 밤 포함 결정)은 바꾸지 않습니다.

---

## 작업 10. 귀가 확률 양극화 대응 (웹앱 UI, 10/9 동결 전)

### 문제
앱을 아무 때나 열면 "귀가 확률 >99%" 아니면 "오늘 밤 지하철로는 집에 갈 수 없어요" 두 가지가 거의 다 나옵니다. 앱의 핵심 정보인 "몇 시까지 나가야 하는지", "막차는 얼마나 위험한지"가 드러나지 않습니다.

### 원인 (실측, 2026-10-06, 평일, 무작위 출발역·집·출발 시각 22:00~01:30, `web/public/data` 현재본)
| 대표 여정(지금 출발) 결과 | 비율 (2,994건) |
|---|---|
| ≥99% | 45.8% |
| 90~99% | 1.9% |
| 50~90% | 0.6% |
| <50% | 0.0% |
| 경로 없음 | 51.7% |

- **모형 오류가 아니라 구조입니다.** 막차 전에는 환승을 놓쳐도 다음 열차로 집에 갈 수 있어서, 재탐색까지 넣은 귀가 확률이 1에 가깝습니다. 확률이 떨어지는 건 마지막 연결 한 편뿐이고, 99% 아래로 내려간 뒤 경로 없음이 되기까지의 구간 폭은 중앙값 0분입니다. B 보고서의 결론("위험은 마지막 연결에 몰려 있다")과 같은 현상입니다.
- **정보는 이미 엔진 결과 안에 있습니다** (600건 추가 실측).
  - 경로가 있는 311건 가운데, 맨 마지막 출발 안(막차)의 귀가 확률이 <99%인 경우는 138건(44%), <90%인 경우는 40건(13%)입니다.
  - 지금 출발하면 ≥99%인데 막차는 <90%인 경우가 36건입니다. 지금은 이 차이가 첫 화면에 안 보입니다.
  - 경로 없음 288건 중 286건은 21:00부터 다시 계산하면 그날 마지막으로 탈 수 있었던 열차가 나옵니다.
  - 그 재계산에 걸리는 시간은 Node 기준 중앙값 48ms, 90번째 백분위 93ms입니다. 평소 계산은 중앙값 1ms입니다.

### 원칙
- 확률 모형(B), 경로 엔진 선택 규칙, 판정 임계값(`THRESHOLDS`)은 바꾸지 않습니다. 숫자를 억지로 퍼지게 만들지 않고, 이미 계산한 값 중 지금 보이지 않는 것을 꺼내 보여 줍니다.
- 바꾸는 범위는 `web/src`의 화면 코드와 `plan.js` 밖의 보조 함수만입니다. `check_route.py`와의 일치 검증 대상인 `planTrip` 결과는 그대로 둡니다.

### 변경 (추천 순서대로, 10-1과 10-2가 핵심)
| # | 화면 | 지금 | 바꾼 뒤 | 쓰는 값 |
|---|---|---|---|---|
| 10-1 | 요약 카드(`SummaryCard`), 경로 있음 | 귀가 확률 큰 숫자 + 출발 마감 큰 숫자 | 그대로 두고, 확률 막대 아래에 **막차 줄**을 추가합니다. 예: "막차 00:27 출발 · 귀가 확률 30%". 판정 색을 쓰고, 고른 여정이 막차면 숨깁니다 | `plan.leave_by.last` (이미 `depart_sec`, `p_home` 있음) |
| 10-2 | 요약 카드, 경로 없음 | "오늘 밤 지하철로는 집에 갈 수 없어요" + 대안 보기 | **"오늘 마지막 기회는 00:27 출발이었어요 · 귀가 확률 30%"**를 큰 글씨로 보여 주고, N버스·따릉이 안내는 그대로 둡니다. 운행 종료 문구(`serviceEnd`)도 유지합니다 | 경로 없음일 때만 `planTrip(nowSec = 21:00)`을 한 번 더 돌려 `leave_by.last`를 씁니다. 같은 걸음·여유 설정을 쓰고 `useMemo`로 캐시합니다 |
| 10-3 | 추천 출발 띠(`DepartureStrip`) | 접힌 상태에서는 고른 출발 주변 3장만 보여, 막차 카드가 가려지는 경우가 있음 | 접힌 상태에서도 **지금 / 마감 / 막차** 세 장을 고정해서 보여 줍니다. 겹치면 하나로 합칩니다 | `plan.options`, `leave_by` |
| 10-4 | 방법 화면(`MethodScreen`) | 설명 없음 | 한 단락을 추가합니다: "막차 전에는 놓쳐도 다음 열차가 있어 대부분 >99%이고, 위험은 마지막 연결에 몰려 있어요" | 위 실측 수치 |

하지 않는 것: 출발 시각별 확률 곡선(차트)은 띠 카드로 대신합니다. 막차 근처 몇 분만 값이 변해서 곡선이 대부분 평평하기 때문입니다. 판정 기준을 대표 여정에서 막차로 바꾸는 것도 하지 않습니다. 지금 출발하는 사람에게 틀린 경고가 됩니다.

### 일정과 완료 기준
| 시점 | 할 일 | 확인 |
|---|---|---|
| 10/7 | 10-1, 10-2 구현, 보조 함수 테스트 추가(`npm test` 전부 통과) | 프리셋 3개는 숫자가 그대로이고, 막차 줄이 맞게 나옴 |
| 10/8 | 10-3, 10-4 구현. Playwright로 화면을 찍어 확인: >99%이면서 막차 <90%인 경우 1건, 경로 없음 1건, 프리셋 3개, 모바일 375px | 겹침·잘림 없음, 콘솔 에러 0 |
| 10/8 | 커밋·푸시 → Vercel 배포 확인 | 배포 사이트에서 위와 같게 나옴 |
| 10/9 | 코드 동결(`freeze-1009`)에 포함 | — |

### 리스크
- **휴대폰에서 재계산이 느릴 수 있습니다.** Node 기준 90번째 백분위가 93ms이고, 휴대폰은 3~5배 느릴 수 있습니다(추정). 경로 없음일 때만 돌리고 캐시하며, 계산하는 동안은 기존 문구를 먼저 보여 줍니다.
- **"마지막 기회" 문구를 떠난 열차를 탈 수 있다는 뜻으로 오해할 수 있습니다.** 그래서 과거형("…출발이었어요")과 "N분 전에 떠났어요"를 함께 씁니다.
- **10/10 최종 데이터로 위 비율이 바뀔 수 있습니다.** 화면 로직은 비율에 의존하지 않습니다. 방법 화면의 수치만 10/10에 다시 확인합니다.

---

## 10/9 이후 남는 일

| 시점 | 할 일 | 담당 | 확인 |
|---|---|---|---|
| 10/9 | 코드 동결 태그 `freeze-1009`, `run_pipeline.py` 완주, 소요 시간 측정 | 시원 | 완주, 소요 30분 이하(목표) |
| 10/10 02:00 이후 낮 | ① `git pull`(10/9 밤 수집분 확인) ② **Actions 수집 예약 해제** ③ `python run_pipeline.py --force`(22밤, `validate.py`는 confirm과 final 두 모드 모두 실행) ④ `night_qa`로 확증 밤 상태 확인 ⑤ `web/public/data` 커밋과 Vercel 확인 ⑥ `python fill_report.py` ⑦ `fetch_notice.py` 재수집 | 시원 | 각 단계 exit 0 |
| 10/10 | 드라이런(10/4) 대 최종 비교: 조합별 \|Δp\| 최댓값, 지표 변화 | 시원 | \|Δp\| > 0.1인 조합이 있으면 원인 점검 |
| 10/11 오전 | 해석 문장 검토(수치 방향이 바뀐 곳만), 발표 자료 수치 갱신, 제출 | 시원, 팀원 | — |

**"파이프라인 먼저 완성" 원칙의 검증 기준**
1. 10/10 최종 실행에 코드 커밋이 없어야 합니다. `git diff freeze-1009 -- "*.py" web/src`가 비어 있어야 합니다. 버그 수정이 불가피하면 사유를 커밋 메시지에 남기고, 동결 전후 결과를 둘 다 기록합니다.
2. 사람 손이 가는 단계는 해석 문장과 발표뿐이어야 합니다. 숫자 이동은 `export_for_app.py`와 `fill_report.py`가 맡습니다.
3. 확증 평가 결과는 10/2 동결 설정과 확증 밤으로 확정됩니다(확증 밤이 모두 들어온 뒤의 첫 실행이 곧 최종). 최종 앱 수치는 22밤 재적합(`final` 모드)이고, 데이터로 고르는 항목의 판정이 10/2와 달라지면 달라진 대로 보고서에 적습니다. 규칙과 동결 값은 바꾸지 않습니다.

---

## 미해결 항목

| 항목 | 현재 상태 | 확인 방법 | 담당·기한 |
|---|---|---|---|
| 추석 특별 시간표 | 9/24 밤 2·5·6·7·8호선 불일치 확인. 9/25·9/26은 미확인 | 작업 1 `tt_fit` | Claude, 9/27 |
| 9호선 토요일 시간표(CSV 대 API) | 94.5% 행에서 시각이 다름 | 9/19 밤 지연 중앙값(5-9) | Claude, 9/30 |
| 9호선 `updnLine` 대응 | 조사마다 반대 | 작업 1 교차표. 방향은 시간표에서 가져오므로 결과 영향 없음 | Claude, 9/27 |
| 전역출발 = 이전 역 출발인지 | 추정 | `y_assumptions.csv` | Claude, 9/30 |
| 막차 연계 대기 크기 | 추정 | 막차 정차 연장 분포 | Claude, 9/30 |
| 3호선 3802~3983이 회송인지 | 추정. 시간표와 위치 API에 없음은 확인 | 제외 건수만 기록 | — |
| 1·4호선 결손 원인 | 코레일 미수록 가설 약화 | 5-2 | 시원, 10/5 |
| 위치 API 공백 원인과 재발 | 8밤 중 2밤, 원인 미확인 | 매일 `night_qa` | 시원, 상시 |
| 예약 8개 전환 효과 | 9/25 전환, 미확인 | 매일 `first_tick` | 시원, 상시 |
| `getNtceList` 1,000건 상한 | 추정 | 5-6 | 시원, 9/30 |
| 활용사례 등록(호출 한도 해제) | 진행 상태 불명 | 시원 확인 | 시원, 9/28 |
| 생활이동 `move_purpose=3`의 의미 | 미검증 | 생활이동을 쓰지 않으면 불필요 | — |

## 의사결정 필요 항목 (10/2 표 외)

| 항목 | 선택지 (추천 먼저) | 결정 주체·기한 |
|---|---|---|
| 최종 제출일, 형식, 분량 | 문서에 없음. 대회 요강 확인 | 팀, 9/28 |
| 보고서 공개 여부 | (추천) 대회 규정 확인 전까지 `report/`를 저장소 밖에 둠 / 저장소에 둠 | 시원, 10/3 전 |
| 분석 범위: 코레일 연장 구간 | **결정: 포함(현상 유지).** 공식 CSV와 실시간 API가 이미 코레일 구간을 담고 있어 따로 넣거나 뺄 작업이 없음. 조합은 환승역 기준이라 외곽 역은 자동으로 빠지고, 코레일 쪽 환승역 6개(가산디지털단지, 도봉산, 신길, 신도림, 온수, 창동)는 자동으로 들어감. 1호선 지연 분포가 외곽 코레일 역에 끌려가는지는 5-8의 전 역 대 환승역 비교로 확인 | 시원, 9/27 결정 |
| 분석 라이브러리 | (추천) `python -m pip install scikit-learn` / numpy로 직접 구현 | 시원 승인, 9/29 전 |
| verdict 계산 위치 | (추천) 앱 `config.js` / JSON | 시원, 9/27 |
| 인원 필드 | (추천) `night_alight` / 생활이동 + 외부 행정동 경계 | 팀, 9/28 |
| 행선(단축 운행) | (추천) 판정에는 무시하고 `d_dest` 표시 / 목적지 입력 추가 | 팀, 10/2 |
| 검토에서 반영하지 않은 것 | 베이지안 계층 모형: 일정과 설명 비용 때문에 제외. 붓스트랩: 비평활 통계량에만 남김 | — |

## 외부 모델 리뷰(gpt-6-astra) 반영 내역

| 지적 | 판정 | 반영 위치 |
|---|---|---|
| "도착 + 시간표 정차"는 출발의 하한이 아님 | 맞음 | 작업 3 `arr_bound`: 하한을 도착 관측 자체로 바꿈 |
| 매칭된 사건만 넘기면 창 밖 막차를 찾을 수 없음 | 맞음 | 작업 1 `stamps_*.csv` 신설, 작업 3b 입력 변경 |
| 10/2 동결과 22밤 재판정이 충돌 | 맞음 | 작업 6 `confirm`/`final` 모드 분리, 동결 범위 명시 |
| 잭나이프 LOO 추정치가 0/1이면 logit 불가 | 맞음 | 작업 6 경계 처리 규칙 추가 |
| `logit y`는 이진 라벨에 정의되지 않음 | 맞음 | 보정 지표를 이항 로지스틱 회귀로 명시, p 클리핑 |
| 토요일 사용자가 END 막차 시각을 받음 | 맞음 | 3a·8: `tt_tag` 세 벌 모두 제공, 요일 유형 3단계 |
| (리뷰 밖, 자체 추가) 단측 확정 라벨은 성공만 확정돼 편향 | — | `one_sided` 등급을 주 라벨에서 제외, 민감도로만 |
