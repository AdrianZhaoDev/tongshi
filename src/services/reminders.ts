import {
  ReminderError,
  parseReminderSettings,
  parseReminderSubscription,
  type ReminderAuthorization,
  type ReminderService,
} from '../domain/reminders'
import { createWeChatCloudClient, type WeChatServiceOptions } from './wechat-cloud'

export function createReminderService(options: WeChatServiceOptions = {}): ReminderService {
  const { call: cloudCall, getRuntime } = createWeChatCloudClient(options)

  return {
    async getSettings() {
      return parseReminderSettings(await cloudCall({ action: 'getSettings' }))
    },
    requestAuthorization(templateId) {
      // Do not put a cloud request or an await before this native call: WeChat requires the confirm gesture.
      return new Promise<ReminderAuthorization>((resolve, reject) => {
        try {
          if (!templateId.trim()) {
            throw new ReminderError('TEMPLATE_NOT_CONFIGURED', '微信订阅模板尚未配置，无法发起授权，请联系运营者。')
          }
          const runtime = getRuntime()
          if (typeof runtime.requestSubscribeMessage !== 'function') {
            throw new ReminderError('WECHAT_SUBSCRIBE_UNAVAILABLE', '当前微信环境不支持订阅消息，请更新微信后再试。')
          }
          runtime.requestSubscribeMessage({
            tmplIds: [templateId],
            success(response) {
              const result = response[templateId]
              if (result === 'accept' || result === 'acceptWithAlert' || result === 'acceptWithAudio' || result === 'reject' || result === 'ban') {
                resolve(result)
              } else {
                reject(new ReminderError('AUTHORIZATION_UNCONFIRMED', '微信没有返回所选模板的明确授权结果，本次未保存新计划。请重试。'))
              }
            },
            fail(error) {
              const message = typeof error === 'object' && error !== null && 'errMsg' in error && typeof error.errMsg === 'string'
                ? error.errMsg.toLowerCase() : ''
              reject(message.includes('cancel')
                ? new ReminderError('AUTHORIZATION_CANCELLED', '已取消微信授权，本次未保存新计划，原有计划不会因此改变。')
                : new ReminderError('AUTHORIZATION_FAILED', '微信订阅授权未完成，本次未保存新计划。请检查微信订阅消息设置，或联系运营者核对模板类别与权限。'))
            },
          })
        } catch (error) {
          reject(error instanceof ReminderError
            ? error
            : new ReminderError('AUTHORIZATION_FAILED', '未能发起微信订阅授权，本次未保存新计划，请重试。'))
        }
      })
    },
    async subscribe(input) {
      const subscription = parseReminderSubscription(await cloudCall({
        action: 'subscribe',
        requestId: input.requestId,
        mode: input.mode,
        frequency: input.frequency,
        templateId: input.templateId,
      }))
      if (!subscription) {
        throw new ReminderError('INVALID_RESPONSE', '服务端未返回已保存的提醒计划，请重试保存以核对同一请求。')
      }
      return subscription
    },
    async cancel(generation) {
      return parseReminderSubscription(await cloudCall({ action: 'cancel', generation }))
    },
  }
}
