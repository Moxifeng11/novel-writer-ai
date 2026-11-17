# 补全拆解 / 重新提取指纹弹窗（refill-modal）

> 状态：stable（视觉重构 Slice W 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**
  - 「🔄 补全拆解 - 《书名》」弹窗：选拆解模式（补缺失维度 / 全部重跑）、勾选 8 个维度卡片（已完成 ✓ / 失败 ✗ / 缺失 ○）、看预估时间与已选数量，运行时显示进度条与「关闭（后台继续）」。
  - 「🔄 重新提取指纹 - 指纹名」弹窗：显示当前完整度徽标（绿 ≥85 / 黄 ≥50 / 红 <50），勾选补全选项（重新提取特征 / 重新收集样本 / 重新向量化），返回「开始补全」。
- **代码入口**
  - `ui/refill-modal.ts`（650 行，LF 行尾）。唯一导出 `export class RefillModal extends Modal`（`:36`）。
  - `constructor(app, options)`（`:80`）：判别式联合 —— `{ type: 'knowledge', bookId, bookName, knowledgeBaseManager, deconstructionScheduler }` 或 `{ type: 'fingerprint', fingerprint, fingerprintLibrary, aiEngine, embeddingSettings? }`。
  - `onOpen()`（`:116`，先 `modalEl.addClass('nw-scope')`，knowledge 变体再 `await loadDimensionStatus()`）→ `render()`（`:198`，加 `nw-modal-sm` 后按 `type` 分流）→ `renderFingerprintRefill(contentEl)`（`:211`）/ `renderKnowledgeRefill(contentEl)`（`:324`）。
  - 行为：`loadDimensionStatus()`（`:131`）、`updateSelectedDimensions()`（`:137`，`missing` 模式选 `missing|failed`，`all` 模式全选）、`getEstimatedTime()`（`:150`，维度数 × 30 秒）、`formatTime(seconds)`（`:154`）、`getFingerprintCompleteness(fp)`（`:163`，特征 7 项 40 分 + 样本 15 条 30 分 + 原文 30 分）、`getCompletenessBadge(...)`（`:190`）、`startDeconstruction()`（`:500`）、`startFingerprintRefill()`（`:584`）。
  - 打开方：知识库侧由拆解相关入口 `new RefillModal(app, { type: 'knowledge', ... })`；指纹侧由 `ui/fingerprint-library-modal.ts` 等入口 `{ type: 'fingerprint', ... }`。
- **数据来源**：`knowledgeBaseManager.getDimensionStatus(bookId)`（返回 8 个维度的 `completed | missing | failed`）；`DIMENSION_CONFIG`（维度图标/名字/键）；指纹完整度由 `StyleFingerprint` 的 `features`（7 个键）、`samples`、`sourceText` 现算。
- **样式**：新建 `styles-src/40-refill-modal.css`（6330 字节 / 277 行 / 39 个 `nw-rf-*` 选择器，样式源 45 → 46）。作用域统一在 `.nw-scope` 下（`onOpen` 给 `modalEl` 加了 `.nw-scope`），按钮一律写 `.nw-scope button.nw-rf-btn`。

## 2. 现状（事实，不写愿望）

- **指纹变体**（`:211-322`）：`h3.nw-rf-title` → `nw-rf-completeness-row`（`nw-rf-field-label`「当前完整度」+ 徽标）→ `nw-rf-section` + `nw-rf-section-title`「补全选项」→ 三条 `nw-rf-option-row`（`input.nw-rf-check` + `nw-rf-option-label` / `nw-rf-option-desc`）→ 运行中追加 `nw-rf-progress` 系列 → `nw-rf-btn-row`。
- **徽标**（`:190`）：`createDiv({ cls: `nw-rf-badge nw-rf-badge--${completeness.level}` })`，内部两个 `span`：`●●●`/`●●○`/`●○○` 与 `标签 (分值%)`。三档底色是 `rgba(var(--background-modifier-success-rgb | -warning-rgb | -error-rgb), 0.15)`。
- **知识库变体**（`:324-498`）：`h3.nw-rf-title` → `nw-rf-section`（`nw-rf-section-title`「拆解模式」+ 两条 `nw-rf-mode-row`：`input.nw-rf-radio` + `nw-rf-option-label` / `nw-rf-option-desc`）→ `nw-rf-dim-section`（标题 + `nw-rf-dim-grid`）→ 8 张 `nw-rf-dim-card`（`--selected` 修饰；内含 `input.nw-rf-check.nw-rf-check--sm`、`nw-rf-flex1` 包 `nw-rf-dim-label` 与 `nw-rf-dim-status--{completed|failed|missing}`）→ `nw-rf-section.nw-rf-section--alt`（`nw-rf-time-line` 预估 + `nw-rf-time-sub` 已选数量）→ 运行中 `nw-rf-progress`（`-progress-message` / `-progress-dim` / `-progress-track` > `-progress-fill` / `-progress-pct`）→ `nw-rf-btn-row`。
- **按钮**：取消 `button.nw-rf-btn`（运行时知识库变体加 `--dim` = `background: var(--background-secondary)`）；开始 `button.nw-rf-btn-primary`（0 选中时加 `--disabled` = 半透明 + 禁用光标）。
- **进度条宽度**：`this.progressBar.style.setProperty('--nw-rf-pct', `${this.currentProgress}%`)`（`:466`），CSS 侧 `.nw-rf-progress-fill{width: var(--nw-rf-pct, 0%)}`；JS 不再写 `style.width`。
- **历史包袱（Slice W 处理前）**：97 处 `nw-u-*` 工具类、14 处内联 `style` 字符串（维度卡 `transition:all 0.2s`、取消/开始按钮的背景与透明度、进度条 `width`、徽标 `background:rgba(var(--...-rgb),0.15)`、维度状态 `color` 等）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| RF-01 | P0 | 97 处 `nw-u-*` 拼出两个变体的全部排版，语义不可读 | `nw-rf-*` 语义类集中到新建 `styles-src/40-refill-modal.css` | done（Slice W） |
| RF-02 | P1 | 维度卡/按钮/进度条/徽标共 14 处内联 `style`（含 `transition:all 0.2s`） | 全部改修饰类；过渡拆成 `background-color` + `border-color` 两条显式属性 | done（Slice W） |
| RF-03 | P1 | 徽标与维度状态用 JS 颜色表（`colors[level]` / `statusColor[status]`）拼 `background` / `color` | 删表，改 `nw-rf-badge--{level}` / `nw-rf-dim-status--{status}` 修饰类 | done（Slice W） |
| RF-04 | P1 | 进度条宽度靠 `style.width` 直接写 | 改 CSS 变量 `--nw-rf-pct`，与 `ui/batch-import-modal.ts` 的 `--nw-bi-pct` 同套路 | done（Slice W） |
| RF-05 | P2 | 单选按钮与复选框共用一套样式，但单选原本没有手型光标 | 拆出 `input.nw-rf-check` 与 `input.nw-rf-radio` 两条规则 | done（Slice W） |

## 4. 关键决策

- **2026-11-17 新建 40 号样式文件**：弹窗横跨两个变体、39 个选择器；塞进 `20-runtime-modals.css`（已 1200+ 行）会继续发散。新建后 `nw-rf-*` 自成一段，两个变体共用一个命名空间。
- **2026-11-17 `transition:all 0.2s` 必须改写**：旧内联用的是全属性过渡，但 `tests/unit/ui/panel-resizer-and-motion.test.ts` 硬断言 `styles.css` 不含 `transition:all`（性能门禁）。改成 `transition: background-color 0.2s ease, border-color 0.2s ease` —— **代价是 6 张维度卡的 `transition` 计算值从 `0.2s` 变成两属性串**，这是本轮唯一一处「计算样式与改前不同」的偏差，像素零差异，已在验收表标注为有意偏差。
- **2026-11-17 两个变体的取消按钮不能共用修饰类**：知识库变体是 `this.isRunning ? 'nw-rf-btn nw-rf-btn--dim' : 'nw-rf-btn'`（运行时 `background-secondary`），而指纹变体旧代码恒为 `background: var(--background-primary)`。第一版统一按 `isRunning` 判断，导致 `05-fingerprint-yellow-running` 的取消按钮底色 `rgb(255,255,255) → rgb(246,246,246)`（1 处 style 差）。**结论：按各变体原始声明分别复刻，别为了「少一个类」合并语义。**
- **2026-11-17 徽标/状态改修饰类而非保留颜色表**：`getCompletenessBadge` 原在 JS 里写 `badge.style.background = colors[level]`，颜色表只服务于这一处；改 `--{level}` 修饰类后，颜色回到样式表，且与 `--background-modifier-*-rgb` 主题变量联动。
- **2026-11-17 进度条走 CSS 变量**：保留 `progressBar` 引用与 `setProperty` 写法（与 `batch-import-modal` 一致），CSS 侧默认 `0%`。比 `style.width` 的好处是宽度可被主题（如紧凑模式）覆盖，且 JS 侧不再出现内联样式。
- **2026-11-17 单选/复选拆开**：`nw-rf-check` 带 `cursor: pointer`，而 `nw-rf-radio` 原本没有；拆开后既保留了像素等价，也让「单选的点击区其实在行上」这个事实显式化（行本身有 `cursor`）。
- **2026-11-17 不做响应式/暗色适配**：`480px` 宽度由 `nw-modal-sm` 决定，本轮不动；目标是 6 场景像素零差异（结果达成）。

## 5. 验收记录

| 日期 | 项 | 结果 |
| --- | --- | --- |
| 2026-11-17 | `npx tsc --noEmit` | EXIT 0 |
| 2026-11-17 | `npm run build` | `[styles] 拼接 46 个源文件 → styles.css（31322 行）`；esbuild v4.96.1 成功 |
| 2026-11-17 | 单测 | `npx vitest run tests/unit/ui/panel-resizer-and-motion.test.ts` → 16 通过（`transition:all` 禁令未触发）；仓库无 `RefillModal` 专用单测 |
| 2026-11-17 | 像素（6 场景 before/after） | PNG **6/6 = 0 px**；probes struct 0 / rect 0；style 仅 knowledge 三场景各 6 个 `nw-rf-dim-card` 的 `transition`（有意偏差，见 §4） |
| 2026-11-17 | 门禁 | `check:inline-styles` 542→**530**；`check:utility` 84/367→**75/270**（零引用 0）；`check:css` bytes **781932** / uniqueClasses **4249** / hex 184 / rgbHsl **223**；`check:bundle` main.js **5627977** / styles.css **781932** |
| 2026-11-17 | `npm run preflight` | EXIT=0：959 文件 / 10118 通过 + 3 skipped；`check:release` v4.96.1 |

## 6. 测试清单

- 过渡禁令：`tests/unit/ui/panel-resizer-and-motion.test.ts`（断言 `styles.css` 不含 `transition:all`，是 RF-02 改写的直接原因）。
- 无专用单测：仓库里 `tests/` 对 `RefillModal` 零引用；两个变体的渲染、维度勾选、进度条宽度都靠 before/after 像素脚手架（见 §8）验证。
- 实机检查点：knowledge 变体的 8 张维度卡状态色、`--selected` 选中态、运行中进度条与「关闭（后台继续）」、0 选中时开始按钮禁用；fingerprint 变体三档徽标（绿/黄/红）、补全选项勾选、返回按钮。
- 若要补单测，最小切入点是 `render()` 的 DOM 冒烟：断言 `nw-rf-badge--{green|yellow|red}`、`nw-rf-dim-status--{status}`、`--nw-rf-pct` 变量值。

## 7. 剩余 backlog（P2/P3）

- [ ] `nw-rf-dim-card` 的 `transition` 是两属性补间（原为全属性），若未来加 `color` / `transform` 过渡需记得同步扩写。
- [ ] 650 行仍混着「两个变体的渲染 + 两个启动流程」，可按 Slice M 思路拆成 `refill-modal.ts`（外壳 + 共用件）/ `refill-knowledge.ts` / `refill-fingerprint.ts`。
- [ ] `progressBar` / `progressText` / `startBtn` / `cancelBtn` 等字段只用于渲染期，可改成函数内局部变量（减少实例状态）。
- [ ] 两个变体的按钮行结构完全一致（取消 + 主操作），可抽一个 `renderButtonRow(contentEl, { primaryLabel, disabled, onClick })` 辅助。
- [ ] 补一条 DOM 冒烟测试（见 §6），避免以后只能靠截图回归。

## 8. 交接备注

- **下一轮从哪开始**：`nw-u-*` 存量大户剩 `ui/views/kb-stats-panel.ts`（81）、`ui/settings/deconstruction-section.ts`（47）。用户（m09227）要求「按顺序直接做完全部」，Slice W 是第二站，接下来 Slice X → Y。
- **已知坑（本轮新踩）**
  1. **首轮采集的像素噪声**：第一次 after 采集在 `01/02/04` 各出现 523/523/541 px、`maxDelta` 6~7，probes 却全为 0；重采后 6/6 归零。与 Slice V 同一现象（新开 Obsidian 首轮边缘合成像素）。**判定标准：重采归零即噪声，稳定复现才是真差异。**
  2. **两个变体别共用条件样式**：指纹变体的取消按钮恒 `background-primary`，知识库变体才按 `isRunning` 分档；统一判断会掉进 `05` 那种 1 处 style 差（PNG 3969 px）。
  3. **before 侧也要打钩子**：worktree checkout 的 HEAD 没有 `window.__nwRefill`，先在 worktree 的 `ui/refill-modal.ts` 末尾补 `// TEMP-SNAP-HOOK` 再 build；截完从主仓删除并重建（否则 `git grep TEMP-SNAP-HOOK` 会命中）。
  4. **`Modal.open()` 与 `contentEl` 时序**：脚本必须先 `m.open()` 再写 `m.dimensionStatus` / `isRunning` 等字段，最后手动 `m.render()`，否则 `onOpen` → `loadDimensionStatus` 会把字段覆盖回默认值。
  5. **dev vault 是真实目录**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 必须手工 `Copy-Item main.js,styles.css`（`scripts/dev-vault.mjs sync` 指向的是 `C:\Users\admin\nw-dev-vault`）。
  6. **本文件是 LF 行尾**：整段字符串替换前先确认，避免把 CRLF 写回。
- **脚本**（仓外临时，勿提交）：`D:\nw-tmp\snap-w.mjs`（6 场景，`--tag=before|after`）、`D:\nw-tmp\diff-w.mjs`（PNG + 35 键探针）。
