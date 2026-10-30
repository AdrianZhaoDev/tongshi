export type ThemeId = 'nature' | 'society' | 'technology' | 'thinking' | 'arts'

export interface CurriculumTheme {
  id: ThemeId
  name: string
  description: string
  chapters: readonly [string, string, string]
}

// 白皮书的分类框架，不代表已经上线或审校通过的课程。
export const curriculumThemes: readonly CurriculumTheme[] = [
  {
    id: 'nature',
    name: '自然与生命',
    description: '从身体与身边生命，认识自然的联系。',
    chapters: ['我的身体与感觉', '身边动植物邻居', '地球、天气与季节'],
  },
  {
    id: 'society',
    name: '社会与文明',
    description: '从日常相处，认识社会如何一起运转。',
    chapters: ['社区与身边职业', '货币、物品与交换', '规则、安全与生活方式'],
  },
  {
    id: 'technology',
    name: '科技与造物',
    description: '从生活物品，探究材料、原理与创造。',
    chapters: ['家常物品大解密', '轮子与交通工具', '奇妙的材料与变化'],
  },
  {
    id: 'thinking',
    name: '思维与逻辑',
    description: '在比较、追问与假设中，练习思考。',
    chapters: ['比较与分类认知', '因果与“为什么”', '脑洞大开的假设思维'],
  },
  {
    id: 'arts',
    name: '艺术与心智',
    description: '感受美、表达情绪，也试着理解他人。',
    chapters: ['情绪颜色与表达', '声音与视觉韵律', '故事与同理心体验'],
  },
]

export const ageStages = [
  { age: '3–5 岁', name: '感官与发现', description: '从可感知的日常出发，观察与表达。' },
  { age: '6–8 岁', name: '因果与联系', description: '比较、分类，试着解释事物的联系。' },
  { age: '9–12 岁', name: '观点与思辨', description: '寻找证据，从不同视角讨论问题。' },
] as const
