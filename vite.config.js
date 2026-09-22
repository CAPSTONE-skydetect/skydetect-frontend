import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const BACKEND = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:8080'
const AI = process.env.VITE_AI_ORIGIN || 'http://localhost:8000'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 프록시가 이 프로젝트의 인증 전략이다.
    // 브라우저는 전부 5173 으로 보내고 Vite 가 중계하므로 same-origin 이 된다.
    // 덕분에 JSESSIONID/XSRF-TOKEN 쿠키가 그냥 오가고 CORS 도 없다.
    // 8080 을 직접 부르면 cross-site 가 되어 두 쿠키 모두 막힌다.
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false },
      '/hls': { target: BACKEND, changeOrigin: false },

      // AI 서버(FastAPI, 기본 8000). 라우트가 백엔드와 똑같이 /api 로 시작해서
      // 충돌하므로 /ai 접두어를 붙여 구분하고 중계할 때 떼어낸다.
      //   /ai/health            -> :8000/health
      //   /ai/api/tracks/manual -> :8000/api/tracks/manual
      '/ai': {
        target: AI,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
