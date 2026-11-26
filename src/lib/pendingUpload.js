// 실시간 화면(폰 카메라)에서 찍은 영상을 업로드 분석 화면으로 넘기는 통로.
// 두 화면은 서로 import 하지 않고, 파일 하나만 이 ref 를 통해 주고받는다.
// 업로드 화면이 가져가면 null 로 되돌린다.
import { shallowRef } from 'vue'

export const pendingUpload = shallowRef(null)
