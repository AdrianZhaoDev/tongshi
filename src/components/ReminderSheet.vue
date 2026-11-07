<template>
  <view class="reminder-layer" @tap.stop @touchstart.stop @touchmove.stop @touchend.stop @touchcancel.stop>
    <view
      class="reminder-backdrop"
      aria-hidden="true"
      @tap.stop="close"
      @touchmove.stop.prevent
    />
    <view
      class="reminder-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="设置亲子对话提醒"
      @tap.stop
      @touchstart.stop
      @touchmove.stop
      @touchend.stop
      @touchcancel.stop
    >

      <scroll-view class="reminder-scroll" scroll-y :show-scrollbar="false" :bounces="false">
        <view class="reminder-header">
          <view class="reminder-heading">
            <text class="reminder-eyebrow">微信订阅消息</text>
            <text class="reminder-title">设置对话提醒</text>
          </view>
          <button class="reminder-close" hover-class="reminder-pressed" aria-label="关闭提醒设置" @tap="close">关闭</button>
        </view>
        <view class="reminder-content">
          <text class="reminder-intro">提醒会显示你个人下一张未领取卡片的标题；收到提醒不会推进领取进度。</text>
          <text class="reminder-schedule">首次提醒在保存后的次日 {{ sendTime }}（北京时间），不会立即发送。</text>
          <text v-if="state.phase === 'authorizing' || state.phase === 'saving' || state.phase === 'cancelling'" class="reminder-operation-note">关闭此页不会撤回已提交的云端操作，也不能撤回已提交至微信的消息。可重新打开核对当前计划。</text>
          <text v-else-if="state.subscription && !state.pendingGrant" class="reminder-operation-note">确认新计划后，会替换原有计划，不会叠加。</text>

          <view v-if="loading" class="reminder-feedback" role="status" aria-live="polite">
            <text class="reminder-feedback-title">{{ state.phase === 'refreshing' ? '计划有变化，正在重新读取…' : '正在读取微信提醒设置…' }}</text>
            <text class="reminder-secondary">读取完成后才能授权和保存。</text>
          </view>

          <view v-if="state.policy && !loading" class="reminder-current">
            <text class="reminder-section-label">{{ state.pendingGrant || state.phase === 'cancelling' ? '上次确认的计划' : '当前计划' }}</text>
            <template v-if="state.subscription">
              <text class="reminder-current-title">{{ reminderSubscriptionLabel(state.subscription) }}</text>
              <text v-if="state.subscription.nextSendAt !== null" class="reminder-secondary">下次安排：{{ formatReminderTimestamp(state.subscription.nextSendAt) }}</text>
              <text v-if="state.subscription.lastSentAt !== null" class="reminder-secondary">最近发送确认：{{ formatReminderTimestamp(state.subscription.lastSentAt) }}</text>
              <text v-if="subscriptionExplanation" class="reminder-secondary">{{ subscriptionExplanation }}</text>
              <button
                v-if="state.subscription.status !== 'stopped' && state.subscription.status !== 'completed'"
                class="reminder-stop"
                hover-class="reminder-pressed"
                :disabled="!canCancel"
                :loading="state.phase === 'cancelling'"
                @tap="cancel"
              >停止当前提醒</button>
            </template>
            <text v-else class="reminder-secondary">{{ state.pendingGrant ? '此前未设置提醒，本次保存结果尚未确认。' : '尚未设置提醒。' }}</text>
          </view>

          <view class="reminder-options" :class="{ 'reminder-options-disabled': !canEdit }">
            <text class="reminder-section-label">提醒方式</text>
            <checkbox-group @change="changeLongTerm">
              <label class="reminder-long-option">
                <checkbox
                  value="long"
                  :checked="state.longTerm"
                  :disabled="!canEdit"
                  color="var(--color-accent)"
                />
                <view class="reminder-option-copy">
                  <text class="reminder-option-title">长期提醒</text>
                  <text class="reminder-secondary">不勾选时，仅安排下一次提醒。</text>
                </view>
              </label>
            </checkbox-group>

            <view v-if="state.longTerm" class="reminder-frequency">
              <text class="reminder-section-label">提醒频率</text>
              <radio-group @change="changeFrequency">
                <label
                  v-for="frequency in REMINDER_CONTRACT.frequencies"
                  :key="frequency.id"
                  class="reminder-frequency-option"
                  :class="{ 'reminder-frequency-selected': state.frequency === frequency.id }"
                >
                  <text class="reminder-option-title">{{ frequency.label }}</text>
                  <radio
                    :value="frequency.id"
                    :checked="state.frequency === frequency.id"
                    :disabled="!canEdit"
                    color="var(--color-accent)"
                  />
                </label>
              </radio-group>
              <text class="reminder-secondary reminder-frequency-note">按所选间隔的北京时间 {{ sendTime }} 安排；错过的提醒不会集中补发。</text>
            </view>
            <text v-else class="reminder-once-note">当前选择：仅提醒一次。</text>
          </view>

          <view v-if="selectionIssue && state.policy && !state.pendingGrant" class="reminder-feedback reminder-error" role="alert">
            <text>{{ selectionIssue.message }}</text>
          </view>

          <view v-if="state.pendingGrant" class="reminder-feedback" role="status" aria-live="polite">
            <text class="reminder-feedback-title">微信已授权，{{ state.phase === 'saving' ? '正在保存计划…' : '保存尚未确认' }}</text>
            <text class="reminder-secondary">重试会保存同一请求，不会再次弹出微信授权。此前提交是否已保存，需以云端确认结果为准。</text>
            <button
              v-if="state.phase === 'save_failed'"
              class="reminder-text-button"
              hover-class="reminder-pressed"
              @tap="discardPending"
            >放弃重试，重新读取</button>
          </view>

          <view v-if="state.issue" class="reminder-feedback reminder-error" role="alert">
            <text>{{ state.issue.message }}</text>
          </view>
          <view v-if="state.notice" class="reminder-feedback" role="status" aria-live="polite">
            <text>{{ state.notice }}</text>
          </view>

          <button
            v-if="!state.pendingGrant && !loading"
            class="reminder-refresh"
            hover-class="reminder-pressed"
            :disabled="busy"
            @tap="reload"
          >重新读取当前计划</button>

          <view class="reminder-explanation">
            <text>确认后会单独打开微信授权弹窗；这里选择的频率是应用的发送安排，不是微信弹窗选项。微信的“保持以上选择”不代表长期提醒权限。</text>
            <text>打开通识卡时才领取新卡，同一北京时间日期只领一张。缺席日期不补发，全部领完后停止提醒，不会循环旧卡。</text>
            <text>领取记录按微信身份保存在云端，换设备可继续。提醒另存方式、频率与发送状态；不采集儿童资料，本机预览历史不上传、不合并。</text>
          </view>
        </view>
      </scroll-view>

      <view class="reminder-footer">
        <button
          class="reminder-confirm"
          hover-class="reminder-confirm-pressed"
          :disabled="primaryDisabled"
          :loading="busy"
          @tap="confirm"
        >{{ primaryLabel }}</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { REMINDER_CONTRACT } from '../config/reminders'
import {
  createReminderController,
  formatReminderTimestamp,
  isReminderFrequency,
  reminderCanCancel,
  reminderCanConfirm,
  reminderCanEdit,
  reminderIsBusy,
  reminderSelectionIssue,
  reminderSubscriptionLabel,
  reminderTimeLabel,
  type ReminderState,
  type ReminderSubscription,
} from '../domain/reminders'
import { createReminderService } from '../services/reminders'

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'updated', subscription: ReminderSubscription | null): void
}>()

const controller = createReminderController(createReminderService(), {
  onChange: (next) => { state.value = next },
  onUpdated: (subscription) => { emit('updated', subscription) },
})
const state = shallowRef<ReminderState>(controller.getState())
const sendTime = reminderTimeLabel()
const busy = computed(() => reminderIsBusy(state.value))
const loading = computed(() => state.value.phase === 'idle' || state.value.phase === 'loading' || state.value.phase === 'refreshing')
const canEdit = computed(() => reminderCanEdit(state.value))
const canCancel = computed(() => reminderCanCancel(state.value))
const selectionIssue = computed(() => reminderSelectionIssue(state.value))
const primaryDisabled = computed(() => state.value.phase === 'save_failed'
  ? !state.value.pendingGrant
  : !reminderCanConfirm(state.value))
const primaryLabel = computed(() => {
  switch (state.value.phase) {
    case 'idle':
    case 'loading':
    case 'refreshing': return '正在读取…'
    case 'authorizing': return '等待微信授权…'
    case 'saving': return '正在保存计划…'
    case 'save_failed': return '重试保存（无需再次授权）'
    case 'cancelling': return '正在停止…'
    default: return state.value.longTerm ? '确认并授权长期提醒' : '确认并授权下一次提醒'
  }
})
const subscriptionExplanation = computed(() => {
  switch (state.value.subscription?.status) {
    case 'needs_authorization': return '微信授权已不可用，可再次确认以重新授权；不会自动改为单次提醒。'
    case 'configuration_error': return '发送配置异常，请联系运营者处理；不能保证提醒送达。'
    case 'delivery_unknown': return '上次发送结果无法确认，不会自动重发同一条消息；请核对微信消息。'
    case 'completed': return state.value.subscription?.lastResult === 'catalog_exhausted'
      ? '全部卡片已领取，已停止后续提醒；本次没有发送消息，可继续回看历史。'
      : '单次提醒已发送完成；收到提醒不代表领取卡片，再次确认可设置新的提醒计划。'
    case 'stopped': return '已停止后续提醒，已提交至微信的消息无法撤回。'
    default: return ''
  }
})

function changeLongTerm(event: { detail: { value: string[] } }) {
  controller.setLongTerm(event.detail.value.includes('long'))
}

function changeFrequency(event: { detail: { value: string } }) {
  if (isReminderFrequency(event.detail.value)) controller.setFrequency(event.detail.value)
}

function confirm() {
  if (state.value.phase === 'save_failed') {
    void controller.retrySave()
  } else {
    // Keep this synchronous so the native API is invoked within this tap's gesture.
    void controller.confirm()
  }
}

function reload() {
  void controller.load()
}

function discardPending() {
  void controller.discardPendingAndReload()
}

function cancel() {
  void controller.cancel()
}

function close() {
  controller.close()
  emit('close')
}

onMounted(() => { void controller.load() })
onBeforeUnmount(() => { controller.close() })
</script>

<style scoped>
.reminder-layer {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: var(--text-body);
  line-height: 1.6;
}

.reminder-backdrop {
  position: absolute;
  inset: 0;
  background: var(--color-ink);
  opacity: 0.48;
  animation: reminder-scrim-in 180ms ease-out;
}

.reminder-sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  height: 86vh;
  max-height: 900px;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  background: var(--color-surface-solid);
  box-shadow: var(--shadow-card);
  animation: reminder-sheet-in 240ms cubic-bezier(0.32, 0.72, 0, 1);
}

.reminder-header {
  display: flex;
  flex: none;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-lg) var(--space-md);
}

.reminder-heading,
.reminder-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.reminder-eyebrow,
.reminder-section-label {
  display: block;
  color: var(--color-muted);
  font-size: 0.875rem;
  font-weight: 600;
}

.reminder-title {
  display: block;
  margin-top: var(--space-xs);
  font-size: 1.5rem;
  line-height: 1.4;
  font-weight: 650;
}

.reminder-close,
.reminder-stop,
.reminder-refresh,
.reminder-text-button,
.reminder-confirm {
  box-sizing: border-box;
  min-height: var(--touch-min);
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  border: 0;
  border-radius: var(--radius-control);
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.6;
  font-weight: 600;
  white-space: normal;
  transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1), opacity 140ms ease;
}

.reminder-close::after,
.reminder-stop::after,
.reminder-refresh::after,
.reminder-text-button::after,
.reminder-confirm::after {
  border: 0;
}

.reminder-close {
  flex: none;
  min-width: var(--touch-min);
  color: var(--color-muted);
  background: var(--color-surface-back);
}

.reminder-scroll {
  flex: 1;
  min-height: 0;
  height: 0;
}

.reminder-content {
  padding: 0 var(--space-lg) var(--space-lg);
}

.reminder-intro,
.reminder-schedule,
.reminder-secondary,
.reminder-current-title,
.reminder-feedback-title,
.reminder-once-note {
  display: block;
}

.reminder-intro {
  font-size: 1.0625rem;
}

.reminder-schedule,
.reminder-secondary {
  color: var(--color-muted);
  font-size: 0.875rem;
  line-height: 1.65;
}

.reminder-schedule {
  margin-top: var(--space-sm);
}

.reminder-current {
  margin-top: var(--space-lg);
  padding: var(--space-md) 0;
  border-top: 1px solid var(--color-line);
  border-bottom: 1px solid var(--color-line);
}

.reminder-current-title,
.reminder-feedback-title {
  margin: var(--space-xs) 0;
  font-weight: 600;
}

.reminder-stop {
  display: inline-flex;
  align-items: center;
  margin-top: var(--space-sm);
  padding-right: 0;
  padding-left: 0;
  color: var(--color-danger);
  background: transparent;
  text-align: left;
}

.reminder-options {
  margin-top: var(--space-lg);
}

.reminder-options-disabled {
  opacity: 0.65;
}

.reminder-long-option {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 64px;
  padding: var(--space-sm) 0;
}

.reminder-option-title {
  font-size: 1rem;
  font-weight: 600;
}

.reminder-frequency {
  margin-top: var(--space-md);
}

.reminder-frequency-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  box-sizing: border-box;
  min-height: 56px;
  margin-top: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--color-line);
  border-radius: var(--space-md);
  background: var(--color-surface-back);
}

.reminder-frequency-selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}

.reminder-frequency-note,
.reminder-once-note {
  margin-top: var(--space-sm);
}

.reminder-once-note {
  color: var(--color-accent);
  font-size: 0.875rem;
}

.reminder-feedback {
  margin-top: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--space-md);
  background: var(--color-surface-back);
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
}

.reminder-error {
  border-left: 3px solid var(--color-danger);
  color: var(--color-danger);
}

.reminder-refresh,
.reminder-text-button {
  width: 100%;
  margin-top: var(--space-sm);
  color: var(--color-accent);
  background: transparent;
}

.reminder-explanation {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-lg);
  padding-top: var(--space-md);
  border-top: 1px solid var(--color-line);
  color: var(--color-muted);
  font-size: 0.8125rem;
  line-height: 1.75;
}

.reminder-footer {
  flex: none;
  padding: var(--space-md) var(--space-lg) calc(var(--space-md) + env(safe-area-inset-bottom));
  border-top: 1px solid var(--color-line);
  background: var(--color-surface-solid);
}

.reminder-operation-note {
  display: block;
  margin-bottom: var(--space-sm);
  color: var(--color-muted);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.reminder-confirm {
  width: 100%;
  min-height: 52px;
  padding: 12px var(--space-md);
  color: var(--color-accent-ink);
  background: var(--color-accent);
}

.reminder-confirm[disabled] {
  color: var(--color-muted);
  background: var(--color-background);
}

.reminder-stop[disabled],
.reminder-refresh[disabled] {
  opacity: 0.5;
}

.reminder-pressed,
.reminder-confirm-pressed {
  opacity: 0.85;
  transform: scale(0.98);
}

.reminder-close:focus-visible,
.reminder-stop:focus-visible,
.reminder-refresh:focus-visible,
.reminder-text-button:focus-visible,
.reminder-confirm:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}

@keyframes reminder-sheet-in {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes reminder-scrim-in {
  from { opacity: 0; }
  to { opacity: 0.48; }
}

@media (prefers-reduced-motion: reduce) {
  .reminder-sheet,
  .reminder-backdrop {
    animation: none;
  }

  .reminder-close,
  .reminder-stop,
  .reminder-refresh,
  .reminder-text-button,
  .reminder-confirm {
    transition: none;
  }

  .reminder-pressed,
  .reminder-confirm-pressed {
    transform: none;
  }
}
</style>
