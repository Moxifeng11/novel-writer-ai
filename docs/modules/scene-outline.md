# 场景细纲面板（scene-outline-controller）

> 状态：stable（视觉重构 Slice T 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：全屏写作视图左栏「🎬 场景细纲」面板——左侧是本章场景卡列表（可拖拽排序、带状态圆点/名场面标记），右侧是选中场景的三页签编辑器（基础 / 冲突爽点 / 伏笔），底部是自动保存提示与保存按钮。
- **代码入口**
  - 控制器：`ui/full-writer/scene-outline-controller.ts`（1209 行），`export class SceneOutlineController`，依赖见 `SceneOutlineControllerDeps`（`:43`）。
  - 挂载点：`ui/full-writer/step-render-controller.ts:603-605`——先建 `.nw-scene-editor-wrap` 容器，再 `new SceneOutlineController({...})` 并 `render(sceneEditorWrap)`；`onSceneChange` 把保存结果回写 `stepResults['sceneExpand']` 并触发 `invalidateBodyAfterPlanningChange`。
  - 主入口：`render(container)`（`:82`）→ 早退空态 / 根节点 `nw-scene-outline-container nw-so-root`（`:99`）→ `renderHeader`（`:108`）/ `renderMainContent`（`:145`）/ `renderFooter`（`:549`）。
  - 序列化：`ui/full-writer/scene-outline-format.ts`（`serializeScenes` / `appendScenesToContent`）；解析走 `parseSceneHeadings`（`engine/scene-expander`）与自带 `parseScenes`（`:929`）/ `extractField`（`:992`）。
- **数据来源**：章节 md 的 Scene 字段，映射为 `ExtendedSceneData`（`shared/types`）；自动保存防抖 1s（`markDirty` `:999` → `saveScenes` `:1028`），脏数据带章节目标 `pendingSaveTarget`（切章后不会写错文件）。
- **样式**：新建 `styles-src/37-scene-outline.css`（6034 字节 / 275 行，样式源 42 → 43），前缀 `nw-so-*`，作用域统一 `.nw-scene-outline-container`。外壳类 `.nw-scene-outline-btn` / `.nw-scene-outline-input` / `.nw-scene-outline-input-sm` 仍留在 `styles-src/25-planning-outline-controls.css`（未改名，与 Slice O 的外壳策略一致）。

## 2. 现状（事实，不写愿望）

- **根与早退**：`render` 先 `container.empty()`；`!project || chapNum <= 0` 时只渲染一个 `nw-so-empty`（「请先选择项目和章节」，padding 20 / muted / 居中）并 return——该节点**不在**根作用域内，所以 CSS 里单独一条不带前缀。
- **头部**：`nw-so-header`（flex / center / space-between / p8-12 / 下边框 / shrink0）→ 标题 `nw-so-title` + 按钮组 `nw-so-btn-group`（gap4，按钮沿用 `.nw-scene-outline-btn`）。
- **主体**：`nw-so-main`（flex / flex1 / minh0 / overflow hidden）→ 列表 `nw-so-list`（宽 180 / 右边框 / 纵向 flex）与编辑器 `nw-scene-editor-wrap nw-so-editor`（flex1 / 纵向 / minh0）。
  - 列表：`nw-so-list-header`（p8-10 / 0.8em / muted / 下边框）+ `nw-so-list-body`（flex1 / overflow-y auto / p4）；空列表给 `nw-so-list-empty`（p20-10 / center / faint / 0.85em）。
  - 场景卡：`nw-so-item`（p8-10 / m2-0 / radius6 / pointer / 0.82em）+ `--active`（accent 底 + 白字）+ `--dragging`（opacity .5）；卡内 `nw-so-item-top`（flex/center/gap4）→ `nw-so-dot`（6×6 圆点，`--completed` #22c55e / `--in-progress` #f59e0b）+ `nw-so-item-index` + `nw-so-item-flag`；下接 `nw-so-item-name`（0.78em，选中变 `rgba(255,255,255,.8)`）与 `nw-so-item-arc`（0.72em，选中变 `rgba(255,255,255,.6)`，两者都 nowrap + ellipsis）。
- **编辑器**：`renderEditorToolbar`（`:273`，`nw-so-toolbar` 与头部同一声明）→ 名称 `nw-so-toolbar-title` / `nw-so-toolbar-name` + 操作按钮；`renderTabBar`（`:323`）→ `nw-so-tabs` + 三个 `nw-so-tab`（`--active`：下边框 accent、文字 accent、fw600）；`renderTabContent`（`:348`）→ `nw-so-tab-content`（flex1 / overflow-y auto / p12）内按页签渲染。
  - 字段行：`createTextInput`（`:506`）/ `createTextArea`（`:533`）统一 `nw-so-field` + `nw-so-field-label`；名场面行 `nw-so-field-row`（flex/center/gap8/m10-0）+ `nw-so-fs-85`。
  - 冲突页：`nw-so-field-row--gap12` 一行两列（两个 `nw-so-flex-1` 包裹 label + `select.nw-scene-outline-input`）。
  - 伏笔页：`nw-so-stats` / `nw-so-stats-title` / `nw-so-stat-row` / `nw-so-stat-unit`。
- **底部**：`nw-so-footer`（`:549`）→ 保存提示 `nw-so-save-hint` + 保存按钮。
- **历史包袱（Slice T 处理前）**：123 处 `nw-u-*` 工具类，5 处 `attr: { style: '...' }` 内联样式（场景卡整串、状态圆点、卡名、情绪弧线、页签按钮），另有 `getStatusColor(status)` 返回内联 `background: #22c55e;`。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| SO-01 | P0 | 123 处 `nw-u-*` 拼出列表/编辑器/页签全部排版，语义不可读 | `nw-so-*` 语义类集中到新建 `styles-src/37-scene-outline.css` | done（Slice T） |
| SO-02 | P1 | 5 处内联 `style` 字符串含三元表达式，状态色也写在内联里 | 状态改修饰类（`--active` / `--dragging` / `nw-so-dot--*`），条件色改 `getStatusClass` | done（Slice T） |
| SO-03 | P1 | 非选中卡内联写 `background: var(--background-secondary) hover: var(--background-modifier-hover);`——含 `hover:` 的非法声明被整条丢弃 | 按**实际渲染**复刻：非选中卡不设底色、不加 `:hover` | done（Slice T） |
| SO-04 | P2 | `nw-u-fs-0-78em` 等 16 个工具类只有本文件在用 | 删定义 + 引用归零，工具类定义 144 → 128 | done（Slice T） |

## 4. 关键决策

- **2026-11-17 新建 37 号样式文件**：场景细纲属于「规划」但 DOM 体量大（42 个类），塞进 `25-planning-outline-controls.css`（67 行、画布按钮）会让该文件职责混乱；新建后 `nw-so-*` 与 `nw-scene-outline-*` 外壳清晰分层。
- **2026-11-17 非选中卡按实际渲染复刻，不补底色**：旧内联的非选中分支是 `background: var(--background-secondary) hover: var(--background-modifier-hover);`，`hover:` 不是合法属性名，整条声明在解析阶段被丢弃 → 浏览器里从来只有 accent/白字的选中态。若「照字面」补上 secondary 底，每个场景卡都会变灰——这是最容易被误判成「等价重构」的地方，源码注释已写进 37 号文件头。
- **2026-11-17 状态色改修饰类而非 CSS 变量**：`getStatusColor` 原返回 `background: #22c55e;` 这样的声明串，无法用类名组合；改成 `getStatusClass(status)` 返回 `nw-so-dot--completed` / `nw-so-dot--in-progress` / `''`，颜色回到样式表（`.nw-so-dot--completed{background:#22c55e}`）。
- **2026-11-17 `.nw-so-field-row--gap12` 显式写 `align-items: normal`**：基础行来自 `nw-u-d-flex nw-u-ai-center nw-u-gap-8px nw-u-m-10px-0`，而冲突页那行是 `nw-u-d-flex nw-u-gap-12px nw-u-m-10px-0`（**没有** `ai-center`）。基础类带 `align-items:center` 后，修饰类必须还原 `normal`，否则两个下拉列的对齐从 stretch 变 center——探针里表现为该元素 `align-items normal → center`（像素相同，但语义不等价）。
- **2026-11-17 头部与编辑器工具栏共用一条规则**：`.nw-so-header` 与 `.nw-so-toolbar` 旧声明逐条相同（flex/center/space-between/p8-12/下边框/shrink0），故合并成一个选择器组，不复制声明。
- **2026-11-17 不做响应式改造**：`nw-so-list` 的 `width:180px`、圆点 `6px`、各种 em 字号全部保留原值，目标是 6 场景像素零差异（结果达成）。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-17 | `npx tsc --noEmit` / `npm run build` | 0 错；`[styles] 拼接 43 个源文件 → styles.css（30500 行）` | 构建日志 |
| 2026-11-17 | 单测 `scene-outline-format` + `full-writer-view-contracts` | 1 文件 / 9 用例 + 18 用例通过（后者只断言 `nw-scene-outline-container` 与行为） | vitest |
| 2026-11-17 | before/after 像素（6 场景，真机 dev vault，720×640 宿主） | **6/6 PNG 0 px**；probes struct 0 / style 0 / rect 0（唯一 cls 差为改名的预期差异） | `D:\nw-dev-vault\_visual-t\{before,after}` + `D:\nw-tmp\diff-t.mjs` |
| 2026-11-17 | 四道门禁 | `check:inline-styles` 558（-5）、`check:utility` 128 类 / 579 次（删 16 个零引用）、`check:css` 764628 B / 4168 类、`check:bundle` 全部通过 | 基线 JSON 已带 note |
| 2026-11-17 | `npm run lint` | 0 error（1102 warning，均存量） | eslint |
| 2026-11-17 | `npm run preflight` | EXIT=0，959 文件 / 10118 通过 + 3 skipped；`check:bundle` main.js 5635056 / styles.css 764628 / workers 684381 + 108804；`check:release` 通过（v4.96.1） | `D:\nw-tmp\preflight-t.log` |

## 6. 测试清单

- 序列化/解析：`tests/unit/ui/scene-outline-format.test.ts`（`serializeScenes` / `appendScenesToContent` / 字段往返）。
- 契约：`tests/unit/ui/full-writer-view-contracts.test.ts`（面板挂载点、`nw-scene-outline-container` 存在性、保存回调契约）。
- 无 controller 的 DOM 渲染单测：本次改动只能靠 before/after 像素脚手架验证（见 §8）。
- 实机检查点：未选项目早退、空场景列表、拖拽中卡（`--dragging`）、名场面勾选后列表 flag、脏数据提示、三页签来回切换、超长场景名省略号。

## 7. 剩余 backlog（P2/P3）

- [ ] `scene-outline-controller.ts` 1209 行仍混着「场景列表渲染 / 编辑器渲染 / AI 生成 / 文件读写 / 章节目标列举」五件事，可按 Slice M 的思路拆成 3~4 个文件。
- [ ] 非选中卡的 `:hover` 从未存在（见 §4），若要补，需要单独确认视觉（会改变现有观感）。
- [ ] 拖拽排序没有任何单测，可先抽「索引重排」纯函数（`moveScene` `:644` / `reindexScenes` `:705`）。
- [ ] `nw-scene-outline-input` / `-btn` 外壳类留在 25 号文件，命名与 `nw-so-*` 两套并存，未来统一。

## 8. 交接备注

- **下一轮从哪开始**：`nw-u-*` 存量大户剩 `ui/settings/knowledge-section.ts`（108）、`ui/polish-editor.ts`（104）、`ui/refill-modal.ts`（97）、`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。用户已同意「只做前三个 + lint 冻结」，本轮（Slice T）是第三个，方案 B 的三连到此结束。
- **已知坑（本轮新踩）**
  1. **改类时删行会移动行号**：不能按行号表逐行替换大段代码，必须整文件 normalize 成 LF 后做整段字符串替换（每处断言出现次数），再还原 CRLF。
  2. **截图要先暴露类引用**：`SceneOutlineController` 不是单例也不是 `window` 上的东西，before/after 两轮构建都要临时插 `window.__nwSceneOutline = SceneOutlineController`（`// TEMP-SNAP-HOOK`），截完**必须删除并重建**，否则产物里带着调试钩子。
  3. **before 侧也要打同一个钩子**：worktree 里 checkout 的是 HEAD，没有钩子，脚本会报 `hook missing`；要先把同样的临时行补进 worktree 的源码再 build。
  4. **绕过读盘**：`render()` 会 `await this.loadScenes()` 读真实章节文件，截图前把 `ctl.loadScenes` 覆盖成空 async 函数，再设 `ctl.scenes`，否则渲染的是 dev vault 里的真实章节（空）。
  5. **dev vault 是真实目录**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 必须手工 `Copy-Item main.js,styles.css`；`scripts/dev-vault.mjs sync` 指向的是 `C:\Users\admin\nw-dev-vault`。
- **脚本**（仓外临时，勿提交）：`D:\nw-tmp\snap-t.mjs`（6 场景，`--tag=before|after`）、`D:\nw-tmp\diff-t.mjs`（PNG + 35 键探针对比）。
