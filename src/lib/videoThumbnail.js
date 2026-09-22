/**
 * <video> 의 현재 프레임을 작은 JPEG data URL 로 뽑는다. 기록 목록의 썸네일용.
 *
 * 크기를 줄이는 게 핵심이다. 1920px 원본을 그대로 넣으면 한 건에 수백 KB 라
 * localStorage 가 금방 찬다.
 */

const THUMB_WIDTH = 320
const THUMB_QUALITY = 0.6

/**
 * @param {HTMLVideoElement} video
 * @param {{box?: {x:number,y:number,width:number,height:number}}} [options]
 *        box 를 주면 원본 픽셀 좌표 기준으로 사각형을 같이 그린다.
 * @returns {string|null} data URL. 뽑을 수 없으면 null
 */
export function captureThumbnail(video, options = {}) {
  if (!video?.videoWidth || !video.videoHeight) return null

  try {
    const scale = THUMB_WIDTH / video.videoWidth
    const canvas = document.createElement('canvas')
    canvas.width = THUMB_WIDTH
    canvas.height = Math.round(video.videoHeight * scale)

    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    if (options.box) {
      const { x, y, width, height } = options.box
      ctx.strokeStyle = '#4da3ff'
      ctx.lineWidth = 2
      ctx.strokeRect(x * scale, y * scale, width * scale, height * scale)
    }

    return canvas.toDataURL('image/jpeg', THUMB_QUALITY)
  } catch {
    // 교차 출처 영상이면 canvas 가 오염되어 toDataURL 이 막힌다.
    // 썸네일이 없다고 기록을 못 남길 이유는 없다.
    return null
  }
}
