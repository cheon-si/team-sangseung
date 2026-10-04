import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 정적 사이트로 빌드한다. 데이터는 public/data/*.json 을 브라우저가 직접 읽는다(서버 없음).
// 개발 포트 3000: 카카오맵 JavaScript 키에 등록된 사이트 도메인이 http://localhost:3000 이다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000, strictPort: true },
});
