import { CARDS_DATA, type CardItem } from './cards'

/** Share routes contain catalog IDs only, never personal progress or identity. */
export function resolveSharedCard(cardId: unknown): CardItem | null {
  if (typeof cardId !== 'string') return null
  return CARDS_DATA.find(card => card.id === cardId) ?? null
}

export function cardShareMessage(card: CardItem | null) {
  return card
    ? { title: `通识卡｜${card.title}`, path: `/pages/share/index?cardId=${encodeURIComponent(card.id)}` }
    : { title: '通识卡 · 每日一问', path: '/pages/index/index' }
}
