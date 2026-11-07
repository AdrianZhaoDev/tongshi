import catalog from '../../cloudfunctions/reminders/cards.json'

export interface CardItem {
  id: string
  title: string
  scene: string
  sceneIcon: string
  kind: 'daily' | 'weekend'
  front: {
    question: string
    action: string
  }
  back: {
    domain: string
    science: string
    safety: string
  }
  practice?: {
    materials: string
    preparation: string
    duration: string
    steps: readonly string[]
  }
}

export const CARDS_DATA: readonly CardItem[] = catalog as readonly CardItem[]
