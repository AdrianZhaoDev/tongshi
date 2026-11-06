export interface DatedCard {
  id: string
  releaseOn: string
}

export interface ViewedDay {
  day: string
  cardId: string
}

export interface DailyEntry<T extends DatedCard> {
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

function indexCatalog<T extends DatedCard>(cards: readonly T[]) {
  const byDay = new Map<string, T>()
  const byId = new Map<string, T>()

  for (const card of cards) {
    assertId(card.id)
    assertDay(card.releaseOn)
    if (byId.has(card.id)) {
      throw new TypeError('Duplicate catalog card id')
    }
    if (byDay.has(card.releaseOn)) {
      throw new TypeError('Duplicate catalog release day')
    }
    byDay.set(card.releaseOn, card)
    byId.set(card.id, card)
  }

  return { byDay, byId }
}

function readViewedDays(
  rows: readonly unknown[],
  cardsById?: ReadonlyMap<string, DatedCard>,
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

    if (cardsById) {
      const card = cardsById.get(row.cardId)
      if (!card || card.releaseOn !== row.day) {
        throw new TypeError('Invalid viewed history: card id and release day must match the catalog')
      }
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

export function dayKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Cannot resolve an invalid date')
  }
  const year = date.getFullYear()
  if (year < 0 || year > 9999) {
    throw new RangeError('Calendar year must fit YYYY-MM-DD')
  }

  return `${String(year).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseViewedHistory(raw: unknown, cards: readonly DatedCard[]): ViewedDay[] {
  const { byId } = indexCatalog(cards)
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

export function recordViewedDay(seen: readonly ViewedDay[], entry: DailyEntry<DatedCard>): ViewedDay[] {
  assertDay(entry.day)
  assertId(entry.card.id)
  assertDay(entry.card.releaseOn)
  if (entry.day !== entry.card.releaseOn) {
    throw new TypeError('Viewed day must match the card release day')
  }

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

export function resolveDailyFeed<T extends DatedCard>(
  cards: readonly T[],
  seen: readonly ViewedDay[],
  now: Date,
): { today: DailyEntry<T> | null; entries: DailyEntry<T>[]; activeIndex: number } {
  const { byDay, byId } = indexCatalog(cards)
  const currentDay = dayKey(now)
  const viewed = readViewedDays(seen, byId)
  const entries: DailyEntry<T>[] = []

  // Date-only keys sort by calendar day without assuming every day lasts 24 hours.
  for (const row of viewed) {
    if (row.day < currentDay) {
      entries.push({ day: row.day, card: byId.get(row.cardId)! })
    }
  }
  entries.sort(compareDays)

  const currentCard = byDay.get(currentDay)
  const today = currentCard ? { day: currentDay, card: currentCard } : null
  if (today) {
    entries.push(today)
  }

  return { today, entries, activeIndex: entries.length - 1 }
}
