# AGENTS.md · 通识卡 AI 开发约束

本文件适用于整个仓库。产品正式名称为「通识卡」，是一款专为家长设计的亲子通识对谈与打卡工具，面向 3–12 岁儿童的家长，以亲子对话而非儿童刷屏为核心。默认使用简体中文沟通与编写内容，代码标识符使用英文。用户确认的产品介绍见 README；目标能力不得描述成当前已上线功能。

## 先读什么

1. 阅读 [README.md](README.md) 确认当前已实现范围与运行方式。
2. 从 [docs/README.md](docs/README.md) 选择任务对应规范；不要每次加载全部文档。
3. 修改代码必读 [工程架构](docs/engineering/architecture.md)、[开发规范](docs/engineering/development.md)；涉及课程必读 [课程体系](docs/content/curriculum.md)、[卡片标准](docs/content/card-standard.md)、[儿童安全](docs/security/child-safety.md)。
4. 按下表加载专项 skill。所有路径以仓库根目录为基准，即使工具没有自动发现 skills，也必须主动读取相应 `SKILL.md`。

## 专项 skills

| 任务 | 入口 |
| --- | --- |
| 月主题、周单元、分龄螺旋课程规划 | [.agents/skills/curriculum-planning/SKILL.md](.agents/skills/curriculum-planning/SKILL.md) |
| 每日微探究卡片、家长提问话术 | [.agents/skills/inquiry-card/SKILL.md](.agents/skills/inquiry-card/SKILL.md) |
| 事实核查、分龄检查、实验安全审校 | [.agents/skills/content-review/SKILL.md](.agents/skills/content-review/SKILL.md) |
| uni-app 页面、组件、跨端交互 | [.agents/skills/uniapp-page/SKILL.md](.agents/skills/uniapp-page/SKILL.md) |
| 餐桌一问日签、亲子金句分享海报 | [.agents/skills/parent-poster/SKILL.md](.agents/skills/parent-poster/SKILL.md) |
| UI/UX 设计推荐与可用性审查 | [.agents/skills/ui-ux-pro-max/SKILL.md](.agents/skills/ui-ux-pro-max/SKILL.md) |
本仓库只维护 `.agents/skills/` 一份源文件。不复制出多份工具专属规则；工具未自动加载时，通过本入口显式读取。预置 skill 是开发工作流，不代表已接入在线 AI 产品功能。

## Penpot MCP 原型设计与跨设备部署

本项目使用 Penpot MCP 服务进行高保真 UI/UX 原型直接设计与视觉审查。切换电脑时可按以下步骤快速部署：

1. **配置 MCP 服务**（见项目根目录 `.mcp.json`）：
   ```json
   {
     "mcpServers": {
       "penpot": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "http://localhost:4401/mcp", "--allow-http"]
       }
     }
   }
   ```
2. **安装并启动 Penpot 插件客户端**：
   - 打开 Penpot 项目网页端，在右侧插件区加载/运行 Penpot MCP Plugin。
   - 启动本地代理连接（默认端口 `4401`），点击插件面板的 **Connect MCP Server** 保持绿色 `● Connected` 状态。
   - *注意*：若浏览器长时间处于后台，插件可能休眠挂起（提示 `no heartbeat` 或 `No Penpot plugin instances`），只需点击唤醒 Penpot 标签页即可自动恢复。
3. **画布结构与规范**：
   - 包含三大核心高保真画板：
     - `iPhone 14 - 通识卡 (Today)`（X: 200, 375×812）：沉浸式主角卡片、无焦虑微元信息、亲子生活类比对话框、底部宽胶囊完成按钮。
     - `iPhone 14 - 通识卡 (Footprint)`（X: 722, 375×812）：去考评化温润手账、5 维柔和主题徽章、真实童言金句卡片列表。
     - `iPhone 14 / 15 - 项目导览首页`（X: 1200, 390×1080）：五大主题折叠手风琴卡片演示（自然与生命展开）、分龄三阶梯模块、底部边界说明。
   - 全局底部统一采用深色毛玻璃悬浮 Dock（260×54px，圆角 27px，距底 34px）。

## 不可越过的边界

- 产品为家长提供备课支持，不做儿童智力、心理、疾病诊断；不把参与次数包装成认知能力评分。
- 白皮书是产品输入，不是事实证据或上线批准。原文见 [来源记录](docs/reference/provenance.md)；冲突与风险按 [待决策事项](docs/product/roadmap.md) 处理，不悄悄补全。
- 内容保持五大世界、12 个核心大概念、三个年龄阶段的一致性。不为凑卡片数制造冷知识或伪科学。
- AI 产物必须标明草稿/待审状态；事实、安全和分龄结论须有依据。禁止编造来源、审校人、认证、真实孩子金句、实验观察或用户数据。
- 不能因“一屏”“30 秒”删掉必要安全警示。不可让幼儿盲尝未知物、接触热源、直接长时持冰、独自靠近道路水体或接触不熟悉的动物。
- 展示文案全局约束：所有用户页面、卡片正反面、分享标题、应用简介与演示预览，不添加「安全提示」「草稿 · 待人工审校」及同义的流程标签、角标、提示块或免责式备课说明。不可省略的操作条件融入活动正文、成人准备与步骤，不另设提示区；AI 内容的真实草稿／待审状态与审校依据集中记录在内部内容文档，不因界面去标识而改为已审校。
- 未获明确授权，不调用外部模型处理儿童文字、照片、语音及身份信息；不新增采集、埋点、上传或公开分享。
- 密钥、令牌、AppSecret 不得进入仓库、前端环境变量或构建产物。`VITE_*` 均视为公开信息。
- 不在无真实接口时伪造登录成功、支付成功、上传成功、课程发布或进度保存。

## 工程约束

- 使用 uni-app + Vue 3 + TypeScript；npm 是唯一包管理器，维护 `package-lock.json`，安装使用 `npm ci`。
- `@dcloudio/uni-*` 编译器与平台运行包保持兼容同一发行版本；升级时统一处理并重新验证两端。不要擅自切换 uni-app x、React、Nuxt 或添加 UI 框架。
- 优先 uni-app 的 `view`、`text`、`button` 和 `uni.*` API。共享代码不得依赖 `window`、`document`、`localStorage`；平台差异显式隔离并说明。
- 先读被修改文件与调用方，复用现有模式。无第二套 token、重复领域常量、空 service、未来占位目录或未经使用的抽象。
- 文案/颜色/数据与逻辑遵循现有边界。页面不硬编码密钥、用户身份、业务计数或假进度。
- 不覆盖用户未关联的改动；破坏性操作、数据迁移、生产发布、外部付费操作先取得明确授权。

## 每个任务的完成条件

1. 简述目标、影响文件和验收场景；多步任务拆解后执行，缺少信息优先查项目，不凭空假设。
2. 只实现本次请求，保持改动聚焦。新增依赖需说明必要性和跨端成本。
3. 代码变更运行 `npm run type-check` 及受影响平台构建；共享代码需 `npm run build:h5` 和 `npm run build:mp-weixin`。
4. 页面变更必须启动 H5、实际点击并观察；微信端还需开发者工具与真机检查才能宣称端到端通过。构建通过不等于真机通过。
5. 修复 bug 尽量保留行为回归测试；不要只断言源码字符串、复制常量或 mock 回显。当前没有业务测试套件，不得声称已有覆盖率。
6. 文档/skill 变更检查相对链接、引用路径和模板可执行性；课程还需独立人工审校，AI 不得自行签发。
7. 同步受影响规范与 `CHANGELOG.md`，删除临时脚本和生成示例。交付列出实际改动、执行命令、观测结果、未验证项，不编造通过记录。

详细任务模板与交接格式见 [AI 工作流](docs/ai/workflow.md)。
