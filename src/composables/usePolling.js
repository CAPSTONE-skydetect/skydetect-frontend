/**
 * 상태 폴링 도우미.
 *
 * setInterval 을 쓰지 않는다. 응답이 간격보다 늦어지면 요청이 겹쳐 쌓이기 때문이다.
 * 대신 "응답을 받고 나서 다음 예약"하는 setTimeout 체인으로 만든다.
 *
 * @param {() => Promise<any>} fetchOnce  한 번 조회
 * @param {object} p
 * @param {(result:any) => boolean} p.isDone  더 폴링할 필요가 없는 최종 상태인가
 * @param {(result:any) => void} p.onResult
 * @param {(error:any) => void} [p.onError]
 * @param {number} p.intervalMs
 * @returns {() => void} 중단 함수. 화면에서 사라질 때 반드시 불러야 한다.
 */
export function startPolling(fetchOnce, { isDone, onResult, onError, intervalMs }) {
  let stopped = false
  let timer = null

  async function tick() {
    if (stopped) return
    try {
      const result = await fetchOnce()
      if (stopped) return
      onResult(result)
      if (isDone(result)) return
    } catch (error) {
      if (stopped) return
      onError?.(error)
      // 일시적 네트워크 오류면 계속 시도한다. 401 은 http 래퍼가 전역 처리하고,
      // 여기서는 화면에 남는 에러만 넘긴다.
      if (error?.status && error.status !== 0 && error.status < 500) return
    }
    timer = setTimeout(tick, intervalMs)
  }

  tick()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
