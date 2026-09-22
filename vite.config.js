import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 백엔드(Spring Boot) 주소. 팀원마다 다를 수 있어 env 로 뺀다.
const BACKEND = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:8080'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 프록시가 이 프로젝트의 인증 전략 그 자체다.
    //
    // 브라우저는 모든 요청을 http://localhost:5173 으로 보내고, Vite 가 그걸
    // 백엔드로 중계한다. 브라우저 입장에서는 same-origin 이므로
    //   - JSESSIONID / XSRF-TOKEN 쿠키가 아무 설정 없이 그대로 오간다
    //   - CORS preflight 도, SameSite=Lax 걸림도 없다
    // 프록시를 빼고 8080 을 직접 부르면 cross-site 가 되어 두 쿠키 모두 막힌다.
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false },
      // HLS 는 /api 밑이 아닐 수도 있어서 둘 다 열어둔다 (백엔드와 확정 필요).
      '/hls': { target: BACKEND, changeOrigin: false },
    },
  },
  build: {
    // 배포 시 백엔드의 src/main/resources/static/ 으로 옮길 산출물
    outDir: 'dist',
    emptyOutDir: true,
  },
})
