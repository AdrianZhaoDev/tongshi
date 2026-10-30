# 开发规范

## 环境与命令

使用 Node.js 22 和 npm（版本约束以根目录 `package.json` 为准）。在项目根目录执行：

```bash
npm ci
npm run dev:h5
npm run dev:mp-weixin
npm run build:h5
npm run build:mp-weixin
npm run type-check
```

`npm ci` 以提交的锁文件安装；不要手动修改锁文件或混用包管理器。`dev:h5` 用浏览器访问终端打印的本地地址；`dev:mp-weixin` 产物导入微信开发者工具，使用自己的测试小程序 AppID 或开发者工具允许的测试方式，当前配置不提供正式 AppID。构建产物分别位于 `dist/build/h5`、`dist/build/mp-weixin`，开发产物位于 `dist/dev/` 对应平台目录。运行命令并不自动证明功能在真机可用，详见[验证规范](verification.md)。

## 代码约定

- 使用 Vue 3 `<script setup lang="ts">`、明确类型和现有项目风格；类型、组件名用 PascalCase，变量与函数用 camelCase，常量按照现有文件惯例命名。避免 `any` 和非必要断言。
- 页面按 `pages.json` 注册；优先 uni-app 内置组件和跨端 API，平台特例使用条件编译并提供清晰的非适用处理，不在通用逻辑中假定 DOM 或 `wx` 存在。
- 通用颜色、字号与间距复用 `tokens.css`，交互与可访问性遵循[界面规范](../design/ui-guidelines.md)；新增功能先核对[架构边界](architecture.md)。
- DCloud 相关运行时与构建插件版本保持同一套官方兼容版本，不单独升级一个包；修改依赖须同步更新锁文件，确认 Vue、Vite 和类型工具兼容。不要引入第二套状态、路由或组件体系只为解决局部问题。
- 不提交密钥、真实儿童资料或构建产物。涉及内容变更同时维护来源和审校状态；接口、存储或平台行为变更同步相关文档。

## 安装来源与已知提示

初始化时官方 npm 源下载多次中断，改用 `https://registry.npmmirror.com` 完成安装；未修改全局 registry，锁文件记录实际下载地址及完整性。常规使用 `npm ci`，不要为了网络问题跳过 peer 依赖校验或手动改锁文件。

当前官方兼容基线依赖包含已停止维护的 `vue-i18n@9.14.5` 和间接依赖 `phin`，安装会提示弃用。升级需按整套 DCloud 兼容关系验证，不直接强升单包。弃用不等于已确认漏洞；本次初始化未完成漏洞审计。
