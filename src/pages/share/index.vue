<template>
  <!-- #ifdef MP-WEIXIN -->
  <page-meta root-font-size="system" />
  <!-- #endif -->
  <view class="share-page">
    <view class="share-brand">
      <text class="brand-name">通识卡</text>
      <text class="share-caption">一张卡，一起聊</text>
    </view>

    <template v-if="card">
      <view class="shared-card">
        <view class="card-meta">
          <view class="scene">
            <image class="scene-icon" :src="'/static/icons/' + card.sceneIcon + '.svg'" mode="aspectFit" aria-hidden="true" />
            <text>{{ card.scene }}</text>
          </view>
          <text>3–5 岁 · {{ card.kind === 'weekend' ? '周末实践' : '日常对话' }}</text>
        </view>
        <text class="card-title" role="heading" aria-level="1">{{ card.title }}</text>
        <text class="section-label">开口这样问</text>
        <text class="card-question">“{{ card.front.question }}”</text>
        <view class="content-section">
          <text class="section-label">{{ card.kind === 'weekend' ? '一起实践' : '随手做' }}</text>
          <text class="body-copy">{{ card.front.action }} {{ card.back.safety }}</text>
        </view>
      </view>

      <view class="parent-notes">
        <text class="notes-title" role="heading" aria-level="2">为什么这样聊</text>
        <text v-if="card.back.domain" class="section-label">{{ card.back.domain }}</text>
        <text class="body-copy">{{ card.back.science }}</text>
        <template v-if="card.practice">
          <view class="content-section">
            <text class="section-label">材料</text>
            <text class="body-copy">{{ card.practice.materials }}</text>
          </view>
          <view class="content-section">
            <text class="section-label">成人准备</text>
            <text class="body-copy">{{ card.practice.preparation }}</text>
          </view>
          <view class="content-section">
            <text class="section-label">操作与等待</text>
            <text class="body-copy">{{ card.practice.duration }}</text>
          </view>
          <view class="content-section">
            <text class="section-label">一起试试</text>
            <view v-for="(step, index) in card.practice.steps" :key="index" class="practice-step">
              <text class="step-number">{{ index + 1 }}.</text>
              <text class="body-copy">{{ step }}</text>
            </view>
          </view>
        </template>
      </view>
      <text class="reading-note">分享阅读不会领取卡片，也不会改变你的个人进度。</text>
      <!-- #ifdef MP-WEIXIN -->
      <button class="primary-button" open-type="share" hover-class="button-pressed">分享给微信好友</button>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <text class="reading-note">H5 分享页预览 · 请在微信小程序中分享</text>
      <!-- #endif -->
    </template>
    <view v-else class="unavailable" role="alert">
      <text class="notes-title">这张分享卡片暂时无法查看</text>
      <text class="body-copy">链接缺少有效的卡片信息，或卡片已不在当前目录中。请让分享者重新发送。</text>
    </view>
    <button class="home-button" hover-class="button-pressed" @tap="openHome">去领取我的今日卡片</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { CardItem } from '@/domain/cards'
import { resolveSharedCard } from '@/domain/card-share'
// #ifdef MP-WEIXIN
import { onShareAppMessage } from '@dcloudio/uni-app'
import { cardShareMessage } from '@/domain/card-share'
// #endif

const card = ref<CardItem | null>(null)
onLoad(query => {
  card.value = resolveSharedCard(query?.cardId)
  // #ifdef MP-WEIXIN
  if (card.value) {
    uni.showShareMenu({ menus: ['shareAppMessage'] })
  } else {
    // uni-app's cross-platform type also requires the non-WeChat option.
    uni.hideShareMenu({ hideShareItems: [], menus: ['shareAppMessage', 'shareTimeline'] })
  }
  // #endif
})

// The native share preview uses WeChat's page screenshot. No personal data is rendered here.
// #ifdef MP-WEIXIN
onShareAppMessage(() => cardShareMessage(card.value))
// #endif

function openHome() {
  uni.reLaunch({
    url: '/pages/index/index',
    fail: () => uni.showToast({ title: '暂时无法打开首页，请重试', icon: 'none' }),
  })
}
</script>

<style scoped>
.share-page { box-sizing: border-box; width: 100%; max-width: 480px; margin: 0 auto; padding: var(--space-lg) var(--space-lg) max(24px, env(safe-area-inset-bottom)); overflow-wrap: anywhere; }
.share-brand { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-lg); }
.brand-name { font-family: var(--font-display); font-size: 1.375rem; font-weight: 750; letter-spacing: -0.035em; }
.share-caption, .card-meta, .reading-note { color: var(--color-muted); font-size: 0.75rem; line-height: 1.7; }
.shared-card { padding: var(--space-lg); border: 1px solid var(--color-highlight); border-radius: var(--radius-card); background: var(--color-surface-solid); box-shadow: var(--shadow-card); }
.card-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-sm); }
.scene { display: flex; align-items: center; gap: var(--space-xs); }
.scene-icon { width: 18px; height: 18px; }
.card-title { display: block; margin: var(--space-lg) 0; font-family: var(--font-display); font-size: 1.875rem; font-weight: 750; line-height: 1.35; letter-spacing: -0.035em; }
.section-label { display: block; margin-bottom: var(--space-sm); color: var(--color-accent); font-size: 0.8125rem; font-weight: 650; line-height: 1.6; }
.card-question { display: block; font-size: 1.25rem; font-weight: 550; line-height: 1.8; }
.content-section { margin-top: var(--space-lg); }
.body-copy { display: block; font-size: 1rem; line-height: 1.9; }
.parent-notes { padding: var(--space-xl) var(--space-sm); }
.notes-title { display: block; margin-bottom: var(--space-md); font-size: 1.25rem; font-weight: 650; line-height: 1.5; }
.practice-step { display: flex; align-items: baseline; gap: var(--space-sm); margin-top: var(--space-md); }
.practice-step .body-copy { flex: 1; min-width: 0; }
.step-number { color: var(--color-accent); font-weight: 650; }
.reading-note { display: block; margin-bottom: var(--space-md); text-align: center; }
.primary-button, .home-button { display: flex; align-items: center; justify-content: center; min-height: 48px; margin: 0; padding: 12px var(--space-lg); border: 0; border-radius: var(--radius-control); font-size: 0.9375rem; line-height: 1.6; }
.primary-button { background: var(--color-ink); color: var(--color-accent-ink); }
.home-button { margin-top: var(--space-sm); background: transparent; color: var(--color-accent); }
.button-pressed { opacity: 0.7; }
.unavailable { padding: var(--space-xl) 0; }
@media (max-width: 359px) { .share-page { padding-left: var(--space-md); padding-right: var(--space-md); } .shared-card { padding: var(--space-md); } }
</style>
