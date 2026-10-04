// 카카오맵 JavaScript SDK 로더 (계약 4장). 키는 web/.env.local 의 VITE_KAKAO_JS_KEY — 코드에 쓰지 않는다.
// JavaScript 키는 브라우저에 노출되는 것이 전제이고, 카카오 개발자 콘솔의 사이트 도메인 등록으로 사용처를 제한한다.
// 한 번만 불러오도록 Promise 를 모듈에 보관한다. 실패는 보관하지 않고 붙인 스크립트도 떼어 낸다
// (네트워크가 돌아온 뒤 지도의 "다시 시도"가 실제로 다시 불러오도록. data.js loadJson 과 같은 규칙).

let sdkPromise = null;

export function loadKakaoMaps(timeoutMs = 10000) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.kakao?.maps?.Map) {
      resolve(window.kakao);
      return;
    }
    // 앞선 시도에서 스크립트는 받았지만 초기화(load 콜백)가 끝나지 않았으면 스크립트를 다시 붙이지 않고 초기화만 한다
    if (window.kakao?.maps?.load) {
      window.kakao.maps.load(() => resolve(window.kakao));
      return;
    }
    const key = import.meta.env.VITE_KAKAO_JS_KEY;
    if (!key) {
      reject(new Error("VITE_KAKAO_JS_KEY 가 없습니다"));
      return;
    }
    const script = document.createElement("script");
    const fail = (message) => {
      clearTimeout(timer);
      script.remove();
      reject(new Error(message));
    };
    // 도메인 미등록 등으로 load 콜백이 영영 안 오는 경우를 대비한 시간 제한
    const timer = setTimeout(() => fail("카카오맵 로드 시간 초과"), timeoutMs);
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao?.maps) {
        fail("카카오맵 SDK 초기화 실패");
        return;
      }
      window.kakao.maps.load(() => {
        clearTimeout(timer);
        resolve(window.kakao);
      });
    };
    script.onerror = () => fail("카카오맵 SDK 를 불러오지 못했습니다");
    document.head.appendChild(script);
  });
  sdkPromise.catch(() => {
    sdkPromise = null;
  });
  return sdkPromise;
}
