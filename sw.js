// GreenCount 오프라인 지원용 서비스워커
// 처음 온라인 상태로 페이지를 열면 그 응답을 캐시에 저장하고,
// 이후에는(오프라인이어도) 캐시된 버전을 우선 보여줍니다.

const CACHE_NAME = 'greencount-cache-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // GET 요청만 캐싱 대상으로 처리
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cachedResponse) => {
        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            // 정상 응답이면 캐시에 최신 버전으로 저장
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse); // 오프라인이면 캐시된 버전 사용

        // 캐시가 있으면 즉시 보여주고(빠른 로딩), 없으면 네트워크 응답을 기다림
        return cachedResponse || networkFetch;
      })
    )
  );
});
