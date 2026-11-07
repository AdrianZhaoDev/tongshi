import { CARDS_DATA } from '../domain/cards'
import { parseViewedHistory, type ViewedDay } from '../domain/daily-feed'
import { ReminderError } from '../domain/reminders'
import { createWeChatCloudClient, type WeChatServiceOptions } from './wechat-cloud'

export function createDailyFeedService(options: WeChatServiceOptions = {}) {
  const cloud = createWeChatCloudClient(options)
  return {
    async openDaily(): Promise<ViewedDay[]> {
      // No identity, date, card choice or local history is sent by the client.
      const result = await cloud.call({ action: 'openDaily' })
      try {
        if (typeof result !== 'object' || result === null || Array.isArray(result)) {
          throw new TypeError('Expected authoritative viewed history')
        }
        return parseViewedHistory(result, CARDS_DATA)
      } catch {
        throw new ReminderError('INVALID_RESPONSE', '云端领取记录无法识别，未在本机补发或替换卡片。请重新读取；如仍失败，请联系运营者。')
      }
    },
  }
}
