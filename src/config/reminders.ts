import sharedContract from '../../cloudfunctions/reminders/contract.json'

export type ReminderFrequency = 'daily' | 'every2days' | 'weekly'

export interface ReminderFrequencyOption {
  readonly id: ReminderFrequency
  readonly days: number
  readonly label: string
}

export const REMINDER_CONTRACT = sharedContract as {
  readonly version: number
  readonly functionName: string
  readonly timezone: string
  readonly sendHour: number
  readonly sendMinute: number
  readonly frequencies: readonly ReminderFrequencyOption[]
}

const daily = REMINDER_CONTRACT.frequencies.find((frequency) => frequency.days === 1)
if (!daily) {
  throw new Error('提醒协议缺少每日频率配置。')
}

export const DEFAULT_REMINDER_FREQUENCY = daily.id

export function reminderCloudEnvironment(environment: Record<string, unknown>): string {
  const value = environment.VITE_WECHAT_CLOUD_ENV
  return typeof value === 'string' ? value.trim() : ''
}
