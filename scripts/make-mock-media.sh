#!/usr/bin/env bash
#
# mock 영상 생성. ffmpeg 가 필요하다.
#
#   bash scripts/make-mock-media.sh
#
# 만드는 것 두 가지
#   public/mock/hls/live.m3u8  — 왼쪽 라이브 패널용 HLS 스트림 (60초, 1280x720)
#   public/mock/clip.mp4       — 오른쪽 클립 패널용 13초 1920x1080 클립
#
# 왜 굳이 진짜 영상을 만드는가:
#   박스 좌표 변환은 "1920 픽셀 영상을 640 픽셀 폭으로 보여줄 때"만 의미가 있다.
#   가짜 이미지나 canvas 로 때우면 video.videoWidth 가 실제와 달라서
#   정작 검증하려던 변환을 검증하지 못한다.
#
# 산출물은 .gitignore 에 있다. 저장소에 넣지 않는다.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_HLS="public/mock/hls"
OUT_CLIP="public/mock/clip.mp4"
mkdir -p "$OUT_HLS"

# Windows 기본 폰트. drawtext 는 폰트 경로의 콜론을 이스케이프해야 한다.
FONT="C\:/Windows/Fonts/consola.ttf"
if [ ! -f "C:/Windows/Fonts/consola.ttf" ]; then
  FONT="C\:/Windows/Fonts/arial.ttf"
fi

echo "[1/2] 라이브 HLS 스트림 생성 (60초)..."
# 하늘 배경 + 천천히 가로지르는 물체 + 시계.
# 시계를 넣는 이유: 왼쪽이 멈췄는지 흐르는지 눈으로 바로 알기 위해서다.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=0x8fbfe0:s=1280x720:r=25:d=60" \
  -vf "\
drawbox=x='120+16*t':y='260+50*sin(0.6*t)':w=26:h=16:color=0x2b2f36@1:t=fill,\
drawbox=x='900-11*t':y='180+30*sin(0.9*t+1)':w=18:h=12:color=0x3a3f47@1:t=fill,\
drawtext=fontfile='${FONT}':text='LIVE  %{pts\:hms}':x=32:y=28:fontsize=34:fontcolor=white:box=1:boxcolor=0x00000066:boxborderw=10" \
  -c:v libx264 -preset veryfast -g 50 -sc_threshold 0 -pix_fmt yuv420p \
  -f hls -hls_time 4 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "$OUT_HLS/live%03d.ts" \
  "$OUT_HLS/live.m3u8"

echo "[2/2] 클립 영상 생성 (13초, 1920x1080, 30fps)..."
# 트리거 -3초 ~ +10초. 즉 프레임 90(=3초 × 30fps)이 트리거 순간이다.
# 그 지점에 표시를 넣어두면 initFrameIndex 계산이 맞는지 눈으로 확인된다.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=0x8fbfe0:s=1920x1080:r=30:d=13" \
  -vf "\
drawbox=x='180+118*t+40*sin(2.2*t)':y='430+120*sin(0.9*t)':w=46:h=30:color=0x23262c@1:t=fill,\
drawbox=x='1500-70*t':y='220+60*sin(1.4*t+2)':w=30:h=20:color=0x343a42@1:t=fill,\
drawtext=fontfile='${FONT}':text='frame %{n}   t\=%{pts}s':x=40:y=36:fontsize=44:fontcolor=white:box=1:boxcolor=0x00000066:boxborderw=12,\
drawtext=fontfile='${FONT}':text='TRIGGER (frame 90)':x=40:y=100:fontsize=44:fontcolor=0xffd166:box=1:boxcolor=0x00000066:boxborderw=12:enable='between(n\,85\,95)'" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart \
  "$OUT_CLIP"

echo "완료:"
ls -la "$OUT_CLIP" "$OUT_HLS/live.m3u8"
