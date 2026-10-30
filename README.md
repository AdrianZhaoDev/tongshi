# 通识卡

一款专为家长设计的亲子通识对谈与打卡工具。内置海量预设探究卡片与启发话术，帮助家长轻松应对孩子的“十万个为什么”。支持童言金句记录与打卡留痕，是您高质量陪伴的得力助手。

以上为用户确认的产品介绍，描述产品目标，并非当前初始化版本的功能清单。课程面向 3–12 岁儿童的家长，以每日 3 分钟真实对话为切口；实际实现范围如下。

## 当前交付

- uni-app + Vue 3 + TypeScript 工程，支持 H5 预览与微信小程序构建。
- 项目导览首页，展示五大主题及对应探究篇章；可切换主题查看内容。
- `AGENTS.md`、分类产品与工程规范、五个专项 AI skills。
- 用户白皮书的可追溯文本副本与已识别风险。

**尚未实现的产品规划**：正式课程卡片、登录、今日打卡、成长手账、关卡地图、在线 AI 追问、海报生成、支付和后端。首页不展示伪造的儿童身份、课程进度或运营数据。预置 skills 用于 AI 辅助开发和内容制作，不等于在线 AI 功能。

## 本地运行

环境：Node.js 22（见 `.nvmrc`）、npm；只维护 `package-lock.json`。

```bash
npm ci
npm run dev:h5
```

按终端实际输出地址打开浏览器。停止服务使用 `Ctrl+C`。

```bash
npm run type-check
npm run build:h5
npm run build:mp-weixin
```

H5 产物：`dist/build/h5`。微信小程序产物：`dist/build/mp-weixin`。

### 微信开发者工具

```bash
npm run dev:mp-weixin
```

导入 `dist/dev/mp-weixin`。微信 AppID 在 `src/manifest.json` 的 `mp-weixin.appid` 配置；初始化留空，不冒用真实项目身份。使用自有测试号/已授权 AppID 完成开发者工具预览和真机验证。DCloud AppID 与微信 AppID 是不同标识，按实际平台要求配置。AppSecret 不能写入此工程。

产物构建通过不等于微信真机验收或正式上线。发布还需要真实账号、平台审核和必要的隐私配置。

## 使用 AI 开发

每次新会话先让 AI 读取 [AGENTS.md](AGENTS.md)，再从 [文档导航](docs/README.md) 按任务选择规范。示例：

> 先阅读 AGENTS.md 和 `.agents/skills/inquiry-card/SKILL.md`。为 3–5 岁制作一张“影子为什么会变长”的微探究卡片草稿，提供事实依据、双向容错话术、安全检查和待审清单。不要标为已发布。

> 先阅读 AGENTS.md 和 `.agents/skills/uniapp-page/SKILL.md`。按照已确认的需求实现页面，复用项目现有设计 token，运行类型检查和双端构建，并实际验证交互。

五个专项入口：`curriculum-planning`、`inquiry-card`、`content-review`、`uniapp-page`、`parent-poster`，统一位于 `.agents/skills/`。是否自动发现取决于使用的 AI 工具；不支持时显式读取 `SKILL.md` 即可，不需要在线 API Key。生成课程须经独立人工审校，内容安全不得由 AI 自行签发。

## 阅读顺序

1. [AI 总约束](AGENTS.md)
2. [分类文档索引](docs/README.md)
3. [产品范围](docs/product/overview.md)与[路线图/待决策事项](docs/product/roadmap.md)
4. [白皮书来源及风险](docs/reference/provenance.md)
5. [工程验证清单](docs/engineering/verification.md)

技术依据：[DCloud CLI 文档](https://uniapp.dcloud.net.cn/quickstart-cli.html)及[官方 Vue 3 TypeScript 模板](https://github.com/dcloudio/uni-preset-vue/tree/vite-ts)。依赖版本以本仓库锁文件为准，不混用不同发行版编译器。
