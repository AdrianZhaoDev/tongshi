import {
  DEFAULT_REMINDER_FREQUENCY,
  REMINDER_CONTRACT,
  type ReminderFrequency,
} from '../config/reminders'

export type { ReminderFrequency } from '../config/reminders'
export type ReminderMode = 'once' | 'long'
export type ReminderStatus =
  | 'active'
  | 'completed'
  | 'stopped'
  | 'needs_authorization'
  | 'configuration_error'
  | 'delivery_unknown'

export interface ReminderSubscription {
  readonly generation: string
  readonly mode: ReminderMode
  readonly frequency: ReminderFrequency
  readonly status: ReminderStatus
  readonly nextSendAt: number | null
  readonly lastSentAt: number | null
  readonly lastResult: string | null
}

export interface ReminderModePolicy {
  readonly enabled: boolean
  readonly configured: boolean
  readonly templateId: string
}

export interface ReminderPolicy {
  readonly version: number
  readonly timezone: string
  readonly sendHour: number
  readonly sendMinute: number
  readonly frequencies: typeof REMINDER_CONTRACT.frequencies
  readonly once: ReminderModePolicy
  readonly long: ReminderModePolicy
}

export interface ReminderSettings {
  readonly policy: ReminderPolicy
  readonly subscription: ReminderSubscription | null
}

export interface SubscribeReminderInput {
  readonly requestId: string
  readonly mode: ReminderMode
  readonly frequency: ReminderFrequency
  readonly templateId: string
}

export type ReminderAuthorization = 'accept' | 'acceptWithAlert' | 'acceptWithAudio' | 'reject' | 'ban'

export interface ReminderService {
  getSettings(): Promise<ReminderSettings>
  requestAuthorization(templateId: string): Promise<ReminderAuthorization>
  subscribe(input: SubscribeReminderInput): Promise<ReminderSubscription>
  cancel(generation: string): Promise<ReminderSubscription | null>
}

export class ReminderError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ReminderError'
  }
}

export interface ReminderIssue {
  readonly code: string
  readonly message: string
}

export type ReminderPhase =
  | 'idle' | 'loading' | 'ready' | 'authorizing' | 'saving' | 'save_failed'
  | 'cancelling' | 'refreshing' | 'error' | 'saved' | 'cancelled' | 'closed'

export interface ReminderState {
  readonly phase: ReminderPhase
  readonly longTerm: boolean
  readonly frequency: ReminderFrequency
  readonly policy: ReminderPolicy | null
  readonly subscription: ReminderSubscription | null
  readonly pendingGrant: SubscribeReminderInput | null
  readonly issue: ReminderIssue | null
  readonly notice: string | null
}

const statusLabels: Record<ReminderStatus, string> = {
  active: '已启用',
  completed: '已完成',
  stopped: '已停止',
  needs_authorization: '需要重新授权',
  configuration_error: '发送配置异常',
  delivery_unknown: '上次送达结果待确认',
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(): never {
  throw new ReminderError('INVALID_RESPONSE', '提醒服务返回了无法识别的数据，请重新读取；如仍失败，请联系运营者。')
}

export function isReminderFrequency(value: unknown): value is ReminderFrequency {
  return REMINDER_CONTRACT.frequencies.some((frequency) => frequency.id === value)
}

function timestamp(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

export function parseReminderSubscription(value: unknown): ReminderSubscription | null {
  if (value === null) return null
  if (
    !record(value) || typeof value.generation !== 'string' || !value.generation.trim()
    || (value.mode !== 'once' && value.mode !== 'long') || !isReminderFrequency(value.frequency)
    || (value.mode === 'once' && value.frequency !== DEFAULT_REMINDER_FREQUENCY)
    || typeof value.status !== 'string' || !Object.prototype.hasOwnProperty.call(statusLabels, value.status)
    || !timestamp(value.nextSendAt) || !timestamp(value.lastSentAt)
    || (value.lastResult !== null && typeof value.lastResult !== 'string')
  ) invalidResponse()

  return {
    generation: value.generation,
    mode: value.mode,
    frequency: value.frequency,
    status: value.status as ReminderStatus,
    nextSendAt: value.nextSendAt,
    lastSentAt: value.lastSentAt,
    lastResult: value.lastResult,
  }
}

function parseModePolicy(value: unknown): ReminderModePolicy {
  if (
    !record(value) || typeof value.enabled !== 'boolean' || typeof value.configured !== 'boolean'
    || typeof value.templateId !== 'string' || (value.configured && !value.templateId.trim())
  ) invalidResponse()
  return { enabled: value.enabled, configured: value.configured, templateId: value.templateId }
}

export function parseReminderSettings(value: unknown): ReminderSettings {
  if (!record(value) || !record(value.policy)) invalidResponse()
  const policy = value.policy
  if (policy.version !== REMINDER_CONTRACT.version) {
    throw new ReminderError('POLICY_VERSION_MISMATCH', '客户端与提醒服务的协议版本不一致，请联系运营者更新部署后重新读取。')
  }
  if (
    policy.timezone !== REMINDER_CONTRACT.timezone || policy.sendHour !== REMINDER_CONTRACT.sendHour
    || policy.sendMinute !== REMINDER_CONTRACT.sendMinute || !Array.isArray(policy.frequencies)
    || policy.frequencies.length !== REMINDER_CONTRACT.frequencies.length
    || !REMINDER_CONTRACT.frequencies.every((expected) => (policy.frequencies as unknown[]).some((item) => (
      record(item) && item.id === expected.id && item.days === expected.days && item.label === expected.label
    )))
  ) {
    throw new ReminderError('POLICY_MISMATCH', '客户端与提醒服务的时间或频率配置不一致，请联系运营者更新部署后重新读取。')
  }
  return {
    policy: {
      version: REMINDER_CONTRACT.version,
      timezone: REMINDER_CONTRACT.timezone,
      sendHour: REMINDER_CONTRACT.sendHour,
      sendMinute: REMINDER_CONTRACT.sendMinute,
      frequencies: REMINDER_CONTRACT.frequencies,
      once: parseModePolicy(policy.once),
      long: parseModePolicy(policy.long),
    },
    subscription: parseReminderSubscription(value.subscription),
  }
}

export function reminderIsBusy(state: ReminderState): boolean {
  return state.phase === 'loading' || state.phase === 'authorizing' || state.phase === 'saving'
    || state.phase === 'cancelling' || state.phase === 'refreshing'
}

export function reminderSelectionIssue(state: ReminderState): ReminderIssue | null {
  if (!state.policy) return { code: 'SETTINGS_REQUIRED', message: '请先读取微信提醒配置。' }
  const mode = state.longTerm ? 'long' : 'once'
  const policy = state.policy[mode]
  const name = state.longTerm ? '长期提醒' : '单次提醒'
  if (!policy.enabled) {
    return { code: 'MODE_DISABLED', message: `${name}暂未开放。不会自动改为其他提醒方式，请自行选择或稍后重试。` }
  }
  if (!policy.configured || !policy.templateId.trim()) {
    return { code: 'TEMPLATE_NOT_CONFIGURED', message: `${name}的微信模板或发送内容尚未配置。请联系运营者完成配置后重新读取。` }
  }
  return null
}

export function reminderCanConfirm(state: ReminderState): boolean {
  return (state.phase === 'ready' || state.phase === 'saved' || state.phase === 'cancelled')
    && !state.pendingGrant && !reminderSelectionIssue(state)
}

export function reminderCanEdit(state: ReminderState): boolean {
  return !!state.policy && !reminderIsBusy(state) && !state.pendingGrant
    && state.phase !== 'closed' && state.phase !== 'error'
}

export function reminderCanCancel(state: ReminderState): boolean {
  return reminderCanEdit(state) && !!state.subscription
    && state.subscription.status !== 'stopped' && state.subscription.status !== 'completed'
}

export function reminderSubscriptionLabel(subscription: ReminderSubscription): string {
  const frequency = REMINDER_CONTRACT.frequencies.find((item) => item.id === subscription.frequency)
  const plan = subscription.mode === 'once' ? '仅提醒一次' : `${frequency?.label ?? ''}长期提醒`
  const status = subscription.status === 'completed' && subscription.lastResult === 'catalog_exhausted'
    ? '全部卡片已领取' : statusLabels[subscription.status]
  return `${plan} · ${status}`
}

export function reminderTimeLabel(): string {
  return `${String(REMINDER_CONTRACT.sendHour).padStart(2, '0')}:${String(REMINDER_CONTRACT.sendMinute).padStart(2, '0')}`
}

export function formatReminderTimestamp(value: number): string {
  try {
    return `${new Intl.DateTimeFormat('zh-CN', {
      timeZone: REMINDER_CONTRACT.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(value)}（北京时间）`
  } catch {
    return `${new Date(value).toISOString().replace('T', ' ').slice(0, 16)} UTC`
  }
}

function issueFrom(error: unknown, fallback: string): ReminderIssue {
  return error instanceof ReminderError
    ? { code: error.code, message: error.message }
    : { code: 'REQUEST_FAILED', message: fallback }
}

export interface ReminderControllerOptions {
  readonly onChange?: (state: ReminderState) => void
  readonly onUpdated?: (subscription: ReminderSubscription | null) => void
  readonly createRequestId?: () => string
}

export function createReminderController(service: ReminderService, options: ReminderControllerOptions = {}) {
  let state: ReminderState = {
    phase: 'idle', longTerm: false, frequency: DEFAULT_REMINDER_FREQUENCY,
    policy: null, subscription: null, pendingGrant: null, issue: null, notice: null,
  }
  let version = 0

  function current(operation: number): boolean {
    return state.phase !== 'closed' && operation === version
  }

  function update(patch: Partial<ReminderState>) {
    state = { ...state, ...patch }
    options.onChange?.(state)
  }

  async function loadSettings(notice: string | null = null) {
    if (state.phase === 'closed' || reminderIsBusy(state) || state.pendingGrant) return
    const operation = ++version
    update({ phase: 'loading', issue: null, notice: null })
    try {
      const settings = await service.getSettings()
      if (!current(operation)) return
      update({ phase: 'ready', policy: settings.policy, subscription: settings.subscription, issue: null, notice })
    } catch (error) {
      if (!current(operation)) return
      update({ phase: 'error', policy: null, subscription: null, issue: issueFrom(error, '未能读取提醒设置，请检查网络后重新读取。') })
    }
  }

  async function save(input: SubscribeReminderInput, operation: number) {
    if (!current(operation)) return
    try {
      const subscription = await service.subscribe(input)
      if (!current(operation)) return
      update({
        phase: subscription.status === 'active' ? 'saved' : 'ready',
        subscription, pendingGrant: null, issue: null,
        notice: subscription.status === 'active'
          ? '提醒计划已保存。实际送达以微信授权及发送结果为准。'
          : '服务端已确认本次请求，提醒当前未启用，请查看当前计划状态。',
      })
      if (current(operation)) options.onUpdated?.(subscription)
    } catch (error) {
      if (!current(operation)) return
      update({ phase: 'save_failed', issue: issueFrom(error, '服务端保存尚未确认，请检查网络后重试保存。'), notice: null })
    }
  }

  async function confirm() {
    if (!reminderCanConfirm(state) || !state.policy) return
    const operation = ++version
    const mode: ReminderMode = state.longTerm ? 'long' : 'once'
    const input: SubscribeReminderInput = {
      requestId: options.createRequestId?.() ?? `reminder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`,
      mode,
      frequency: state.longTerm ? state.frequency : DEFAULT_REMINDER_FREQUENCY,
      templateId: state.policy[mode].templateId,
    }
    update({ phase: 'authorizing', issue: null, notice: null })
    try {
      // This call runs in the original confirm tap, before any await or cloud request.
      const authorization = await service.requestAuthorization(input.templateId)
      if (!current(operation)) return
      if (authorization !== 'accept' && authorization !== 'acceptWithAlert' && authorization !== 'acceptWithAudio') {
        update({
          phase: 'ready',
          issue: {
            code: authorization === 'ban' ? 'AUTHORIZATION_BLOCKED' : 'AUTHORIZATION_DENIED',
            message: authorization === 'ban'
              ? '微信已关闭此模板的订阅权限，本次未保存新计划。请在微信的小程序设置中检查订阅消息权限后再试。'
              : '你没有同意微信订阅，本次未保存新计划，原有计划不会因此改变。',
          },
        })
        return
      }
      update({ phase: 'saving', pendingGrant: input })
      await save(input, operation)
    } catch (error) {
      if (!current(operation)) return
      update({ phase: 'ready', issue: issueFrom(error, '未能完成微信订阅授权，本次未保存新计划，请重试。') })
    }
  }

  async function retrySave() {
    if (state.phase !== 'save_failed' || !state.pendingGrant) return
    const input = state.pendingGrant
    const operation = ++version
    update({ phase: 'saving', issue: null, notice: null })
    await save(input, operation)
  }

  async function discardPendingAndReload() {
    if (state.phase !== 'save_failed' || !state.pendingGrant) return
    update({ pendingGrant: null })
    await loadSettings('已重新读取当前计划。放弃重试不会撤回此前已提交的保存，请以当前状态为准。')
  }

  async function cancel() {
    if (!reminderCanCancel(state) || !state.subscription) return
    const generation = state.subscription.generation
    const operation = ++version
    update({ phase: 'cancelling', issue: null, notice: null })
    try {
      const subscription = await service.cancel(generation)
      if (!current(operation)) return
      if (subscription && (subscription.generation !== generation || subscription.status !== 'stopped')) {
        throw new ReminderError('STALE_GENERATION', '提醒计划已变化，停止操作尚未确认。')
      }
      update({ phase: 'cancelled', subscription, issue: null, notice: '已停止后续提醒。已提交至微信的消息无法撤回。' })
      if (current(operation)) options.onUpdated?.(subscription)
    } catch (error) {
      if (!current(operation)) return
      const issue = issueFrom(error, '停止提醒尚未确认，请检查网络并重新读取当前计划。')
      if (issue.code !== 'STALE_GENERATION') {
        update({ phase: 'error', policy: null, subscription: null, issue, notice: '未确认停止成功，请重新读取当前计划。' })
        return
      }
      update({ phase: 'refreshing', issue: null })
      try {
        const settings = await service.getSettings()
        if (!current(operation)) return
        update({
          phase: 'ready', policy: settings.policy, subscription: settings.subscription,
          issue: { code: 'STALE_GENERATION', message: '提醒计划已变化，本次未停止新的计划。已重新读取，请核对后再操作。' },
        })
      } catch (refreshError) {
        if (!current(operation)) return
        const refreshIssue = issueFrom(refreshError, '未能重新读取提醒设置，请检查网络后重试。')
        update({ phase: 'error', policy: null, subscription: null, issue: refreshIssue, notice: '计划已变化，停止尚未确认；请先重新读取当前计划。' })
      }
    }
  }

  return {
    getState: () => state,
    load: () => loadSettings(),
    confirm,
    retrySave,
    discardPendingAndReload,
    cancel,
    setLongTerm(value: boolean) {
      if (!reminderCanEdit(state) || state.longTerm === value) return
      update({ longTerm: value, phase: 'ready', issue: null, notice: null })
    },
    setFrequency(value: ReminderFrequency) {
      if (!reminderCanEdit(state) || !state.longTerm || !isReminderFrequency(value) || state.frequency === value) return
      update({ frequency: value, phase: 'ready', issue: null, notice: null })
    },
    close() {
      if (state.phase === 'closed') return
      ++version
      update({ phase: 'closed' })
    },
  }
}
