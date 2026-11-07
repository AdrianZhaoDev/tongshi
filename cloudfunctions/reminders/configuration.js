const contract = require('./contract.json')
const cards = require('./cards.json')

const FIELD_NAME = /^(thing|number|letter|symbol|character_string|time|date|amount|phone_number|car_number|name|phrase|enum)\d+$/
const REPLACEMENT = /\{\{(scheduledAt|date|cardTitle)\}\}/g
const REPLACEMENT_LENGTHS = {
  scheduledAt: 16,
  date: 10,
  cardTitle: cards.reduce((length, card) => Math.max(length, card.title.length), 0),
}

function parseTemplateData(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const data = JSON.parse(raw)
    if (!data || Array.isArray(data) || typeof data !== 'object' || !Object.keys(data).length) return null
    let hasCardTitle = false
    for (const [field, entry] of Object.entries(data)) {
      if (!FIELD_NAME.test(field) || !entry || Array.isArray(entry) || typeof entry !== 'object') return null
      if (Object.keys(entry).length !== 1 || typeof entry.value !== 'string' || !entry.value.trim()) return null
      if (/[\u0000-\u001f\u007f]/.test(entry.value)) return null
      const literal = entry.value.replace(REPLACEMENT, '')
      if (literal.includes('{{') || literal.includes('}}')) return null
      if (entry.value.includes('{{cardTitle}}')) {
        // Chinese card titles belong in the account's real thing field, not a
        // shorter name/phrase field or an invented fallback template mapping.
        if (!/^thing\d+$/.test(field)) return null
        hasCardTitle = true
      }
      // WeChat thing values allow at most 20 characters. Counting UTF-16 code
      // units is conservative for supplementary characters; never truncate titles.
      if (/^thing\d+$/.test(field) && entry.value.replace(REPLACEMENT, (_, name) => ' '.repeat(REPLACEMENT_LENGTHS[name])).length > 20) return null
    }
    return hasCardTitle ? data : null
  } catch {
    return null
  }
}

function readConfiguration(env) {
  const modes = {}
  for (const mode of ['once', 'long']) {
    const prefix = `REMINDER_${mode.toUpperCase()}`
    const flag = env[`${prefix}_ENABLED`]
    const validFlag = flag === undefined || flag === 'true' || flag === 'false'
    const rawId = env[`${prefix}_TEMPLATE_ID`]
    const templateId = typeof rawId === 'string' ? rawId.trim() : ''
    const data = parseTemplateData(env[`${prefix}_TEMPLATE_DATA`])
    modes[mode] = {
      enabled: flag !== 'false',
      configured: validFlag && !!templateId && !/\s/.test(templateId) && !!data,
      templateId,
      data,
    }
  }
  return modes
}

function publicPolicy(configuration) {
  const { version, timezone, sendHour, sendMinute, frequencies } = contract
  const publicMode = mode => ({
    enabled: configuration[mode].enabled,
    configured: configuration[mode].configured,
    templateId: configuration[mode].templateId,
  })
  return { version, timezone, sendHour, sendMinute, frequencies, once: publicMode('once'), long: publicMode('long') }
}

function templateData(configuration, mode, scheduledAt, cardTitle) {
  // Shanghai has UTC+8 calendar days throughout this application's scheduling range.
  const dateTime = new Date(scheduledAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
  const replacements = { scheduledAt: dateTime, date: dateTime.slice(0, 10), cardTitle }
  return Object.fromEntries(Object.entries(configuration[mode].data).map(([key, entry]) => [key, {
    value: entry.value.replace(REPLACEMENT, (_, name) => replacements[name]),
  }]))
}

module.exports = { readConfiguration, publicPolicy, templateData }
