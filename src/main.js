import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
// 홈 화면 추가 이벤트는 앱이 그려지기 전에 올 수 있어서 미리 듣기 시작한다.
import './lib/installPrompt.js'

// 홈 화면 설치 조건용 서비스 워커(캐시 없음). 개발 서버에서는 등록하지 않는다.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

// SPA 라우터를 쓰지 않는다. 화면이 사실상 하나(관제 화면)이고,
// 로그인 여부에 따라 App.vue 가 무엇을 그릴지만 고르면 된다.
createApp(App).mount('#app')
