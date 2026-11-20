# 插件界面真实点击验收（2026-11-20）

> 状态：活跃（本轮验收记录 + 可复用验收标准；后续回归按本表执行）
> 版本：v4.96.1 · 环境：Obsidian 1.14.5 · 开发 vault `D:\nw-dev-vault`

## 一、目的

用户 2026-11-20 要求：**不用脚本直接调 API，而是像用户一样真实点击**，确认插件界面可用、
找出真 bug，并留下一套可重复执行的验收标准。本文记录方法与结论。

## 二、方法（必须这样跑，否则结论不可信）

1. 用 `--user-data-dir` 临时目录 + `--remote-debugging-port` 起 Obsidian，打开开发 vault。
2. **只信任仓库一次**：点「信任仓库作者」；之后所有操作都用真实点击/真实键盘事件，
   不调用 `plugin.xxx()` 业务方法（仅读取 DOM 度量与状态）。
3. **必须关掉多余窗口**：Obsidian 1.14.5 在本机把设置窗口、命令面板开在**第二个窗口**
   （`about:blank`）。该窗口存在时会抢走 `activeWindow`，插件的 Modal 会弹到那个窗口里，
   主窗口看起来「点了没反应」。脚本启动后 `for (p of ctx.pages()) if (p !== main) p.close()`。
4. 视口固定 1440×900 与 1280×800 各跑一遍；侧栏展开态另测。
5. 记录三样证据：截图（`D:\nw-dev-vault\_verify\`）、控制台 error/warning、
   DOM 度量（`clientWidth/scrollWidth`、元素 bounding box）。

脚本：`D:\nw-tmp\verify-1.mjs`（启动/入口盘点）、`verify-5.mjs`（页签与视图切换）、
`verify-7.mjs`（写作台布局）、`D:\nw-tmp\probe-fw*.mjs`（写作台细节）。

## 三、验收标准（每条都是「可判定」的）

### A. 启动与加载（PASS 条件全满足）
- A1 点「信任仓库作者」后 90s 内插件加载完成，`app.plugins.plugins['novel-writer-ai'].manifest` 可读。
- A2 控制台 **error 数为 0**；warning 必须能解释（见 §六 F-08）。
- A3 页签标题为中文（不得出现 `novel-writer-xxx` 原始 id）。
- A4 重启恢复上次标签后，无重复空白页签。

### B. 入口可达（逐个真实点击，必须都有可见结果）
- B1 左侧 ribbon 7 项：新建白板 / 命令面板 / 新建数据库 / 创作主页 / 任务中心 / Agent 创作工作台 / 项目速览 —— 点击后**有视图或弹窗**。
- B2 创作主页 6 个卡片按钮（任务中心 / 项目体检 / 资产总览 / 用量账本 / 备份中心 / 首启引导）各弹 Modal。
- B3 三个创作分类入口（长篇 / 短篇 / 短剧）各弹「前期调研」Modal，含项目名、分类、目标字数/节数。
- B4 写作台工具栏 26 个按钮：视图类开页签、弹窗类开 Modal、命令类给 Notice，**不得静默无反应**。

### C. 交互反馈
- C1 任何按钮点击后 300ms 内必须有可见状态变化（Modal / 页签 / Notice / 按钮 busy）。
- C2 危险操作（删除、清空、批量）必须有确认框，且确认框里写明后果。
- C3 AI 调用失败必须给可见提示（Notice 或页面内错误条），不能只写控制台。

### D. 布局适配
- D1 1440×900：容器 `scrollWidth === clientWidth`，底部无横向滚动条，右侧上下文面板完整可见。
- D2 1280×800：同上；工具栏允许换行，但不得横向溢出。
- D3 视图内单个卡片/条目不得被相邻面板裁切。
- D4 窄栏（命中容器查询断点）时改为上下堆叠属于设计行为，但列表必须可滚动到底。

### E. 弹窗生命周期
- E1 Esc 关闭；点遮罩关闭（有数据时按脏检查拦截）。
- E2 关闭后再次打开，字段不残留上一次的值。
- E3 长内容弹窗内部滚动，不出横向滚动。

### F. 页签与状态栏
- F1 页签标题中文且与视图一致（含监控面板 A/B）。
- F2 状态栏在 1280 宽下不重叠、不被裁切（换行可以）。

## 四、实测结果（2026-11-20）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| A1 启动加载 | PASS（4.96.1，114 条命令注册） | verify-1 输出 |
| A2 控制台 error | PASS（0 error；3 条 warning） | `_verify/v4.json` |
| A3 页签标题中文 | **修复后 PASS** | `_verify/v5.json` tabTitles |
| A4 无重复空白页签 | PASS（清掉历史 workspace.json 后） | — |
| B1 ribbon 7 项 | PASS | `_verify/01-home.png` 等 |
| B2 主页 6 按钮 | PASS（6 个 Modal 全部弹出） | `_verify/home-*.png` |
| B3 三种创作入口 | PASS（短篇 Modal 内容完整） | `_verify/probe-short3.png` |
| B4 写作台工具栏 | PASS（视图/Modal/Notice 三类都有响应） | `_verify/v7-fw-1280.png` |
| C1 点击反馈 | PASS | — |
| C2 危险操作确认 | PASS（抽查清空/删除） | — |
| C3 AI 失败可见提示 | **FAIL** → F-03 | 见下 |
| D1 1440 布局 | **修复后 PASS** | `_verify/after-fix-1440.png` |
| D2 1280 布局 | 修复后 PASS（cw=sw=912，右栏 x=1038） | `_verify/v7-fw-1280.png` |
| D3 卡片不被裁切 | PARTIAL → F-06 | `v7-fw-1280.png` 阶段导航 |
| D4 窄栏堆叠 | PASS（设计如此） | `_verify/v5-fp.png` |
| E1 弹窗 Esc/遮罩 | PASS | 手工点击 |
| E2 字段不残留 | PASS | 手工点击 |
| F1 页签标题 | 修复后 PASS | `_verify/v5.json` |
| F2 状态栏 | PARTIAL → F-07 | `v7-fw-1280.png` |

其它已确认无溢出的视图：项目速览、规划画布、设定实体图（hostW 1096 / overflow 0）。

## 五、本轮修复（已落地）

### FIX-01 完整写作工作台在 1440 宽下横向溢出（对应 F-01）
- 现象：进入「第1章」写作页后容器 clientWidth 1072 / scrollWidth 1391，右侧「上下文监控」
  面板整个在屏外（x=1517 > 视口 1440），工具栏后半段被裁，底部出现横向滚动条。
- 根因：`.novel-writer-fw-title-row`（1350px）与 `.novel-writer-fw-titlebar`（1371px）
  是 `flex-shrink: 0` 的单行 flex，行内不换行 → 容器最小内容宽被顶到约 1350px。
- 修法：`styles-src/02-full-writer-view.css:167` 给 `.novel-writer-fw-title-row` 加
  `flex-wrap: wrap; min-width: 0;` 与 `.novel-writer-fw-title-row > * { min-width: 0; }`；
  `styles-src/04-workspace-layers.css:48` 给 `.novel-writer-fw-title-secondary` 加
  `flex-wrap: wrap; min-width: 0;`；`styles-src/08-workbench-v7-v8.css:1195` 给
  `.novel-writer-fw-quick-tools-row` 加 `min-width: 0;`。
- 结果：1440 下 cw=sw=1072、右栏 x=1198 可见；1280 下 cw=sw=912、右栏 x=1038；
  工具栏变两/三行，无横向滚动。

### FIX-02 重启后页签显示视图类型 id（对应 F-02）
- 现象：重启后除最后激活的一个外，全部页签显示 `novel-writer-knowledge-base` 等原始 id，
  要手点一次才变中文（含分离式监控面板 A/B）。
- 根因：Obsidian 1.7.2+ 的 DeferredView 未实例化时 `getDisplayText()` 返回视图类型 id，
  保存工作区布局时把这个 id 写进 `workspace.json`。
- 修法：新增 `ui/view-tab-titles.ts`（视图类型 → 显示名的单一映射，含 9 个视图 + 2 个监控面板）；
  `main.ts` 增加 `_scheduleDeferredTabTitlesFix()` / `_fixDeferredTabTitles()`：
  布局就绪后按 0/300/1000/2500ms 重试，并监听 `layout-change` 兜住新开页签；
  只有当页签文字**等于视图类型 id** 时才改写，不覆盖已正常加载的标题；异常只 `log.warn`，不影响启动。
- 结果：重启后 20 个页签全部中文（`_verify/v5.json`）。

## 六、缺陷清单（未修复项）

| ID | 级别 | 现象 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| F-03 | P1 | 打开第 1 章即触发一次 `deepseek-v4-flash` 调用（偏离检测/体检），key 无效时控制台 401，**界面无任何错误提示**，只在体检条显示「0% 偏离中 未解析到情节线」 | `_verify/v5.json` 控制台、`v7-fw-1280.png` 体检条 | 1) 未配置有效 key 时在写作台顶部给一次性引导条；2) AI 失败统一走 `showErrorNotice` 并带「设置」按钮；3) 偏离检测在无 key 时直接跳过并发一条 info |
| F-04 | P2 | 设置页「使用中」开关压住右侧「模型显示」文字（被截断） | `_verify/settings-plugin.png` | 开关容器 `flex: none` + 文字 `white-space: nowrap`，或把「模型显示」移到下一行 |
| F-05 | P2 | 「高级设置」页签有虚线焦点框，与其它页签观感不一致 | 同上 | 统一 `:focus-visible` 样式或改用无边框高亮 |
| F-06 | P2 | 写作台在 900px 左右宽度下三栏挤压，阶段导航文字被截成「上下文加…」「Scen…」 | `v7-fw-1280.png` | 阶段导航列设最小宽或加容器查询：<980px 时折叠成图标+tooltip |
| F-07 | P2 | 800px 高度 + 工具栏换行后，底部状态栏第二行被窗口裁掉 | `v7-fw-1280.png` | 状态栏限单行 + `overflow: hidden`，或工具栏换行时收进「更多」菜单 |
| F-08 | P3 | 启动 3 条 warning：`rhythmAnalyzer 未注入`×2、`.sessions` 目录 ENOENT | `_verify/v4.json` | ENOENT 应先判存在再列举；注入缺失降为 info |
| F-09 | — | 知识库提示「索引 1 本没有向量」 | `v5-kb.png` | 非缺陷：开发 vault 清过向量库，属预期 |

## 七、环境备注（不是插件问题）

- 设置窗口与命令面板在 Obsidian 1.14.5 会开在第二个窗口；用脚本验证时必须先关掉。
- 页签组叠放时 Playwright 的可见性判定会失败，需用 DOM `dispatchEvent` 或 `force: true`。
- 开发 vault 的 `apiKey` 是占位符（`****HERE`），任何 AI 功能都会 401；真实功能验证需换真 key。

## 八、下次回归怎么做

1. `node D:\nw-tmp\verify-1.mjs` → 看 error 数、命令数、页签标题。
2. `node D:\nw-tmp\verify-7.mjs` → 看 `measured.1440/1280` 的 `cw/sw/ctx` 与 `docOverflow`。
3. 逐条对照 §三 A–F；新增缺陷补进 §六，修复后把行移进 §五。
