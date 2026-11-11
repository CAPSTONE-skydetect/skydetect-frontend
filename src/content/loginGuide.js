/**
 * 로그인 화면 왼쪽에 스크롤로 보여 주는 안내 글.
 *
 * 이 사이트가 무엇이고 어떻게 쓰는지만 쉽게 쓴다. 모델 이름이나 내부 동작 같은 깊은 설명은 넣지 않는다.
 * 글을 고치려면 이 파일만 고치면 된다. 한국어(ko)와 영어(en)는 같은 구조여야 한다.
 *
 *   intro    이 사이트가 무엇인지
 *   modes    쓰는 방법 두 가지(실시간 / 영상 업로드)
 *   flows    방법별 따라 하기 단계
 *   results  결과 읽는 법
 *   tips     사용 팁
 *
 * flows[].shot 은 실제 화면 스크린샷(public/guide)과 그 위에 그릴 표시다.
 *   marks[].n     단계 번호(steps 의 순서와 같다). 같은 번호를 두 곳에 써도 된다.
 *   marks[].rect  스크린샷 원본(1440x900) 기준 [x, y, 너비, 높이] 픽셀
 * 화면 디자인이 바뀌면 public/guide 의 그림과 rect 를 같이 다시 만든다.
 */
export const GUIDE = {
  en: {
    eyebrow: 'Guide',
    intro: {
      title: 'What is SkyDetect?',
      body: 'SkyDetect is a web console for spotting drones in the sky. It watches a live camera stream or a video you already have, follows the object you point at, and tells you whether it is a drone or a bird.',
    },
    modes: {
      title: 'Two ways to use it',
      items: [
        { name: 'Live detection', text: 'Watch a camera stream. When something appears, cut out that moment and analyze it.' },
        { name: 'Video upload', text: 'Analyze a recorded video. Pick the object in one frame and follow it through the clip.' },
      ],
    },
    flows: [
      {
        title: 'Live detection, step by step',
        shot: {
          src: '/guide/live-en.jpg',
          marks: [{ n: 1, rect: [1, 261, 718, 404] }, { n: 2, rect: [12, 844, 113, 46] }, { n: 3, rect: [960, 330, 88, 88] }, { n: 4, rect: [732, 756, 126, 36] }],
        },
        steps: [
          'Open Live. The camera stream plays on the left.',
          'When something appears, press Detect. The moment from 3 seconds before to 10 seconds after is saved as a clip.',
          'On the paused clip, click the object. A box locks onto it.',
          'Press Request analysis and wait for the result.',
        ],
      },
      {
        title: 'Video upload, step by step',
        shot: {
          src: '/guide/upload-en.jpg',
          marks: [{ n: 1, rect: [1, 144, 768, 432] }, { n: 2, rect: [12, 674, 104, 36] }, { n: 2, rect: [268, 317, 70, 60] }, { n: 3, rect: [12, 804, 107, 42] }, { n: 4, rect: [772, 91, 667, 576] }],
        },
        steps: [
          'Open Upload analysis and drop in a video.',
          'Pause on a frame where the object is easy to see, press Select object, then click it.',
          'Press Track ROI. The object is followed through the whole video.',
          'Watch the tracking overlay play back with the path it flew.',
        ],
      },
    ],
    results: {
      title: 'Reading the result',
      items: [
        { label: 'Drone', text: 'The way it moved matches a drone.' },
        { label: 'Bird', text: 'The way it moved matches a bird.' },
        { label: 'Undetermined', text: 'There was not enough to decide. This is not an error. Try a longer or clearer section.' },
      ],
    },
    tips: {
      title: 'Usage tips',
      items: [
        'Click the center of the object, and use the magnifier that follows your cursor for small ones.',
        'Pick a section where the object stays in view for at least a few seconds.',
        'A sky with clear contrast works best. Re-select the object if tracking drifts.',
        'Every finished analysis is saved in Detections so you can review it later.',
      ],
    },
  },

  ko: {
    eyebrow: '이용 안내',
    intro: {
      title: 'SkyDetect 는 무엇인가요?',
      body: 'SkyDetect 는 하늘의 드론을 찾아내는 웹 콘솔입니다. 실시간 카메라 영상이나 가지고 있는 영상을 보면서, 지정한 물체를 따라가고 드론인지 새인지 알려 줍니다.',
    },
    modes: {
      title: '사용 방법은 두 가지입니다',
      items: [
        { name: '실시간 탐지', text: '카메라 영상을 보다가 무언가 나타나면 그 순간을 잘라 분석합니다.' },
        { name: '영상 업로드', text: '녹화된 영상을 분석합니다. 한 장면에서 물체를 고르면 영상 끝까지 따라갑니다.' },
      ],
    },
    flows: [
      {
        title: '실시간 탐지, 따라 하기',
        shot: {
          src: '/guide/live-ko.jpg',
          marks: [{ n: 1, rect: [1, 261, 718, 404] }, { n: 2, rect: [12, 844, 95, 46] }, { n: 3, rect: [960, 330, 88, 88] }, { n: 4, rect: [732, 756, 78, 36] }],
        },
        steps: [
          '실시간 화면을 엽니다. 왼쪽에 카메라 영상이 재생됩니다.',
          '무언가 나타나면 검출을 누릅니다. 누른 시각 3초 전부터 10초 뒤까지가 클립으로 저장됩니다.',
          '멈춘 클립에서 물체를 클릭하면 박스가 붙습니다.',
          '분석 요청을 누르고 결과를 기다립니다.',
        ],
      },
      {
        title: '영상 업로드, 따라 하기',
        shot: {
          src: '/guide/upload-ko.jpg',
          marks: [{ n: 1, rect: [1, 144, 768, 432] }, { n: 2, rect: [12, 674, 78, 36] }, { n: 2, rect: [268, 317, 70, 60] }, { n: 3, rect: [12, 804, 98, 42] }, { n: 4, rect: [772, 91, 667, 576] }],
        },
        steps: [
          '업로드 분석을 열고 영상을 올립니다.',
          '물체가 잘 보이는 장면에서 멈추고 객체 선택을 누른 뒤 물체를 클릭합니다.',
          'ROI 추적을 누르면 영상 전체에서 물체를 따라갑니다.',
          '추적 오버레이에서 물체가 지나간 경로를 확인합니다.',
        ],
      },
    ],
    results: {
      title: '결과 읽는 법',
      items: [
        { label: '드론', text: '움직임이 드론과 같습니다.' },
        { label: '새', text: '움직임이 새와 같습니다.' },
        { label: '판단불가', text: '판단할 자료가 부족합니다. 오류가 아니니 더 길거나 선명한 구간으로 다시 해 보세요.' },
      ],
    },
    tips: {
      title: '사용 팁',
      items: [
        '물체의 가운데를 클릭하세요. 작은 물체는 커서를 따라다니는 돋보기로 확인합니다.',
        '물체가 몇 초 이상 계속 보이는 구간을 고르세요.',
        '하늘과 대비가 뚜렷할수록 잘 됩니다. 추적이 어긋나면 물체를 다시 지정하세요.',
        '분석이 끝난 결과는 검출 기록에 저장되어 나중에 다시 볼 수 있습니다.',
      ],
    },
  },
}
