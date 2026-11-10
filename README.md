# 通识卡 · 每日一问

面向 3–5 岁儿童家长的单页亲子微探究卡。采用已选定的「暖杏米白」配色：正面是提问、随手互动和必要安全提示，背面解释观察思路与边界。没有地图、账号、年龄选择、金句输入、打卡或底部导航。

## 当前功能与边界

- **按访问领取**：卡片不绑定日期。以北京时间划分领取日，同一天反复打开仍是同一张；下个访问日领取目录中下一张未领卡，缺席不补发。
- **只回看已领取历史**：打开即领取，不表示完成活动或掌握知识。左滑回看较早的卡片，右滑返回较新卡片；没有历史时左滑提示「明日再来哦」。
- **立体卡堆**：历史卡在下层露边，支持跟手拖动、边界阻尼和回位；点击查看背面，垂直阅读不应触发切卡。页面不显示页码、卡库总数或演示切换按钮。
- **微信云端进度**：以微信平台认证身份保存领取日期和卡片 ID，同一用户跨设备共享；云端事务保证同日不重复领取。不新增账号表单，不采集儿童姓名、文字、照片或语音。
- **失败不冒充成功**：微信读取失败不回退为本地派卡，不显示虚假保存成功。旧版本本地历史不自动上传或覆盖云端；云端首次访问从第一张开始。H5 明确为本地预览，使用 `tongshi:viewed-days:v1`，不与微信进度互通；历史损坏时保留原数据并提示重试。
- **内容仍为草稿**：内置 14 张待人工审校内容，包含 10 张日常卡和 4 张实践卡。内容按目录顺序领取，不绑定日期或星期；全部领取后保留历史，不循环旧卡、不假称有新卡。实践背面保留材料、准备、时间与步骤。
- **微信提醒已实现、尚未部署**：小程序可打开设置面板。长期提醒默认不勾选，未勾选只安排一次；勾选后可选每日、每 2 日、每周，初始选中每日。调用真实微信授权后才提交云端保存，保存获确认后才显示成功；拒绝不保存，保存结果未确认时可重试同一请求，不重复授权、不自动降级。H5 不提供提醒。
- **个人下一张提醒**：发送时读取用户进度，模板包含下一张未领卡标题；提醒本身不领取卡片，未访问时下一张保持不变。全部领完后不再发送新卡提醒。
- **数据与授权边界**：阅读需要云端个人进度，发送提醒另需微信订阅授权。云端保存微信身份关联的进度、提醒方式／频率与发送状态；停止提醒不删除进度及幂等回执。生产前须确认隐私声明、保留期限与删除流程。

内容单一来源是 `cloudfunctions/reminders/cards.json`，`src/domain/cards.ts` 提供前端类型入口。扩充课程追加稳定 ID，不任意改变已有 ID 的含义。正式发布前仍需科学事实、儿童安全和编辑人工审校，不能因代码构建通过而批准内容或推送。

H5 运行框架可能另行写入本地设备标识；本地预览历史和微信云端进度与该框架行为分开，正式发布前仍须核验平台与框架隐私要求。

## 开发与验证

使用 Node.js 22、npm：

```bash
npm ci
npm run dev:mp-weixin
```

当前 `src/manifest.json` 的 `mp-weixin.appid` 已配置本项目的公开 AppID，更换小程序账号时须同步更新。微信阅读与提醒均需复制 [`.env.example`](.env.example) 为 `.env.local`，填写公开的 `VITE_WECHAT_CLOUD_ENV`、部署云函数并创建集合后重新编译；阅读无需订阅消息授权。AppID、环境 ID 不是密钥，AppSecret、令牌不得进入前端或仓库。

另开终端执行 `npm run wechat:project -- dev`，在微信开发者工具中导入**仓库根目录**。生成的本机 `project.config.json` 指向 `dist/dev/mp-weixin/` 和 `cloudfunctions/`，已忽略；缺少真实 AppID 或对应构建目录时命令会失败，不生成假配置。使用构建产物时先运行 `npm run build:mp-weixin`，再运行 `npm run wechat:project -- build`。

H5 保留 `npm run dev:h5` 作为共享卡片的开发预览，不承载微信授权或提醒发送。

```bash
npm run dev:h5
```

在浏览器或 Web 预览中打开该命令实际输出的本地 URL；端口以终端输出为准。项目根目录的 `index.html` 是 Vite 编译入口，不能直接打开，也不能通过普通静态服务器预览仓库根目录：其中的 `/src/main.ts` 需要 uni-app/Vite 转换，直接加载会因模块 MIME 类型或未编译语法报错而白屏。仅修改服务器的 MIME 类型无法替代编译。预览构建结果时，静态服务器应指向 `dist/build/h5`。

```bash
npm test
npm run type-check
npm run build:h5
npm run build:mp-weixin
```

- H5 产物：`dist/build/h5`；微信产物：`dist/build/mp-weixin`。
- 回归使用 Node 内置测试工具和现有 TypeScript，覆盖日期、历史兼容、提醒授权／保存／取消、日历周期、并发和未知发送结果；云端与原生 API 使用明确隔离的 SDK／数据库／提供方，不访问真实微信服务。
- H5 的 `getStorageSync` 会把底层读取异常折叠为空串；页面先检查存储键，已有键却不可读或读到空值时禁止覆盖，而不是当作新设备初始化。
- 卡堆使用 uni-app Options API 与 WXS 视图层脚本，而不是在小程序内嵌网页。目标为 H5 与微信 **WebView 渲染模式、基础库 2.14.2 及以上**；开发者工具和真机仍须单独验收。
- H5 使用浏览器基础字号，不让正文随视口宽度放大；系统减少动态效果偏好会传入卡堆。微信通过 [`page-meta`](https://developers.weixin.qq.com/miniprogram/dev/component/page-meta.html) 的 `root-font-size="system"` 配置系统字号，具体触控、字号、动态偏好与读屏效果仍须真机验收。
- 微信领取日以服务端北京时间为准，不信任客户端传入日期或用户身份。H5 仅在本地模拟访问领取，不代表微信云端进度。

## 微信提醒配置与部署

首次上线请按 [微信小程序上线操作手册](docs/wechat-deployment.md) 执行：包含对应网站、账号与 AppID、开发者工具导入、云环境、数据库、云函数部署、订阅模板、定时器、真机验收和审核发布的逐步操作。下方为配置速查。

以下为操作说明，**本次未创建资源、部署、发布或发送真实消息**。仓库已配置公开 AppID，但仍无真实云环境或模板配置，不能据本地构建与回归宣称线上可用。

### 模板和环境变量

一次与长期两种方式默认均启用，但必须分别配置账户真实可用的模板。长期订阅资格由微信的账号、类目和模板规则决定；应用配置不授予平台权限，“保持以上选择”也不等于长期授权，不得把一次模板冒充长期模板。

| 变量 | 配置位置与含义 |
| --- | --- |
| `VITE_WECHAT_CLOUD_ENV` | 前端 `.env.local`；公开的微信云环境 ID，变更后重新编译 |
| `REMINDER_ONCE_TEMPLATE_ID` | 云函数环境；真实一次订阅模板 ID |
| `REMINDER_LONG_TEMPLATE_ID` | 云函数环境；真实长期订阅模板 ID |
| `REMINDER_ONCE_TEMPLATE_DATA` | 云函数环境；一次模板的真实字段到 `{ "value": "文案" }` 的 JSON 对象 |
| `REMINDER_LONG_TEMPLATE_DATA` | 云函数环境；长期模板的真实字段到 `{ "value": "文案" }` 的 JSON 对象 |
| `REMINDER_ONCE_ENABLED` | 云函数环境；可选，默认 `true`，设为 `false` 可明确关闭一次方式 |
| `REMINDER_LONG_ENABLED` | 云函数环境；可选，默认 `true`，设为 `false` 可明确关闭长期方式 |

字段名与长度／类型限制必须取自对应真实模板，不提供虚构字段兜底。模板必须在真实 `thingN` 字段中包含 `{{cardTitle}}`，替换为发送时该用户下一张未领卡标题；校验每个 `thingN` 字段替换后不超过 20 个 UTF-16 单元，超限拒绝配置，不截断标题。同时支持 `{{scheduledAt}}`（北京时间 `YYYY-MM-DD HH:mm`）与 `{{date}}`。标题及文案须人工审校，不发送整卡正文或截断安全提示；跳转正式版 `pages/index/index`，打开时按当日个人进度领取，不凭消息中的日期解锁卡片。

### 云开发操作

1. 在自有小程序云开发环境创建 `card_progress`、`reminder_subscriptions`、`reminder_deliveries` 三个集合；分别应用 [`database.rules.json`](cloudfunctions/reminders/database.rules.json)，禁止客户端直接读写，只由云函数服务端访问。进度使用认证 OPENID 派生的文档 ID，在事务内读取和领取；不要从客户端接收指定用户或指定领取卡片。
2. 为 `reminder_subscriptions` 创建**非唯一联合索引**，顺序为 `status` 升序、`nextSendAt` 升序、`_id` 升序。不对请求回执设置 TTL，不删除仍可能被重试引用的去重记录。
3. 在 `cloudfunctions/reminders` 运行 `npm ci`；将该目录上传为 **`reminders`** 云函数，使用平台可用的 Node.js 18+，函数超时设置 **60 秒**，按上表配置服务端环境变量。唯一新增运行依赖为锁定的 `wx-server-sdk@4.0.2`，用于真实云数据库与微信 OpenAPI，不增加前端 UI 依赖。
4. [`config.json`](cloudfunctions/reminders/config.json) 声明 `subscribeMessage.send` 权限和 `reminder-dispatch` 定时器。七字段 cron `0 */5 * * * * *` 按平台 UTC+8 每五分钟触发；还须在开发者工具执行**上传触发器**，仅上传代码不代表触发器已启用。
5. 真实环境另行验证模板类别、授权弹窗、集合规则／索引、触发器来源、权限生效和送达；开发者工具与真机验证按本次约定暂不进行。内容人工审校和小程序发布同样未执行。

### 发送与故障语义

- 每个微信用户只保留一个当前计划，新计划替换旧计划，不累计授权次数。首次安排在**保存后的次日北京时间 09:00**；长期之后间隔 1／2／7 个北京时间日历日，晚到不集中补发。发送时选取该用户下一张未领卡；未访问不推进进度，全部领取后结束新卡提醒。
- 09:00 是计划时隙，不是送达保证；五分钟轮询、排队与平台延迟会影响实际送达。每轮最多扫描 500 条、五路并发，40 秒启动窗口；生产规模仍需实际验证。
- 收件身份只取平台认证上下文，客户端不能指定收件人、页面或消息正文。普通用户即使伪造 Timer 字段也不能触发派发；只接受可信平台定时器。
- 事务保存请求回执与代际状态；并发派发共享不可重领的发送锁，旧计划结果不能覆盖新计划。只有提供方明确成功才记为发送成功；目录全部领取时计划结束，原因单独记为 `catalog_exhausted`，不冒充已发送。发送事务记录当时下一张的 ID 与标题，之后用户领取或计划取消不能召回已在途消息。
- 授权失效或配置错误会停止后续发送；网络／超时／结算丢失等结果不明时标记待确认，**不盲重发**。无微信提供方幂等键，取舍是可能漏发而不重复尝试，不能保证消息未送达。取消不能召回已经进入派发流程的消息。

官方依据：[原生订阅授权](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)、[订阅能力与长期限制](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html)、[服务端发送](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage)、[云函数定时触发器](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/functions/triggers)。

## 代码入口

- `src/pages/index/index.vue`：唯一主页、微信云端领取与 H5 本地预览、错误提示。
- `src/components/DailyCardDeck.vue`、`card-deck.css`、`card-deck.wxs`：卡片正反面、共享样式及视图层手势与动效。保持标准 WXS 脚本声明，样式外置以避免 H5 样式热更新重复解析脚本。
- `cloudfunctions/reminders/cards.json`、`src/domain/cards.ts`：共享内容草稿及前端类型；[内容文档](docs/content/first-version-plan.md)保留审校边界。
- `src/domain/daily-feed.ts`：领取历史解析及本地预览派卡规则。
- `src/components/ReminderSheet.vue`：仅小程序挂载的提醒面板，标题、说明和选项在原生滚动区内，确认按钮单独固定，避免短屏与大字号挤掉正文。
- `src/domain/reminders.ts`、`src/services/reminders.ts`：提醒控制器与隔离的真实微信授权／云函数适配器。
- `cloudfunctions/reminders/`：可部署云函数、数据库权限与触发器；`contract.json` 是前后端共用的频率／时间／协议单一来源。
- `scripts/prepare-wechat-project.cjs`：校验真实 AppID 与编译目录，生成开发者工具根项目配置。
- `tokens.css`：正式暖杏色变量；H5 与微信使用兼容的 sRGB 色值。
- `src/static/licenses/swiper.txt`：移植的 Cards 数学所适用的 MIT 许可，随两端静态资源分发。

## 原始交互预览

安装依赖后仍可打开 [preview-cards.html](preview-cards.html) 对照原始三套配色与官方 [Swiper Cards](https://swiperjs.com/demos/255-effect-cards/core.html)。该文件中的历史为演示状态，不是真实阅读记录；Swiper `14.0.1` 仅作为预览开发依赖，未把 DOM 引擎引入微信代码。
