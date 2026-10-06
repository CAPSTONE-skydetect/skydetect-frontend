# SkyDetect 프론트 (Vue 3 / Vite) → nginx 정적 서빙 + 리버스 프록시

# 1) 빌드
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_* 는 빌드 시점에 번들에 박힌다. compose 의 build.args 로 넘긴다.
ARG VITE_CLIP_SOURCE=mock
ARG VITE_ANALYSIS_SOURCE=ai
ARG VITE_HLS_URL=/mock/hls/live.m3u8
ENV VITE_CLIP_SOURCE=$VITE_CLIP_SOURCE \
    VITE_ANALYSIS_SOURCE=$VITE_ANALYSIS_SOURCE \
    VITE_HLS_URL=$VITE_HLS_URL
RUN npm run build

# 2) 실행
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
