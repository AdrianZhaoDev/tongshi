const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const Module = require('node:module')
const test = require('node:test')
const contract = require('../cloudfunctions/reminders/contract.json')
const cards = require('../cloudfunctions/reminders/cards.json')
const { createReminderService, CLAIM_LIFETIME_MS } = require('../cloudfunctions/reminders/service')
const { readConfiguration, templateData } = require('../cloudfunctions/reminders/configuration')
const { createCloudRepository, createWeChatProvider } = require('../cloudfunctions/reminders/cloud')

// These IDs and providers exist only in this isolated test boundary, never in
// deployment configuration. No test imports or calls the real platform SDK.
const environment = {
  REMINDER_ONCE_TEMPLATE_ID: 'isolated-once-template',
  REMINDER_LONG_TEMPLATE_ID: 'isolated-long-template',
  REMINDER_ONCE_TEMPLATE_DATA: JSON.stringify({ thing1: { value: '{{cardTitle}}' }, time2: { value: '{{scheduledAt}}' } }),
  REMINDER_LONG_TEMPLATE_DATA: JSON.stringify({ thing3: { value: '{{cardTitle}}' }, date4: { value: '{{date}}' } }),
}
const owner = { SOURCE: 'wx_client', OPENID: 'isolated-owner' }
const timer = { SOURCE: 'wx_trigger' }
const clone = value => structuredClone(value)
const timestamp = value => Date.parse(value)

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

/**
 * An isolated, atomic SDK-shaped database fixture. The production repository is
 * used by all business tests, including its keyset filters, field projection,
 * document.set shape, null reads, and cross-collection transactions. Transactions
 * serialize and roll back, with optional conflict replay/ambiguous commit faults.
 */
function databaseFixture() {
  let tables = { reminder_subscriptions: new Map(), reminder_deliveries: new Map(), card_progress: new Map() }
  let queue = Promise.resolve()
  const fixture = { failBeforeCommit: 0, failAfterCommit: 0, replayTransactions: false, queries: [], transactionCalls: 0 }
  const copyTables = source => Object.fromEntries(Object.entries(source).map(([key, rows]) => [key, new Map(clone([...rows]))]))
  const command = {
    and: items => ({ operator: 'and', items }),
    or: items => ({ operator: 'or', items }),
    lte: value => ({ operator: 'lte', value }),
    gt: value => ({ operator: 'gt', value }),
    eq: value => ({ operator: 'eq', value }),
  }
  function matches(record, condition) {
    if (condition.operator === 'and') return condition.items.every(item => matches(record, item))
    if (condition.operator === 'or') return condition.items.some(item => matches(record, item))
    return Object.entries(condition).every(([key, expected]) => {
      if (!expected || typeof expected !== 'object') return record[key] === expected
      if (expected.operator === 'lte') return record[key] <= expected.value
      if (expected.operator === 'gt') return record[key] > expected.value
      if (expected.operator === 'eq') return record[key] === expected.value
      throw new Error('Unsupported fixture query operator')
    })
  }
  function scope(getTables) {
    return {
      collection(name) {
        assert.ok(Object.hasOwn(tables, name), 'only the three private collections are used')
        const orders = []
        let condition = {}
        let maximum = 100
        let fields = null
        const collection = {
          doc(id) {
            return {
              async get() { return { data: clone(getTables()[name].get(id) || null) } },
              async set({ data }) {
                assert.equal(Object.hasOwn(data, '_id'), false, 'document.set must not send immutable _id')
                const exists = getTables()[name].has(id)
                getTables()[name].set(id, { ...clone(data), _id: id })
                return { _id: id, stats: { created: Number(!exists), updated: Number(exists) } }
              },
            }
          },
          where(value) { condition = value; return collection },
          orderBy(field, direction) { orders.push([field, direction]); return collection },
          field(value) { fields = value; return collection },
          limit(value) { maximum = value; assert.ok(value <= 100); return collection },
          async get() {
            fixture.queries.push({ name, condition: clone(condition), maximum })
            const rows = [...getTables()[name].values()].filter(row => matches(row, condition)).sort((a, b) => {
              for (const [key, direction] of orders) {
                if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (direction === 'asc' ? 1 : -1)
              }
              return 0
            }).slice(0, maximum)
            return { data: rows.map(row => fields ? Object.fromEntries(Object.keys(fields).filter(key => fields[key]).map(key => [key, clone(row[key])])) : clone(row)) }
          },
        }
        return collection
      },
    }
  }
  fixture.database = {
    command,
    collection: name => scope(() => tables).collection(name),
    async runTransaction(callback) {
      fixture.transactionCalls += 1
      const previous = queue
      let unlock
      queue = new Promise(resolve => { unlock = resolve })
      await previous
      try {
        if (fixture.replayTransactions) {
          const replay = copyTables(tables)
          await callback(scope(() => replay))
        }
        const working = copyTables(tables)
        const result = await callback(scope(() => working))
        if (fixture.failBeforeCommit > 0) {
          fixture.failBeforeCommit -= 1
          throw new Error('isolated uncommitted database outage')
        }
        tables = working
        if (fixture.failAfterCommit > 0) {
          fixture.failAfterCommit -= 1
          throw new Error('isolated lost commit acknowledgment')
        }
        return result
      } finally {
        unlock()
      }
    },
  }
  fixture.subscriptions = () => clone([...tables.reminder_subscriptions.values()])
  fixture.deliveries = () => clone([...tables.reminder_deliveries.values()])
  fixture.progress = () => clone([...tables.card_progress.values()])
  fixture.seed = (collection, id, data) => tables[collection].set(id, { ...clone(data), _id: id })
  return fixture
}

function harness({ env = {}, send = async () => ({ errCode: 0, errMsg: 'openapi.subscribeMessage.send:ok' }) } = {}) {
  let time = timestamp('2026-11-06T02:00:00Z')
  let serial = 0
  let request = 0
  const fixture = databaseFixture()
  const calls = []
  const repository = createCloudRepository(fixture.database)
  const provider = createWeChatProvider({ openapi: { subscribeMessage: { async send(message) {
    calls.push(clone(message))
    return send(message, calls.length, fixture)
  } } } })
  const configuration = readConfiguration({ ...environment, ...env })
  const service = createReminderService({ repository, provider, configuration, now: () => time, uniqueId: () => `isolated-generation-${++serial}` })
  return {
    fixture, calls, service, repository,
    at(value) { time = typeof value === 'string' ? timestamp(value) : value },
    now: () => time,
    settings: (context = owner) => service.handle({ action: 'getSettings' }, context),
    save: (input = {}, context = owner) => service.handle({
      action: 'subscribe', requestId: `isolated-request-${++request}`, mode: 'once', frequency: 'daily',
      templateId: environment.REMINDER_ONCE_TEMPLATE_ID, ...input,
    }, context),
    cancel: (generation, context = owner) => service.handle({ action: 'cancel', generation }, context),
    open: (context = owner) => service.handle({ action: 'openDaily' }, context),
    tick: (context = timer) => service.handle({ Type: 'Timer' }, context),
  }
}

async function planOf(h, context = owner) {
  const result = await h.settings(context)
  assert.equal(result.ok, true)
  return result.data.subscription
}

function assertError(result, code) {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, code)
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message'])
}

function longInput(frequency, requestId = `long-${frequency}`) {
  return { requestId, mode: 'long', frequency, templateId: environment.REMINDER_LONG_TEMPLATE_ID }
}

test('capabilities come from the shared contract, expose no template data, and never fabricate configuration', async () => {
  const h = harness({ env: { REMINDER_ONCE_TEMPLATE_ID: '', REMINDER_LONG_TEMPLATE_DATA: '' } })
  const result = await h.settings()
  assert.equal(result.ok, true)
  assert.equal(result.data.subscription, null)
  const policy = result.data.policy
  for (const key of ['version', 'timezone', 'sendHour', 'sendMinute', 'frequencies']) assert.deepEqual(policy[key], contract[key])
  assert.deepEqual(policy.once, { enabled: true, configured: false, templateId: '' })
  assert.deepEqual(policy.long, { enabled: true, configured: false, templateId: environment.REMINDER_LONG_TEMPLATE_ID })
  assert.equal(JSON.stringify(policy).includes('亲子'), false)
  assert.equal(h.fixture.subscriptions().length + h.fixture.deliveries().length, 0)
  assertError(await h.save(), 'TEMPLATE_NOT_CONFIGURED')
  assertError(await h.save(longInput('daily')), 'TEMPLATE_NOT_CONFIGURED')
})

test('explicit policy disablement, malformed mapping, and unknown replacement block save without fake fallbacks', async () => {
  const disabled = harness({ env: { REMINDER_LONG_ENABLED: 'false' } })
  assertError(await disabled.save(longInput('weekly')), 'MODE_DISABLED')
  assert.equal((await disabled.settings()).data.policy.once.configured, true)
  for (const raw of ['{}', 'null', '[]', '{', JSON.stringify({ thing1: { value: '{{cardTitle}}' }, thing2: { value: '{{openid}}' } }), JSON.stringify({ thing1: { value: '{{cardTitle}}', extra: true } })]) {
    const h = harness({ env: { REMINDER_ONCE_TEMPLATE_DATA: raw } })
    assertError(await h.save(), 'TEMPLATE_NOT_CONFIGURED')
    assert.equal(h.fixture.subscriptions().length, 0)
  }
  const invalidFlag = harness({ env: { REMINDER_ONCE_ENABLED: 'yes' } })
  assert.equal((await invalidFlag.settings()).data.policy.once.configured, false)
})

test('only SDK identity is accepted; event identity and timer source cannot be spoofed', async () => {
  const h = harness()
  for (const context of [{}, { SOURCE: 'wx_http', OPENID: owner.OPENID }, { SOURCE: 'wx_trigger', OPENID: owner.OPENID }, { SOURCE: 'wx_client,scf', OPENID: owner.OPENID }]) {
    assertError(await h.save({}, context), 'UNAUTHENTICATED')
  }
  assertError(await h.save({ openid: 'other-user' }), 'INVALID_REQUEST')
  assertError(await h.service.handle({ action: 'getSettings', OPENID: 'other-user' }, owner), 'INVALID_REQUEST')
  assertError(await h.service.handle({ Type: 'Timer', SOURCE: 'wx_trigger', OPENID: '' }, owner), 'FORBIDDEN')
  assertError(await h.service.handle({ Type: 'Timer' }, { SOURCE: 'wx_client,wx_trigger' }), 'FORBIDDEN')
  assertError(await h.tick({ ...timer, OPENID: owner.OPENID }), 'FORBIDDEN')
  assertError(await h.service.handle({ action: 'dispatch' }, owner), 'INVALID_REQUEST')
  assert.equal(h.fixture.subscriptions().length, 0)
  assert.equal(h.calls.length, 0)
  const saved = await h.save()
  assert.equal(saved.ok, true)
  assert.equal(await planOf(h, { SOURCE: 'wx_client', OPENID: 'other-user' }), null)
  assert.deepEqual(Object.keys(saved.data).sort(), ['generation', 'mode', 'frequency', 'status', 'nextSendAt', 'lastSentAt', 'lastResult'].sort())
  assert.equal(JSON.stringify(saved.data).includes(owner.OPENID), false)
})

test('subscribe rejects unsupported cadence, mismatched templates, and client-controlled page/data', async () => {
  const h = harness()
  for (const input of [{ frequency: 'monthly' }, { frequency: 'weekly' }, { mode: 'other' }, { requestId: '' }, { page: 'other/page' }, { data: { thing1: { value: 'user text' } } }]) {
    assertError(await h.save(input), 'INVALID_REQUEST')
  }
  assertError(await h.save({ templateId: environment.REMINDER_LONG_TEMPLATE_ID }), 'TEMPLATE_MISMATCH')
  assert.equal(h.fixture.subscriptions().length + h.fixture.deliveries().length, 0)
})

test('first reminder is always next Shanghai calendar day at 09:00, including year and leap-day rollover', async () => {
  const examples = [
    ['2026-11-05T15:59:59.999Z', '2026-11-06T01:00:00Z'],
    ['2026-11-05T16:00:00Z', '2026-11-07T01:00:00Z'],
    ['2026-11-06T00:59:00Z', '2026-11-07T01:00:00Z'],
    ['2026-11-06T01:01:00Z', '2026-11-07T01:00:00Z'],
    ['2026-12-31T12:00:00Z', '2027-01-01T01:00:00Z'],
    ['2028-02-28T16:00:00Z', '2028-03-01T01:00:00Z'],
  ]
  for (const [now, expected] of examples) {
    const h = harness()
    h.at(now)
    const saved = await h.save()
    assert.equal(saved.ok, true)
    assert.equal(saved.data.nextSendAt, timestamp(expected), now)
    assert.equal(saved.data.status, 'active')
    assert.equal(h.calls.length, 0)
  }
})

test('save retries are durable across lost commit acknowledgments and cannot reset the schedule', async () => {
  const h = harness()
  h.fixture.failAfterCommit = 1
  assertError(await h.save({ requestId: 'stable-save-request' }), 'STORAGE_ERROR')
  const committed = await planOf(h)
  h.at('2026-11-08T04:00:00Z')
  const retried = await h.save({ requestId: 'stable-save-request' })
  assert.deepEqual(retried.data, committed)
  assert.equal(h.fixture.subscriptions().length, 1)
  assert.equal(h.fixture.deliveries().length, 1)
  assertError(await h.save({ ...longInput('daily'), requestId: 'stable-save-request' }), 'REQUEST_CONFLICT')
})

test('concurrent identical saves and database callback replays create exactly one generation and no sends', async () => {
  const h = harness()
  h.fixture.replayTransactions = true
  const responses = await Promise.all(Array.from({ length: 8 }, () => h.save({ requestId: 'concurrent-request' })))
  assert.ok(responses.every(response => response.ok))
  assert.equal(new Set(responses.map(response => response.data.generation)).size, 1)
  assert.equal(h.fixture.deliveries().length, 1)
  assert.equal(h.fixture.subscriptions().length, 1)
  assert.equal(h.calls.length, 0)
})

test('superseded request receipts never restore old plans; cancelled same-request retries stay stopped', async () => {
  const h = harness()
  const original = await h.save({ requestId: 'original-request' })
  const replacement = await h.save(longInput('every2days', 'replacement-request'))
  assert.notEqual(original.data.generation, replacement.data.generation)
  assertError(await h.save({ requestId: 'original-request' }), 'STALE_GENERATION')
  assertError(await h.cancel(original.data.generation), 'STALE_GENERATION')
  assert.deepEqual(await planOf(h), replacement.data)
  const stopped = await h.cancel(replacement.data.generation)
  assert.equal(stopped.data.status, 'stopped')
  assert.equal(stopped.data.nextSendAt, null)
  assert.deepEqual((await h.save(longInput('every2days', 'replacement-request'))).data, stopped.data)
  assert.deepEqual((await h.cancel(replacement.data.generation)).data, stopped.data)
  const other = { SOURCE: 'wx_client', OPENID: 'other-user' }
  assert.deepEqual(await h.cancel(replacement.data.generation, other), { ok: true, data: null })
})

test('once delivery completes on a real acknowledgment and the server message uses the trusted recipient', async () => {
  const h = harness()
  const saved = await h.save()
  h.at(saved.data.nextSendAt - 1)
  assert.equal((await h.tick()).data.sent, 0)
  h.at(saved.data.nextSendAt)
  const dispatched = await h.tick()
  assert.equal(dispatched.data.sent, 1)
  assert.deepEqual(h.calls[0], {
    touser: owner.OPENID, templateId: environment.REMINDER_ONCE_TEMPLATE_ID,
    page: 'pages/index/index', miniprogramState: 'formal', lang: 'zh_CN',
    data: { thing1: { value: cards[0].title }, time2: { value: '2026-11-07 09:00' } },
  })
  const completed = await planOf(h)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.nextSendAt, null)
  assert.equal(completed.lastSentAt, h.now())
  assert.equal(completed.lastResult, 'sent')
  h.at('2026-12-01T02:00:00Z')
  await h.tick()
  assert.equal(h.calls.length, 1)
})

for (const [frequency, nextDay] of [['daily', '08'], ['every2days', '09'], ['weekly', '14']]) {
  test(`long ${frequency} advances calendar cadence and uses its own authorized template mapping`, async () => {
    const h = harness()
    const saved = await h.save(longInput(frequency))
    h.at(saved.data.nextSendAt)
    await h.tick()
    const plan = await planOf(h)
    assert.equal(plan.status, 'active')
    assert.equal(plan.nextSendAt, timestamp(`2026-11-${nextDay}T01:00:00Z`))
    assert.deepEqual(h.calls[0].data, { thing3: { value: cards[0].title }, date4: { value: '2026-11-07' } })
    assert.equal(h.calls[0].templateId, environment.REMINDER_LONG_TEMPLATE_ID)
    h.at(plan.nextSendAt)
    await h.tick()
    assert.equal(h.calls.length, 2)
  })
}

test('late timers skip missed slots without flooding, retain cadence, and keep reminding for unread cards', async () => {
  for (const [frequency, expected] of [['daily', '25'], ['every2days', '25'], ['weekly', '28']]) {
    const h = harness()
    await h.save(longInput(frequency))
    h.at('2026-11-24T04:00:00Z')
    await h.tick()
    await h.tick()
    const plan = await planOf(h)
    assert.equal(h.calls.length, 1)
    assert.equal(plan.nextSendAt, timestamp(`2026-11-${expected}T01:00:00Z`))
    assert.equal(plan.lastSentAt, h.now())
  }
})

test('explicit authorization/configuration rejections and ambiguous delivery stop without blind retries', async () => {
  const cases = [
    [{ errCode: 43101 }, 'needs_authorization', 'authorization_required'],
    [{ errCode: 47003 }, 'configuration_error', 'template_data_invalid'],
    [{ errCode: -604101 }, 'configuration_error', 'openapi_permission_missing'],
    [{ errCode: 43108 }, 'configuration_error', 'provider_concurrency_limited'],
    [{ errCode: -604102 }, 'delivery_unknown', 'delivery_unknown'],
    [{ errCode: -1 }, 'delivery_unknown', 'delivery_unknown'],
    [new Error('isolated network timeout, raw details must stay private'), 'delivery_unknown', 'delivery_unknown'],
  ]
  for (const [error, status, lastResult] of cases) {
    const h = harness({ send: async () => { throw error } })
    const saved = await h.save()
    h.at(saved.data.nextSendAt)
    await h.tick()
    const plan = await planOf(h)
    assert.equal(plan.status, status)
    assert.equal(plan.lastResult, lastResult)
    assert.equal(plan.lastSentAt, null)
    assert.equal(plan.nextSendAt, null)
    h.at('2026-11-30T02:00:00Z')
    await h.tick()
    assert.equal(h.calls.length, 1)
    assert.equal(JSON.stringify(plan).includes('raw details'), false)
  }
  const noAcknowledgment = harness({ send: async () => undefined })
  const saved = await noAcknowledgment.save()
  noAcknowledgment.at(saved.data.nextSendAt)
  await noAcknowledgment.tick()
  assert.equal((await planOf(noAcknowledgment)).status, 'delivery_unknown')
})

test('a rejected long grant stays long and paused; a fresh explicit authorization can replace it', async () => {
  const h = harness({ send: async () => { throw { errCode: 43101 } } })
  const saved = await h.save(longInput('weekly', 'long-authorization-request'))
  h.at(saved.data.nextSendAt)
  await h.tick()
  const paused = await planOf(h)
  assert.equal(paused.mode, 'long')
  assert.equal(paused.frequency, 'weekly')
  assert.equal(paused.status, 'needs_authorization')
  assert.equal(paused.nextSendAt, null)
  assert.equal(h.calls[0].templateId, environment.REMINDER_LONG_TEMPLATE_ID)
  assert.deepEqual((await h.save(longInput('weekly', 'long-authorization-request'))).data, paused)
  const replacement = await h.save(longInput('weekly', 'renewed-long-authorization'))
  assert.equal(replacement.data.status, 'active')
  assert.notEqual(replacement.data.generation, paused.generation)
  assert.equal(replacement.data.nextSendAt, timestamp('2026-11-08T01:00:00Z'))
  assert.equal(h.calls.length, 1)
})

test('configuration changes stop an existing plan rather than sending a different, unauthorized template', async () => {
  const h = harness()
  const saved = await h.save()
  const service = createReminderService({
    repository: h.repository, provider: { send: async () => { assert.fail('must not send changed template') } },
    configuration: readConfiguration({ ...environment, REMINDER_ONCE_TEMPLATE_ID: 'isolated-new-template' }), now: h.now,
  })
  h.at(saved.data.nextSendAt)
  await service.handle({ Type: 'Timer' }, timer)
  const plan = await planOf(h)
  assert.equal(plan.status, 'configuration_error')
  assert.equal(plan.lastResult, 'template_changed')
  assert.equal(plan.lastSentAt, null)
})

test('concurrent timers share an atomic per-slot claim and transaction retries never duplicate a send', async () => {
  const entered = deferred()
  const release = deferred()
  const h = harness({ send: async () => { entered.resolve(); await release.promise; return { errCode: 0 } } })
  const saved = await h.save()
  h.fixture.replayTransactions = true
  h.at(saved.data.nextSendAt)
  const first = h.tick()
  await entered.promise
  const other = await h.tick()
  assert.equal(other.data.sent, 0)
  assert.equal(h.calls.length, 1)
  assert.equal((await planOf(h)).status, 'active')
  release.resolve()
  await first
  await h.tick()
  assert.equal(h.calls.length, 1)
  assert.equal((await planOf(h)).status, 'completed')
})

test('cancel before dispatch sends nothing; cancel during an in-flight send cannot be overwritten by its stale result', async () => {
  const before = harness()
  const savedBefore = await before.save()
  await before.cancel(savedBefore.data.generation)
  before.at(savedBefore.data.nextSendAt)
  await before.tick()
  assert.equal(before.calls.length, 0)

  const entered = deferred()
  const release = deferred()
  const h = harness({ send: async () => { entered.resolve(); await release.promise; return { errCode: 0 } } })
  const saved = await h.save()
  h.at(saved.data.nextSendAt)
  const dispatching = h.tick()
  await entered.promise
  const cancelled = await h.cancel(saved.data.generation)
  release.resolve()
  await dispatching
  assert.deepEqual(await planOf(h), cancelled.data)
  assert.equal(cancelled.data.status, 'stopped')
  assert.equal(cancelled.data.lastSentAt, null)
  assert.equal(h.fixture.deliveries().filter(row => row.kind === 'send')[0].state, 'sent')
})

test('replacing a plan during delivery fences the old result from every field of the new generation', async () => {
  const entered = deferred()
  const release = deferred()
  const h = harness({ send: async () => { entered.resolve(); await release.promise; return { errCode: 0 } } })
  const saved = await h.save({ requestId: 'first-generation-request' })
  h.at(saved.data.nextSendAt)
  const dispatching = h.tick()
  await entered.promise
  const replacement = await h.save(longInput('weekly', 'second-generation-request'))
  release.resolve()
  await dispatching
  assert.deepEqual(await planOf(h), replacement.data)
  assertError(await h.save({ requestId: 'first-generation-request' }), 'STALE_GENERATION')
  assert.equal(h.calls.length, 1)
})

test('an abandoned or timed-out send claim expires to unknown and is never reassigned, even after a late acknowledgment', async () => {
  const entered = deferred()
  const release = deferred()
  const h = harness({ send: async () => { entered.resolve(); await release.promise; return { errCode: 0 } } })
  const saved = await h.save()
  h.at(saved.data.nextSendAt)
  const abandonedInvocation = h.tick()
  await entered.promise
  h.at(h.now() + CLAIM_LIFETIME_MS + 1)
  await h.tick()
  assert.equal((await planOf(h)).status, 'delivery_unknown')
  release.resolve()
  await abandonedInvocation
  await h.tick()
  assert.equal((await planOf(h)).status, 'delivery_unknown')
  assert.equal(h.calls.length, 1)
})

test('acknowledged send with lost settlement cannot be resent and never falsely completes once', async () => {
  const h = harness({ send: async (message, count, fixture) => {
    fixture.failBeforeCommit = 1
    return { errCode: 0 }
  } })
  const saved = await h.save()
  h.at(saved.data.nextSendAt)
  const dispatched = await h.tick()
  assert.equal(dispatched.data.sent, 0)
  assert.equal(dispatched.data.failed, 1)
  assert.equal((await planOf(h)).status, 'active')
  h.at(h.now() + CLAIM_LIFETIME_MS + 1)
  await h.tick()
  assert.equal((await planOf(h)).status, 'delivery_unknown')
  assert.equal(h.calls.length, 1)
})

test('failed database transactions roll back subscription and cancellation without claiming success', async () => {
  const h = harness()
  h.fixture.failBeforeCommit = 1
  assertError(await h.save({ requestId: 'uncommitted-request' }), 'STORAGE_ERROR')
  assert.equal(await planOf(h), null)
  assert.equal(h.fixture.deliveries().length, 0)
  const saved = await h.save({ requestId: 'uncommitted-request' })
  h.fixture.failBeforeCommit = 1
  assertError(await h.cancel(saved.data.generation), 'STORAGE_ERROR')
  assert.deepEqual(await planOf(h), saved.data)
})

test('keyset pagination passes a full page of locked plans so other due recipients are not starved', async () => {
  const h = harness()
  const due = timestamp('2026-11-07T01:00:00Z')
  h.at(due)
  for (let index = 0; index < 105; index += 1) {
    const id = `isolated-user-${String(index).padStart(3, '0')}`
    const generation = `seed-generation-${index}`
    const plan = {
      generation, openid: id, mode: 'long', frequency: 'daily', templateId: environment.REMINDER_LONG_TEMPLATE_ID,
      status: 'active', nextSendAt: due, lastSentAt: null, lastResult: null, inFlight: null, createdAt: due - 1000, updatedAt: due,
    }
    if (index < 50) {
      const deliveryId = `send_${createHash('sha256').update(JSON.stringify([generation, due])).digest('hex')}`
      plan.inFlight = { deliveryId, token: `seed-token-${index}`, expiresAt: due + CLAIM_LIFETIME_MS }
      h.fixture.seed('reminder_deliveries', deliveryId, {
        kind: 'send', subscriptionId: id, generation, scheduledAt: due, state: 'sending',
        token: plan.inFlight.token, claimedAt: due, expiresAt: plan.inFlight.expiresAt,
      })
    }
    h.fixture.seed('reminder_subscriptions', id, plan)
  }
  const result = await h.tick()
  assert.equal(result.ok, true)
  assert.equal(result.data.scanned, 105)
  assert.equal(result.data.sent, 55)
  assert.equal(result.data.skipped, 50)
  assert.equal(h.calls.length, 55)
  assert.ok(h.fixture.queries.length >= 3)
  assert.ok(h.fixture.queries.every(query => query.maximum === 50))
  h.at(due + CLAIM_LIFETIME_MS + 1)
  await h.tick()
  assert.equal(h.fixture.subscriptions().filter(row => row.status === 'delivery_unknown').length, 50)
  assert.equal(h.calls.length, 55)
})

test('production invocations re-read trusted identity and persist completion only after acknowledged delivery', async () => {
  const fixture = databaseFixture()
  const calls = []
  let context = owner
  const sdk = {
    DYNAMIC_CURRENT_ENV: Symbol('isolated current environment'),
    init() {},
    database: () => fixture.database,
    getWXContext: () => context,
    openapi: { subscribeMessage: { async send(message) { calls.push(clone(message)); return { errCode: 0, errMsg: 'openapi.subscribeMessage.send:ok' } } } },
  }
  const previousEnv = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]))
  const flags = ['REMINDER_ONCE_ENABLED', 'REMINDER_LONG_ENABLED']
  for (const key of flags) previousEnv[key] = process.env[key]
  const filename = require.resolve('../cloudfunctions/reminders/index')
  const originalLoad = Module._load
  try {
    Object.assign(process.env, environment)
    for (const key of flags) delete process.env[key]
    Module._load = function (request, parent, isMain) {
      return request === 'wx-server-sdk' ? sdk : originalLoad.call(this, request, parent, isMain)
    }
    delete require.cache[filename]
    const { main } = require(filename)
    Module._load = originalLoad
    const saved = await main({ action: 'subscribe', requestId: 'production-entrypoint-request', mode: 'once', frequency: 'daily', templateId: environment.REMINDER_ONCE_TEMPLATE_ID })
    assert.equal(saved.ok, true)
    assertError(await main({ Type: 'Timer', SOURCE: 'wx_trigger', OPENID: '' }), 'FORBIDDEN')
    const plan = fixture.subscriptions()[0]
    const { _id, ...data } = plan
    fixture.seed('reminder_subscriptions', _id, { ...data, nextSendAt: Date.now() - 1000 })
    context = timer
    const dispatched = await main({ Type: 'Timer' })
    assert.equal(dispatched.data.sent, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].touser, owner.OPENID)
    assert.equal(calls[0].page, 'pages/index/index')
    context = owner
    const settings = await main({ action: 'getSettings' })
    assert.equal(settings.data.subscription.status, 'completed')
    assert.equal(settings.data.subscription.generation, saved.data.generation)
  } finally {
    Module._load = originalLoad
    delete require.cache[filename]
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

function progressId(context = owner) {
  return `user_${createHash('sha256').update(context.OPENID).digest('hex')}`
}

async function collectCatalog(h, context = owner) {
  let history
  for (let index = 0; index < cards.length; index += 1) {
    h.at(Date.UTC(2026, 10, 6 + index, 2))
    const opened = await h.open(context)
    assert.equal(opened.ok, true)
    assert.equal(opened.data.viewed.length, index + 1)
    assert.equal(opened.data.viewed.at(-1).cardId, cards[index].id)
    history = opened.data
  }
  return history
}

test('openDaily returns only authoritative versioned history and isolates each trusted WeChat identity', async () => {
  const h = harness()
  const other = { SOURCE: 'wx_devtools', OPENID: 'another-isolated-owner' }
  const first = { version: 1, viewed: [{ day: '2026-11-06', cardId: cards[0].id }] }
  assert.deepEqual(await h.open(), { ok: true, data: first })
  assert.deepEqual(await h.open(), { ok: true, data: first })
  h.at('2026-11-07T02:00:00Z')
  const next = { version: 1, viewed: [...first.viewed, { day: '2026-11-07', cardId: cards[1].id }] }
  assert.deepEqual(await h.open(), { ok: true, data: next })
  assert.deepEqual(await h.open(other), { ok: true, data: { version: 1, viewed: [{ day: '2026-11-07', cardId: cards[0].id }] } })
  assert.deepEqual(await h.open(), { ok: true, data: next })
  assert.equal(h.fixture.progress().length, 2)
  assert.equal(JSON.stringify(next).includes(owner.OPENID), false)
  assert.equal(JSON.stringify(next).includes('_id'), false)
  assert.equal(h.fixture.subscriptions().length + h.fixture.deliveries().length, 0)
  assert.equal(h.calls.length, 0)
})

test('openDaily rejects client dates, identities, and local history under the existing authentication boundary', async () => {
  const h = harness()
  for (const context of [{}, timer, { SOURCE: 'wx_http', OPENID: owner.OPENID }, { ...owner, FROM_OPENID: 'other' }]) {
    assertError(await h.open(context), 'UNAUTHENTICATED')
  }
  for (const fields of [
    { day: '2030-01-01' }, { OPENID: 'other' }, { openid: 'other' },
    { viewed: [{ day: '2026-11-05', cardId: cards[3].id }] }, { cardId: cards[3].id }, { version: 1 },
  ]) {
    assertError(await h.service.handle({ action: 'openDaily', ...fields }, owner), 'INVALID_REQUEST')
  }
  assertError(await h.service.handle({ action: 'openDaily', Type: 'Timer' }, owner), 'FORBIDDEN')
  assert.equal(h.fixture.progress().length, 0)
  assert.equal(h.calls.length, 0)
})

test('same-day concurrent openings and transaction replays claim one card, changing days exactly at Beijing midnight', async () => {
  const h = harness()
  h.at('2026-11-06T15:59:59.999Z')
  h.fixture.replayTransactions = true
  const responses = await Promise.all(Array.from({ length: 12 }, () => h.open()))
  const expected = { ok: true, data: { version: 1, viewed: [{ day: '2026-11-06', cardId: cards[0].id }] } }
  for (const response of responses) assert.deepEqual(response, expected)
  assert.equal(h.fixture.progress().length, 1)
  assert.deepEqual(h.fixture.progress()[0].viewed, expected.data.viewed)
  h.at('2026-11-06T16:00:00.000Z')
  const afterMidnight = await Promise.all(Array.from({ length: 12 }, () => h.open()))
  const second = { ok: true, data: { version: 1, viewed: [...expected.data.viewed, { day: '2026-11-07', cardId: cards[1].id }] } }
  for (const response of afterMidnight) assert.deepEqual(response, second)
  assert.deepEqual(h.fixture.progress()[0].viewed, second.data.viewed)
  assert.equal(h.calls.length, 0)
})

test('openings follow catalog order rather than release dates and never backfill days missed between visits', async () => {
  const h = harness()
  h.at('2026-01-01T02:00:00Z')
  assert.deepEqual((await h.open()).data, { version: 1, viewed: [{ day: '2026-01-01', cardId: cards[0].id }] })
  h.at('2031-05-07T02:00:00Z')
  const opened = await h.open()
  assert.deepEqual(opened.data, { version: 1, viewed: [
    { day: '2026-01-01', cardId: cards[0].id },
    { day: '2031-05-07', cardId: cards[1].id },
  ] })
  assert.deepEqual(await h.open(), opened)
  assert.equal(h.fixture.progress()[0].viewed.length, 2)
})

test('the next claim uses the first unseen catalog ID rather than assuming history length identifies a card', async () => {
  const h = harness()
  const prior = { day: '2026-11-04', cardId: cards[1].id }
  h.fixture.seed('card_progress', progressId(), { version: 1, viewed: [prior] })
  assert.deepEqual((await h.open()).data, { version: 1, viewed: [prior, { day: '2026-11-06', cardId: cards[0].id }] })
  h.at('2026-11-07T02:00:00Z')
  const next = await h.open()
  assert.equal(next.data.viewed.at(-1).cardId, cards[2].id)
  assert.equal(next.data.viewed.length, 3)
})

test('invalid stored progress is reported without overwriting, resetting, or exposing it', async () => {
  const entry = { day: '2026-11-04', cardId: cards[0].id }
  const invalid = [
    {}, { version: 2, viewed: [] }, { version: 1, viewed: 'not history' },
    { version: 1, viewed: [{ day: '2026-02-30', cardId: cards[0].id }] },
    { version: 1, viewed: [{ day: '2026-11-40', cardId: cards[0].id }] },
    { version: 1, viewed: [{ day: '2027-01-01', cardId: cards[0].id }] },
    { version: 1, viewed: [{ day: '2026-11-04', cardId: 'unknown-private-card' }] },
    { version: 1, viewed: [entry, { day: entry.day, cardId: cards[1].id }] },
    { version: 1, viewed: [entry, { day: '2026-11-05', cardId: entry.cardId }] },
    { version: 1, viewed: [{ day: '2026-11-05', cardId: cards[1].id }, entry] },
    { version: 1, viewed: [{ ...entry, privateText: 'must not be returned' }] },
    { version: 1, viewed: [entry], privateText: 'must not be returned' },
  ]
  for (const record of invalid) {
    const h = harness()
    h.fixture.seed('card_progress', progressId(), record)
    const before = h.fixture.progress()
    const result = await h.open()
    assertError(result, 'PROGRESS_INVALID')
    assert.equal(Object.hasOwn(result, 'data'), false)
    assert.deepEqual(h.fixture.progress(), before)
    assert.equal(h.calls.length, 0)
  }
})

test('failed open transactions roll back and lost acknowledgments can be retried without an extra claim', async () => {
  const h = harness()
  h.fixture.failBeforeCommit = 1
  assertError(await h.open(), 'STORAGE_ERROR')
  assert.equal(h.fixture.progress().length, 0)
  const first = await h.open()
  assert.equal(first.data.viewed.length, 1)
  h.at('2026-11-20T02:00:00Z')
  h.fixture.failAfterCommit = 1
  assertError(await h.open(), 'STORAGE_ERROR')
  const committed = await h.repository.getProgress(progressId())
  assert.equal(committed.viewed.length, 2)
  const retried = await h.open()
  assert.deepEqual(retried.data, { version: 1, viewed: committed.viewed })
  assert.equal(retried.data.viewed.at(-1).cardId, cards[1].id)
  assert.deepEqual(h.fixture.progress()[0], committed)
})

test('opening after the catalog is exhausted retains all history without cycling or inventing a new day', async () => {
  const h = harness()
  const history = await collectCatalog(h)
  const before = h.fixture.progress()
  assert.deepEqual(await h.open(), { ok: true, data: history })
  h.at('2030-12-31T16:00:00Z')
  assert.deepEqual(await h.open(), { ok: true, data: history })
  assert.deepEqual(h.fixture.progress(), before)
  assert.deepEqual(history.viewed.map(entry => entry.cardId), cards.map(card => card.id))
  assert.equal(h.calls.length, 0)
})

test('personalized configuration requires a real thing field and fits every whole card title within 20 characters', async () => {
  const longestTitle = Math.max(...cards.map(card => card.title.length))
  for (const mapping of [
    { thing1: { value: '只有固定邀请' } },
    { name1: { value: '{{cardTitle}}' } },
    { phrase2: { value: '{{cardTitle}}' } },
    { thing1: { value: `${'前'.repeat(21 - longestTitle)}{{cardTitle}}` } },
    { thing1: { value: '{{cardTitle}}{{scheduledAt}}' } },
    { thing1: { value: '{{cardTitle}}' }, thing2: { value: '字'.repeat(21) } },
  ]) {
    const h = harness({ env: { REMINDER_ONCE_TEMPLATE_DATA: JSON.stringify(mapping) } })
    assert.equal((await h.settings()).data.policy.once.configured, false)
    assertError(await h.save(), 'TEMPLATE_NOT_CONFIGURED')
    assert.equal(h.calls.length, 0)
  }
  const prefix = '前'.repeat(20 - longestTitle)
  const configuration = readConfiguration({ ...environment, REMINDER_ONCE_TEMPLATE_DATA: JSON.stringify({
    thing1: { value: `${prefix}{{cardTitle}}` }, time2: { value: '{{scheduledAt}}' },
  }) })
  assert.equal(configuration.once.configured, true)
  for (const card of cards) {
    const data = templateData(configuration, 'once', timestamp('2026-11-07T01:00:00Z'), card.title)
    assert.equal(data.thing1.value, `${prefix}${card.title}`)
    assert.ok(data.thing1.value.length <= 20)
    assert.equal(data.time2.value, '2026-11-07 09:00')
  }
})

test('reminders snapshot each recipient next unseen title at claim time and never advance either progress', async () => {
  const h = harness()
  const other = { SOURCE: 'wx_client', OPENID: 'another-reminder-owner' }
  await h.open()
  await h.save(longInput('daily'))
  h.at('2026-11-07T00:59:00Z')
  await h.open()
  await h.open(other)
  await h.save(longInput('daily'), other)
  const before = h.fixture.progress()
  h.at('2026-11-08T01:00:00Z')
  assert.equal((await h.tick()).data.sent, 2)
  const titles = Object.fromEntries(h.calls.map(message => [message.touser, message.data.thing3.value]))
  assert.deepEqual(titles, { [owner.OPENID]: cards[2].title, [other.OPENID]: cards[1].title })
  assert.deepEqual(h.fixture.progress(), before)
  h.at('2026-11-09T01:00:00Z')
  assert.equal((await h.tick()).data.sent, 2)
  assert.equal(h.calls.length, 4)
  for (const message of h.calls) assert.equal(message.data.thing3.value, titles[message.touser])
  assert.deepEqual(h.fixture.progress(), before)
})

test('a visit after send claim cannot change its saved title snapshot and the next reminder sees the new progress', async () => {
  const entered = deferred()
  const release = deferred()
  const h = harness({ send: async () => { entered.resolve(); await release.promise; return { errCode: 0 } } })
  await h.open()
  const saved = await h.save(longInput('daily'))
  h.at(saved.data.nextSendAt)
  const dispatching = h.tick()
  await entered.promise
  const delivery = h.fixture.deliveries().find(record => record.kind === 'send')
  assert.equal(delivery.cardId, cards[1].id)
  assert.equal(delivery.cardTitle, cards[1].title)
  assert.equal(h.calls[0].data.thing3.value, cards[1].title)
  const opened = await h.open()
  assert.equal(opened.data.viewed.at(-1).cardId, cards[1].id)
  release.resolve()
  await dispatching
  assert.equal(h.fixture.deliveries().find(record => record.kind === 'send').cardTitle, cards[1].title)
  h.at((await planOf(h)).nextSendAt)
  await h.tick()
  assert.equal(h.calls[1].data.thing3.value, cards[2].title)
  assert.equal(h.fixture.progress()[0].viewed.length, 2)
})

test('sending to a user without progress does not initialize or advance cloud history', async () => {
  const h = harness()
  const saved = await h.save()
  h.at(saved.data.nextSendAt)
  await h.tick()
  assert.equal(h.calls[0].data.thing1.value, cards[0].title)
  assert.equal(h.fixture.progress().length, 0)
  const opened = await h.open()
  assert.deepEqual(opened.data.viewed, [{ day: '2026-11-07', cardId: cards[0].id }])
})

test('corrupt cloud progress blocks reminder sending without destroying progress or claiming a delivery', async () => {
  const h = harness()
  const saved = await h.save(longInput('daily'))
  h.fixture.seed('card_progress', progressId(), { version: 1, viewed: [
    { day: '2026-11-05', cardId: cards[0].id }, { day: '2026-11-06', cardId: cards[0].id },
  ] })
  const before = h.fixture.progress()
  h.at(saved.data.nextSendAt)
  const dispatched = await h.tick()
  assert.equal(dispatched.data.failed, 1)
  assert.equal(dispatched.data.sent, 0)
  assert.equal(h.calls.length, 0)
  assert.deepEqual(h.fixture.progress(), before)
  assert.deepEqual(await planOf(h), saved.data)
  assert.equal(h.fixture.deliveries().filter(record => record.kind === 'send').length, 0)
  assertError(await h.open(), 'PROGRESS_INVALID')
})

for (const mode of ['once', 'long']) {
  test(`exhausted ${mode} reminder plans complete without sending or resetting history`, async () => {
    const h = harness()
    const history = await collectCatalog(h)
    const before = h.fixture.progress()
    const saved = await h.save(mode === 'long' ? longInput('daily') : {})
    h.at(saved.data.nextSendAt)
    const dispatched = await h.tick()
    assert.deepEqual(dispatched.data, { scanned: 1, sent: 0, skipped: 1, failed: 0 })
    const completed = await planOf(h)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.lastResult, 'catalog_exhausted')
    assert.equal(completed.nextSendAt, null)
    assert.equal(completed.lastSentAt, null)
    assert.equal(h.calls.length, 0)
    assert.deepEqual(h.fixture.progress(), before)
    assert.deepEqual(await h.open(), { ok: true, data: history })
    await h.tick()
    assert.equal(h.calls.length, 0)
  })
}
