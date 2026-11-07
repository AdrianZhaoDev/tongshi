const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

// Exercise the real TS domain and concrete callback adapter without uni, wx, network or credentials.
const modules = new Map()
function loadClient(relative) {
  const filename = path.resolve(__dirname, relative)
  if (modules.has(filename)) return modules.get(filename).exports
  const module = { exports: {} }
  modules.set(filename, module)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
    transformers: {
      before: [(context) => (source) => {
        function visit(node) {
          if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
            return ts.factory.createIdentifier('__importMeta')
          }
          return ts.visitEachChild(node, visit, context)
        }
        return ts.visitNode(source, visit)
      }],
    },
  })
  const nativeRequire = createRequire(filename)
  const requireModule = (request) => request.startsWith('.') && !request.endsWith('.json')
    ? loadClient(path.relative(__dirname, path.resolve(path.dirname(filename), `${request}.ts`)))
    : nativeRequire(request)
  new Function('module', 'exports', 'require', '__importMeta', outputText)(module, module.exports, requireModule, { env: {} })
  return module.exports
}

const {
  ReminderError,
  createReminderController,
  parseReminderSettings,
  parseReminderSubscription,
  reminderCanCancel,
  reminderCanConfirm,
  reminderCanEdit,
} = loadClient('../src/domain/reminders.ts')
const { REMINDER_CONTRACT, DEFAULT_REMINDER_FREQUENCY } = loadClient('../src/config/reminders.ts')
const { createReminderService } = loadClient('../src/services/reminders.ts')

function settings(options = {}) {
  return {
    policy: {
      ...REMINDER_CONTRACT,
      once: { enabled: true, configured: true, templateId: 'fixture-once-template', ...options.once },
      long: { enabled: true, configured: true, templateId: 'fixture-long-template', ...options.long },
      ...options.policy,
    },
    subscription: options.subscription ?? null,
  }
}

function subscription(options = {}) {
  return {
    generation: 'fixture-generation-a', mode: 'once', frequency: DEFAULT_REMINDER_FREQUENCY,
    status: 'active', nextSendAt: Date.parse('2026-11-07T01:00:00Z'), lastSentAt: null, lastResult: null,
    ...options,
  }
}

function harness(overrides = {}) {
  const calls = { reads: 0, native: [], saves: [], cancels: [] }
  const updates = []
  const changes = []
  const service = {
    getSettings() {
      calls.reads += 1
      return overrides.getSettings ? overrides.getSettings() : Promise.resolve(settings())
    },
    requestAuthorization(templateId) {
      calls.native.push(templateId)
      return overrides.requestAuthorization ? overrides.requestAuthorization(templateId) : Promise.resolve('accept')
    },
    subscribe(input) {
      calls.saves.push(input)
      return overrides.subscribe ? overrides.subscribe(input) : Promise.resolve(subscription({ mode: input.mode, frequency: input.frequency }))
    },
    cancel(generation) {
      calls.cancels.push(generation)
      return overrides.cancel ? overrides.cancel(generation) : Promise.resolve(subscription({ generation, status: 'stopped', nextSendAt: null }))
    },
  }
  let requestSequence = 0
  const controller = createReminderController(service, {
    createRequestId: () => `fixture-request-${++requestSequence}`,
    onUpdated: (value) => updates.push(value),
    onChange: (value) => changes.push(value),
  })
  return { controller, calls, updates, changes }
}

function callbackRuntime(handler) {
  const calls = { initialization: [], cloud: [], native: [] }
  const runtime = {
    cloud: {
      init(options) { calls.initialization.push(options) },
      callFunction(options) {
        calls.cloud.push(options.data)
        handler(options)
      },
    },
    requestSubscribeMessage(options) {
      calls.native.push(options.tmplIds)
      options.success({ [options.tmplIds[0]]: 'accept' })
    },
  }
  return { runtime, calls }
}

function serviceFor(runtime) {
  return createReminderService({ cloudEnvironment: 'fixture-public-cloud-env', runtime: () => runtime })
}

test('starts unchecked with daily selected, and cannot authorize before a successful settings read', async () => {
  const read = Promise.withResolvers()
  const { controller, calls, updates } = harness({ getSettings: () => read.promise })
  assert.equal(controller.getState().longTerm, false)
  assert.equal(controller.getState().frequency, DEFAULT_REMINDER_FREQUENCY)
  await controller.confirm()
  const loading = controller.load()
  await controller.confirm()
  assert.equal(controller.getState().phase, 'loading')
  assert.equal(reminderCanConfirm(controller.getState()), false)
  assert.deepEqual(calls.native, [])
  read.resolve(settings())
  await loading
  assert.equal(reminderCanConfirm(controller.getState()), true)
  assert.deepEqual(updates, [])
})

test('failed authenticated settings reads stay disabled until a real retry succeeds', async () => {
  let offline = true
  const { controller, calls, updates } = harness({ getSettings: async () => {
    if (offline) throw new ReminderError('UNAUTHENTICATED', '需要微信身份。')
    return settings()
  } })
  await controller.load()
  assert.equal(controller.getState().issue.code, 'UNAUTHENTICATED')
  assert.equal(reminderCanEdit(controller.getState()), false)
  await controller.confirm()
  assert.equal(calls.native.length, 0)
  offline = false
  await controller.load()
  assert.equal(controller.getState().phase, 'ready')
  assert.equal(reminderCanConfirm(controller.getState()), true)
  assert.deepEqual(updates, [])
})

test('unconfigured or disabled selected modes do not request permission or silently switch modes', async () => {
  for (const unavailable of [{ configured: false, templateId: '' }, { enabled: false }]) {
    const { controller, calls, updates } = harness({ getSettings: async () => settings({ once: unavailable, long: unavailable }) })
    await controller.load()
    await controller.confirm()
    controller.setLongTerm(true)
    await controller.confirm()
    assert.equal(controller.getState().longTerm, true)
    assert.equal(reminderCanConfirm(controller.getState()), false)
    assert.deepEqual(calls.native, [])
    assert.deepEqual(calls.saves, [])
    assert.deepEqual(updates, [])
  }
})

test('confirm invokes native authorization in the same gesture and waits for cloud acknowledgment before saved feedback', async () => {
  const authorization = Promise.withResolvers()
  const save = Promise.withResolvers()
  const saveStarted = Promise.withResolvers()
  const { controller, calls, updates } = harness({
    requestAuthorization: () => authorization.promise,
    subscribe: () => { saveStarted.resolve(); return save.promise },
  })
  await controller.load()
  const confirming = controller.confirm()
  assert.equal(calls.native.length, 1, 'native API must already have been invoked before confirm returns its promise')
  assert.equal(controller.getState().phase, 'authorizing')
  assert.equal(calls.saves.length, 0)
  authorization.resolve('accept')
  await saveStarted.promise
  assert.equal(controller.getState().phase, 'saving')
  assert.equal(controller.getState().subscription, null)
  assert.deepEqual(updates, [])
  assert.equal(calls.saves[0].mode, 'once')
  assert.equal(calls.saves[0].frequency, DEFAULT_REMINDER_FREQUENCY)
  const acknowledged = subscription()
  save.resolve(acknowledged)
  await confirming
  assert.equal(controller.getState().phase, 'saved')
  assert.strictEqual(controller.getState().subscription, acknowledged)
  assert.deepEqual(updates, [acknowledged])
})

test('all three long cadences are submitted as selected, and switching back to once submits only daily', async () => {
  assert.equal(REMINDER_CONTRACT.frequencies.length, 3)
  for (const frequency of REMINDER_CONTRACT.frequencies) {
    const { controller, calls } = harness()
    await controller.load()
    controller.setLongTerm(true)
    assert.equal(controller.getState().frequency, DEFAULT_REMINDER_FREQUENCY)
    controller.setFrequency(frequency.id)
    await controller.confirm()
    assert.equal(controller.getState().subscription.mode, 'long')
    assert.equal(controller.getState().subscription.frequency, frequency.id)
    assert.equal(calls.saves[0].templateId, 'fixture-long-template')
    controller.setLongTerm(false)
    await controller.confirm()
    assert.equal(calls.saves[1].mode, 'once')
    assert.equal(calls.saves[1].frequency, DEFAULT_REMINDER_FREQUENCY)
    assert.equal(calls.saves[1].templateId, 'fixture-once-template')
  }
})

test('only explicit accepted native outcomes save; denial, ban and cancellation preserve the existing plan', async () => {
  for (const result of ['accept', 'acceptWithAlert', 'acceptWithAudio', 'reject', 'ban', 'cancel']) {
    const original = subscription({ generation: 'original', mode: 'long', frequency: REMINDER_CONTRACT.frequencies[2].id })
    const { controller, calls, updates } = harness({
      getSettings: async () => settings({ subscription: original }),
      requestAuthorization: async () => {
        if (result === 'cancel') throw new ReminderError('AUTHORIZATION_CANCELLED', '用户取消。')
        return result
      },
    })
    await controller.load()
    controller.setLongTerm(true)
    await controller.confirm()
    if (result.startsWith('accept')) {
      assert.equal(calls.saves.length, 1)
      assert.equal(updates.length, 1)
    } else {
      assert.strictEqual(controller.getState().subscription, original)
      assert.equal(controller.getState().longTerm, true)
      assert.equal(calls.saves.length, 0)
      assert.deepEqual(updates, [])
      assert.ok(controller.getState().issue)
    }
  }
})

test('an accepted grant survives a failed save, freezes its payload, and retries the same request without reauthorization', async () => {
  let saves = 0
  const { controller, calls, updates } = harness({ subscribe: async (input) => {
    if (++saves === 1) throw new ReminderError('STORAGE_ERROR', '保存结果未确认。')
    return subscription({ mode: input.mode, frequency: input.frequency })
  } })
  await controller.load()
  controller.setLongTerm(true)
  controller.setFrequency(REMINDER_CONTRACT.frequencies[1].id)
  await controller.confirm()
  const pending = controller.getState().pendingGrant
  assert.equal(controller.getState().phase, 'save_failed')
  assert.equal(controller.getState().subscription, null)
  assert.deepEqual(updates, [])
  controller.setLongTerm(false)
  controller.setFrequency(REMINDER_CONTRACT.frequencies[2].id)
  await controller.load()
  assert.strictEqual(controller.getState().pendingGrant, pending)
  assert.equal(calls.reads, 1)
  await controller.retrySave()
  assert.strictEqual(calls.saves[0], calls.saves[1])
  assert.equal(calls.native.length, 1)
  assert.equal(controller.getState().subscription.mode, 'long')
  assert.equal(controller.getState().subscription.frequency, REMINDER_CONTRACT.frequencies[1].id)
  assert.equal(controller.getState().pendingGrant, null)
  assert.equal(updates.length, 1)
})

test('policy rejection during save remains a long-mode error, never a single-reminder fallback', async () => {
  const { controller, calls, updates } = harness({ subscribe: async () => {
    throw new ReminderError('MODE_DISABLED', '长期提醒已关闭。')
  } })
  await controller.load()
  controller.setLongTerm(true)
  await controller.confirm()
  await controller.retrySave()
  assert.equal(controller.getState().phase, 'save_failed')
  assert.equal(controller.getState().issue.code, 'MODE_DISABLED')
  assert.equal(controller.getState().longTerm, true)
  assert.equal(controller.getState().pendingGrant.mode, 'long')
  assert.equal(calls.native.length, 1)
  assert.ok(calls.saves.every((input) => input.mode === 'long'))
  assert.deepEqual(updates, [])
})

test('retry acknowledgment of a now-stopped receipt does not claim reminders are active', async () => {
  let first = true
  const stopped = subscription({ status: 'stopped', nextSendAt: null })
  const { controller, updates } = harness({ subscribe: async () => {
    if (first) { first = false; throw new ReminderError('CLOUD_REQUEST_FAILED', '回执丢失。') }
    return stopped
  } })
  await controller.load()
  await controller.confirm()
  await controller.retrySave()
  assert.equal(controller.getState().phase, 'ready')
  assert.equal(controller.getState().subscription.status, 'stopped')
  assert.equal(controller.getState().pendingGrant, null)
  assert.match(controller.getState().notice, /未启用/)
  assert.deepEqual(updates, [stopped])
})

test('abandoning a superseded pending request reloads the real newer plan without claiming the failed save succeeded', async () => {
  const newer = subscription({ generation: 'newer-plan', mode: 'long', frequency: REMINDER_CONTRACT.frequencies[2].id })
  let reads = 0
  const { controller, calls, updates } = harness({
    getSettings: async () => settings({ subscription: ++reads === 1 ? null : newer }),
    subscribe: async () => { throw new ReminderError('STALE_GENERATION', '本请求已被新计划替换。') },
  })
  await controller.load()
  await controller.confirm()
  await controller.discardPendingAndReload()
  assert.equal(controller.getState().pendingGrant, null)
  assert.strictEqual(controller.getState().subscription, newer)
  assert.equal(controller.getState().phase, 'ready')
  assert.equal(calls.native.length, 1)
  assert.deepEqual(updates, [])
})

test('repeat confirm taps and edits cannot create overlapping authorizations or mutate the in-flight choice', async () => {
  const authorization = Promise.withResolvers()
  const { controller, calls } = harness({ requestAuthorization: () => authorization.promise })
  await controller.load()
  controller.setLongTerm(true)
  const confirming = controller.confirm()
  controller.setLongTerm(false)
  controller.setFrequency(REMINDER_CONTRACT.frequencies[2].id)
  await controller.confirm()
  await controller.cancel()
  assert.equal(calls.native.length, 1)
  assert.equal(controller.getState().longTerm, true)
  assert.equal(controller.getState().frequency, DEFAULT_REMINDER_FREQUENCY)
  authorization.resolve('accept')
  await confirming
  assert.equal(calls.saves.length, 1)
  assert.equal(calls.saves[0].mode, 'long')
})

test('closing while settings or native permission is pending prevents later saves and update events', async () => {
  const read = Promise.withResolvers()
  const first = harness({ getSettings: () => read.promise })
  const reading = first.controller.load()
  first.controller.close()
  read.resolve(settings())
  await reading
  assert.equal(first.controller.getState().phase, 'closed')
  assert.deepEqual(first.updates, [])

  const authorization = Promise.withResolvers()
  const second = harness({ requestAuthorization: () => authorization.promise })
  await second.controller.load()
  const confirming = second.controller.confirm()
  second.controller.close()
  authorization.resolve('accept')
  await confirming
  assert.equal(second.controller.getState().phase, 'closed')
  assert.deepEqual(second.calls.saves, [])
  assert.deepEqual(second.updates, [])
})

test('closing after a save was submitted never emits a misleading late UI success', async () => {
  const saved = Promise.withResolvers()
  const started = Promise.withResolvers()
  const { controller, calls, updates, changes } = harness({ subscribe: () => { started.resolve(); return saved.promise } })
  await controller.load()
  const confirming = controller.confirm()
  await started.promise
  controller.close()
  const closedChanges = changes.length
  saved.resolve(subscription())
  await confirming
  assert.equal(calls.saves.length, 1, 'closing cannot revoke a request already submitted to the server')
  assert.equal(controller.getState().phase, 'closed')
  assert.equal(changes.length, closedChanges)
  assert.deepEqual(updates, [])
  await controller.retrySave()
  await controller.load()
  assert.equal(calls.saves.length, 1)
})

test('cancellation waits for the expected generation acknowledgment before showing stopped or emitting updated', async () => {
  const stop = Promise.withResolvers()
  const original = subscription()
  const { controller, calls, updates } = harness({
    getSettings: async () => settings({ subscription: original }),
    cancel: () => stop.promise,
  })
  await controller.load()
  assert.equal(reminderCanCancel(controller.getState()), true)
  const cancelling = controller.cancel()
  assert.equal(controller.getState().phase, 'cancelling')
  assert.strictEqual(controller.getState().subscription, original)
  assert.deepEqual(updates, [])
  assert.deepEqual(calls.cancels, [original.generation])
  const acknowledged = subscription({ status: 'stopped', nextSendAt: null })
  stop.resolve(acknowledged)
  await cancelling
  assert.equal(controller.getState().phase, 'cancelled')
  assert.equal(reminderCanCancel(controller.getState()), false)
  assert.deepEqual(updates, [acknowledged])
})

test('stale cancellation refreshes the newer generation and does not pretend it was stopped', async () => {
  const newer = subscription({ generation: 'generation-newer', mode: 'long' })
  let reads = 0
  const { controller, calls, updates } = harness({
    getSettings: async () => settings({ subscription: ++reads === 1 ? subscription() : newer }),
    cancel: async () => { throw new ReminderError('STALE_GENERATION', '计划已变化。') },
  })
  await controller.load()
  await controller.cancel()
  assert.equal(calls.reads, 2)
  assert.equal(controller.getState().issue.code, 'STALE_GENERATION')
  assert.strictEqual(controller.getState().subscription, newer)
  assert.equal(controller.getState().subscription.status, 'active')
  assert.deepEqual(updates, [])
})

test('failed cancellation or failed stale refresh clears stale actionable settings without false stopped feedback', async () => {
  for (const code of ['CLOUD_REQUEST_FAILED', 'STALE_GENERATION']) {
    let reads = 0
    const { controller, updates } = harness({
      getSettings: async () => {
        if (++reads > 1) throw new ReminderError('CLOUD_REQUEST_FAILED', '读取失败。')
        return settings({ subscription: subscription() })
      },
      cancel: async () => { throw new ReminderError(code, '停止尚未确认。') },
    })
    await controller.load()
    await controller.cancel()
    assert.equal(controller.getState().phase, 'error')
    assert.equal(reminderCanConfirm(controller.getState()), false)
    assert.equal(reminderCanCancel(controller.getState()), false)
    assert.equal(controller.getState().subscription, null)
    assert.deepEqual(updates, [])
  }
})

test('closing during a stale cancellation refresh cannot publish its later result', async () => {
  const refresh = Promise.withResolvers()
  const refreshing = Promise.withResolvers()
  let reads = 0
  const { controller, updates } = harness({
    getSettings: () => {
      if (++reads === 1) return Promise.resolve(settings({ subscription: subscription() }))
      refreshing.resolve()
      return refresh.promise
    },
    cancel: async () => { throw new ReminderError('STALE_GENERATION', '计划已变化。') },
  })
  await controller.load()
  const cancelling = controller.cancel()
  await refreshing.promise
  controller.close()
  refresh.resolve(settings({ subscription: subscription({ generation: 'newer' }) }))
  await cancelling
  assert.equal(controller.getState().phase, 'closed')
  assert.deepEqual(updates, [])
})

test('public parsers reject malformed or drifting policy data and never leak private server fields', () => {
  for (const value of [undefined, {}, { ...subscription(), status: 'sent' }, { ...subscription(), nextSendAt: NaN }]) {
    assert.throws(() => parseReminderSubscription(value), { code: 'INVALID_RESPONSE' })
  }
  assert.throws(() => parseReminderSettings(settings({ policy: { version: REMINDER_CONTRACT.version + 1 } })), { code: 'POLICY_VERSION_MISMATCH' })
  assert.throws(() => parseReminderSettings(settings({ policy: { sendHour: REMINDER_CONTRACT.sendHour + 1 } })), { code: 'POLICY_MISMATCH' })
  assert.throws(() => parseReminderSettings(settings({ policy: { frequencies: REMINDER_CONTRACT.frequencies.slice(1) } })), { code: 'POLICY_MISMATCH' })
  assert.throws(() => parseReminderSettings(settings({ long: { configured: true, templateId: '' } })), { code: 'INVALID_RESPONSE' })
  const publicPlan = parseReminderSubscription({ ...subscription(), openid: 'private-fixture', _id: 'private-document-id', token: 'private-token' })
  assert.deepEqual(publicPlan, subscription())
})

test('concrete cloud adapter refuses missing environment and malformed successes rather than inventing settings', async () => {
  const { runtime, calls } = callbackRuntime((options) => options.success({ result: { ok: true } }))
  const missing = createReminderService({ cloudEnvironment: '', runtime: () => runtime })
  await assert.rejects(missing.getSettings(), { code: 'CLOUD_ENV_NOT_CONFIGURED' })
  assert.deepEqual(calls.initialization, [])
  assert.deepEqual(calls.cloud, [])
  await assert.rejects(serviceFor(runtime).getSettings(), { code: 'INVALID_RESPONSE' })
  assert.deepEqual(calls.initialization, [{ env: 'fixture-public-cloud-env', traceUser: false }])
})

test('concrete authorization accepts only the configured template result, not an unrelated accept or keep-choice flag', async () => {
  const { runtime } = callbackRuntime(() => {})
  const service = serviceFor(runtime)
  for (const response of [{ otherTemplate: 'accept' }, { errMsg: 'requestSubscribeMessage:ok', keepChoice: true }, { wanted: 'unknown' }]) {
    runtime.requestSubscribeMessage = (options) => options.success(response)
    await assert.rejects(service.requestAuthorization('wanted'), { code: 'AUTHORIZATION_UNCONFIRMED' })
  }
  runtime.requestSubscribeMessage = (options) => options.fail({ errMsg: 'requestSubscribeMessage:fail cancel' })
  await assert.rejects(service.requestAuthorization('wanted'), { code: 'AUTHORIZATION_CANCELLED' })
  runtime.requestSubscribeMessage = (options) => options.fail({ errMsg: 'requestSubscribeMessage:fail template unavailable' })
  await assert.rejects(service.requestAuthorization('wanted'), { code: 'AUTHORIZATION_FAILED' })
})

test('real callback adapter plus controller preserves an accepted request through lost cloud acknowledgment', async () => {
  let saveAttempt = 0
  const acknowledged = subscription({ mode: 'long', frequency: REMINDER_CONTRACT.frequencies[2].id })
  const { runtime, calls } = callbackRuntime((options) => {
    assert.equal(options.name, REMINDER_CONTRACT.functionName)
    if (options.data.action === 'getSettings') return options.success({ result: { ok: true, data: settings() } })
    if (++saveAttempt === 1) return options.fail({ errMsg: 'fixture lost acknowledgment' })
    options.success({ result: { ok: true, data: acknowledged } })
  })
  const updates = []
  const controller = createReminderController(serviceFor(runtime), { onUpdated: (value) => updates.push(value) })
  await controller.load()
  controller.setLongTerm(true)
  controller.setFrequency(REMINDER_CONTRACT.frequencies[2].id)
  await controller.confirm()
  assert.equal(controller.getState().phase, 'save_failed')
  assert.equal(controller.getState().issue.code, 'CLOUD_REQUEST_FAILED')
  assert.deepEqual(updates, [])
  await controller.retrySave()
  assert.equal(controller.getState().phase, 'saved')
  assert.deepEqual(updates, [acknowledged])
  assert.equal(calls.native.length, 1)
  assert.deepEqual(calls.native[0], ['fixture-long-template'])
  assert.deepEqual(calls.cloud[1], calls.cloud[2])
  assert.equal(calls.cloud[1].mode, 'long')
  assert.equal(calls.cloud[1].frequency, REMINDER_CONTRACT.frequencies[2].id)
  assert.equal(Object.prototype.hasOwnProperty.call(calls.cloud[1], 'openid'), false)
  assert.equal(calls.initialization.length, 1)
})

test('real cloud error envelopes preserve long-mode failure instead of fabricating saved or a one-time fallback', async () => {
  const { runtime, calls } = callbackRuntime((options) => options.success({ result: options.data.action === 'getSettings'
    ? { ok: true, data: settings() }
    : { ok: false, error: { code: 'TEMPLATE_MISMATCH', message: '模板已变化，请重新读取配置。' } } }))
  const updates = []
  const controller = createReminderController(serviceFor(runtime), { onUpdated: (value) => updates.push(value) })
  await controller.load()
  controller.setLongTerm(true)
  await controller.confirm()
  assert.equal(controller.getState().phase, 'save_failed')
  assert.equal(controller.getState().issue.code, 'TEMPLATE_MISMATCH')
  assert.equal(controller.getState().longTerm, true)
  assert.equal(calls.cloud[1].mode, 'long')
  assert.deepEqual(updates, [])
})

test('missing native capabilities and null cloud save acknowledgments are honest failures', async () => {
  const unsupported = serviceFor({})
  await assert.rejects(unsupported.getSettings(), { code: 'WECHAT_CLOUD_UNAVAILABLE' })
  await assert.rejects(unsupported.requestAuthorization('fixture-template'), { code: 'WECHAT_SUBSCRIBE_UNAVAILABLE' })
  const { runtime } = callbackRuntime((options) => options.success({ result: { ok: true, data: null } }))
  await assert.rejects(serviceFor(runtime).subscribe({
    requestId: 'fixture-request', mode: 'once', frequency: DEFAULT_REMINDER_FREQUENCY, templateId: 'fixture-template',
  }), { code: 'INVALID_RESPONSE' })
})
