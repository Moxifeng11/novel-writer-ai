# 上下文监控面板（ContextPanel）

> 状态：stable（视觉重构 Slice Q 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：全屏写作视图右侧栏的「📊 上下文监控」——把本章将要注入模型的上下文按卡片分组（人物状态 / 智能实体上下文 / 地点 / 势力 / 物品功法 / 场景细纲 / 伏笔库 / 分卷大纲 / 时间线 / 世界观 / 设定库 / 写作规则 / 文笔风格 / 上下文使用进度），每张卡可折叠；顶部显示 token 预算与压缩情况。
- **代码入口**
  - 面板本体：`ui/rendering/context-panel.ts`（`export class ContextPanel`，956 行）。`constructor(private app: App)`；主渲染 `render(workspace, context, project, chapterNum, plugin, estimateTotalChars)`（`:63-865`）；私有 `parseSceneSummary()`（`:870`）、`getImportanceBadge()`（约 `:915`）、`renderCollapsibleCard(panel, title, renderBody, reRender = false)`（`:930-955`）。
  - 调用方：`ui/full-writer-view.ts:632` `this.contextPanel = new ContextPanel(this.app)`；`:1912` 直接调 `render(...)`；`ui/full-writer/entity-state-controller.ts:129` 通过 `deps.getContextPanel().render(...)` 调（依赖注入见 `:23`）。
  - 刷新事件：`ui/full-writer-view.ts:1068` 监听 `novel-writer:refresh-context-panel`；`:1164` 卸载时清理缓存组件（释放 `MarkdownRenderer` 子资源）。`:832` 通过 `getContextPanel` 把实例暴露给 controllers。
- **数据来源**：`engine/context/context-types.ts` 的 `GatheredContext { project, gatheredAt, data: ContextData, issues }`。面板读 `ctx.data` 下的 `_failedModules`、`_contextTokens`、`compressed`、`smart_entity_context`（或 `plugin._smartEntityContext`）、`characters`/`locations`/`factions`/`items`、`scene_expansion.raw`、`foreshadows`、`timeline`、`world_view`、`setting_lib`、`fanfic_rules`、`writing_rules`、`writing_style`。
- **样式**：`styles-src/35-context-panel.css`（383 行 / 10818 字节，40→41 个样式源），全部规则 `.novel-writer-fw-context-panel ` 前缀；外壳类 `novel-writer-fw-context-panel`、`novel-writer-fw-panel-title`、`novel-writer-context-mode-hint`、`novel-writer-context-scope-row`、`novel-writer-scope-label`、`nw-context-bar__collapsible-*`、`novel-writer-fw-warning`、`novel-writer-fw-muted`、`novel-writer-fw-token-fill` 保留原名。

## 2. 现状（事实，不写愿望）

- **顶部行**：`h4.novel-writer-fw-panel-title`（📊 上下文监控）→ `novel-writer-context-mode-hint`（「当前：（仅注入本章涉及实体）」）→ token 预算行 `novel-writer-context-mode-hint nw-cp-token-hint`（`--warn` >50%、`--danger` >70%）→ `novel-writer-context-scope-row` + `novel-writer-scope-label`（📌 上下文：紧凑/标准模式）。
- **模块失败提示**：`novel-writer-fw-warning nw-cp-alert nw-cp-alert--error` 一行文字「⚠️ 以下模块加载失败：…（已跳过）」。
- **压缩截断警告**：`nw-cp-trunc`（点击展开）→ `nw-cp-trunc-header`（文案 + `nw-cp-trunc-icon` ▶/▼）→ `nw-cp-trunc-details`（默认 `display:none`，展开时加 `nw-cp-trunc-details--open`）→ 每行 `nw-cp-trunc-row` / `-label` / `-value`（「200字 → 7字（压缩97%）」）。
- **智能实体上下文**：`nw-cp-tip`（提示条）→ `nw-cp-stats`（`-head` 首行 + `nw-cp-text-muted` 弱化）→ 若干 `nw-cp-section-title`（关系段用 `--spaced`）→ `nw-cp-list`（`--mb8`）/ `nw-cp-list-item`（`nw-cp-name-row` + `nw-cp-name` + `nw-cp-badge` + `nw-cp-level` + `nw-cp-sub`（`--faint`/`--tight`）/ `nw-cp-more`（`--faint`））→ 关系行 `nw-cp-rel-item` / `-names` / `-type` → 缺失实体 `nw-cp-missing` + `nw-cp-missing-label` + `nw-cp-muted-sm`。
- **场景细纲**：`nw-cp-tip` + `nw-cp-scene-stats`（`nw-cp-scene-key`）×3 → `nw-cp-list` → `nw-cp-list-item`（`nw-cp-scene-index` + `nw-cp-scene-star` + `nw-cp-scene-name`）→ `nw-cp-sub--faint` / `nw-cp-more--faint` → `nw-cp-hook`（🪝 已设置结尾钩子）。
- **写作规则**：`nw-cp-warn-box`（同人 OOC 必守/雷区，内含 `nw-cp-rule-list`（`--tight`）与 `nw-cp-rule-text--warning` / `--error`）→ `nw-cp-rule-section`（`--tight`）+ `nw-cp-rule-heading` → `nw-cp-rule-card`（`nw-cp-rule-title` / `-desc` / `-points`）→ `nw-cp-check-list` / `nw-cp-check-item` → `nw-cp-more-note`；文笔风格 `nw-cp-style-text` + `nw-cp-edit-link`（「编辑文笔风格」）；渲染异常 `nw-cp-error-text`。
- **折叠卡片**：每张卡的外壳仍是 `nw-context-bar__collapsible-card` / `-header` / `-title` / `-icon` / `-body`，body 追加 `nw-cp-card-body`；折叠时 body 加 `nw-cp-is-collapsed`，由 `.novel-writer-fw-context-panel .nw-cp-card-body.nw-cp-is-collapsed{display:none}`（0,3,0）压过 `.nw-context-bar__collapsible-body` 的 padding/line-height。
- **进度条**：`novel-writer-fw-token-fill nw-cp-token-fill`，宽度由 `fill.style.setProperty('--nw-cp-pct', pct + '%')` 写入，CSS 读 `width: var(--nw-cp-pct, 0%)`。
- **历史包袱（Slice Q 处理前）**：173 处 `nw-u-*`（66 行）拼出整面板布局；3 处内联样式（`:85` token 配色 `cssText`、`:168` 截断详情 `style.display`、`:852` 进度条 `style.width`）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| CP-01 | P0 | 173 处 `nw-u-*` 拼出整面板布局，语义不可读 | 语义类 `nw-cp-*` 集中到 `styles-src/35-context-panel.css` | done（Slice Q） |
| CP-02 | P1 | 三处内联样式：token 配色串、截断详情显隐、进度条宽度 | 配色改 `--warn`/`--danger` 修饰类；显隐改 `--open` 修饰类；宽度改 CSS 变量 `--nw-cp-pct` | done（Slice Q） |
| CP-03 | P1 | `nw-u-bg-modifier-error-soft` 的声明（`background: var(--background-modifier-error-rgb, 255,100,100,0.1)`）在 computed-value 阶段非法，把告警条背景归为 `transparent`，外壳 `--nw-warning-bg` 从未生效 | 删除该工具类后由外壳提供浅橙底 | done（Slice Q，有意视觉修正） |
| CP-04 | P2 | 两个死类：`novel-writer-fw-truncation-warning`（零定义）、`nw-context-fanfic-rules`（零定义） | 直接删除，不保留别名 | done（Slice Q） |
| CP-05 | P2 | 折叠卡片用 `nw-u-d-none` 做状态（工具类承担运行时显隐） | `nw-cp-is-collapsed` 修饰类 + 复合选择器 | done（Slice Q） |

## 4. 关键决策

- **作用域前缀用 `.novel-writer-fw-context-panel`，不是 `.nw-scope`**：面板根节点就是这个类，天然唯一；面板不嵌在 `Modal` 里，不需要对抗 `.modal button` 的 (0,1,1)。所有规则写成 `.novel-writer-fw-context-panel .nw-cp-*`（0,2,0），压得过单类工具类与 02/03/04 号文件里的 `novel-writer-*` 外壳规则。
- **状态一律修饰类**：`--warn`/`--danger`（token 提示）、`--error`（失败条）、`--open`（截断详情）、`--spaced`/`--tight`/`--faint`/`--mb8`（排版变体）、`nw-cp-is-collapsed`（折叠）。**没有一处靠内联 style 表达状态**。
- **折叠卡片必须写复合选择器**：`.nw-cp-card-body.nw-cp-is-collapsed`（0,3,0）而不是 `.nw-cp-is-collapsed`（0,2,0）。原因：`.nw-context-bar__collapsible-body` 自带 padding / line-height，单类修饰类在级联顺序不稳时会漏掉过渡；复合选择器把特异性抬到 0,3,0 彻底压住。
- **进度条宽度走 CSS 变量**：`fill.style.setProperty('--nw-cp-pct', pct + '%')` + `width: var(--nw-cp-pct, 0%)`。仓内先例 `ui/batch-import-modal.ts:784` 的 `--nw-bi-pct`；JS 只写一个变量、不碰具体属性，样式仍全在 CSS。
- **保留 `.novel-writer-fw-warning` 外壳，`.nw-cp-alert` 只覆盖「被删工具类真正生效的那几项」**（padding 6px 10px / margin-bottom 8px / radius 4px / font-size .85em / color）。必须记住的 CSS 陷阱：`var()` 声明在 computed-value 阶段非法时**回落到 initial**（IACVT，不是「当作没写」），所以旧的 `nw-u-bg-modifier-error-soft` 实际把背景变成了 `transparent`；删掉它之后外壳的 `--nw-warning-bg`（浅色 0.12 / 深色 0.15）重新生效。**这是本切片唯一有意的视觉修正**（告警条恢复浅橙底），已在验收表标注。
- **死类直接删**：`novel-writer-fw-truncation-warning`（全仓零定义，从未有效果）与 `nw-context-fanfic-rules`（零定义）不保留别名；`nw-ctx-warn-box`（`styles-src/26-cleanup-utilities.css:399` 有定义）的声明原样复刻进 `nw-cp-warn-box`，因为一并删掉了该语境外壳引用。
- **不修既有 DOM 缺陷**：缺失实体块 `:326` 的 `div` 拿到 `nw-cp-missing`，但 `:328`/`:332` 的 span 是 body 的子节点、不是该 div 的子节点（`nw-cp-missing-label` 的样式靠 class 生效，视觉效果不变）。本切片只做等价迁移，结构缺陷留在 backlog。
- **删 31 个零引用工具类**：本面板是唯一使用者（`nw-u-bg-warning-soft*`、`nw-u-p-*`、`nw-u-m-*`、`nw-u-b-warning-border`/`nw-u-bt-warning-border`、`nw-u-c-*-strong`、`nw-u-userselect-none`、`nw-u-lst-none`、`nw-u-fs-10px` 等）。删除是连锁的：删掉头 10 个后又有 21 个暴露为零引用，共 4 轮收敛。定义 216→185、引用 1159→988。

## 5. 验收记录（Slice Q，2026-11-17）

截图：`D:\nw-dev-vault\_visual-q\{before,after}`，`diff-report.json`（`node D:\nw-tmp\diff-q.mjs` 生成）存像素与探针对比；面板挂进自建 384px 宽容器（`#nw-q-host`，`position:absolute;left:24px;top:24px;width:384px;padding:8px`），6 个场景。

| 场景 | 内容 | 高度（前/后） | PNG 差异 | 探针 struct/style/rect |
| --- | --- | --- | --- | --- |
| 01-empty | `data:{}`、全部卡片展开 | 1818 / 1818 | 0 px | 0 / 0 / 0 |
| 02-failed-token60 | `_failedModules` 两项 + token 76,800/128K（60%，`--warn`） | 865 / 865 | 10468 px（3.151%，告警条底色） | 0 / 0 / 0 |
| 03-truncation-open | 压缩截断条 + 点击展开详情 | 940 / 940 | 0 px | 0 / 0 / 0 |
| 04-entities | 人物/地点/势力/物品/伏笔/时间线/6 场景 + 智能实体（10 人/8 关系/2 缺失），全展开 | 2882 / 2882 | 0 px | 0 / 0 / 0 |
| 05-rules-style | 同人 OOC 必守/雷区 + 写作规则（9 条清单）+ 文笔风格 markdown | 2689 / 2689 | 0 px | 0 / 0 / 0 |
| 06-progress80 | token 102,400/128K（80%，`--danger`）+ 字数进度条 40% | 1838 / 1838 | 0 px | 0 / 0 / 0 |

- **5/6 场景像素零差异，6 场景高度全一致、struct/style/rect 探针差全 0**（`style` 探针含 35 个 computed 键：字体、行高、内外边距、颜色、背景、边框、flex、display 等），说明「声明级复刻」在真实 Obsidian 主题下成立。
- **唯一差异 = CP-03**：`02-failed-token60` 的 10468 px 全部落在告警条矩形内（`bbox [4,117,379,864]` 的 y=117–150 段；对比图 `D:\nw-tmp\crop-q-alert.png` 三联：左=before 只有橙边框、右=after 有浅橙底），`maxDelta 22` 是浅橙底与透明底的差值，没有文字重排。这是**有意修正**，不是漏改。
- 场景 03 的点击定位脚本同时尝试旧类名 `.novel-writer-fw-truncation-warning` 与新类名 `.nw-cp-trunc`，展开后高度 940 前后一致，证明「`style.display` → `--open` 修饰类」的显隐等价。
- 另跑：`check:inline-styles` 577（静态 486 / 动态 91，本文件 3 处已消）；`check:utility` 定义 185 / 引用 988 / 零引用 0；`check:css` 746349 字节 / 4091 类 / hex 170 / rgbHsl 211 / `!important` 24；`check:bundle` styles.css 737042→746349（+9307）。

## 6. 测试清单

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/ui/context-panel-dom.test.ts` | 22 条：null/空上下文、失败模块条、token 配色三档、压缩截断条（默认折叠 + 点击展开 + ▶▼ 切换）、人物/实体/时间线渲染、智能实体统计、折叠卡片开关；其中 4 条为 Slice Q 新增的语义类断言（`nw-cp-alert` / `nw-cp-token-fill` + `--nw-cp-pct` / `nw-cp-trunc` + `--open` / `nw-cp-card-body` + `nw-cp-is-collapsed`） |
| `tests/unit/ui/entity-state-context-refresh.test.ts` | 2 条：实体状态变更后触发面板重渲染 |

测试里点截断条必须走 `addEventListener` 注册的监听器（`(el as any).listeners.get('click')?.forEach(fn => fn({}))`），因为源码用的是 `addEventListener`，`onclick` 属性是 `undefined`；折叠卡片反过来用的是 `header.onclick`，可直接调用。

## 7. backlog

- `ui/rendering/context-panel.ts` 956 行、`render()` 单函数约 800 行：可按区块拆成 `render-smart-entity` / `render-scene` / `render-rules` / `render-progress` 四个私有方法或独立文件。
- 缺失实体块的 DOM 结构缺陷（`:326` 的 div 与 `:328`/`:332` 的 span 不是父子关系），修的话要连带调整 `nw-cp-missing` 的盒子样式。
- token 提示的 `#ff4444` / `#ffaa00` 仍是硬编码 hex（原内联迁移而来），可换语义 token，但要注意本主题 `--nw-warning` 已被调淡（Slice P 的教训）。
- 折叠状态不持久：每次 `render()` 重置为展开，用户收起来的卡片会重新张开。
- `parseSceneSummary()` 依赖场景 raw 里的行内约定（`objective:` / `key_scene:` / `cliffhanger:`），换提示词模板就会静默丢信息。
- 面板文案全中文硬编码，无 i18n。

## 8. 交接备注

- **改样式只进** `styles-src/35-context-panel.css`，且必须带 `.novel-writer-fw-context-panel ` 前缀；不要往 `02-full-writer-view.css` / `10-entity-and-utilities.css` 里加 `nw-cp-*`。
- **两条硬约束**：① 折叠卡片显隐必须用复合选择器 `.nw-cp-card-body.nw-cp-is-collapsed`；② 不要再用 `nw-u-*` 做状态（本文件已 0 处，门禁会拦）。
- **截图复现**：`node D:\nw-tmp\snap-q.mjs --tag=before|after`。**坑**：开发 vault 目录 `D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 是真实目录（不是 junction），只 `npm run build` 不生效——必须把 `main.js`/`styles.css` 拷进去（或跑 `dev-vault.mjs sync`，但那个脚本默认指向 `C:\Users\admin\nw-dev-vault`）；判断是否生效最快是查 DOM 里有没有 `nw-cp-*`。
- **before 产物怎么出**：不要 stash（build 会重写 tracked 的 `styles.css`，pop 必冲突）。用 `git worktree add D:\nw-tmp\before-q <commit>` + `mklink /J node_modules` 在 worktree 里 build，再拷产物进 vault。
- **镜头细节**：面板要放进自建容器截图（`#nw-q-host`），直接截视图会带上右侧栏其他内容；`page.evaluate` 里的 `console.log` 只进浏览器控制台，调试值要放进 `return` 对象。
- **对比工具**：`node D:\nw-tmp\diff-q.mjs`（纯 node 解 PNG + 逐元素探针对比，落 `diff-report.json`）；裁剪对比用 `node D:\nw-tmp\crop-q.mjs`（before|after|diff 三联）。

