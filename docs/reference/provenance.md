# 白皮书来源与使用边界

## 来源

- 输入标题：3–12岁儿童通识教育小程序：产品规划与课程工程白皮书。
- 用户提供文件：`/mnt/c/Users/admin/Downloads/儿童通识教育小程序产品与课程设计白皮书.md/.md.html`。
- 提取日期：2026-10-30。
- 输入 HTML SHA-256：`aa8f70dc45e02af8d9eed1f3d6bcff21d692e110fdcf0488c4cbe4a765de8a30`。
- 仓库副本：[whitepaper.txt](whitepaper.txt)，为 HTML 可见文本的提取版本，不是原始 HTML。去除了脚本、样式和空行；表格列、换行、特殊符号可能未保留原排版。原 HTML 不作为网页执行。

本文件中的本地路径只用于溯源；其他协作者读取仓库副本即可，不应依赖此路径。

## 如何使用

白皮书用于理解需求与内容范围，不可直接作为科学、儿童安全、隐私合规或教育效果的证据。对 IB-PYP、Core Knowledge 的借鉴不构成认证、合作或教材授权。

原文保留以便审计，不应静默改写。规范化决策写入 [产品规划](../product/roadmap.md) 与 [卡片标准](../content/card-standard.md)。本次初始化未交付白皮书规划的完整业务、正式课程或运营规模。

## 已识别的输入风险

- 年度“每季 13 周”与四个 12 周主题段加 4 周复盘并存；12 周季度报告与自然季度不可直接混为一套排期。
- “30 秒微验证”示例包含染色植物等需要等待的观察，必须拆出等待时间或改为周末实践。
- 舌乳头不等于肉眼可见的味蕾；可见白雾不是水蒸气本身；拟人化比喻不得替代正确机制。
- 未知食材盲尝、热水、手持冰块、触摸动物等示例需要安全修订，不因来自原文而自动批准。
- “单屏 200–300 字”应服从可读性与无障碍，不能通过缩小字号或隐藏警示强行达标。

## 技术参考

初始化采用 DCloud 官方 Vue 3 TypeScript CLI 模板的依赖基线，裁剪为 H5 和微信小程序目标：

- [uni-app CLI 官方说明](https://uniapp.dcloud.net.cn/quickstart-cli.html)
- [官方 vite-ts 模板 package.json](https://github.com/dcloudio/uni-preset-vue/blob/vite-ts/package.json)

来源分支会变化，实际安装版本以仓库 `package.json` 和 `package-lock.json` 为准。
