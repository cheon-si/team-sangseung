import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

// 바텀시트 모달 (모바일은 아래에서 올라오고, 넓은 화면은 가운데 카드). 닫기 버튼·Esc·바깥 누르면 닫힌다.
// 포커스는 모달 안에서만 돌고(Tab·Shift+Tab), 닫으면 모달을 연 버튼으로 돌아간다.
export default function Modal({ onClose, labelledBy, children, tall = false }) {
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current();
      else if (e.key === "Tab") trapFocus(e, boxRef.current);
    };
    window.addEventListener("keydown", onKey);
    boxRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  // z-[80]: 위험한 환승역 화면(z-60)·하단 탭바(z-65) 위에 뜬다
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        className="modal-fade absolute inset-0 cursor-default bg-[#1d3a5f]/40"
        onClick={onClose}
      />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`modal-in relative flex w-full flex-col overflow-hidden rounded-t-3xl border-t border-line bg-surface pt-1.5 pb-[env(safe-area-inset-bottom)] text-text shadow-2xl outline-none md:max-w-md md:rounded-3xl md:border ${
          tall ? "h-[86dvh] md:h-[680px]" : "max-h-[88dvh]"
        }`}
      >
        <div className="flex shrink-0 justify-end px-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-canvas hover:text-text"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="soft-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// Tab 이 모달 밖(배경의 버튼·지도)으로 나가지 않게 처음·끝에서 반대쪽으로 돌린다
function trapFocus(e, box) {
  if (!box) return;
  const items = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items.at(-1);
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === box || !box.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !box.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
