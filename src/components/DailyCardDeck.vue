<template>
  <view
    ref="deckRoot"
    class="daily-card-deck"
    :model="deckModel"
    :change:model="cardDeck.observe"
    tabindex="0"
    role="region"
    aria-label="亲子卡片。左滑或左方向键看已领取历史，右滑或右方向键看较新领取的卡片；回车或空格翻面。"
    @touchstart="cardDeck.touchStart"
    @touchmove="cardDeck.touchMove"
    @touchend="cardDeck.touchEnd"
    @touchcancel="cardDeck.touchCancel"
    @tap="cardDeck.tap"
  >
    <view class="deck-viewport">
      <view
        v-for="(entry, index) in items"
        :key="entry.day + ':' + entry.card.id"
        class="deck-plane"
        :class="['deck-plane-' + index, { 'deck-plane-initial': index === safeIndex }]"
        :data-index="index"
        :aria-hidden="index !== presentedIndex ? 'true' : 'false'"
        role="group"
        :aria-label="entry.card.title"
      >
        <view class="deck-rotator" :class="'deck-rotator-' + index">
          <view
            class="deck-face deck-front"
            :class="'deck-front-' + index"
            :aria-hidden="index !== presentedIndex || presentedBack ? 'true' : 'false'"
          >
            <scroll-view
              class="deck-face-scroll"
              scroll-y
              :show-scrollbar="false"
              :bounces="false"
              :data-index="index"
              @scroll="cardDeck.scroll"
            >
              <view class="deck-face-content" :class="'deck-front-copy-' + index">
                <view class="deck-meta">
                  <view class="deck-scene">
                    <image
                      class="deck-icon"
                      :src="'/static/icons/' + entry.card.sceneIcon + '.svg'"
                      mode="aspectFit"
                      aria-hidden="true"
                    />
                    <text>{{ entry.card.scene }}</text>
                  </view>
                  <text v-if="entry.card.kind === 'weekend'" class="deck-practice-tag">周末实践</text>
                </view>
                <scroll-view
                  class="deck-reading"
                  scroll-y
                  :show-scrollbar="false"
                  :bounces="false"
                  :data-index="index"
                  @scroll="cardDeck.scroll"
                >
                  <view class="deck-reading-content">
                    <text class="deck-title">{{ entry.card.title }}</text>
                    <text class="deck-section-label">开口这样问</text>
                    <text class="deck-question">“{{ entry.card.front.question }}”</text>
                    <view class="deck-action">
                      <text class="deck-action-label">{{ entry.card.kind === 'weekend' ? '一起实践' : '随手做' }}</text>
                      <text>{{ entry.card.front.action }}</text>
                    </view>
                  </view>
                </scroll-view>
                <text class="deck-safety">{{ entry.card.back.safety }}</text>
                <button
                  class="deck-face-toggle"
                  role="button"
                  hover-class="deck-face-toggle-pressed"
                  :disabled="index !== presentedIndex || presentedBack"
                  :tabindex="index === presentedIndex && !presentedBack ? 0 : -1"
                  :aria-label="'查看' + entry.card.title + '的说明'"
                >
                  <image class="deck-icon" src="/static/icons/flip.svg" mode="aspectFit" aria-hidden="true" />
                  <text>{{ entry.card.practice ? '材料与步骤' : '查看说明' }}</text>
                </button>
              </view>
            </scroll-view>
          </view>
          <view
            class="deck-face deck-back"
            :class="'deck-back-' + index"
            :aria-hidden="index !== presentedIndex || !presentedBack ? 'true' : 'false'"
          >
            <scroll-view
              class="deck-face-scroll"
              scroll-y
              :show-scrollbar="false"
              :bounces="false"
              :data-index="index"
              @scroll="cardDeck.scroll"
            >
              <view class="deck-face-content" :class="'deck-back-copy-' + index">
                <view class="deck-meta">
                  <view class="deck-scene"><text>仅供家长备课</text></view>
                  <text class="deck-practice-tag">草稿 · 待人工审校</text>
                </view>
                <scroll-view
                  class="deck-reading"
                  scroll-y
                  :show-scrollbar="false"
                  :bounces="false"
                  :data-index="index"
                  @scroll="cardDeck.scroll"
                >
                  <view class="deck-reading-content">
                    <text class="deck-title">为什么这样聊</text>
                    <text v-if="entry.card.back.domain" class="deck-section-label">{{ entry.card.back.domain }}</text>
                    <text class="deck-science">{{ entry.card.back.science }}</text>
                    <view v-if="entry.card.practice" class="deck-practice">
                      <text class="deck-section-label">材料</text>
                      <text class="deck-practice-copy">{{ entry.card.practice.materials }}</text>
                      <text class="deck-section-label">成人准备</text>
                      <text class="deck-practice-copy">{{ entry.card.practice.preparation }}</text>
                      <text class="deck-section-label">操作与等待</text>
                      <text class="deck-practice-copy">{{ entry.card.practice.duration }}</text>
                      <text class="deck-section-label">一起试试</text>
                      <text v-for="(step, stepIndex) in entry.card.practice.steps" :key="stepIndex" class="deck-practice-copy">{{ stepIndex + 1 }}. {{ step }}</text>
                    </view>
                  </view>
                </scroll-view>
                <text class="deck-safety">{{ entry.card.back.safety }}</text>
                <button
                  class="deck-face-toggle"
                  role="button"
                  hover-class="deck-face-toggle-pressed"
                  :disabled="index !== presentedIndex || !presentedBack"
                  :tabindex="index === presentedIndex && presentedBack ? 0 : -1"
                  :aria-label="'返回' + entry.card.title + '的提问'"
                >
                  <image class="deck-icon" src="/static/icons/flip.svg" mode="aspectFit" aria-hidden="true" />
                  <text>翻回正面</text>
                </button>
              </view>
            </scroll-view>
          </view>
        </view>
        <view class="deck-shade" :class="'deck-shade-' + index" aria-hidden="true" />
      </view>
    </view>
  </view>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import type { CardItem } from '@/domain/cards'
import type { DailyEntry } from '@/domain/daily-feed'

interface DeckPresentation {
  identity: string
  index: number
  back: boolean
  focus?: boolean
}

interface DeckCommit {
  identity: string
  index: number
}

interface DeckBoundary extends DeckCommit {
  direction: 'older' | 'newer'
}

// Only the H5 adapter uses DOM types or these uni-app-injected view-layer APIs.
// Touch handling and every animation frame stay in the same external WXS engine.
interface H5DeckEngine {
  mouseStart(event: PointerEvent, owner: unknown): boolean | void
  mouseMove(event: PointerEvent, owner: unknown): boolean | void
  mouseEnd(event: PointerEvent, owner: unknown): boolean | void
  cancel(event: Event, owner: unknown): boolean | void
  keydown(event: KeyboardEvent, owner: unknown): boolean | void
  dispose(owner: unknown): void
}

interface H5DeckBridge {
  cardDeck: H5DeckEngine
  $gcd(instance: unknown, owner: boolean): unknown
}

interface DeckViewEngine extends H5DeckEngine {
  observe(model: unknown, previous?: unknown, owner?: unknown): void
  touchStart(event: unknown, owner?: unknown): boolean | void
  touchMove(event: unknown, owner?: unknown): boolean | void
  touchEnd(event: unknown, owner?: unknown): boolean | void
  touchCancel(event: unknown, owner?: unknown): boolean | void
  tap(event: unknown, owner?: unknown): void
  scroll(event: unknown, owner?: unknown): void
}

// The external WXS module is injected by uni-app beforeCreate, not Vue data.
declare module 'vue' {
  interface ComponentCustomProperties {
    cardDeck: DeckViewEngine
  }
}

// Kept outside Vue's reactive data: listeners and descriptors never cross setData.
// #ifdef H5
const h5Disposers = new WeakMap<object, () => void>()
// #endif

export default defineComponent({
  name: 'DailyCardDeck',
  props: {
    items: {
      type: Array as PropType<readonly DailyEntry<CardItem>[]>,
      required: true,
    },
    activeIndex: { type: Number, required: true },
    reducedMotion: { type: Boolean, default: false },
  },
  emits: {
    change: (index: number) => Number.isInteger(index),
    boundary: (direction: 'older' | 'newer') => direction === 'older' || direction === 'newer',
  },
  data() {
    return {
      presentedIndex: this.activeIndex,
      presentedBack: false,
      modelRevision: 0,
      alive: true,
    }
  },
  computed: {
    safeIndex(): number {
      if (this.items.length === 0) return -1
      return Math.max(0, Math.min(this.items.length - 1, this.activeIndex))
    },
    itemIdentity(): string {
      return JSON.stringify(this.items.map((entry) => [entry.day, entry.card.id]))
    },
    deckModel(): { identity: string; count: number; index: number; reduced: boolean; revision: number; alive: boolean } {
      return {
        identity: this.itemIdentity,
        count: this.items.length,
        index: this.safeIndex,
        reduced: this.reducedMotion,
        revision: this.modelRevision,
        alive: this.alive,
      }
    },
  },
  watch: {
    itemIdentity() {
      this.presentedIndex = this.safeIndex
      this.presentedBack = false
    },
  },
  mounted() {
    // Re-observe after the first child render, including MP's initial property pass.
    this.modelRevision += 1
    // #ifdef H5
    this.installH5Input()
    // #endif
  },
  beforeUnmount() {
    this.alive = false
    // #ifdef H5
    h5Disposers.get(this)?.()
    h5Disposers.delete(this)
    // #endif
  },
  methods: {
    onDeckCommit(payload: DeckCommit) {
      if (!this.alive || payload.identity !== this.itemIdentity) return
      if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index >= this.items.length) return
      this.$emit('change', payload.index)
    },
    onDeckBoundary(payload: DeckBoundary) {
      if (!this.alive || payload.identity !== this.itemIdentity || payload.index !== this.safeIndex) return
      if (payload.direction !== 'older' && payload.direction !== 'newer') return
      this.$emit('boundary', payload.direction)
    },
    onDeckPresentation(payload: DeckPresentation) {
      if (!this.alive || payload.identity !== this.itemIdentity) return
      this.presentedIndex = payload.index
      this.presentedBack = payload.back
      // #ifdef H5
      if (payload.focus) {
        this.$nextTick(() => {
          const root = this.h5Root()
          const face = payload.back ? 'back' : 'front'
          root?.querySelector<HTMLElement>('.deck-' + face + '-' + payload.index + ' .deck-face-toggle')?.focus({ preventScroll: true })
        })
      }
      // #endif
    },
    // #ifdef H5
    h5Root(): HTMLElement | null {
      const ref = this.$refs.deckRoot as { $el?: HTMLElement } | HTMLElement | undefined
      if (!ref) return null
      return (('$el' in ref ? ref.$el : ref) as HTMLElement | undefined) ?? null
    },
    installH5Input() {
      const root = this.h5Root()
      if (!root) return
      const bridge = this as unknown as H5DeckBridge
      const owner = bridge.$gcd(this, false)
      const engine = bridge.cardDeck
      let pointer: number | null = null
      const down = (event: PointerEvent) => {
        if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0 || pointer !== null) return
        pointer = event.pointerId
        root.setPointerCapture(pointer)
        root.focus({ preventScroll: true })
        engine.mouseStart(event, owner)
      }
      const move = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return
        if (engine.mouseMove(event, owner) === false) event.preventDefault()
      }
      const up = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return
        engine.mouseEnd(event, owner)
        pointer = null
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId)
      }
      const cancel = (event: Event) => {
        if (pointer === null) return
        pointer = null
        engine.cancel(event, owner)
      }
      const key = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'].includes(event.key)) {
          event.preventDefault()
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') root.focus({ preventScroll: true })
          engine.keydown(event, owner)
        }
      }
      const blur = (event: Event) => cancel(event)
      root.addEventListener('pointerdown', down)
      root.addEventListener('pointermove', move, { passive: false })
      root.addEventListener('pointerup', up)
      root.addEventListener('pointercancel', cancel)
      root.addEventListener('lostpointercapture', cancel)
      root.addEventListener('keydown', key)
      window.addEventListener('blur', blur)
      h5Disposers.set(this, () => {
        root.removeEventListener('pointerdown', down)
        root.removeEventListener('pointermove', move)
        root.removeEventListener('pointerup', up)
        root.removeEventListener('pointercancel', cancel)
        root.removeEventListener('lostpointercapture', cancel)
        root.removeEventListener('keydown', key)
        window.removeEventListener('blur', blur)
        engine.dispose(owner)
      })
    },
    // #endif
  },
})
</script>

<!-- 标准 WXS 声明保留微信视图层绑定，外置样式避免 H5 热更新重复解析脚本。 -->
<script module="cardDeck" lang="wxs" src="./card-deck.wxs"></script>

<style scoped src="./card-deck.css"></style>
