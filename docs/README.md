# 文档导航

先读根目录 [README](../README.md) 与 [AGENTS.md](../AGENTS.md)，再按任务加载下表。规范描述的未来能力不代表当前已实现；实际范围以 README 为准。

| 分类 | 文档 | 解决的问题 |
| --- | --- | --- |
| 产品 | [定位与范围](product/overview.md) | 用户、价值、功能边界 |
| 产品 | [路线图与决策](product/roadmap.md) | 初始化、MVP、长期计划和未定事项 |
| 课程 | [课程体系](content/curriculum.md) | 五大世界、概念、分龄、排期 |
| 课程 | [卡片标准](content/card-standard.md) | 字段、话术、字符口径、审校与发布 |
| 设计 | [UI 规范](design/ui-guidelines.md) | 视觉、阅读、跨端、交互与无障碍 |
| 工程 | [架构边界](engineering/architecture.md) | 当前目录、职责与未来扩展原则 |
| 工程 | [开发规范](engineering/development.md) | 环境、命名、跨端 API 与依赖 |
| 工程 | [验证清单](engineering/verification.md) | 命令、交互场景、平台验证边界 |
| 安全 | [儿童与数据安全](security/child-safety.md) | 活动风险、隐私、监护授权与分享 |
| AI | [协作工作流](ai/workflow.md) | 任务输入、专项技能、审校与交接 |
| 参考 | [来源与风险](reference/provenance.md) | 原文溯源、冲突和技术依据 |
| 参考 | [白皮书提取全文](reference/whitepaper.txt) | 用户输入，非可直接上线内容 |

## 专项制作入口

技能源文件统一放在 [`.agents/skills/`](../.agents/skills/)。支持该目录的工具可按名称发现；其他工具按下表显式读取，不保证所有 AI 客户端自动加载。

| Skill | 示例请求 |
| --- | --- |
| [curriculum-planning](../.agents/skills/curriculum-planning/SKILL.md) | 为 3–5 岁规划“身边的声音”一周，含 5 张卡片大纲与 1 个周末实践 |
| [inquiry-card](../.agents/skills/inquiry-card/SKILL.md) | 按卡片标准制作一张“影子为什么会变长”的待审卡片，给出依据与安全边界 |
| [content-review](../.agents/skills/content-review/SKILL.md) | 审校这张卡片的科学性、分龄、双分支话术和实验安全，列出阻断问题 |
| [uniapp-page](../.agents/skills/uniapp-page/SKILL.md) | 按现有架构实现已确认的页面需求，列出 H5 与微信端验收场景 |
| [parent-poster](../.agents/skills/parent-poster/SKILL.md) | 制作不含儿童个人信息的“今日餐桌一问”海报方案，注明素材授权与导出规格 |

## 维护原则

- 每条规则只保留一个权威定义，其他文件引用它。
- 事实与内容发布状态、产品决策和实现状态分开记录。
- 修改业务语义时同步相关规范；修改工程时只记录真实存在的目录、脚本和能力。
- 白皮书原文与历史验证事实不追溯改写；新决策明确注明替代关系。
