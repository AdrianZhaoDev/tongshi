import { REMINDER_CONTRACT, reminderCloudEnvironment } from '../config/reminders'
import { ReminderError } from '../domain/reminders'

interface WeChatCloud {
  init(options: { env: string; traceUser: boolean }): unknown
  callFunction(options: {
    name: string
    data: Record<string, unknown>
    success(response: { result?: unknown }): void
    fail(error: unknown): void
  }): unknown
}

export interface WeChatRuntime {
  cloud?: WeChatCloud
  requestSubscribeMessage?: (options: {
    tmplIds: string[]
    success(response: Record<string, unknown>): void
    fail(error: unknown): void
  }) => unknown
}

export interface WeChatServiceOptions {
  readonly cloudEnvironment?: string
  readonly runtime?: () => WeChatRuntime
}

declare const wx: WeChatRuntime | undefined

function nativeRuntime(): WeChatRuntime {
  let runtime: WeChatRuntime | undefined
  // #ifdef MP-WEIXIN
  if (typeof wx !== 'undefined') runtime = wx
  // #endif
  if (!runtime) {
    throw new ReminderError('WECHAT_ONLY', '云端领取与提醒仅支持微信小程序，请在微信中打开通识卡。')
  }
  return runtime
}

function unwrapCloudResult(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReminderError('INVALID_RESPONSE', '云函数没有返回有效结果，请重新读取或联系运营者检查部署。')
  }
  const result = value as Record<string, unknown>
  if (result.ok === true && Object.prototype.hasOwnProperty.call(result, 'data')) return result.data
  if (result.ok === false && typeof result.error === 'object' && result.error !== null) {
    const error = result.error as Record<string, unknown>
    if (typeof error.code === 'string' && error.code.trim() && typeof error.message === 'string' && error.message.trim()) {
      throw new ReminderError(error.code, error.message)
    }
  }
  throw new ReminderError('INVALID_RESPONSE', '云函数返回格式不正确，请重新读取或联系运营者检查部署。')
}

// All consumers share initialization for the same native cloud object/environment.
const initializedEnvironments = new WeakMap<WeChatCloud, string>()

export function createWeChatCloudClient(options: WeChatServiceOptions = {}) {
  const environment = options.cloudEnvironment === undefined
    ? reminderCloudEnvironment(import.meta.env)
    : options.cloudEnvironment.trim()
  const getRuntime = options.runtime ?? nativeRuntime

  function call(data: Record<string, unknown>): Promise<unknown> {
    if (!environment) {
      return Promise.reject(new ReminderError(
        'CLOUD_ENV_NOT_CONFIGURED',
        '尚未配置微信云环境。请联系运营者设置 VITE_WECHAT_CLOUD_ENV 并部署 reminders 云函数后再试。',
      ))
    }
    let cloud: WeChatCloud
    try {
      const runtime = getRuntime()
      if (!runtime.cloud || typeof runtime.cloud.init !== 'function' || typeof runtime.cloud.callFunction !== 'function') {
        throw new ReminderError('WECHAT_CLOUD_UNAVAILABLE', '当前微信环境不支持云开发，请更新微信；如仍不可用，请联系运营者检查云开发配置。')
      }
      cloud = runtime.cloud
      if (initializedEnvironments.get(cloud) !== environment) {
        cloud.init({ env: environment, traceUser: false })
        initializedEnvironments.set(cloud, environment)
      }
    } catch (error) {
      return Promise.reject(error instanceof ReminderError
        ? error
        : new ReminderError('CLOUD_INITIALIZATION_FAILED', '未能初始化微信云环境，请联系运营者检查公开环境 ID 和云开发配置。'))
    }

    return new Promise((resolve, reject) => {
      try {
        cloud.callFunction({
          name: REMINDER_CONTRACT.functionName,
          data,
          success(response) {
            try {
              resolve(unwrapCloudResult(response.result))
            } catch (error) {
              reject(error)
            }
          },
          fail() {
            reject(new ReminderError('CLOUD_REQUEST_FAILED', '未能确认云端操作结果。请检查网络后重试；如仍失败，请联系运营者检查云函数部署与权限。'))
          },
        })
      } catch {
        reject(new ReminderError('CLOUD_REQUEST_FAILED', '未能调用云函数，请检查网络或联系运营者检查云函数部署。'))
      }
    })
  }

  return { call, getRuntime }
}
