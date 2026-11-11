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
      <button class="retry-button" role="button" tabindex="0" hover-class="button-pressed" :disabled="loading" :loading="loading" @tap="refreshDaily" @keydown.enter.space.prevent="refreshDaily">重试</button>
    </view>

    <view v-if="entries.length" class="deck-stage">
      <DailyCardDeck
        :items="entries"
        :active-index="activeIndex"
        :reduced-motion="reducedMotion"
        @boundary="onDeckBoundary"
        @change="onCardChange"
      />
    </view>
    <view v-else class="empty-card" :role="historyError ? undefined : 'status'">
      <text class="empty-title">{{ loading ? '正在读取领取进度…' : historyError ? '暂时无法打开卡片' : '暂无可领取的卡片' }}</text>
      <text class="empty-copy">{{ historyError ? '读取进度成功后才能继续，原有记录不会被重置或替换。' : loading ? '请稍候，读取完成后再显示卡片。' : '当前卡片已全部领取；不会从头循环或补发缺席日期。' }}</text>
    </view>

    <view class="app-footer">
      <!-- #ifndef MP-WEIXIN -->
      <text class="delivery-note">H5 本机预览 · 不同步微信云端进度</text>
      <!-- #endif -->
      <text v-if="ready && exhausted" class="delivery-note">全部卡片已领取，可继续回看历史。</text>
      <text v-else-if="ready && !hasToday && entries.length" class="delivery-note">当前显示已领取历史，今天没有新增领取记录。</text>
      <view class="history-slot">
        <button v-if="hasOlderCard" class="history-hint" role="button" tabindex="0" aria-label="查看上一张已领取的历史卡片，左滑或左方向键" hover-class="button-pressed" @tap="showOlderCard" @keydown.enter.space.prevent="showOlderCard">
          <image class="control-icon history-arrow" src="/static/icons/arrow-right.svg" mode="aspectFit" aria-hidden="true" />
          <text>左滑看历史</text>
        </button>
        <button v-if="hasNewerCard" class="history-hint" role="button" tabindex="0" aria-label="查看较新领取的卡片，右滑或右方向键" hover-class="button-pressed" @tap="showNewerCard" @keydown.enter.space.prevent="showNewerCard">
          <text>右滑看新卡</text>
          <image class="control-icon" src="/static/icons/arrow-right.svg" mode="aspectFit" aria-hidden="true" />
        </button>
      </view>
      <button v-if="activeCard" class="share-button" role="button" hover-class="button-pressed" @tap="openSharePreview">分享这张卡片</button>
      <!-- #ifdef MP-WEIXIN -->
      <button class="subscribe-button" role="button" hover-class="button-pressed" @tap="reminderOpen = true">
        <image class="control-icon" src="/static/icons/bell.svg" mode="aspectFit" aria-hidden="true" />
        <text>设置对话提醒</text>
      </button>
      <text v-if="reminderStatus" class="subscription-note" role="status">{{ reminderStatus }}</text>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <button class="subscribe-button" disabled aria-disabled="true" tabindex="-1" aria-label="对话提醒仅支持微信小程序">
        <image class="control-icon" src="/static/icons/bell.svg" mode="aspectFit" aria-hidden="true" />
        <text>设置对话提醒</text>
      </button>
      <!-- #endif -->
    </view>
  </view>
  <!-- #ifdef MP-WEIXIN -->
  <ReminderSheet v-if="reminderOpen" @close="reminderOpen = false" @updated="onReminderUpdated" />
  <!-- #endif -->
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import DailyCardDeck from '@/components/DailyCardDeck.vue'
import { CARDS_DATA, type CardItem } from '@/domain/cards'
import { dayKey, mapViewedFeed, nextDayStart, parseViewedHistory, recordViewedDay, resolveDailyFeed, type DailyEntry, type DailyFeed, type ViewedDay } from '@/domain/daily-feed'
import { cardShareMessage } from '@/domain/card-share'
// #ifdef MP-WEIXIN
import ReminderSheet from '@/components/ReminderSheet.vue'
import { onShareAppMessage } from '@dcloudio/uni-app'
import { reminderSubscriptionLabel, type ReminderSubscription } from '@/domain/reminders'
import { createDailyFeedService } from '@/services/daily-feed'
// #endif

// #ifndef MP-WEIXIN
const viewedStorageKey = 'tongshi:viewed-days:v1'
// #endif
const entries = ref<DailyEntry<CardItem>[]>([])
const activeIndex = ref(-1)
const hasToday = ref(false)
const ready = ref(false)
const loading = ref(true)
const exhausted = ref(false)
const historyError = ref('')
const reducedMotion = ref(false)
const headerStyle = ref<Record<string, string>>({})
const hasOlderCard = computed(() => activeIndex.value > 0)
const hasNewerCard = computed(() => activeIndex.value >= 0 && activeIndex.value < entries.value.length - 1)
const activeCard = computed(() => entries.value[activeIndex.value]?.card ?? null)
let midnightTimer: ReturnType<typeof setTimeout> | undefined
let pageVisible = false
let refreshVersion = 0
let disposed = false

// #ifdef MP-WEIXIN
const dailyFeedService = createDailyFeedService()
const reminderOpen = ref(false)
const reminderStatus = ref('')
onShareAppMessage(() => cardShareMessage(activeCard.value))
function onReminderUpdated(subscription: ReminderSubscription | null) {
  reminderStatus.value = subscription ? `云端已确认：${reminderSubscriptionLabel(subscription)}` : '云端已确认：当前没有提醒计划'
}
// #endif

function scheduleNextDay(now: Date, visitStarted: Date) {
  stopMidnightTimer()
  // A response spanning midnight must open the new Beijing day, not wait another day.
  const delay = dayKey(now) === dayKey(visitStarted) ? nextDayStart(now).getTime() - now.getTime() + 50 : 100
  midnightTimer = setTimeout(refreshDaily, Math.max(100, delay))
}

// #ifndef MP-WEIXIN
function readPreviewFeed(now: Date): { feed: DailyFeed<CardItem>; claimed: number } {
  let viewed: ViewedDay[]
  let feed: DailyFeed<CardItem>
  try {
    // H5 folds read errors into an empty value; distinguish a missing key first.
    const storedKeys = uni.getStorageInfoSync().keys
    let stored: unknown
    if (storedKeys.includes(viewedStorageKey)) {
      stored = uni.getStorageSync(viewedStorageKey)
      if (stored === '' || stored === undefined || stored === null) {
        throw new Error('Existing preview history is unreadable')
      }
    }
    viewed = parseViewedHistory(stored, CARDS_DATA)
    feed = resolveDailyFeed(CARDS_DATA, viewed, now)
  } catch {
    throw new Error('本机预览进度暂时无法读取，原数据未改动。不会重置进度或分配新卡，请重试。')
  }

  if (feed.today && !viewed.some(item => item.day === feed.today!.day)) {
    try {
      viewed = recordViewedDay(viewed, feed.today)
      uni.setStorageSync(viewedStorageKey, { version: 1, viewed })
    } catch {
      throw new Error('本机预览的领取记录未能保存，暂不显示新卡。请重试，不会显示保存成功。')
    }
  }
  return { feed, claimed: viewed.length }
}
// #endif

async function refreshDaily() {
  const operation = ++refreshVersion
  const visitStarted = new Date()
  stopMidnightTimer()
  loading.value = true
  historyError.value = ''
  try {
    let snapshot: { feed: DailyFeed<CardItem>; claimed: number }
    // #ifdef MP-WEIXIN
    const remoteViewed = await dailyFeedService.openDaily()
    if (disposed || operation !== refreshVersion) return
    snapshot = { feed: mapViewedFeed(CARDS_DATA, remoteViewed, new Date()), claimed: remoteViewed.length }
    // #endif
    // #ifndef MP-WEIXIN
    snapshot = readPreviewFeed(visitStarted)
    // #endif
    if (disposed || operation !== refreshVersion) return
    entries.value = snapshot.feed.entries
    activeIndex.value = snapshot.feed.activeIndex
    hasToday.value = snapshot.feed.today !== null
    exhausted.value = CARDS_DATA.length > 0 && snapshot.claimed === CARDS_DATA.length
  } catch (error) {
    if (disposed || operation !== refreshVersion) return
    entries.value = []
    activeIndex.value = -1
    hasToday.value = false
    exhausted.value = false
    historyError.value = error instanceof Error ? error.message : '领取进度暂时无法读取，未在本机分配新卡。请重试。'
  } finally {
    if (!disposed && operation === refreshVersion) {
      loading.value = false
      ready.value = true
      if (pageVisible) scheduleNextDay(new Date(), visitStarted)
    }
  }
}

function openSharePreview() {
  if (!activeCard.value) return
  uni.navigateTo({
    url: cardShareMessage(activeCard.value).path,
    fail: () => uni.showToast({ title: '暂时无法打开分享页，请重试', icon: 'none' }),
  })
}

function onCardChange(index: number) {
  if (Number.isInteger(index) && index >= 0 && index < entries.value.length) activeIndex.value = index
}

function showOlderCard() {
  if (hasOlderCard.value) activeIndex.value -= 1
}

function showNewerCard() {
  if (hasNewerCard.value) activeIndex.value += 1
}

function onDeckBoundary(direction: 'older' | 'newer') {
  uni.showToast({
    title: exhausted.value ? '全部卡片已领取，可回看历史' : direction === 'older' ? '明日再来哦' : '已是最新领取的卡片',
    icon: 'none',
  })
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
  refreshVersion += 1
  loading.value = false
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

onUnmounted(() => {
  disposed = true
  refreshVersion += 1
  stopMidnightTimer()
})
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
.history-arrow { transform: rotate(180deg); }
.subscribe-button { display: flex; align-items: center; justify-content: center; gap: var(--space-sm); min-height: 48px; margin: 0; padding: 0 var(--space-lg); border: 0; border-radius: var(--radius-control); background: var(--color-ink); color: var(--color-accent-ink); font-size: 0.875rem; font-weight: 600; line-height: 1.5; }
.share-button { min-height: 44px; margin: 0; padding: 10px var(--space-lg); border: 1px solid var(--color-line); border-radius: var(--radius-control); background: var(--color-surface-solid); color: var(--color-accent); font-size: 0.875rem; line-height: 1.6; }
.subscribe-button[disabled] { background: var(--color-ink); color: var(--color-accent-ink); opacity: 0.6; }
.subscription-note, .delivery-note { color: var(--color-muted); font-size: 0.75rem; line-height: 1.7; }
.subscription-note, .delivery-note { display: block; text-align: center; }
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
