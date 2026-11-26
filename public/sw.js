// 홈 화면 설치 조건을 맞추기 위한 최소 서비스 워커. 아무것도 캐시하지 않는다.
// 캐시를 두면 배포 후에도 예전 화면이 남고, 실시간 영상·API 요청까지 건드릴 수 있어서 요청은 그대로 네트워크로 보낸다.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
