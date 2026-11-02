---
name: ui-ux-pro-max
description: "面向「通识卡」的 UI/UX 设计推荐与可用性审查工具。基于 BM25 检索风格、色系、排版、产品模式与 UX/无障碍指引，辅助 uni-app (Vue 3) 界面设计、触控无障碍核验与视觉层级决策。不替代项目既有的白皮书五大主题色彩规范，不引入未授权的重型 UI 库。"
---

# UI/UX Pro Max · 通识卡精简版设计推荐

本工具是针对「通识卡」亲子对谈工具裁剪后的轻量级 UI/UX 决策辅助库，专用于**界面排版、触控无障碍、设计模式与视觉层级建议**。

## 项目专属定位与规则

1. **不可覆盖项目设计基线**：
   - 核心色彩必须遵循 `docs/design/ui-guidelines.md` 与 `tokens.css`（背景 `#F9F9F7`、五大世界主题色）。
   - 本工具推荐的色彩与风格主要用于**辅助色、卡片视觉层级、中性灰阶、行高间距、轻微质感**，不得擅自将科技感、商业转化率导向或游戏化焦虑色彩强加到亲子通识卡片上。
2. **跨端与框架适配**：
   - 项目采用 **uni-app + Vue 3 + TypeScript**，运行于 H5 与微信小程序。
   - 所有 UI 输出严禁直接使用 DOM/BOM API（如 `window`、`document`、纯浏览器 GSAP）；代码实现统一使用 uni-app 原生标签（`view`、`text`、`button`、`image`）及条件编译。
3. **无焦虑与成人友好**：
   - 优先满足成人 30 秒备课快速扫读，字号 $\ge 16\text{px}$、行高舒适、触控目标 $\ge 44 \times 44\text{px}$、对比度 $\ge 4.5:1$。

---

## 常用推荐命令

脚本位于项目内 `.agents/skills/ui-ux-pro-max/scripts/search.py`，无需外部安装，直接使用 Python 3 运行：

### 1. 生成设计系统与层级建议

针对特定功能模块或页面进行设计层级与排版推荐：

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "education warm parent child card" --design-system
```

### 2. 检索移动端与触控可用性规范 (UX / Accessibility)

审查点击热区、表单反馈、弱网加载、视力可访问性：

```bash
# 查询触控目标规范 (44x44px、间距)
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "touch target" --domain ux

# 查询移动端排版与对比度规范
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "contrast readability" --domain ux
```

### 3. 查询移动端/原生界面规范 (Web & Mobile Interface)

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "safe area mobile" --domain web
```

### 4. 查询 Vue 3 规范

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "reactivity composition props" --stack vue
```

---

## 核心可用性自检清单（交付前必查）

- [ ] **触控区域**：按钮与卡片点击热区最小 $44 \times 44\text{px}$，元素间留白 $\ge 8\text{px}$。
- [ ] **对比度**：正文与背景对比度 $\ge 4.5:1$，大标题 $\ge 3:1$，严禁低对比度浅灰字。
- [ ] **跨端安全区**：适配 iOS 底部安全区（`constant(safe-area-inset-bottom)` / `env(safe-area-inset-bottom)`）与小程序胶囊按钮。
- [ ] **无焦虑表达**：无倒计时强迫、无惩罚性断签、无复杂炫光动效。
