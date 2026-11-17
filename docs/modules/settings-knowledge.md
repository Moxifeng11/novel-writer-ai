# 知识库设置分区（settings / knowledge-section）

> 状态：stable（视觉重构 Slice U 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：设置页「📚 写作知识库」分区——顶部是向量增强（提供商 / 密钥 / 连接状态检测）表单，下面是知识库路径只读行 + 四个操作按钮（📥 批量导入 / 📊 监控面板 / 🔄 重建索引 / 🧠 重向量化）、搜索与状态筛选条、书籍卡片网格（状态徽标、标签、字数、更新时间，悬浮出「🔄 重拆 / 🗑 删除」）。
- **代码入口**
  - 分区类：`ui/settings/knowledge-section.ts`（788 行），`export class KnowledgeSection extends SettingsSection`（`:31`）。
  - 注册：`ui/settings/section-factory.ts:70`——`{ id: 'knowledge', label: '📚 写作知识库', group: 'primary', create: host => new KnowledgeSection(host) }`。
  - 主入口：`async render(container)`（`:49`）→ `h3` + 说明 → `renderVectorEnhancementSettings(section)`（`:58`，定义 `:442`）→ 加载态 `:60` → 首次懒初始化引擎 `:68-76`（`engineRegistry.get(...)` 后 `await this.loadKnowledgeBooks()`）→ 工具条 `:78` → 筛选条 `:141` → 空态 `:201` → 计数行 + 卡片网格 `:228-240`。
  - 渲染分支：`filterKnowledgeBooks()`（`:243`）、`renderKnowledgeBookCard()`（`:264`）、`getStatusBadge()`（`:375`）、`formatKbWordCount()`（`:392`）、`showBatchImportModal()`（`:412`）、`showKnowledgeMonitorModal()`（`:435`）。
- **数据来源**：`BookBasicInfo`（`services/knowledge-base-manager.ts:78`）——`id/name/author?/wordCount?/themeTags[]/techniqueTags[]/customTags[]/createdAt/updatedAt/breakdownStatus`；`breakdownStatus` ∈ `pending | processing | completed | failed`。状态徽标、筛选下拉与删除确认都基于该字段。
- **样式**：新建 `styles-src/38-settings-knowledge.css`（7130 字节 / 311 行 / 47 个 `nw-st-kb-*` 类），**不套 `.nw-scope`**（与 Slice R 的 `36-settings-general.css` 一致：设置页整体不在 scope 容器内）。按钮/输入框/下拉一律元素限定（`button.nw-st-kb-*`、`input[type='text'].nw-st-kb-search-input`、`select.nw-st-kb-status-select`）。
- **刷新契约**：`readonly asyncLoad = true`（`:33`）→ 宿主显示统一刷新条；搜索框输入会 `this.refresh()` 重建整分区，故用 250ms 防抖并在重建后恢复焦点与光标（`:155-170`）——改样式时不要动这段逻辑。

## 2. 现状（事实，不写愿望）

- **加载态**：`nw-st-kb-loading`（p40 / center / faint / 13px），`:60` 早退。
- **工具条**：`nw-st-kb-toolbar`（mb16）内嵌一个 `Setting`（知识库路径只读文本框 + 「打开」按钮）+ `nw-st-kb-actions`（flex / gap8 / mt8 / mb16）四个按钮。首个按钮 `nw-st-kb-btn nw-st-kb-btn--primary nw-st-kb-btn--fw500`，其余纯 `nw-st-kb-btn`；空态里那颗「📥 批量导入书籍」是 `nw-st-kb-btn nw-st-kb-btn--primary nw-st-kb-btn--lg`（**没有** `--fw500`）。
- **筛选条**：`nw-st-kb-filters`（p12 / border 1px / radius6 / mb16 / bg secondary）→ `nw-st-kb-search-row`（flex / gap8 / mb10 / wrap）内放搜索框 `input.nw-st-kb-search-input` + 状态下拉 `select.nw-st-kb-status-select`（5 个选项：全部/待拆解/拆解中/已完成/失败）→ 标签行 `nw-st-kb-tag-row` 内两个 `nw-st-kb-tag-filter`（flex1 / minw200），各含一个 `nw-st-kb-tag-label`（📖 题材：全部 / ✍️ 技巧：全部，切片行，**没有**接事件）。
- **空态**：`nw-st-kb-empty`（p60-20 / center / 虚线边框 / radius8 / bg secondary）+ `nw-st-kb-empty-icon`（48px / mb16 / opacity .5）+ `nw-st-kb-empty-text`；仅当 `knowledgeBooks.length === 0` 时追加导入按钮。
- **计数与网格**：`nw-status-row`（外壳类，未改名）里放 `nw-st-kb-count`；`nw-st-kb-grid`（grid `repeat(auto-fill, minmax(280px,1fr))` / gap12 / max-h500 / overflow-y auto / p4）。
- **书籍卡**：根节点是 `nw-kb-book-card nw-st-kb-card`——**底色/内边距/边框/圆角/过渡全部沿用 `styles-src/27-knowledge-base.css:376` 的 `.nw-kb-book-card`**，`nw-st-kb-card` 只补 `position: relative; overflow: hidden`。卡内：右上 `nw-kb-card-actions nw-st-kb-card-actions`（absolute / top8 / right8 / flex / gap4 / z-index10，opacity 0 与 hover 过渡仍由 `.nw-kb-book-card .nw-kb-card-actions` 负责）+ 两个 `nw-st-kb-mini-btn`（删除那颗加 `--danger`）；标题行 `nw-st-kb-card-title-row` → `nw-st-kb-card-name` / `nw-st-kb-card-author`；状态徽标 `nw-st-kb-badge nw-st-kb-badge--<tone>`（tone 与 status 同名，四态各一套色）；标签行 `nw-st-kb-tags` + 最多 3 个 `nw-st-kb-tag` + 溢出 `nw-st-kb-tag nw-st-kb-tag--more`（`+N`）；底部 `nw-st-kb-meta`（📝 字数 / 🕐 日期）。
- **向量增强区**：`nw-st-kb-vector`（容器）+ `nw-st-kb-vector-title`；提供商/模型/密钥行全部走 Obsidian `Setting` API，未新增语义类。连接状态由 `nw-st-kb-dot` + `nw-st-kb-status-text` 组合，四态修饰类 `--idle / --checking / --connected / --disconnected`；`updateStatusDisplay()`（`:723`）与首次渲染（`:779-785`）都只改 `className`。
- **历史包袱（Slice U 处理前）**：108 处 `nw-u-*` 工具类、11 处 `attr: { style: '...' }` 内联样式（书籍卡整串、徽标色、mini 按钮、空态、筛选条、计数、网格、加载态、向量标题等），另有 `statusColors` 表与两处动态内联 `color` / `background`。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| SK-01 | P0 | 108 处 `nw-u-*` 拼出工具条/筛选条/卡片/空态全部排版，语义不可读 | `nw-st-kb-*` 语义类集中到新建 `styles-src/38-settings-knowledge.css` | done（Slice U） |
| SK-02 | P1 | 11 处 `attr: { style }` 内联样式（含卡片整串声明） | 全部改 `cls` 语义类，`style:` 计数 108→0 同期归零 | done（Slice U） |
| SK-03 | P1 | 状态徽标用 `{label, color, bg}` 表拼动态内联；连接状态另有 `statusColors` 表 + 两处动态内联 | 改成 `{label, tone}` + `nw-st-kb-badge--<tone>`；连接状态改 `className` 修饰类 | done（Slice U） |
| SK-04 | P1 | 工具条导入按钮带 `font-weight:500`，空态导入按钮不带；基类 `--primary` 若收 fw500 会把空态按钮也加粗 | 新增独立 `button.nw-st-kb-btn--fw500`，只给工具条那颗 | done（Slice U，像素验收抓出） |
| SK-05 | P2 | 书籍卡原有 4 个`nw-u-*`声明与 `.nw-kb-book-card` 重叠，其中 `padding` 因样式源顺序（10 号文件在前、27 号在后）本就输给后者 | `nw-st-kb-card` 只写 `position/overflow`，几何交给外壳类 | done（Slice U） |
| SK-06 | P2 | 标签筛选行两个 `nw-st-kb-tag-filter` 只是占位（「题材：全部」不可点） | 记录为 backlog，本轮不为它造交互 | backlog |

## 4. 关键决策

- **2026-11-17 新建 38 号样式文件而不是塞进 27 号**：知识库设置属于「设置页」体系，与知识库视图（27 号文件 3132 行）职责不同；前缀也刻意用 `nw-st-kb-*`（设置页 `nw-st-*` 命名空间下的子域），而不是继续 `nw-kb-*`，避免和视图页的 `nw-kb-tasks-*` / `nw-kb-detail-*` 撞名。
- **2026-11-17 不套 `.nw-scope`，全部元素限定选择器**：设置页整体不在 scope 容器里（宿主直接把 `section` 渲染进 `vertical-tab-content`），目标元素大量是 `<button>` / `<input>` / `<select>`，单类选择器会被 Obsidian 基础样式（(0,1,1)）压掉。与 Slice R 同法。
- **2026-11-17 保留 `.nw-kb-book-card`**：卡片的内边距/底色/边框/圆角/过渡都由 27 号文件里的外壳类提供，且旧的 `nw-u-p-14px` 在级联里本来就没赢（10 号文件先加载）。因此 `nw-st-kb-card` 只补 `position: relative; overflow: hidden`——这两条是被删工具类里**真正生效且外壳类没有**的声明。
- **2026-11-17 `-card-actions` 只写定位**：`opacity: 0`、`:hover` 提升与过渡都在 `.nw-kb-book-card .nw-kb-card-actions` 里（27 号文件），复制过来会造成两份真相；语义类只提供 absolute/top/right/flex/gap/z-index。
- **2026-11-17 徽标配色留在样式表**：`getStatusBadge` 原来返回内联 `color`/`background`，无法组合；改成 `tone` 字段 + 修饰类，四态底色统一写 `rgba(var(--*-rgb), 0.1)`（这也是 `.css-baseline.json` 的 rgbHsl +3 来源）。
- **2026-11-17 `--fw500` 单独成类（像素验收抓出的回归）**：首轮把 `font-weight:500` 写进 `button.nw-st-kb-btn--primary`，7 场景对比里 `02-empty` 立刻出现 1 处 style 差（空态导入按钮 400 → 500）。修法是 `--primary` 只管配色，字重做成 `--fw500` 修饰类只挂在工具条按钮上。教训与 Slice R 的「基类取众数」同源：内联样式的差异必须靠修饰类显式表达。
- **2026-11-17 删 25 个零引用工具类**：`nw-u-p-14px`、`nw-u-pos-absolute`、`nw-u-z-10`、`nw-u-transition-all-0-2s-ease` 等全部只在本文件用过，语义化后归零，定义数 128 → 103。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-17 | `npx tsc --noEmit` / `npm run build` | 0 错；`[styles] 拼接 44 个源文件 → styles.css（30786 行）` | 构建日志 |
| 2026-11-17 | 单测 `mini-settings-vector-secrets` + `settings-framework-wiring` + `settings-search` | 3 文件 / 27 用例通过（只断言密钥处理与装配，不断言类名） | vitest |
| 2026-11-17 | before/after 像素（7 场景，真机 dev vault，820px 宿主） | **7/7 PNG 0 px**；probes struct 0 / style 0 / rect 0 | `D:\nw-dev-vault\_visual-u\{before,after}` + `D:\nw-tmp\diff-u.mjs` |
| 2026-11-17 | 四道门禁 | `check:inline-styles` 547（-11）、`check:utility` 103 类 / 471 次（删 25 个零引用）、`check:css` 770834 B / 4190 类、`check:bundle` 全部通过 | 基线 JSON 已带 note |
| 2026-11-17 | `npm run lint` | 0 error（1100+ warning，均存量） | eslint |
| 2026-11-17 | `npm run preflight` | EXIT=0，959 文件 / 10118 通过 + 3 skipped | `D:\nw-tmp\preflight-u.log` |

## 6. 测试清单

- 设置框架装配：`tests/unit/ui/settings-framework-wiring.test.ts`（分区注册表含 `knowledge`、宿主 refresh 契约）。
- 向量密钥：`tests/unit/ui/mini-settings-vector-secrets.test.ts`（密钥输入框、显示/隐藏切换、保存路径）。
- 设置搜索：`tests/unit/ui/settings-search.test.ts`（分区标题可被搜到）。
- 无分区 DOM 渲染单测：本分区只能靠 before/after 像素脚手架验证（见 §8）。
- 实机检查点：加载态、空库空态、筛选无结果空态、四种徽标、标签溢出 `+N`、悬浮出重拆/删除、删除确认、四个工具条按钮、连接状态四态切换、搜索框输入不失焦。

## 7. 剩余 backlog（P2/P3）

- [ ] `knowledge-section.ts` 788 行混着「知识库列表 / 向量表单 / 弹窗调度」三件事，可按 Slice M 思路拆成 `knowledge-list-section` + `vector-settings-section`。
- [ ] 标签筛选行（📖 题材 / ✍️ 技巧）只是静态占位，没有任何点击行为——要么接上标签过滤，要么删掉避免误导。
- [ ] 搜索框防抖 250ms 后走 `document.querySelector('input[placeholder="🔍 搜索书名/作者/标签..."]')` 恢复焦点，querySelector 是全局的（同页若有第二个同样 placeholder 会失焦到错的框），可改成 `section.querySelector`。
- [ ] 空态与筛选空态共用一个文案分支，`nw-st-kb-empty-icon` 的 opacity .5 是硬编码，未接 `--nw-*` 语义令牌。

## 8. 交接备注

- **下一轮从哪开始**：`nw-u-*` 存量大户剩 `ui/polish-editor.ts`（104）、`ui/refill-modal.ts`（97）、`ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。方案 B 三连（R/S/T）后已进入「碰哪改哪」，本轮（Slice U）清掉 `knowledge-section` 108 处，**不在原方案 B 三连里**，属长尾里最大的一户。
- **已知坑（本轮新踩）**
  1. **设置页 DOM 不在主 document 里**：`app.setting.open()` 的弹窗拿不到（`.modal-container` 为 0），截图必须自建 `vertical-tab-content nw-settings-root` 宿主，再 `plugin.settingsTab.containerEl = host; plugin.settingsTab.display();`。
  2. **每个场景前必须 `panelCache.clear()`**：设置分区有 DOM 缓存，不清的话第二次 `openTab('knowledge')` 复用旧 DOM，perf/空态场景会截出上一张图。
  3. **`activeDocument` / `activeWindow` 必须 `Object.defineProperty` 注入**（直接赋值读回 false），否则 `Modal` 挂到错误 document。
  4. **dev vault 是真实目录**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 必须手工 `Copy-Item main.js,styles.css`；`scripts/dev-vault.mjs sync` 指向的是 `C:\Users\admin\nw-dev-vault`。
  5. **假依赖要注入**：分区自己从 `engineRegistry` 取 `knowledgeBaseManager/knowledgeTagManager`，截图前直接给 `sec.knowledgeBaseManager = { getAllBooks: async () => [], ... }` 等，否则会读 dev vault 的真实知识库（空）。
- **脚本**（仓外临时，勿提交）：`D:\nw-tmp\snap-u.mjs`（7 场景，`--tag=before|after`，产物 `D:\nw-dev-vault\_visual-u\<tag>`）、`D:\nw-tmp\diff-u.mjs`（PNG + 35 键探针对比）。
