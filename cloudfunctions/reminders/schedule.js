const contract = require('./contract.json')

const DAY_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const SEND_OFFSET_MS = (contract.sendHour * 60 + contract.sendMinute) * 60 * 1000

function nextMorning(now) {
  const calendarDay = Math.floor((now + SHANGHAI_OFFSET_MS) / DAY_MS)
  return (calendarDay + 1) * DAY_MS - SHANGHAI_OFFSET_MS + SEND_OFFSET_MS
}

function nextCadence(scheduledAt, now, frequency) {
  const interval = contract.frequencies.find(item => item.id === frequency).days * DAY_MS
  // Retain the plan's calendar-day cadence, skipping every elapsed slot in one step.
  return scheduledAt + Math.max(1, Math.floor((now - scheduledAt) / interval) + 1) * interval
}

module.exports = { nextMorning, nextCadence }
