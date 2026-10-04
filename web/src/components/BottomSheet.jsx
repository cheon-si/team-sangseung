import { useEffect, useLayoutEffect, useRef, useState } from "react";

const ORDER = ["peek", "mid", "full"];
const HANDLE_H = 28; // 손잡이 영역 높이
const TOP_GAP = 68; // 전체 단계에서도 상단 칩이 보이도록 남기는 높이
const FLICK = 0.5; // 이 속도(px/ms)보다 빠르게 튕기면 그 방향 다음 단계로

// 끌어서 높이를 바꾸는 하단 시트(모바일). 3단: peek(요약) / mid(중간) / full(전체).
// pointer 이벤트 하나로 터치·마우스를 함께 처리한다. 요약 단계 높이는 summary 내용 높이를 재서 맞춘다.
// peek·mid 에서는 세로로 끄는 동작이 모두 시트 이동이고(가로 스크롤 띠는 그대로 동작), full 에서는 본문이 스크롤된다.
export default function BottomSheet({ snap, onSnapChange, summary, children, onLayout }) {
  const bodyRef = useRef(null);
  const summaryRef = useRef(null);
  const suppressClick = useRef(false);
  const wheelAt = useRef(0);
  const [vh, setVh] = useState(() => window.innerHeight);
  const [summaryH, setSummaryH] = useState(null); // 처음 재기 전에는 애니메이션 없이 자리만 잡는다
  const [dragH, setDragH] = useState(null);
  const [settled, setSettled] = useState(false); // 첫 측정이 화면에 반영된 뒤부터 높이 변화를 애니메이션

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const el = summaryRef.current;
    setSummaryH(el.offsetHeight);
    const ro = new ResizeObserver(() => setSummaryH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (summaryH == null || settled) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [summaryH, settled]);

  const full = vh - TOP_GAP;
  const peek = Math.min(HANDLE_H + (summaryH ?? 240), full);
  const mid = Math.min(Math.max(Math.round(vh * 0.62), peek + 150), full);
  const heights = { peek, mid, full };
  const height = dragH ?? heights[snap];

  useEffect(() => {
    onLayout?.({ peek, height: heights[snap] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek, heights[snap]]);

  // full 에서 내려오면 요약이 다시 보이도록 스크롤을 맨 위로
  useEffect(() => {
    if (snap !== "full" && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [snap]);

  // 끄는 동안의 move/up 은 window 에서 받는다. 손가락·마우스가 시트 밖으로 나가도 끊기지 않게 하려는 것으로,
  // setPointerCapture 를 쓰면 click 대상이 시트로 바뀌어 안쪽 버튼이 눌리지 않을 수 있어 피했다.
  function onPointerDown(e) {
    if (e.button !== 0) return;
    // full 에서는 손잡이에서만 끈다(본문은 스크롤)
    if (snap === "full" && !e.target.closest("[data-drag-handle]")) return;
    const d = { y0: e.clientY, h0: heights[snap], moved: false, prevY: e.clientY, prevT: performance.now(), v: 0 };

    const onMove = (ev) => {
      const dy = ev.clientY - d.y0;
      if (!d.moved) {
        if (Math.abs(dy) < 6) return; // 탭과 구분
        d.moved = true;
      }
      // 속도는 마지막 이동 구간으로 잰다(+: 아래로, px/ms)
      const now = performance.now();
      d.v = (ev.clientY - d.prevY) / Math.max(1, now - d.prevT);
      d.prevY = ev.clientY;
      d.prevT = now;
      setDragH(Math.max(peek * 0.7, Math.min(full, d.h0 - dy)));
    };
    const onUp = (ev) => {
      cleanup();
      if (!d.moved) return;
      const h = d.h0 - (ev.clientY - d.y0);
      let next;
      if (d.v < -FLICK) next = ORDER.find((s) => heights[s] > h + 8) ?? "full";
      else if (d.v > FLICK) next = [...ORDER].reverse().find((s) => heights[s] < h - 8) ?? "peek";
      else next = ORDER.reduce((a, b) => (Math.abs(heights[b] - h) < Math.abs(heights[a] - h) ? b : a));
      setDragH(null);
      onSnapChange(next);
      // 끌고 난 직후의 click 이 버튼을 누르지 않게 한 번 막는다
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    };
    const onCancel = () => {
      cleanup();
      setDragH(null);
    };
    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  // 마우스 휠: 접힌 상태에서 아래로 굴리면 한 단계 펼친다
  function onWheel(e) {
    if (snap === "full" || e.deltaY <= 10) return;
    const now = performance.now();
    if (now - wheelAt.current < 450) return;
    wheelAt.current = now;
    onSnapChange(snap === "peek" ? "mid" : "full");
  }

  const cycle = () => onSnapChange(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]);

  return (
    <section
      aria-label="귀가 경로 요약"
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[28px] border-t border-night-600 bg-night-900 shadow-[0_-12px_40px_rgb(6_12_27/0.45)]"
      style={{
        height: full,
        transform: `translateY(${full - height}px)`,
        transition: dragH == null && settled ? "transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
        touchAction: snap === "full" ? "auto" : "pan-x",
      }}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <button
        type="button"
        data-drag-handle
        onClick={cycle}
        aria-label={`시트 높이 바꾸기 (지금 ${{ peek: "요약", mid: "중간", full: "전체" }[snap]})`}
        className="flex w-full shrink-0 touch-none items-center justify-center rounded-t-[28px]"
        style={{ height: HANDLE_H }}
      >
        <span className="h-1.5 w-10 rounded-full bg-night-500" />
      </button>
      <div
        ref={bodyRef}
        className={`dark-scroll min-h-0 flex-1 overscroll-contain ${snap === "full" ? "overflow-y-auto" : "overflow-hidden"}`}
        onFocus={(e) => {
          // 키보드로 접힌 아래쪽 내용에 들어오면 전체로 펼친다(숨은 영역이 스크롤되어 요약이 가려지지 않게)
          if (snap !== "full" && !summaryRef.current.contains(e.target) && e.target.matches?.(":focus-visible")) onSnapChange("full");
        }}
      >
        <div ref={summaryRef}>{summary}</div>
        {children}
      </div>
    </section>
  );
}
