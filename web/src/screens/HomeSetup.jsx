import Icon from "../components/Icon";
import StationPicker from "../components/StationPicker";
import { DEMO_PRESETS } from "../config";
import { TONE } from "../format";

// 화면 0. 집 역 등록 (첫 방문 한 번). 집은 역으로만 받는다 — 주소는 지오코딩·도보 계산이 더 필요하고 확률과 무관.
// onPreset: 시연 프리셋 열기(집을 등록하지 않아도 시연 경로를 바로 볼 수 있게)
// 모양: 파랑 그라데이션 헤더 + 그 아래로 겹쳐 올라온 흰 검색 카드(역 목록 포함). 넓은 화면에서는 가운데 폰 크기 카드로 띄운다.
export default function HomeSetup({ data, onPick, onPreset }) {
  return (
    <div className="min-h-dvh bg-canvas md:flex md:items-center md:justify-center md:bg-page md:py-8">
      <div className="mx-auto flex h-dvh max-w-md flex-col bg-canvas md:h-[min(860px,calc(100dvh-64px))] md:w-full md:overflow-hidden md:rounded-[32px] md:shadow-[0_20px_60px_rgb(21_101_192/0.18)]">
        {/* 헤더 글씨는 붓질이 진한 왼쪽에 둔다(오른쪽 연하늘 위 흰 글씨는 대비 부족). 설명 문장은 흰 카드 안으로 */}
        <header className="brand-header shrink-0 rounded-b-[32px] px-5 pt-[max(env(safe-area-inset-top),16px)] pb-16">
          <span className="header-pill inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold">
            <Icon name="train" className="h-4 w-4" /> 막차될까
          </span>
          <h1 className="mt-5 text-[27px] leading-snug font-extrabold [text-shadow:0_1px_3px_rgb(21_101_192/0.45)]">
            집이 어느 역
            <br />
            근처인가요?
          </h1>
        </header>
        <div className="card-shadow relative mx-4 -mt-11 flex min-h-0 flex-1 flex-col rounded-3xl bg-surface p-4 pb-2">
          <p className="mb-3 px-1 text-[14px] leading-relaxed text-muted">
            한 번만 정해 두면, 오늘 밤 집에 갈 확률과 몇 시까지 타야 하는지 바로 알려 드려요.
          </p>
          <StationPicker data={data} onPick={onPick} placeholder="집 근처 역 이름" autoFocus />
        </div>
        {/* 375px에서 세 번째(거의 불가) 칩이 화면 밖에 숨지 않게 줄을 넘긴다 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3" aria-label="시연 프리셋">
          <span className="shrink-0 text-[13px] font-semibold text-muted">시연</span>
          {DEMO_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p)}
              className="card-shadow flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-semibold text-text"
            >
              <span className={`h-2 w-2 rounded-full ${TONE[p.tone].bg}`} aria-hidden />
              <span className={TONE[p.tone].text}>{p.label}</span>
              <span className="text-muted">{p.from}→{p.home} {p.t}</span>
            </button>
          ))}
        </div>
        <p className="flex items-center justify-center gap-1.5 py-4 pb-[max(env(safe-area-inset-bottom),16px)] text-[13px] text-muted">
          <Icon name="lock" className="h-4 w-4" />
          브라우저에만 저장되고 서버로 보내지 않습니다.
        </p>
      </div>
    </div>
  );
}
