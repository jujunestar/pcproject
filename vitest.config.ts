import path from "node:path";
import { defineConfig } from "vitest/config";

// tsconfig.json의 "@/*" 경로 별칭을 vitest도 그대로 해석하게 한다.
// Next.js는 tsconfig paths를 자동으로 읽지만 vitest는 별도 설정이 필요하다.
// 새 npm 패키지는 추가하지 않는다 — vitest에 이미 포함된 vite 설정 기능이다.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
