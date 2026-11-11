<script setup>
/**
 * 로그인 화면 왼쪽 아래에 이어지는 이용 안내. 글은 content/loginGuide.js 에서 가져온다.
 * 스크롤하며 읽는 긴 글이라 줄 길이를 제한하고, 단계는 번호 목록으로 보여 준다.
 */
import { computed } from 'vue'
import { GUIDE } from '../content/loginGuide.js'
import { useLocale } from '../composables/useLocale.js'
import GuideShot from './GuideShot.vue'

const { locale } = useLocale()
const g = computed(() => GUIDE[locale.value] || GUIDE.en)

const RESULT_COLOR = ['var(--drone)', 'var(--bird)', 'var(--uncertain)']
</script>

<template>
  <article class="guide">
    <p class="guide__eyebrow">{{ g.eyebrow }}</p>

    <section class="guide__block">
      <h2>{{ g.intro.title }}</h2>
      <p class="guide__lead">{{ g.intro.body }}</p>
    </section>

    <section class="guide__block">
      <h2>{{ g.modes.title }}</h2>
      <div class="guide__modes">
        <div v-for="(m, i) in g.modes.items" :key="m.name" class="guide__mode">
          <span class="guide__idx mono">0{{ i + 1 }}</span>
          <strong>{{ m.name }}</strong>
          <p>{{ m.text }}</p>
        </div>
      </div>
    </section>

    <section v-for="flow in g.flows" :key="flow.title" class="guide__block">
      <h2>{{ flow.title }}</h2>
      <GuideShot v-if="flow.shot" class="guide__shot" :src="flow.shot.src" :marks="flow.shot.marks" :alt="flow.title" />
      <ol class="guide__steps">
        <li v-for="(s, i) in flow.steps" :key="i">
          <span class="guide__num mono">{{ i + 1 }}</span>
          <span>{{ s }}</span>
        </li>
      </ol>
    </section>

    <section class="guide__block">
      <h2>{{ g.results.title }}</h2>
      <ul class="guide__results">
        <li v-for="(r, i) in g.results.items" :key="r.label">
          <i :style="{ background: RESULT_COLOR[i] }" />
          <strong>{{ r.label }}</strong>
          <span>{{ r.text }}</span>
        </li>
      </ul>
    </section>

    <section class="guide__block">
      <h2>{{ g.tips.title }}</h2>
      <ul class="guide__tips">
        <li v-for="(tip, i) in g.tips.items" :key="i">{{ tip }}</li>
      </ul>
    </section>
  </article>
</template>

<style scoped>
.guide { max-width: 640px; padding-bottom: 64px; }
.guide__eyebrow {
  margin: 0 0 20px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.guide__block { padding: 28px 0; border-top: 1px solid var(--border); }
.guide__block h2 { margin: 0 0 14px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.guide__lead { margin: 0; font-size: 15px; line-height: 1.75; color: var(--text-dim); }

.guide__modes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.guide__mode { padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-panel); }
.guide__idx { display: block; margin-bottom: 8px; font-size: 12px; color: var(--accent-text); }
.guide__mode strong { display: block; margin-bottom: 6px; font-size: 14px; }
.guide__mode p { margin: 0; font-size: 13px; line-height: 1.65; color: var(--text-dim); }

.guide__shot { margin-bottom: 18px; }
.guide__steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.guide__steps li {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 12px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  line-height: 1.65;
  color: var(--text);
}
.guide__steps li:first-child { padding-top: 0; }
.guide__steps li:last-child { border-bottom: 0; padding-bottom: 0; }
.guide__num {
  width: 24px; height: 24px;
  display: grid; place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--accent-text);
}

.guide__results { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.guide__results li {
  display: grid;
  grid-template-columns: 8px 110px 1fr;
  gap: 12px;
  align-items: baseline;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-dim);
}
.guide__results i { width: 8px; height: 8px; border-radius: 1px; align-self: center; }
.guide__results strong { color: var(--text); }

.guide__tips { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; line-height: 1.7; color: var(--text-dim); }
.guide__tips li::marker { color: var(--text-faint); }

@media (max-width: 1100px) { .guide__modes { grid-template-columns: 1fr; } }
</style>
