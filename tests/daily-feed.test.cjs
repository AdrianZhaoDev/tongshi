const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const test = require('node:test')

const sourcePath = path.resolve(__dirname, '../src/domain/daily-feed.ts')

function loadFeed(filename) {
  const ts = require('typescript')
  const source = require('node:fs').readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  })
  const exported = {}
  new Function('exports', outputText)(exported)
  return exported
}

const { dayKey, parseViewedHistory, recordViewedDay, resolveDailyFeed } = loadFeed(sourcePath)
const first = Object.freeze({ id: 'first', releaseOn: '2026-11-06', title: 'First draft' })
const second = Object.freeze({ id: 'second', releaseOn: '2026-11-07', title: 'Second draft' })
const third = Object.freeze({ id: 'third', releaseOn: '2026-11-08', title: 'Third draft' })
const fourth = Object.freeze({ id: 'fourth', releaseOn: '2026-11-09', title: 'Fourth draft' })
const fifth = Object.freeze({ id: 'fifth', releaseOn: '2026-11-10', title: 'Fifth draft' })
const cards = Object.freeze([third, first, fifth, second, fourth])

function localNoon(day) {
  const [year, month, date] = day.split('-').map(Number)
  const result = new Date(0)
  result.setFullYear(year, month - 1, date)
  result.setHours(12, 0, 0, 0)
  return result
}

test('dayKey uses local date fields, pads four-digit years and rejects invalid dates', () => {
  assert.equal(dayKey(localNoon('2026-01-02')), '2026-01-02')
  assert.equal(dayKey(localNoon('0005-01-02')), '0005-01-02')
  assert.throws(() => dayKey(new Date(NaN)), RangeError)
  assert.throws(() => dayKey(localNoon('10000-01-01')), RangeError)
  const negativeYear = localNoon('0000-01-01')
  negativeYear.setFullYear(-1)
  assert.throws(() => dayKey(negativeYear), RangeError)
})

test('only empty uni storage values mean empty viewed history', () => {
  for (const raw of ['', undefined, null]) {
    assert.deepEqual(parseViewedHistory(raw, cards), [])
  }
  assert.deepEqual(parseViewedHistory({ version: 1, viewed: [] }, cards), [])
})

test('version-1 object history is chronological, copied and nonmutating', () => {
  const later = Object.freeze({ day: third.releaseOn, cardId: third.id })
  const earlier = Object.freeze({ day: first.releaseOn, cardId: first.id })
  const rows = Object.freeze([later, earlier])
  const ledger = Object.freeze({ version: 1, viewed: rows })
  const parsed = parseViewedHistory(ledger, cards)

  assert.deepEqual(parsed, [earlier, later])
  assert.notStrictEqual(parsed, rows)
  assert.notStrictEqual(parsed[0], earlier)
  assert.deepEqual(rows, [later, earlier])
})

test('nonempty strings and malformed ledger structures throw rather than reset history', () => {
  const invalid = [
    ' ', 'not json', 'null', '[]', JSON.stringify({ version: 1, viewed: [] }),
    false, 0, [], {}, { viewed: [] }, { version: 1 },
    { version: '1', viewed: [] }, { version: 2, viewed: [] },
    { version: 1, viewed: null }, { version: 1, viewed: {} },
    { version: 1, viewed: [null] }, { version: 1, viewed: [[]] },
    { version: 1, viewed: [{}] },
    { version: 1, viewed: [{ day: first.releaseOn }] },
    { version: 1, viewed: [{ cardId: first.id }] },
    { version: 1, viewed: [{ day: first.releaseOn, cardId: '' }] },
    { version: 1, viewed: [{ day: first.releaseOn, cardId: 1 }] },
  ]
  for (const raw of invalid) {
    assert.throws(() => parseViewedHistory(raw, cards), TypeError, JSON.stringify(raw))
  }
})

test('stored history rejects unknown cards, mismatched schedules and every duplicate', () => {
  const row = { day: first.releaseOn, cardId: first.id }
  const invalidRows = [
    [{ day: first.releaseOn, cardId: 'unknown' }],
    [{ day: second.releaseOn, cardId: first.id }],
    [row, { ...row }],
    [row, { day: first.releaseOn, cardId: second.id }],
    [row, { day: second.releaseOn, cardId: first.id }],
  ]
  for (const viewed of invalidRows) {
    assert.throws(() => parseViewedHistory({ version: 1, viewed }, cards), TypeError)
  }
})

test('catalog and history require real Gregorian YYYY-MM-DD dates', () => {
  const invalidDates = [
    '2026-02-29', '1900-02-29', '2024-02-30', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-11-00', '2026-11-31',
    '2026-1-06', '26-11-06', '2026-11-6', '2026-11-06T00:00:00Z',
    ' 2026-11-06', '2026-11-06 ', '', null,
  ]
  for (const releaseOn of invalidDates) {
    const invalidCards = [{ id: 'invalid', releaseOn }]
    assert.throws(() => parseViewedHistory('', invalidCards), TypeError)
    assert.throws(() => resolveDailyFeed(invalidCards, [], localNoon(first.releaseOn)), TypeError)
    assert.throws(() => parseViewedHistory({
      version: 1, viewed: [{ day: releaseOn, cardId: first.id }],
    }, cards), TypeError)
  }

  const leapCard = { id: 'leap', releaseOn: '2000-02-29' }
  assert.deepEqual(parseViewedHistory({
    version: 1, viewed: [{ day: leapCard.releaseOn, cardId: leapCard.id }],
  }, [leapCard]), [{ day: '2000-02-29', cardId: 'leap' }])
  assert.strictEqual(resolveDailyFeed([leapCard], [], localNoon('2000-02-29')).today.card, leapCard)
})

test('duplicate catalog IDs or dates fail even when storage and history are empty', () => {
  const invalidCatalogs = [
    [first, { id: first.id, releaseOn: second.releaseOn }],
    [first, { id: 'other', releaseOn: first.releaseOn }],
    [first, first],
    [{ id: '', releaseOn: first.releaseOn }],
  ]
  for (const catalog of invalidCatalogs) {
    assert.throws(() => parseViewedHistory('', catalog), TypeError)
    assert.throws(() => resolveDailyFeed(catalog, [], localNoon(first.releaseOn)), TypeError)
  }
})

test('today is globally scheduled, retains generic card fields and never unlocks unread past cards', () => {
  const now = localNoon(third.releaseOn)
  const emptyHistory = resolveDailyFeed(cards, [], now)
  const returningReader = resolveDailyFeed(cards, [{ day: first.releaseOn, cardId: first.id }], now)

  assert.strictEqual(emptyHistory.today.card, third)
  assert.equal(emptyHistory.today.card.title, 'Third draft')
  assert.strictEqual(returningReader.today.card, emptyHistory.today.card)
  assert.deepEqual(emptyHistory.entries, [{ day: third.releaseOn, card: third }])
  assert.equal(emptyHistory.activeIndex, 0)
  assert.deepEqual(returningReader.entries, [
    { day: first.releaseOn, card: first }, { day: third.releaseOn, card: third },
  ])
  assert.equal(returningReader.activeIndex, 1)
  assert.strictEqual(returningReader.entries[1], returningReader.today)
})

test('feed contains chronological viewed past plus today exactly once, not skipped or future days', () => {
  const seen = Object.freeze([
    Object.freeze({ day: fifth.releaseOn, cardId: fifth.id }),
    Object.freeze({ day: fourth.releaseOn, cardId: fourth.id }),
    Object.freeze({ day: first.releaseOn, cardId: first.id }),
    Object.freeze({ day: third.releaseOn, cardId: third.id }),
  ])
  const result = resolveDailyFeed(cards, seen, localNoon(fourth.releaseOn))

  assert.deepEqual(result.entries, [
    { day: first.releaseOn, card: first },
    { day: third.releaseOn, card: third },
    { day: fourth.releaseOn, card: fourth },
  ])
  assert.equal(result.activeIndex, 2)
  assert.equal(seen.length, 4)
  assert.equal(seen[0].cardId, fifth.id)
  assert.deepEqual(cards, [third, first, fifth, second, fourth])
})

test('before release, schedule gaps and exhaustion never cycle or label stale history as today', () => {
  assert.deepEqual(resolveDailyFeed(cards, [], localNoon('2026-11-05')), {
    today: null, entries: [], activeIndex: -1,
  })
  const seen = [{ day: first.releaseOn, cardId: first.id }]
  const expected = { today: null, entries: [{ day: first.releaseOn, card: first }], activeIndex: 0 }
  assert.deepEqual(resolveDailyFeed([first, third], seen, localNoon(second.releaseOn)), expected)
  assert.deepEqual(resolveDailyFeed(cards, seen, localNoon('2026-11-11')), expected)
  assert.deepEqual(resolveDailyFeed(cards, seen, localNoon('2036-11-06')), expected)
  assert.deepEqual(resolveDailyFeed(cards, [], localNoon('2026-11-11')), {
    today: null, entries: [], activeIndex: -1,
  })
})

test('clock rollback excludes future seen dates without deleting them', () => {
  const seen = Object.freeze([
    Object.freeze({ day: first.releaseOn, cardId: first.id }),
    Object.freeze({ day: fifth.releaseOn, cardId: fifth.id }),
  ])
  const rollback = resolveDailyFeed(cards, seen, localNoon(second.releaseOn))
  assert.deepEqual(rollback.entries, [
    { day: first.releaseOn, card: first }, { day: second.releaseOn, card: second },
  ])
  assert.deepEqual(resolveDailyFeed(cards, seen, localNoon('2026-11-05')), {
    today: null, entries: [], activeIndex: -1,
  })
  assert.deepEqual(resolveDailyFeed(cards, seen, localNoon('2026-11-11')).entries, [
    { day: first.releaseOn, card: first }, { day: fifth.releaseOn, card: fifth },
  ])
  assert.equal(seen[1].day, fifth.releaseOn)
})

test('resolve also rejects malformed direct history and invalid clocks', () => {
  const invalidRows = [
    [{ day: '2026-02-29', cardId: first.id }],
    [{ day: first.releaseOn, cardId: 'unknown' }],
    [{ day: second.releaseOn, cardId: first.id }],
    [{ day: first.releaseOn, cardId: first.id }, { day: first.releaseOn, cardId: first.id }],
  ]
  for (const seen of invalidRows) {
    assert.throws(() => resolveDailyFeed(cards, seen, localNoon(first.releaseOn)), TypeError)
  }
  assert.throws(() => resolveDailyFeed(cards, [], new Date(NaN)), RangeError)
})

test('recordViewedDay is idempotent, chronological and nonmutating', () => {
  const later = Object.freeze({ day: third.releaseOn, cardId: third.id })
  const earlier = Object.freeze({ day: first.releaseOn, cardId: first.id })
  const seen = Object.freeze([later, earlier])
  const entry = Object.freeze({ day: second.releaseOn, card: second })
  const expected = [earlier, { day: second.releaseOn, cardId: second.id }, later]
  const recorded = recordViewedDay(seen, entry)

  assert.deepEqual(recorded, expected)
  assert.deepEqual(recordViewedDay(recorded, entry), expected)
  assert.notStrictEqual(recorded, seen)
  assert.notStrictEqual(recorded[0], earlier)
  assert.deepEqual(seen, [later, earlier])
  assert.deepEqual(recordViewedDay([earlier, { ...earlier }], { day: first.releaseOn, card: first }), [earlier])
})

test('recordViewedDay rejects day/ID conflicts and invalid entry dates instead of replacing history', () => {
  const seen = Object.freeze([Object.freeze({ day: first.releaseOn, cardId: first.id })])
  const invalidEntries = [
    { day: first.releaseOn, card: { id: 'replacement', releaseOn: first.releaseOn } },
    { day: second.releaseOn, card: { id: first.id, releaseOn: second.releaseOn } },
    { day: second.releaseOn, card: first },
    { day: '2026-02-29', card: { id: 'invalid', releaseOn: '2026-02-29' } },
    { day: second.releaseOn, card: { id: '', releaseOn: second.releaseOn } },
  ]
  for (const entry of invalidEntries) {
    assert.throws(() => recordViewedDay(seen, entry), TypeError)
  }
  assert.throws(() => recordViewedDay([
    { day: first.releaseOn, cardId: first.id },
    { day: first.releaseOn, cardId: 'conflict' },
  ], { day: second.releaseOn, card: second }), TypeError)
  assert.deepEqual(seen, [{ day: first.releaseOn, cardId: first.id }])
})

function checkTimeZone(timeZone, assertions) {
  const script = `
    const assert = require('node:assert/strict')
    const { dayKey, parseViewedHistory, recordViewedDay, resolveDailyFeed } = (${loadFeed.toString()})(${JSON.stringify(sourcePath)})
    ${assertions}
  `
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: timeZone }, encoding: 'utf8',
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${timeZone}: ${result.stderr || result.stdout}`)
}

test('local midnight does not follow UTC midnight in positive or negative offsets', () => {
  checkTimeZone('Asia/Shanghai', `
    const cards = [{ id: 'today', releaseOn: '2026-11-06' }]
    assert.equal(dayKey(new Date('2026-11-05T15:59:59Z')), '2026-11-05')
    assert.equal(dayKey(new Date('2026-11-05T16:00:00Z')), '2026-11-06')
    assert.equal(resolveDailyFeed(cards, [], new Date('2026-11-05T15:59:59Z')).today, null)
    assert.equal(resolveDailyFeed(cards, [], new Date('2026-11-05T16:00:00Z')).today.card.id, 'today')
  `)
  checkTimeZone('Pacific/Honolulu', `
    const cards = [{ id: 'today', releaseOn: '2026-11-06' }]
    assert.equal(dayKey(new Date('2026-11-06T09:59:59Z')), '2026-11-05')
    assert.equal(dayKey(new Date('2026-11-06T10:00:00Z')), '2026-11-06')
    assert.equal(resolveDailyFeed(cards, [], new Date('2026-11-06T09:59:59Z')).today, null)
    assert.equal(resolveDailyFeed(cards, [], new Date('2026-11-06T10:00:00Z')).today.card.id, 'today')
  `)
})

test('23-hour and 25-hour days, repeated local hours and leap days retain calendar scheduling', () => {
  checkTimeZone('America/New_York', `
    const cards = [
      { id: 'spring', releaseOn: '2026-03-08' },
      { id: 'spring-next', releaseOn: '2026-03-09' },
      { id: 'fall', releaseOn: '2026-11-01' },
      { id: 'fall-next', releaseOn: '2026-11-02' },
      { id: 'leap', releaseOn: '2028-02-29' },
      { id: 'march', releaseOn: '2028-03-01' },
    ]
    const spring = new Date(2026, 2, 8, 0, 30)
    const springNext = new Date(2026, 2, 9, 0, 30)
    const fall = new Date(2026, 10, 1, 0, 30)
    const fallNext = new Date(2026, 10, 2, 0, 30)
    assert.equal(springNext - spring, 23 * 60 * 60 * 1000)
    assert.equal(fallNext - fall, 25 * 60 * 60 * 1000)
    let seen = recordViewedDay([], resolveDailyFeed(cards, [], spring).today)
    assert.deepEqual(resolveDailyFeed(cards, seen, springNext).entries.map(entry => entry.day), ['2026-03-08', '2026-03-09'])
    assert.equal(dayKey(new Date('2026-03-09T03:59:59Z')), '2026-03-08')
    assert.equal(dayKey(new Date('2026-03-09T04:00:00Z')), '2026-03-09')
    const firstHour = resolveDailyFeed(cards, [], new Date('2026-11-01T01:30:00-04:00'))
    const repeatedHour = resolveDailyFeed(cards, [], new Date('2026-11-01T01:30:00-05:00'))
    assert.strictEqual(firstHour.today.card, repeatedHour.today.card)
    seen = recordViewedDay([], resolveDailyFeed(cards, [], fall).today)
    assert.equal(resolveDailyFeed(cards, seen, fallNext).today.card.id, 'fall-next')
    const leap = resolveDailyFeed(cards, [], new Date(2028, 1, 29, 23, 59))
    seen = recordViewedDay([], leap.today)
    assert.deepEqual(resolveDailyFeed(cards, seen, new Date(2028, 2, 1, 0, 0)).entries.map(entry => entry.day), ['2028-02-29', '2028-03-01'])
    assert.deepEqual(parseViewedHistory({ version: 1, viewed: seen }, cards), seen)
  `)
})
