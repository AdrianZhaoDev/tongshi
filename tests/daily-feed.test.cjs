const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../src/domain/daily-feed.ts')
const modules = new Map()

function loadFeed(filename) {
  const ts = require('typescript')
  const fs = require('node:fs')
  const path = require('node:path')
  const { createRequire } = require('node:module')
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
    ? loadFeed(path.resolve(path.dirname(filename), `${request}.ts`)) : nativeRequire(request)
  new Function('module', 'exports', 'require', '__importMeta', outputText)(module, module.exports, requireModule, { env: {} })
  return module.exports
}

const { dayKey, nextDayStart, parseViewedHistory, recordViewedDay, mapViewedFeed, resolveDailyFeed } = loadFeed(sourcePath)
const { CARDS_DATA } = loadFeed(path.resolve(__dirname, '../src/domain/cards.ts'))
const { createDailyFeedService } = loadFeed(path.resolve(__dirname, '../src/services/daily-feed.ts'))
const { createReminderService } = loadFeed(path.resolve(__dirname, '../src/services/reminders.ts'))
const { REMINDER_CONTRACT } = loadFeed(path.resolve(__dirname, '../src/config/reminders.ts'))
const { reminderSubscriptionLabel } = loadFeed(path.resolve(__dirname, '../src/domain/reminders.ts'))
const first = Object.freeze({ id: 'first', title: 'First draft' })
const second = Object.freeze({ id: 'second', title: 'Second draft' })
const third = Object.freeze({ id: 'third', title: 'Third draft' })
const fourth = Object.freeze({ id: 'fourth', title: 'Fourth draft' })
const fifth = Object.freeze({ id: 'fifth', title: 'Fifth draft' })
const cards = Object.freeze([first, second, third, fourth, fifth])
const atDay = (day) => new Date(`${day}T12:00:00+08:00`)

test('day keys and the next midnight always use Beijing, including four-digit years', () => {
  assert.equal(dayKey(new Date('2026-11-06T15:59:59.999Z')), '2026-11-06')
  assert.equal(dayKey(new Date('2026-11-06T16:00:00.000Z')), '2026-11-07')
  assert.equal(dayKey(atDay('0005-01-02')), '0005-01-02')
  assert.equal(nextDayStart(new Date('2026-11-06T15:59:59.999Z')).toISOString(), '2026-11-06T16:00:00.000Z')
  assert.equal(nextDayStart(new Date('2026-11-06T16:00:00.000Z')).toISOString(), '2026-11-07T16:00:00.000Z')
  assert.throws(() => dayKey(new Date(NaN)), RangeError)
  assert.throws(() => nextDayStart(new Date(NaN)), RangeError)
  for (const year of [-1, 10000]) {
    const date = new Date(0)
    date.setUTCFullYear(year, 0, 2)
    assert.throws(() => dayKey(date), RangeError)
  }
})

test('only absent local storage values mean empty history, not malformed objects or strings', () => {
  for (const raw of ['', undefined, null]) assert.deepEqual(parseViewedHistory(raw, cards), [])
  assert.deepEqual(parseViewedHistory({ version: 1, viewed: [] }, cards), [])
  const invalid = [
    ' ', 'not json', JSON.stringify({ version: 1, viewed: [] }), false, 0, [], {},
    { viewed: [] }, { version: 1 }, { version: '1', viewed: [] }, { version: 2, viewed: [] },
    { version: 1, viewed: null }, { version: 1, viewed: {} },
    ...[null, [], {}, { day: '2026-11-06' }, { cardId: first.id },
      { day: '2026-11-06', cardId: '' }, { day: '2026-11-06', cardId: 1 }]
      .map(row => ({ version: 1, viewed: [row] })),
  ]
  for (const raw of invalid) assert.throws(() => parseViewedHistory(raw, cards), TypeError, JSON.stringify(raw))
})

test('version-1 history keeps stable IDs and arbitrary visit dates, and is copied chronologically', () => {
  const later = Object.freeze({ day: '2036-12-20', cardId: first.id, private: 'not copied' })
  const earlier = Object.freeze({ day: '2025-01-01', cardId: third.id })
  const rows = Object.freeze([later, earlier])
  const parsed = parseViewedHistory(Object.freeze({ version: 1, viewed: rows }), cards)
  assert.deepEqual(parsed, [earlier, { day: later.day, cardId: later.cardId }])
  assert.notStrictEqual(parsed, rows)
  assert.notStrictEqual(parsed[0], earlier)
  assert.deepEqual(rows, [later, earlier])
  const obsoleteMetadata = [{ id: first.id, releaseOn: 'not-a-date' }]
  assert.deepEqual(parseViewedHistory({ version: 1, viewed: [{ day: '2026-11-07', cardId: first.id }] }, obsoleteMetadata), [
    { day: '2026-11-07', cardId: first.id },
  ])
})

test('unknown IDs, duplicate days and repeated IDs fail rather than resetting history', () => {
  const row = { day: '2026-11-06', cardId: first.id }
  for (const viewed of [
    [{ day: row.day, cardId: 'unknown' }], [row, { ...row }],
    [row, { day: row.day, cardId: second.id }], [row, { day: '2026-11-07', cardId: first.id }],
  ]) {
    assert.throws(() => parseViewedHistory({ version: 1, viewed }, cards), TypeError)
    assert.throws(() => resolveDailyFeed(cards, viewed, atDay('2026-11-07')), TypeError)
    assert.throws(() => mapViewedFeed(cards, viewed, atDay('2026-11-07')), TypeError)
  }
})

test('history still requires real Gregorian visit dates, without a release-date binding', () => {
  for (const day of [
    '2026-02-29', '1900-02-29', '2024-02-30', '2026-04-31', '2026-00-01', '2026-13-01',
    '2026-11-00', '2026-11-31', '2026-1-06', '26-11-06', '2026-11-6', '2026-11-06T00:00:00Z',
    ' 2026-11-06', '2026-11-06 ', '', null,
  ]) {
    assert.throws(() => parseViewedHistory({ version: 1, viewed: [{ day, cardId: first.id }] }, cards), TypeError)
  }
  assert.deepEqual(parseViewedHistory({ version: 1, viewed: [{ day: '2000-02-29', cardId: first.id }] }, cards), [
    { day: '2000-02-29', cardId: first.id },
  ])
})

test('invalid or duplicate catalog IDs fail even with empty history; release dates are irrelevant', () => {
  for (const catalog of [[first, first], [first, { id: first.id }], [{ id: '' }], [{ id: null }]]) {
    assert.throws(() => parseViewedHistory('', catalog), TypeError)
    assert.throws(() => resolveDailyFeed(catalog, [], atDay('2026-11-06')), TypeError)
  }
  assert.strictEqual(resolveDailyFeed([{ id: 'undated' }], [], atDay('2036-12-20')).today.card.id, 'undated')
})

test('a first visit receives the first catalog item, not a date-matched or randomly chosen card', () => {
  for (const day of ['2025-01-01', '2026-11-06', '2036-12-20']) {
    const feed = resolveDailyFeed(cards, [], atDay(day))
    assert.strictEqual(feed.today.card, first)
    assert.equal(feed.today.card.title, 'First draft')
    assert.deepEqual(feed.entries, [{ day, card: first }])
    assert.equal(feed.activeIndex, 0)
    assert.strictEqual(feed.entries[0], feed.today)
  }
  assert.strictEqual(resolveDailyFeed([third, first, second], [], atDay('2026-11-06')).today.card, third)
})

test('repeated same-day visits stay on the claimed ID even if catalog order changes', () => {
  const date = atDay('2026-11-06')
  const initial = resolveDailyFeed(cards, [], date)
  const viewed = recordViewedDay([], initial.today)
  for (const catalog of [cards, [fifth, second, first, third, fourth]]) {
    const feed = resolveDailyFeed(catalog, viewed, date)
    assert.strictEqual(feed.today.card, first)
    assert.equal(feed.entries.length, 1)
    assert.deepEqual(recordViewedDay(viewed, feed.today), viewed)
  }
})

test('absent days are not backfilled, and the next visit claims only the first unseen ID', () => {
  const seen = Object.freeze([Object.freeze({ day: '2026-11-06', cardId: first.id })])
  const feed = resolveDailyFeed(cards, seen, atDay('2026-12-20'))
  assert.strictEqual(feed.today.card, second)
  assert.deepEqual(feed.entries, [
    { day: '2026-11-06', card: first }, { day: '2026-12-20', card: second },
  ])
  assert.equal(feed.activeIndex, 1)
  assert.deepEqual(seen, [{ day: '2026-11-06', cardId: first.id }])
  const withGaps = [{ day: '2026-11-06', cardId: third.id }, { day: '2026-11-10', cardId: first.id }]
  assert.strictEqual(resolveDailyFeed(cards, withGaps, atDay('2026-12-20')).today.card, second)
})

test('exhaustion preserves every historical card without assigning stale history to today or cycling', () => {
  const seen = cards.map((card, index) => ({ day: `2026-11-${String(6 + index).padStart(2, '0')}`, cardId: card.id }))
  for (const day of ['2026-11-11', '2036-12-20']) {
    const feed = resolveDailyFeed(cards, seen, atDay(day))
    assert.equal(feed.today, null)
    assert.deepEqual(feed.entries.map(entry => entry.card.id), cards.map(card => card.id))
    assert.deepEqual(feed.entries.map(entry => entry.day), seen.map(row => row.day))
    assert.equal(feed.activeIndex, cards.length - 1)
  }
  assert.deepEqual(resolveDailyFeed([], [], atDay('2026-11-06')), { today: null, entries: [], activeIndex: -1 })
})

test('clock rollback preserves future stored records and never reissues a viewed ID', () => {
  const seen = [{ day: '2026-11-10', cardId: first.id }, { day: '2026-11-12', cardId: fifth.id }]
  const feed = resolveDailyFeed(cards, seen, atDay('2026-11-07'))
  assert.strictEqual(feed.today.card, second)
  assert.deepEqual(feed.entries.map(entry => entry.card.id), [second.id, first.id, fifth.id])
  assert.deepEqual(seen, [{ day: '2026-11-10', cardId: first.id }, { day: '2026-11-12', cardId: fifth.id }])
  assert.throws(() => resolveDailyFeed(cards, [], new Date(NaN)), RangeError)
})

test('cloud history mapping never allocates an unseen card, including an empty or old response', () => {
  assert.deepEqual(mapViewedFeed(cards, [], atDay('2026-11-07')), { today: null, entries: [], activeIndex: -1 })
  const yesterday = { day: '2026-11-06', cardId: fourth.id }
  const feed = mapViewedFeed(cards, [yesterday], atDay('2026-11-07'))
  assert.equal(feed.today, null)
  assert.deepEqual(feed.entries, [{ day: yesterday.day, card: fourth }])
  assert.equal(feed.activeIndex, 0)
  const current = mapViewedFeed(cards, [yesterday, { day: '2026-11-07', cardId: second.id }], new Date('2026-11-06T16:00:00Z'))
  assert.strictEqual(current.today.card, second)
  assert.strictEqual(current.entries[current.activeIndex], current.today)
})

test('recording is idempotent, nonmutating and chronological without requiring a release date', () => {
  const earlier = Object.freeze({ day: '2026-11-06', cardId: third.id })
  const later = Object.freeze({ day: '2026-11-10', cardId: first.id })
  const seen = Object.freeze([later, earlier])
  const entry = Object.freeze({ day: '2026-11-07', card: second })
  const expected = [earlier, { day: entry.day, cardId: second.id }, later]
  const recorded = recordViewedDay(seen, entry)
  assert.deepEqual(recorded, expected)
  assert.deepEqual(recordViewedDay(recorded, entry), expected)
  assert.notStrictEqual(recorded[0], earlier)
  assert.deepEqual(seen, [later, earlier])
  assert.deepEqual(recordViewedDay([earlier, { ...earlier }], { day: earlier.day, card: third }), [earlier])
  for (const invalid of [
    { day: earlier.day, card: second }, { day: '2026-11-07', card: third },
    { day: '2026-02-29', card: second }, { day: '2026-11-07', card: { id: '' } },
  ]) assert.throws(() => recordViewedDay([earlier], invalid), TypeError)
})

function checkTimeZone(timeZone, assertions) {
  const script = `
    const assert = require('node:assert/strict')
    const modules = new Map()
    const { dayKey, nextDayStart, recordViewedDay, resolveDailyFeed } = (${loadFeed.toString()})(${JSON.stringify(sourcePath)})
    ${assertions}
  `
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${timeZone}: ${result.stderr || result.stdout}`)
}

test('device timezone and DST do not move the Beijing claim boundary', () => {
  for (const zone of ['Asia/Shanghai', 'Pacific/Honolulu', 'America/New_York']) {
    checkTimeZone(zone, `
      const cards = [{ id: 'first' }, { id: 'second' }]
      const before = new Date('2026-11-06T15:59:59Z')
      const after = new Date('2026-11-06T16:00:00Z')
      const seen = recordViewedDay([], resolveDailyFeed(cards, [], before).today)
      assert.equal(dayKey(before), '2026-11-06')
      assert.equal(dayKey(after), '2026-11-07')
      assert.equal(resolveDailyFeed(cards, seen, after).today.card.id, 'second')
      assert.equal(nextDayStart(before).toISOString(), '2026-11-06T16:00:00.000Z')
      assert.equal(dayKey(new Date('2026-11-01T01:30:00-04:00')), '2026-11-01')
      assert.equal(dayKey(new Date('2026-11-01T01:30:00-05:00')), '2026-11-01')
      assert.equal(dayKey(new Date('2028-02-29T16:00:00Z')), '2028-03-01')
    `)
  }
})

test('the real catalog opens in catalog order across arbitrarily spaced visits, then stops', () => {
  let viewed = []
  for (let index = 0; index < CARDS_DATA.length; index += 1) {
    const now = new Date(Date.UTC(2030, 0, 1 + index * 3, 4))
    const feed = resolveDailyFeed(CARDS_DATA, viewed, now)
    assert.strictEqual(feed.today.card, CARDS_DATA[index])
    assert.equal(feed.today.day, dayKey(now))
    assert.equal(feed.entries.length, index + 1)
    assert.equal('releaseOn' in feed.today.card, false)
    viewed = recordViewedDay(viewed, feed.today)
    assert.strictEqual(resolveDailyFeed(CARDS_DATA, viewed, now).today.card, CARDS_DATA[index])
  }
  const exhausted = resolveDailyFeed(CARDS_DATA, viewed, atDay('2040-01-01'))
  assert.equal(exhausted.today, null)
  assert.equal(exhausted.entries.length, CARDS_DATA.length)
  assert.equal(exhausted.entries.at(-1).card.id, 'd12')
  const practices = CARDS_DATA.filter(card => card.kind === 'weekend')
  assert.equal(practices.length, 4)
  assert.ok(practices.every(card => card.practice?.steps.length > 0))
})

test('all twelve legacy version-1 IDs and dates survive and the next unseen ID is issued', () => {
  const ids = ['d01', 'd02', 'd03', 'd04', 'd05', 'w01', 'd06', 'd07', 'd08', 'd09', 'd10', 'w02']
  const viewed = ids.map((cardId, index) => ({ day: `2026-11-${String(6 + index).padStart(2, '0')}`, cardId }))
  const parsed = parseViewedHistory({ version: 1, viewed }, CARDS_DATA)
  assert.deepEqual(parsed, viewed)
  const feed = resolveDailyFeed(CARDS_DATA, parsed, atDay('2027-05-01'))
  assert.deepEqual(feed.entries.slice(0, -1).map(entry => entry.card.id), ids)
  assert.equal(feed.today.card.id, 'd11')
  assert.equal(feed.activeIndex, ids.length)
})

function callbackRuntime(handler) {
  const calls = { initialization: [], cloud: [], native: [] }
  const runtime = {
    cloud: {
      init(options) { calls.initialization.push(options) },
      callFunction(options) { calls.cloud.push({ name: options.name, data: options.data }); handler(options) },
    },
    requestSubscribeMessage(options) { calls.native.push(options.tmplIds); options.success({ [options.tmplIds[0]]: 'accept' }) },
  }
  return { runtime, calls, options: { cloudEnvironment: 'fixture-public-cloud-env', runtime: () => runtime } }
}

test('openDaily waits for a valid cloud acknowledgment and sends no local identity, dates or history', async () => {
  let pending
  const { options, calls } = callbackRuntime(value => { pending = value })
  const service = createDailyFeedService(options)
  const request = service.openDaily()
  let settled = false
  request.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.deepEqual(calls.cloud, [{ name: REMINDER_CONTRACT.functionName, data: { action: 'openDaily' } }])
  assert.deepEqual(calls.native, [])
  pending.success({ result: { ok: true, data: { version: 1, viewed: [{ day: '2026-11-07', cardId: CARDS_DATA[0].id, openid: 'not copied' }] } } })
  assert.deepEqual(await request, [{ day: '2026-11-07', cardId: CARDS_DATA[0].id }])
})

test('daily and reminder services reuse one cloud initialization, without requesting subscription permission', async () => {
  const { options, calls } = callbackRuntime(request => request.success({ result: { ok: true, data: request.data.action === 'openDaily'
    ? { version: 1, viewed: [] }
    : { policy: { ...REMINDER_CONTRACT, once: { enabled: true, configured: true, templateId: 'once' }, long: { enabled: true, configured: true, templateId: 'long' } }, subscription: null } } }))
  await createDailyFeedService(options).openDaily()
  await createReminderService(options).getSettings()
  await createDailyFeedService(options).openDaily()
  assert.deepEqual(calls.initialization, [{ env: options.cloudEnvironment, traceUser: false }])
  assert.deepEqual(calls.cloud.map(call => call.data.action), ['openDaily', 'getSettings', 'openDaily'])
  assert.deepEqual(calls.native, [])
})

test('missing cloud setup, request errors and invalid progress never become an empty successful ledger', async () => {
  const missing = callbackRuntime(() => assert.fail('must not call an unconfigured cloud'))
  await assert.rejects(createDailyFeedService({ ...missing.options, cloudEnvironment: '' }).openDaily(), { code: 'CLOUD_ENV_NOT_CONFIGURED' })
  assert.deepEqual(missing.calls.initialization, [])
  const failed = callbackRuntime(request => request.fail({ errMsg: 'offline' }))
  await assert.rejects(createDailyFeedService(failed.options).openDaily(), { code: 'CLOUD_REQUEST_FAILED' })
  const rejected = callbackRuntime(request => request.success({ result: { ok: false, error: { code: 'PROGRESS_INVALID', message: '领取记录暂时无法读取。' } } }))
  await assert.rejects(createDailyFeedService(rejected.options).openDaily(), { code: 'PROGRESS_INVALID' })
  for (const data of [null, '', undefined, [], {}, { version: 2, viewed: [] }, { version: 1, viewed: [{ day: '2026-11-07', cardId: 'unknown' }] },
    { version: 1, viewed: [{ day: '2026-11-07', cardId: CARDS_DATA[0].id }, { day: '2026-11-08', cardId: CARDS_DATA[0].id }] }]) {
    const invalid = callbackRuntime(request => request.success({ result: { ok: true, data } }))
    await assert.rejects(createDailyFeedService(invalid.options).openDaily(), { code: 'INVALID_RESPONSE' })
  }
})

function preprocessPage(source, platform) {
  const enabled = [true]
  return source.split('\n').filter(line => {
    const directive = /^\s*\/\/ #(ifdef|ifndef) (\S+)/.exec(line)
    if (directive) {
      enabled.push(enabled.at(-1) && (directive[1] === 'ifdef' ? directive[2] === platform : directive[2] !== platform))
      return false
    }
    if (/^\s*\/\/ #endif/.test(line)) { enabled.pop(); return false }
    return enabled.at(-1)
  }).join('\n')
}

function pageHarness(platform, options = {}) {
  const filename = path.resolve(__dirname, '../src/pages/index/index.vue')
  const script = fs.readFileSync(filename, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const source = preprocessPage(script, platform) + '\nexport const __page = { entries, activeIndex, hasToday, exhausted, loading, ready, historyError, refreshDaily, onDeckBoundary, scheduleNextDay, showOlderCard, showNewerCard }'
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: `${filename}.ts` })
  const lifecycle = { show: [], hide: [], mounted: [], unmounted: [] }
  const requests = []
  const timers = new Map()
  const toasts = []
  const writes = []
  const reads = []
  const storageKey = 'tongshi:viewed-days:v1'
  const storage = new Map(options.stored === undefined ? [] : [[storageKey, options.stored]])
  let clock = Date.parse(options.now ?? '2026-11-07T04:00:00Z')
  let timerSequence = 0
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])) }
    static now() { return clock }
  }
  const vue = {
    ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }),
    onMounted: callback => lifecycle.mounted.push(callback), onUnmounted: callback => lifecycle.unmounted.push(callback),
  }
  const uni = {
    getStorageInfoSync() { reads.push('keys'); if (options.readFails) throw new Error('unreadable'); return { keys: [...storage.keys()] } },
    getStorageSync(key) { reads.push(key); return storage.get(key) },
    setStorageSync(key, value) { if (options.writeFails) throw new Error('quota'); writes.push({ key, value }); storage.set(key, value) },
    showToast(value) { toasts.push(value) },
  }
  const requireModule = request => {
    if (request === 'vue') return vue
    if (request === '@dcloudio/uni-app') return { onShow: callback => lifecycle.show.push(callback), onHide: callback => lifecycle.hide.push(callback) }
    if (request.endsWith('.vue')) return {}
    if (request === '@/services/daily-feed') return { createDailyFeedService: () => ({ openDaily() { const pending = Promise.withResolvers(); requests.push(pending); return pending.promise } }) }
    if (request.startsWith('@/')) return loadFeed(path.resolve(__dirname, '../src', `${request.slice(2)}.ts`))
    return createRequire(filename)(request)
  }
  const exported = {}
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  const window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }
  new Function('exports', 'require', 'uni', 'Date', 'setTimeout', 'clearTimeout', 'document', 'window', outputText)(
    exported, requireModule, uni, ClockDate,
    (callback, delay) => { const id = ++timerSequence; timers.set(id, { callback, delay }); return id }, id => timers.delete(id), document, window,
  )
  return { page: exported.__page, requests, lifecycle, timers, toasts, writes, reads, storage, at: value => { clock = Date.parse(value) } }
}

test('MP waits for authoritative history and stale refresh success or failure cannot replace a newer result', async () => {
  const h = pageHarness('MP-WEIXIN', { stored: { version: 1, viewed: [{ day: '2026-11-07', cardId: CARDS_DATA.at(-1).id }] } })
  const older = h.page.refreshDaily()
  const newer = h.page.refreshDaily()
  assert.deepEqual(h.page.entries.value, [])
  assert.equal(h.page.loading.value, true)
  const confirmed = [{ day: '2026-11-06', cardId: CARDS_DATA[0].id }, { day: '2026-11-07', cardId: CARDS_DATA[1].id }]
  h.requests[1].resolve(confirmed)
  await newer
  assert.deepEqual(h.page.entries.value.map(entry => entry.card.id), confirmed.map(row => row.cardId))
  assert.equal(h.page.hasToday.value, true)
  h.requests[0].resolve(confirmed.slice(0, 1))
  await older
  assert.equal(h.page.entries.value.length, 2)
  const staleFailure = h.page.refreshDaily()
  const latest = h.page.refreshDaily()
  h.requests[3].resolve(confirmed)
  await latest
  h.requests[2].reject(new Error('stale offline error'))
  await staleFailure
  assert.equal(h.page.historyError.value, '')
  assert.equal(h.page.entries.value.length, 2)
  assert.deepEqual(h.reads, [])
  assert.deepEqual(h.writes, [])
})

test('MP request failure or page hide cannot publish a fake local today card', async () => {
  const failed = pageHarness('MP-WEIXIN')
  const request = failed.page.refreshDaily()
  failed.requests[0].reject(new Error('云端进度暂时无法读取。'))
  await request
  assert.deepEqual(failed.page.entries.value, [])
  assert.equal(failed.page.hasToday.value, false)
  assert.match(failed.page.historyError.value, /无法读取/)
  assert.deepEqual(failed.reads, [])
  assert.deepEqual(failed.writes, [])
  const hidden = pageHarness('MP-WEIXIN')
  const pending = hidden.page.refreshDaily()
  hidden.lifecycle.hide[0]()
  hidden.requests[0].resolve([{ day: '2026-11-07', cardId: CARDS_DATA[0].id }])
  await pending
  assert.deepEqual(hidden.page.entries.value, [])
  assert.equal(hidden.timers.size, 0)
})

test('H5 preview uses version-1 local history, stays stable today and does not backfill absences', async () => {
  const h = pageHarness('H5', { now: '2030-01-01T04:00:00Z' })
  await h.page.refreshDaily()
  assert.equal(h.page.entries.value.at(-1).card.id, CARDS_DATA[0].id)
  await h.page.refreshDaily()
  assert.equal(h.writes.length, 1)
  h.at('2030-03-10T04:00:00Z')
  await h.page.refreshDaily()
  assert.deepEqual(h.page.entries.value.map(entry => entry.day), ['2030-01-01', '2030-03-10'])
  assert.deepEqual(h.page.entries.value.map(entry => entry.card.id), CARDS_DATA.slice(0, 2).map(card => card.id))
  assert.equal(h.writes.length, 2)
  assert.equal(h.writes[0].key, 'tongshi:viewed-days:v1')
  assert.equal(h.writes[0].value.version, 1)
  assert.deepEqual(h.requests, [])
})

test('unreadable, corrupt or unsavable preview progress never resets or displays a new card', async () => {
  for (const options of [{ readFails: true }, { stored: '' }, { stored: { version: 1, viewed: [{ day: '2026-11-07', cardId: 'unknown' }] } }, { writeFails: true }]) {
    const h = pageHarness('H5', options)
    await h.page.refreshDaily()
    assert.deepEqual(h.page.entries.value, [])
    assert.equal(h.page.hasToday.value, false)
    assert.equal(h.writes.length, 0)
    assert.ok(h.page.historyError.value)
    if (options.stored !== undefined) assert.strictEqual(h.storage.get('tongshi:viewed-days:v1'), options.stored)
  }
})

test('a refresh spanning Beijing midnight schedules the new visit day promptly', () => {
  const h = pageHarness('MP-WEIXIN')
  h.page.scheduleNextDay(new Date('2026-11-06T15:00:00Z'), new Date('2026-11-06T14:00:00Z'))
  assert.equal([...h.timers.values()][0].delay, 60 * 60 * 1000 + 50)
  h.page.scheduleNextDay(new Date('2026-11-06T16:00:01Z'), new Date('2026-11-06T15:59:59Z'))
  assert.equal(h.timers.size, 1)
  assert.equal([...h.timers.values()][0].delay, 100)
})

test('boundary feedback says tomorrow only while unseen cards remain', async () => {
  const h = pageHarness('H5')
  await h.page.refreshDaily()
  h.page.onDeckBoundary('older')
  assert.equal(h.toasts.at(-1).title, '明日再来哦')
  h.page.exhausted.value = true
  for (const direction of ['older', 'newer']) {
    h.page.onDeckBoundary(direction)
    assert.doesNotMatch(h.toasts.at(-1).title, /明日|明天/)
    assert.match(h.toasts.at(-1).title, /全部卡片已领取/)
  }
})

function deckHarness(reduced = false, index = 1) {
  const module = { exports: {} }
  new Function('module', fs.readFileSync(path.resolve(__dirname, '../src/components/card-deck.wxs'), 'utf8'))(module)
  const engine = module.exports
  const bag = {}
  const queue = []
  const styles = new Map()
  const events = []
  let clock = 0
  const owner = {
    getState: () => bag,
    requestAnimationFrame: callback => queue.push(callback),
    selectComponent(selector) {
      return { getBoundingClientRect: () => ({ width: 320 }), setStyle(value) { styles.set(selector, { ...styles.get(selector), ...value }) } }
    },
    callMethod(name, payload) { events.push({ name, payload }) },
  }
  function frame() { const callback = queue.shift(); if (callback) callback(clock += 1000 / 60) }
  function settle() { for (let step = 0; queue.length && step < 2000; step += 1) frame(); assert.equal(queue.length, 0) }
  function touch(x, y = 100, time = 100) { return { touches: [{ identifier: 1, pageX: x, pageY: y }], timeStamp: time } }
  engine.observe({ identity: 'fixture-history', count: 2, index, reduced, revision: 0, alive: true }, null, owner)
  settle()
  return { engine, owner, bag, styles, events, frame, settle, touch }
}

test('left swipes go to history and right swipes go newer while the plane follows the finger', () => {
  for (const reduced of [false, true]) {
    const h = deckHarness(reduced)
    h.engine.touchStart(h.touch(240, 100, 100), h.owner)
    h.engine.touchMove(h.touch(80, 100, 200), h.owner)
    h.frame()
    assert.ok(h.bag.dailyCardDeck.position < 1)
    assert.ok(Number(/translate3d\(([-\d.]+)%/.exec(h.styles.get('.deck-plane-1').transform)[1]) < 0)
    h.engine.touchEnd({ touches: [], changedTouches: [{ identifier: 1 }], timeStamp: 210 }, h.owner)
    h.settle()
    assert.equal(h.bag.dailyCardDeck.index, 0)
    h.engine.touchStart(h.touch(80, 100, 500), h.owner)
    h.engine.touchMove(h.touch(240, 100, 600), h.owner)
    h.frame()
    assert.ok(Number(/translate3d\(([-\d.]+)%/.exec(h.styles.get('.deck-plane-0').transform)[1]) > 0)
    h.engine.touchEnd({ touches: [], changedTouches: [{ identifier: 1 }], timeStamp: 610 }, h.owner)
    h.settle()
    assert.equal(h.bag.dailyCardDeck.index, 1)
    assert.deepEqual(h.events.filter(event => event.name === 'onDeckCommit').map(event => event.payload.index), [0, 1])
  }
})

test('left boundary swipes notify once, cancelled and vertical gestures do not, and keys match swipe directions', () => {
  const h = deckHarness(false, 0)
  h.engine.touchStart(h.touch(200, 100, 100), h.owner)
  h.engine.touchMove(h.touch(80, 100, 200), h.owner)
  h.engine.touchEnd({ touches: [], changedTouches: [{ identifier: 1 }], timeStamp: 210 }, h.owner)
  h.settle()
  assert.deepEqual(h.events.filter(event => event.name === 'onDeckBoundary').map(event => event.payload.direction), ['older'])
  h.engine.touchStart(h.touch(200, 100, 500), h.owner)
  h.engine.touchMove(h.touch(80, 100, 600), h.owner)
  h.engine.touchCancel({ touches: [], timeStamp: 610 }, h.owner)
  h.settle()
  h.engine.touchStart(h.touch(200, 100, 800), h.owner)
  h.engine.touchMove(h.touch(198, 240, 900), h.owner)
  h.engine.touchEnd({ touches: [], changedTouches: [{ identifier: 1 }], timeStamp: 910 }, h.owner)
  h.settle()
  assert.equal(h.events.filter(event => event.name === 'onDeckBoundary').length, 1)
  h.engine.keydown({ key: 'ArrowRight', timeStamp: 1000 }, h.owner)
  h.settle()
  assert.equal(h.bag.dailyCardDeck.index, 1)
  h.engine.keydown({ key: 'ArrowLeft', timeStamp: 1100 }, h.owner)
  h.settle()
  assert.equal(h.bag.dailyCardDeck.index, 0)
  h.engine.keydown({ key: 'ArrowLeft', timeStamp: 1200 }, h.owner)
  h.settle()
  assert.equal(h.events.filter(event => event.name === 'onDeckBoundary').length, 2)
})

test('exhausted reminder completion is not labeled as a sent single reminder', () => {
  const label = reminderSubscriptionLabel({ mode: 'once', frequency: 'daily', status: 'completed', lastResult: 'catalog_exhausted' })
  assert.match(label, /全部卡片已领取/)
  assert.doesNotMatch(label, /已发送|已完成/)
})
