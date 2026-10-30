<script setup lang="ts">
import { ref } from 'vue'
import { ageStages, curriculumThemes, type ThemeId } from '@/domain/curriculum'

const expandedTheme = ref<ThemeId | null>('nature')

function toggleTheme(id: ThemeId) {
  expandedTheme.value = expandedTheme.value === id ? null : id
}
</script>

<template>
  <view class="guide">
    <view class="intro">
      <view class="intro-meta">
        <text>给家长的通识备课锦囊</text>
        <text class="status">初始化阶段</text>
      </view>
      <text class="brand">通识卡</text>
      <text class="subtitle">项目导览 · 亲子通识对谈与打卡工具</text>
      <text class="promise">每天 3 分钟，
从生活里的一次好奇聊起。</text>
      <text class="intro-note">专为家长设计，用探究卡片与启发话术开启亲子对谈，并计划支持童言金句记录与打卡留痕。当前为初始化阶段，仅展示项目方向与课程分类，尚未提供正式课程或记录功能。</text>
    </view>

    <view class="section">
      <text class="section-title">课程框架</text>
      <text class="section-note">五个主题，连接生活中的发现。点击主题查看三个篇章。</text>
      <view class="themes">
        <view v-for="theme in curriculumThemes" :key="theme.id" class="theme" :class="'theme-' + theme.id">
          <button
            class="theme-button"
            :class="{ 'is-selected': expandedTheme === theme.id }"
            hover-class="is-pressed"
            role="button"
            tabindex="0"
            :aria-expanded="expandedTheme === theme.id"
            :aria-label="theme.name + (expandedTheme === theme.id ? '，收起篇章' : '，展开篇章')"
            @tap="toggleTheme(theme.id)"
            @keydown.enter.prevent="toggleTheme(theme.id)"
            @keydown.space.prevent="toggleTheme(theme.id)"
          >
            <view class="theme-label">
              <view class="theme-marker" />
              <text>{{ theme.name }}</text>
            </view>
            <text class="theme-action">{{ expandedTheme === theme.id ? '收起 −' : '展开 +' }}</text>
          </button>
          <view v-if="expandedTheme === theme.id" class="theme-detail">
            <text class="theme-description">{{ theme.description }}</text>
            <view v-for="(chapter, index) in theme.chapters" :key="chapter" class="chapter">
              <text class="chapter-number">{{ index + 1 }}</text>
              <text>{{ chapter }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="age-section">
        <text class="subheading">同一份好奇，不同的探究深度</text>
        <view v-for="stage in ageStages" :key="stage.age" class="age-row">
          <text class="age-range">{{ stage.age }}</text>
          <view class="age-copy">
            <text class="age-name">{{ stage.name }}</text>
            <text class="age-description">{{ stage.description }}</text>
          </view>
        </view>
        <text class="age-note">年龄仅作内容设计参考，不是能力标签；可以跟随孩子当下的兴趣与节奏。</text>
      </view>
    </view>

    <view class="scope section">
      <text class="section-title">现在，可以看什么？</text>
      <text class="scope-copy">已提供项目导览、五主题篇章与三年龄阶段的框架。正式探究卡片仍需内容编写、安全审查与人工审校。</text>
      <view class="scope-divider" />
      <text class="scope-label">本次不包含</text>
      <text class="scope-copy">课程打卡、儿童档案、成长评估、在线 AI、支付或海报生成。本页不会收集或保存儿童信息。</text>
    </view>
    <text class="footer">把好奇留给生活，把准备做得轻一点。</text>
  </view>
</template>

<style scoped>
.guide {
  box-sizing: border-box;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-xl) var(--space-lg) calc(var(--space-xl) + env(safe-area-inset-bottom));
  overflow-wrap: anywhere;
}
.intro-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm) var(--space-md);
  color: var(--color-muted);
  font-size: var(--text-small);
}
.status {
  color: var(--color-focus);
  background: var(--color-selected);
  border-radius: var(--radius-panel);
  padding: var(--space-xs) var(--space-sm);
}
.brand {
  display: block;
  margin-top: var(--space-lg);
  color: var(--color-nature);
  font-size: var(--text-display);
  font-weight: 700;
  letter-spacing: 4px;
  line-height: 1.3;
}
.subtitle {
  display: block;
  margin-top: var(--space-xs);
  color: var(--color-muted);
  font-size: var(--text-small);
}
.promise {
  display: block;
  margin-top: var(--space-lg);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: 1.65;
  white-space: pre-line;
}
.intro-note, .section-note {
  display: block;
  margin-top: var(--space-md);
  color: var(--color-muted);
}
.section { margin-top: var(--space-section); }
.section-title {
  display: block;
  font-size: var(--text-title);
  font-weight: 600;
}
.section-note { margin-top: var(--space-sm); }
.themes {
  margin-top: var(--space-lg);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-panel);
  background: var(--color-surface);
  overflow: hidden;
}
.theme + .theme { border-top: 1px solid var(--color-line); }
.theme-nature { --theme-color: var(--color-nature); }
.theme-society { --theme-color: var(--color-society); }
.theme-technology { --theme-color: var(--color-technology); }
.theme-thinking { --theme-color: var(--color-thinking); }
.theme-arts { --theme-color: var(--color-arts); }
.theme-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  box-sizing: border-box;
  width: 100%;
  min-height: var(--touch-min);
  margin: 0;
  padding: var(--space-md);
  border: 0;
  border-radius: 0;
  color: var(--color-ink);
  background: var(--color-surface);
  font-family: var(--font-body);
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}
.theme-button::after { border: 0; }
.theme-button.is-selected { background: var(--color-selected); }
.theme-button.is-pressed, .theme-button:active { background: var(--color-pressed); }
.theme-button:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: -3px;
}
.theme-label { display: flex; align-items: center; gap: var(--space-sm); }
.theme-marker {
  width: 6px;
  height: 20px;
  flex-shrink: 0;
  border-radius: var(--radius-panel);
  background: var(--theme-color);
}
.theme-action { color: var(--color-muted); font-size: var(--text-small); font-weight: 400; white-space: nowrap; }
.theme-detail { padding: var(--space-md); }
.theme-description { display: block; margin-bottom: var(--space-md); color: var(--color-muted); }
.chapter { display: flex; align-items: baseline; gap: var(--space-md); margin-top: var(--space-sm); }
.chapter-number { color: var(--color-muted); font-size: var(--text-small); }
.age-section { margin-top: var(--space-xl); }
.subheading { display: block; font-weight: 600; }
.age-row { display: flex; align-items: baseline; gap: var(--space-md); padding: var(--space-md) 0; border-bottom: 1px solid var(--color-line); }
.age-range { width: 76px; flex-shrink: 0; color: var(--color-focus); font-weight: 600; }
.age-copy { min-width: 0; }
.age-name { display: block; font-weight: 600; }
.age-description { display: block; margin-top: var(--space-xs); color: var(--color-muted); font-size: var(--text-small); }
.age-note { display: block; margin-top: var(--space-md); color: var(--color-muted); font-size: var(--text-small); }
.scope { padding-top: var(--space-lg); border-top: 2px solid var(--color-nature); }
.scope-copy { display: block; margin-top: var(--space-sm); color: var(--color-muted); }
.scope-divider { height: 1px; background: var(--color-line); margin: var(--space-lg) 0; }
.scope-label { font-weight: 600; }
.footer { display: block; margin-top: var(--space-section); color: var(--color-muted); font-size: var(--text-small); }
@media (max-width: 360px) {
  .guide { padding-right: var(--space-md); padding-left: var(--space-md); }
  .theme-button { padding-right: var(--space-sm); padding-left: var(--space-sm); }
}
</style>
