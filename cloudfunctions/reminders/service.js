const { createHash, randomUUID } = require('node:crypto')
const contract = require('./contract.json')
const cards = require('./cards.json')
const { publicPolicy, templateData } = require('./configuration')
const { nextMorning, nextCadence } = require('./schedule')

const CLAIM_LIFETIME_MS = 120_000
const DISPATCH_WINDOW_MS = 40_000
const PAGE_SIZE = 50
const MAX_PAGES = 10
const SEND_CONCURRENCY = 5
const FREQUENCIES = new Set(contract.frequencies.map(item => item.id))
const CARD_IDS = new Set(cards.map(card => card.id))

class ReminderError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function fail(code, message) {
  throw new ReminderError(code, message)
}

function beijingDay(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function invalidProgress() {
  fail('PROGRESS_INVALID', '云端卡片进度暂时无法读取，原数据未改动，请稍后重试。')
}

function readProgress(record, today) {
  if (record === null) return { version: 1, viewed: [] }
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.version !== 1 ||
      !Array.isArray(record.viewed) || record.viewed.length > cards.length ||
      Object.keys(record).some(key => !['version', 'viewed', '_id'].includes(key))) invalidProgress()
  let previousDay = ''
  const seen = new Set()
  const viewed = []
  for (const entry of record.viewed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).length !== 2 || typeof entry.day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) || entry.day <= previousDay || entry.day > today ||
        !CARD_IDS.has(entry.cardId) || seen.has(entry.cardId)) invalidProgress()
    const date = Date.parse(`${entry.day}T00:00:00.000Z`)
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== entry.day) invalidProgress()
    viewed.push({ day: entry.day, cardId: entry.cardId })
    seen.add(entry.cardId)
    previousDay = entry.day
  }
  return { version: 1, viewed }
}

function nextCard(progress) {
  const viewedIds = new Set(progress.viewed.map(entry => entry.cardId))
  return cards.find(card => !viewedIds.has(card.id))
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function publicSubscription(plan) {
  if (!plan) return null
  const { generation, mode, frequency, status, nextSendAt, lastSentAt, lastResult } = plan
  return { generation, mode, frequency, status, nextSendAt, lastSentAt, lastResult }
}

function validateFields(event, allowed) {
  if (Object.keys(event).some(key => !allowed.includes(key))) fail('INVALID_REQUEST', '提醒请求包含不支持的字段。')
}

function validateText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)
}

function validateSubscribe(event) {
  validateFields(event, ['action', 'requestId', 'mode', 'frequency', 'templateId'])
  if (!validateText(event.requestId, 128) || !validateText(event.templateId, 256)) fail('INVALID_REQUEST', '提醒请求标识或模板不正确。')
  if (event.mode !== 'once' && event.mode !== 'long') fail('INVALID_REQUEST', '请选择正确的提醒方式。')
  if (!FREQUENCIES.has(event.frequency) || (event.mode === 'once' && event.frequency !== 'daily')) fail('INVALID_REQUEST', '请选择正确的提醒频率。')
}

function requireConfigured(configuration, mode, templateId) {
  const policy = configuration[mode]
  if (!policy.enabled) fail('MODE_DISABLED', '当前提醒方式尚未开放。')
  if (!policy.configured) fail('TEMPLATE_NOT_CONFIGURED', '提醒模板尚未配置完整，请联系小程序运营方。')
  if (policy.templateId !== templateId) fail('TEMPLATE_MISMATCH', '提醒模板已变更，请重新打开提醒设置并授权。')
}

function providerOutcome(result, thrown = false) {
  // wx-server-sdk 4.0.2 normalizes OpenAPI responses and rejections to errCode.
  // Only a real acknowledged response completes a once plan; transport failures do not.
  const code = result && result.errCode
  if (!thrown && code === 0) return { state: 'sent', result: 'sent' }
  if (code === 43101 || code === 40003) {
    return { state: 'failed', status: 'needs_authorization', result: code === 43101 ? 'authorization_required' : 'recipient_unavailable' }
  }
  if ((Number.isInteger(code) && code > 0) || code === -604101) {
    const results = {
      40037: 'template_invalid',
      41030: 'page_invalid',
      43107: 'subscription_blocked',
      43108: 'provider_concurrency_limited',
      45168: 'template_content_rejected',
      47003: 'template_data_invalid',
      '-604101': 'openapi_permission_missing',
    }
    return { state: 'failed', status: 'configuration_error', result: results[code] || 'provider_rejected' }
  }
  return { state: 'unknown', status: 'delivery_unknown', result: 'delivery_unknown' }
}

function applyOutcome(plan, outcome, scheduledAt, finishedAt) {
  if (outcome.state === 'sent') {
    return {
      ...plan,
      status: plan.mode === 'once' ? 'completed' : 'active',
      nextSendAt: plan.mode === 'once' ? null : nextCadence(scheduledAt, finishedAt, plan.frequency),
      lastSentAt: finishedAt,
      lastResult: 'sent',
      inFlight: null,
      updatedAt: finishedAt,
    }
  }
  return { ...plan, status: outcome.status, nextSendAt: null, lastResult: outcome.result, inFlight: null, updatedAt: finishedAt }
}

/**
 * The repository supplies atomic transactions across the private collections and a
 * keyset-paged due scan. Transaction callbacks contain no provider calls: the SDK
 * may retry a database conflict, but must never repeat a send as part of that retry.
 */
function createReminderService({ repository, provider, configuration, now = Date.now, uniqueId = randomUUID }) {
  async function openDaily(openid, event) {
    validateFields(event, ['action'])
    const progressId = `user_${hash(openid)}`
    const today = beijingDay(now())
    return repository.transaction(async transaction => {
      const progress = readProgress(await transaction.getProgress(progressId), today)
      if (progress.viewed.some(entry => entry.day === today)) return progress
      const card = nextCard(progress)
      if (!card) return progress
      const updated = { version: 1, viewed: [...progress.viewed, { day: today, cardId: card.id }] }
      await transaction.putProgress(progressId, updated)
      return updated
    })
  }

  async function subscribe(openid, event) {
    validateSubscribe(event)
    const subscriptionId = `user_${hash(openid)}`
    const receiptId = `request_${hash(JSON.stringify([openid, event.requestId]))}`
    const fingerprint = hash(JSON.stringify([event.mode, event.frequency, event.templateId]))
    const generation = uniqueId()
    const savedAt = now()
    return repository.transaction(async transaction => {
      const receipt = await transaction.getDelivery(receiptId)
      const current = await transaction.getSubscription(subscriptionId)
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', '此提醒请求已用于其他设置，请重新确认。')
        if (!current || current.generation !== receipt.generation) fail('STALE_GENERATION', '提醒设置已经更新，请刷新后查看当前计划。')
        return publicSubscription(current)
      }
      requireConfigured(configuration, event.mode, event.templateId)
      const plan = {
        generation,
        openid,
        mode: event.mode,
        frequency: event.frequency,
        templateId: event.templateId,
        status: 'active',
        nextSendAt: nextMorning(savedAt),
        lastSentAt: null,
        lastResult: null,
        inFlight: null,
        createdAt: savedAt,
        updatedAt: savedAt,
      }
      await transaction.putSubscription(subscriptionId, plan)
      // Durable tombstones prevent an old save retry from restoring a cancelled
      // plan or replacing a newer one. Do not apply TTL to these request receipts.
      await transaction.putDelivery(receiptId, {
        kind: 'subscription_request', subscriptionId, generation, fingerprint, createdAt: savedAt,
      })
      return publicSubscription(plan)
    })
  }

  async function cancel(openid, event) {
    validateFields(event, ['action', 'generation'])
    if (!validateText(event.generation, 128)) fail('INVALID_REQUEST', '取消提醒需要当前计划标识。')
    const subscriptionId = `user_${hash(openid)}`
    return repository.transaction(async transaction => {
      const current = await transaction.getSubscription(subscriptionId)
      if (!current) return null
      if (current.generation !== event.generation) fail('STALE_GENERATION', '提醒设置已经更新，未取消新的计划，请刷新后重试。')
      if (current.status === 'stopped') return publicSubscription(current)
      // A message already handed to WeChat cannot be recalled. Finishing that
      // send may update its private delivery record, never this stopped plan.
      const stopped = { ...current, status: 'stopped', nextSendAt: null, inFlight: null, lastResult: 'cancelled', updatedAt: now() }
      await transaction.putSubscription(subscriptionId, stopped)
      return publicSubscription(stopped)
    })
  }

  async function claim(candidate) {
    const claimedAt = now()
    const token = uniqueId()
    return repository.transaction(async transaction => {
      const plan = await transaction.getSubscription(candidate.id)
      if (!plan || plan.status !== 'active' || plan.nextSendAt !== candidate.nextSendAt || plan.nextSendAt > claimedAt) return null
      const deliveryId = `send_${hash(JSON.stringify([plan.generation, plan.nextSendAt]))}`
      const delivery = await transaction.getDelivery(deliveryId)
      if (delivery) {
        if (delivery.state === 'sending' && delivery.expiresAt > claimedAt) return null
        if (delivery.state === 'sending') {
          const outcome = { state: 'unknown', status: 'delivery_unknown', result: 'delivery_unknown' }
          await transaction.putDelivery(deliveryId, { ...delivery, ...outcome, finishedAt: claimedAt })
          await transaction.putSubscription(candidate.id, applyOutcome(plan, outcome, plan.nextSendAt, claimedAt))
        } else {
          // Normally the delivery and plan settle in the same transaction. This
          // also reconciles a pre-existing terminal slot without sending again.
          await transaction.putSubscription(candidate.id, applyOutcome(plan, delivery, plan.nextSendAt, delivery.finishedAt))
        }
        return null
      }
      const progress = readProgress(await transaction.getProgress(`user_${hash(plan.openid)}`), beijingDay(claimedAt))
      const card = nextCard(progress)
      if (!card) {
        const outcome = { state: 'skipped', status: 'completed', result: 'catalog_exhausted' }
        await transaction.putDelivery(deliveryId, {
          kind: 'send', subscriptionId: candidate.id, generation: plan.generation, scheduledAt: plan.nextSendAt,
          ...outcome, finishedAt: claimedAt,
        })
        await transaction.putSubscription(candidate.id, applyOutcome(plan, outcome, plan.nextSendAt, claimedAt))
        return null
      }
      const mode = configuration[plan.mode]
      if (!mode.enabled || !mode.configured || mode.templateId !== plan.templateId) {
        const outcome = {
          state: 'failed', status: 'configuration_error',
          result: !mode.enabled ? 'mode_disabled' : mode.templateId !== plan.templateId ? 'template_changed' : 'template_not_configured',
        }
        await transaction.putDelivery(deliveryId, {
          kind: 'send', subscriptionId: candidate.id, generation: plan.generation, scheduledAt: plan.nextSendAt,
          ...outcome, finishedAt: claimedAt,
        })
        await transaction.putSubscription(candidate.id, applyOutcome(plan, outcome, plan.nextSendAt, claimedAt))
        return null
      }
      const inFlight = { deliveryId, token, expiresAt: claimedAt + CLAIM_LIFETIME_MS }
      await transaction.putDelivery(deliveryId, {
        kind: 'send', subscriptionId: candidate.id, generation: plan.generation, scheduledAt: plan.nextSendAt,
        state: 'sending', token, claimedAt, expiresAt: inFlight.expiresAt,
        cardId: card.id, cardTitle: card.title,
      })
      // Write the plan as well as the delivery, so cancellation/replacement and
      // concurrent claims contend on the same document under snapshot isolation.
      await transaction.putSubscription(candidate.id, { ...plan, inFlight, updatedAt: claimedAt })
      return { subscriptionId: candidate.id, deliveryId, token, plan, cardTitle: card.title }
    })
  }

  async function finish(claimed, outcome) {
    const finishedAt = now()
    await repository.transaction(async transaction => {
      const delivery = await transaction.getDelivery(claimed.deliveryId)
      if (!delivery || delivery.state !== 'sending' || delivery.token !== claimed.token) return
      const current = await transaction.getSubscription(claimed.subscriptionId)
      await transaction.putDelivery(claimed.deliveryId, { ...delivery, ...outcome, finishedAt })
      if (current && current.generation === claimed.plan.generation && current.status === 'active' &&
          current.nextSendAt === claimed.plan.nextSendAt && current.inFlight && current.inFlight.token === claimed.token) {
        await transaction.putSubscription(claimed.subscriptionId, applyOutcome(current, outcome, claimed.plan.nextSendAt, finishedAt))
      }
    })
  }

  async function dispatchOne(candidate) {
    const claimed = await claim(candidate)
    if (!claimed) return 'skipped'
    const { plan } = claimed
    let outcome
    try {
      outcome = providerOutcome(await provider.send({
        touser: plan.openid,
        templateId: plan.templateId,
        page: 'pages/index/index',
        miniprogramState: 'formal',
        lang: 'zh_CN',
        data: templateData(configuration, plan.mode, plan.nextSendAt, claimed.cardTitle),
      }))
    } catch (error) {
      outcome = providerOutcome(error, true)
    }
    // If this write fails after sending, the durable sending latch survives.
    // Its expiry resolves to unknown; it is never leased out for another send.
    await finish(claimed, outcome)
    return outcome.state === 'sent' ? 'sent' : 'failed'
  }

  async function dispatch() {
    const startedAt = now()
    const deadline = startedAt + DISPATCH_WINDOW_MS
    const totals = { scanned: 0, sent: 0, skipped: 0, failed: 0 }
    let after = null
    for (let page = 0; page < MAX_PAGES && now() < deadline; page += 1) {
      const rows = await repository.listDue({ dueAt: startedAt, after, limit: PAGE_SIZE })
      if (!rows.length) break
      let position = 0
      await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, rows.length) }, async () => {
        while (position < rows.length && now() < deadline) {
          const candidate = rows[position++]
          totals.scanned += 1
          try {
            totals[await dispatchOne(candidate)] += 1
          } catch {
            totals.failed += 1
          }
        }
      }))
      if (position < rows.length || rows.length < PAGE_SIZE) break
      after = rows[rows.length - 1]
    }
    return totals
  }

  async function handle(event, trustedContext) {
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) fail('INVALID_REQUEST', '提醒请求格式不正确。')
      const context = trustedContext || {}
      if (event.Type === 'Timer') {
        if (context.SOURCE !== 'wx_trigger' || context.OPENID || context.FROM_OPENID) fail('FORBIDDEN', '只允许平台定时触发提醒派发。')
        return { ok: true, data: await dispatch() }
      }
      if (!['wx_client', 'wx_devtools'].includes(context.SOURCE) || !validateText(context.OPENID, 256) || context.FROM_OPENID || context.FROM_APPID) {
        fail('UNAUTHENTICATED', '请在当前小程序中重新打开提醒设置。')
      }
      let data
      if (event.action === 'getSettings') {
        validateFields(event, ['action'])
        const plan = await repository.getSubscription(`user_${hash(context.OPENID)}`)
        data = { policy: publicPolicy(configuration), subscription: publicSubscription(plan) }
      } else if (event.action === 'openDaily') {
        data = await openDaily(context.OPENID, event)
      } else if (event.action === 'subscribe') {
        data = await subscribe(context.OPENID, event)
      } else if (event.action === 'cancel') {
        data = await cancel(context.OPENID, event)
      } else {
        fail('INVALID_REQUEST', '不支持此提醒操作。')
      }
      return { ok: true, data }
    } catch (error) {
      if (error instanceof ReminderError) return { ok: false, error: { code: error.code, message: error.message } }
      return { ok: false, error: { code: 'STORAGE_ERROR', message: '云端数据暂时无法读取或保存，请稍后重试。' } }
    }
  }

  return { handle }
}

module.exports = { createReminderService, CLAIM_LIFETIME_MS }
