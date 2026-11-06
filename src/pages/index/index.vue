<template>
  <!-- #ifdef MP-WEIXIN -->
  <page-meta root-font-size="system" />
  <!-- #endif -->
  <view class="app-shell">
    <view class="app-header" :style="headerStyle">
      <view class="brand">
        <text class="brand-name">通识卡</text>
        <text class="age-label">3–5 岁</text>
      </view>
    </view>

    <view v-if="historyError" class="history-error" role="alert">
      <text class="history-error-copy">{{ historyError }}</text>
      <button class="retry-button" role="button" tabindex="0" hover-class="button-pressed" @tap="refreshDaily" @keydown.enter.space.prevent="refreshDaily">重试</button>
    </view>

    <view v-if="entries.length" class="deck-stage">
      <DailyCardDeck
        :items="entries"
        :active-index="activeIndex"
        :reduced-motion="reducedMotion"
        @change="onCardChange"
      />
    </view>
    <view v-else-if="ready" class="empty-card">
      <text class="empty-title">今天暂无新卡片</text>
      <text class="empty-copy">有新内容时会按日期显示；没有看过的历史时，这里不会补入其他卡片。</text>
    </view>

    <view class="app-footer">
      <text v-if="ready && !hasToday && entries.length" class="delivery-note">今天暂无新卡，当前为已看历史。</text>
      <view class="history-slot">
        <button v-if="hasOlderCard" class="history-hint" role="button" tabindex="0" hover-class="button-pressed" @tap="showOlderCard" @keydown.enter.space.prevent="showOlderCard">
          <text>右滑看历史</text>
          <image class="control-icon" src="/static/icons/arrow-right.svg" mode="aspectFit" aria-hidden="true" />
        </button>
      </view>
      <button class="subscribe-button" role="button" disabled aria-disabled="true" tabindex="-1" aria-label="订阅每日提醒，暂未接入微信服务，当前不可用">
        <image class="control-icon" src="/static/icons/bell.svg" mode="aspectFit" aria-hidden="true" />
        <text>订阅每日提醒</text>
      </button>
      <text class="content-note">内容草稿 · 待人工审校</text>
      <text class="subscription-note">微信提醒尚未接入，当前不会发送消息</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import DailyCardDeck from '@/components/DailyCardDeck.vue'
import { CARDS_DATA, type CardItem } from '@/domain/cards'
import { parseViewedHistory, recordViewedDay, resolveDailyFeed, type DailyEntry, type ViewedDay } from '@/domain/daily-feed'

const viewedStorageKey = 'tongshi:viewed-days:v1'
const entries = ref<DailyEntry<CardItem>[]>([])
const activeIndex = ref(-1)
const hasToday = ref(false)
const ready = ref(false)
const historyError = ref('')
const reducedMotion = ref(false)
const headerStyle = ref<Record<string, string>>({})
const hasOlderCard = computed(() => activeIndex.value > 0)
let midnightTimer: ReturnType<typeof setTimeout> | undefined
let pageVisible = false

function scheduleNextDay(now: Date) {
  if (midnightTimer !== undefined) clearTimeout(midnightTimer)
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  midnightTimer = setTimeout(refreshDaily, Math.max(100, midnight.getTime() - now.getTime() + 50))
}

function refreshDaily() {
  const now = new Date()
  let viewed: ViewedDay[] = []
  let canSave = true
  historyError.value = ''
  try {
    // H5 getStorageSync 会把读取异常折叠为空串，先区分缺键与已有但不可读的数据。
    const storedKeys = uni.getStorageInfoSync().keys
    let stored: unknown
    if (storedKeys.includes(viewedStorageKey)) {
      stored = uni.getStorageSync(viewedStorageKey)
      if (stored === '' || stored === undefined || stored === null) {
        throw new Error('Viewed history exists but cannot be read')
      }
    }
    viewed = parseViewedHistory(stored, CARDS_DATA)
  } catch {
    canSave = false
    historyError.value = '本机历史暂时无法读取，原数据未改动。可先阅读今日卡片，或重试读取。'
  }

  try {
    const feed = resolveDailyFeed(CARDS_DATA, viewed, now)
    entries.value = feed.entries
    activeIndex.value = feed.activeIndex
    hasToday.value = feed.today !== null
    // 打开当日卡片即算“看过”，不代表完成活动或掌握知识。
    if (feed.today && canSave && !viewed.some(item => item.day === feed.today!.day && item.cardId === feed.today!.card.id)) {
      const nextViewed = recordViewedDay(viewed, feed.today)
      try {
        uni.setStorageSync(viewedStorageKey, { version: 1, viewed: nextViewed })
      } catch {
        historyError.value = '今日卡片可以阅读，但本次已看历史未保存。请重试；不会显示保存成功。'
      }
    }
  } catch {
    entries.value = []
    activeIndex.value = -1
    hasToday.value = false
    historyError.value = '卡片排期暂时无法读取，请重试。不会提前开放或随机替换今日内容。'
  }
  ready.value = true
  if (pageVisible) scheduleNextDay(now)
}

function onCardChange(index: number) {
  if (Number.isInteger(index) && index >= 0 && index < entries.value.length) activeIndex.value = index
}

function showOlderCard() {
  if (hasOlderCard.value) activeIndex.value -= 1
}

function stopMidnightTimer() {
  if (midnightTimer !== undefined) clearTimeout(midnightTimer)
  midnightTimer = undefined
}

onShow(() => {
  pageVisible = true
  refreshDaily()
})
onHide(() => {
  pageVisible = false
  stopMidnightTimer()
})

// #ifdef MP-WEIXIN
onMounted(() => {
  const system = uni.getSystemInfoSync()
  const capsule = uni.getMenuButtonBoundingClientRect()
  const top = capsule.top || system.statusBarHeight || 24
  headerStyle.value = {
    paddingTop: `${top}px`,
    minHeight: `${top + Math.max(capsule.height, 32)}px`,
    paddingRight: `${Math.max(0, system.windowWidth - capsule.left - 16)}px`,
  }
})
// #endif

// #ifdef H5
let motionPreference: MediaQueryList | undefined
function onMotionPreference() { reducedMotion.value = motionPreference?.matches ?? false }
function onVisibilityChange() {
  if (!document.hidden && pageVisible) refreshDaily()
}
onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  onMotionPreference()
  motionPreference.addEventListener('change', onMotionPreference)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  motionPreference?.removeEventListener('change', onMotionPreference)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
// #endif

onUnmounted(stopMidnightTimer)
</script>

<style scoped>
.app-shell {
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  min-height: 100vh;
  min-height: 100svh;
  margin: 0 auto;
  padding: calc(24px + env(safe-area-inset-top)) 28px max(24px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.app-header { box-sizing: border-box; display: flex; align-items: center; min-height: 33px; }
.brand { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-sm); min-width: 0; }
.brand-name { font-family: var(--font-display); font-size: 1.375rem; font-weight: 750; letter-spacing: -0.035em; }
.age-label { color: var(--color-muted); font-size: 0.75rem; white-space: nowrap; }
.deck-stage { flex: 1; min-width: 0; display: flex; align-items: center; padding: var(--space-sm) 0; }
.app-footer { display: flex; flex-direction: column; align-items: center; gap: var(--space-xs); }
.history-slot { min-height: 44px; display: flex; align-items: center; justify-content: center; }
.history-hint { display: flex; align-items: center; justify-content: center; gap: var(--space-xs); min-height: 44px; margin: 0; padding: 0 var(--space-sm); border: 0; background: transparent; color: var(--color-accent); font-size: 0.8125rem; line-height: 1.5; }
.control-icon { width: 18px; height: 18px; flex-shrink: 0; }
.subscribe-button { display: flex; align-items: center; justify-content: center; gap: var(--space-sm); min-height: 48px; margin: 0; padding: 0 var(--space-lg); border: 0; border-radius: var(--radius-control); background: var(--color-ink); color: var(--color-accent-ink); font-size: 0.875rem; font-weight: 600; line-height: 1.5; }
.subscribe-button[disabled] { background: var(--color-ink); color: var(--color-accent-ink); opacity: 0.6; }
.content-note, .subscription-note, .delivery-note { display: block; color: var(--color-muted); font-size: 0.75rem; line-height: 1.7; text-align: center; }
.content-note { margin-top: var(--space-sm); }
.history-error { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) 12px; border: 1px solid var(--color-danger); border-radius: 14px; color: var(--color-danger); background: var(--color-surface-solid); }
.history-error-copy { flex: 1; min-width: 0; font-size: 0.8125rem; line-height: 1.65; }
.retry-button { flex-shrink: 0; min-height: 44px; margin: 0; padding: 0 12px; border: 0; color: var(--color-danger); background: transparent; font-size: 0.875rem; line-height: 44px; }
.empty-card { flex: 1; min-height: 360px; display: flex; flex-direction: column; justify-content: center; gap: var(--space-md); padding: var(--space-lg); border: 1px solid var(--color-highlight); border-radius: var(--radius-card); background: var(--color-surface-solid); box-shadow: var(--shadow-card); }
.empty-title { font-size: 1.375rem; font-weight: 650; line-height: 1.4; }
.empty-copy { color: var(--color-muted); font-size: 0.9375rem; line-height: 1.8; }
.button-pressed { opacity: 0.7; }
@media (max-width: 359px) { .app-shell { padding-left: 26px; padding-right: 26px; } }
/* #ifdef MP-WEIXIN */
.app-shell { padding-top: 0; }
/* #endif */
</style>
