export interface IdentifiedCard {
  id: string
}

export interface ViewedDay {
  day: string
  cardId: string
}

export interface DailyEntry<T extends IdentifiedCard> {
  day: string
  card: T
}

function assertDay(value: unknown): asserts value is string {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new TypeError('Invalid calendar day: expected YYYY-MM-DD')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthLength = month === 2
    ? (leapYear ? 29 : 28)
    : (month === 4 || month === 6 || month === 9 || month === 11) ? 30 : 31
  if (month < 1 || month > 12 || day < 1 || day > monthLength) {
    throw new TypeError('Invalid calendar day: date does not exist')
  }
}

function assertId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Invalid card id: expected a nonempty string')
  }
}

function indexCatalog<T extends IdentifiedCard>(cards: readonly T[]) {
  const byId = new Map<string, T>()
  for (const card of cards) {
    assertId(card.id)
    if (byId.has(card.id)) {
      throw new TypeError('Duplicate catalog card id')
    }
    byId.set(card.id, card)
  }
  return byId
}

function readViewedDays(
  rows: readonly unknown[],
  cardsById?: ReadonlyMap<string, IdentifiedCard>,
  deduplicate = false,
): ViewedDay[] {
  const byDay = new Map<string, string>()
  const byId = new Map<string, string>()
  const viewed: ViewedDay[] = []

  for (const row of rows) {
    if (
      typeof row !== 'object' || row === null || Array.isArray(row)
      || !('day' in row) || !('cardId' in row)
    ) {
      throw new TypeError('Invalid viewed history: expected day and cardId records')
    }
    assertDay(row.day)
    assertId(row.cardId)

    if (cardsById && !cardsById.has(row.cardId)) {
      throw new TypeError('Invalid viewed history: unknown card id')
    }
    const existingId = byDay.get(row.day)
    const existingDay = byId.get(row.cardId)
    if (existingId !== undefined || existingDay !== undefined) {
      if (deduplicate && existingId === row.cardId && existingDay === row.day) {
        continue
      }
      throw new TypeError('Invalid viewed history: duplicate or conflicting day/card id')
    }

    byDay.set(row.day, row.cardId)
    byId.set(row.cardId, row.day)
    viewed.push({ day: row.day, cardId: row.cardId })
  }

  return viewed
}

function compareDays(a: { day: string }, b: { day: string }): number {
  return a.day < b.day ? -1 : a.day > b.day ? 1 : 0
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// Visits use the same Beijing calendar day on every device and platform.
export function dayKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Cannot resolve an invalid date')
  }
  const shifted = new Date(date.getTime() + BEIJING_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  if (year < 0 || year > 9999) {
    throw new RangeError('Calendar year must fit YYYY-MM-DD')
  }

  return `${String(year).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

export function nextDayStart(date: Date): Date {
  dayKey(date)
  return new Date((Math.floor((date.getTime() + BEIJING_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - BEIJING_OFFSET_MS)
}

export function parseViewedHistory(raw: unknown, cards: readonly IdentifiedCard[]): ViewedDay[] {
  const byId = indexCatalog(cards)
  if (raw === '' || raw === undefined || raw === null) {
    return []
  }

  if (
    typeof raw !== 'object' || raw === null || Array.isArray(raw)
    || !('version' in raw) || raw.version !== 1
    || !('viewed' in raw) || !Array.isArray(raw.viewed)
  ) {
    throw new TypeError('Invalid viewed history: expected version 1 and a viewed array')
  }

  return readViewedDays(raw.viewed, byId).sort(compareDays)
}

export function recordViewedDay(seen: readonly ViewedDay[], entry: DailyEntry<IdentifiedCard>): ViewedDay[] {
  assertDay(entry.day)
  assertId(entry.card.id)

  const viewed = readViewedDays(seen, undefined, true)
  for (const row of viewed) {
    if (row.day === entry.day || row.cardId === entry.card.id) {
      if (row.day === entry.day && row.cardId === entry.card.id) {
        return viewed.sort(compareDays)
      }
      throw new TypeError('Viewed day conflicts with an existing day/card id')
    }
  }

  viewed.push({ day: entry.day, cardId: entry.card.id })
  return viewed.sort(compareDays)
}

export interface DailyFeed<T extends IdentifiedCard> {
  today: DailyEntry<T> | null
  entries: DailyEntry<T>[]
  activeIndex: number
}

function mapHistory<T extends IdentifiedCard>(
  byId: ReadonlyMap<string, T>,
  viewed: readonly ViewedDay[],
  currentDay: string,
): DailyFeed<T> {
  const entries = viewed.map(row => ({ day: row.day, card: byId.get(row.cardId)! })).sort(compareDays)
  const todayIndex = entries.findIndex(entry => entry.day === currentDay)
  return {
    today: todayIndex < 0 ? null : entries[todayIndex]!,
    entries,
    activeIndex: todayIndex < 0 ? entries.length - 1 : todayIndex,
  }
}

// Cloud callers only map acknowledged records. This function never claims a card.
export function mapViewedFeed<T extends IdentifiedCard>(
  cards: readonly T[],
  seen: readonly ViewedDay[],
  now: Date,
): DailyFeed<T> {
  const byId = indexCatalog(cards)
  return mapHistory(byId, readViewedDays(seen, byId), dayKey(now))
}

// Local H5 preview only: the next visit day receives the first unseen catalog ID.
export function resolveDailyFeed<T extends IdentifiedCard>(
  cards: readonly T[],
  seen: readonly ViewedDay[],
  now: Date,
): DailyFeed<T> {
  const byId = indexCatalog(cards)
  const viewed = readViewedDays(seen, byId)
  const currentDay = dayKey(now)
  const feed = mapHistory(byId, viewed, currentDay)
  if (feed.today) return feed

  const viewedIds = new Set(viewed.map(row => row.cardId))
  const nextCard = cards.find(card => !viewedIds.has(card.id))
  if (!nextCard) return feed

  const today = { day: currentDay, card: nextCard }
  feed.entries.push(today)
  feed.entries.sort(compareDays)
  return { today, entries: feed.entries, activeIndex: feed.entries.indexOf(today) }
}
