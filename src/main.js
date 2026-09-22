import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'

// SPA 라우터를 쓰지 않는다. 화면이 사실상 하나(관제 화면)이고,
// 로그인 여부에 따라 App.vue 가 무엇을 그릴지만 고르면 된다.
createApp(App).mount('#app')
