import { useEffect, useState } from "react";

// 정적 JSON 을 한 번 읽어 두고 조회 함수를 제공한다. 서버도 API 호출도 없다.
// 같은 파일을 여러 화면(경로 엔진·위험한 환승역 화면)이 읽어도 요청은 한 번만 나가도록 Promise 를 보관한다.
// 실패한 요청은 보관하지 않는다(“다시 시도”가 실제로 다시 요청하도록).
const cache = {};

export function loadJson(name) {
  cache[name] ??= fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`${name}.json ${r.status}`);
      return r.json();
    })
    .catch((error) => {
      delete cache[name];
      throw error;
    });
  return cache[name];
}

// 화면에서 JSON 하나를 쓰는 훅. 실패하면 null 그대로 두고 그 부분만 숨긴다.
export function useJson(name) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let alive = true;
    loadJson(name).then((v) => alive && setValue(v)).catch(() => {});
    return () => { alive = false; };
  }, [name]);
  return value;
}

// 물리 역 이름: 4호선 총신대입구와 7호선 이수는 같은 역
export const stationId = (name) => (name === "이수" ? "총신대입구" : name);
