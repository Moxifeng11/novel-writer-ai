# 写作指纹库（视图 + 详情 / 编辑 / 提取弹窗）

> 状态：stable（视觉重构 Slice L 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：一个面板管理「让 AI 模仿某种文风」的指纹库——可按层（项目 / 全局 / 模板）切换与搜索、
  按标签过滤、查看某个指纹的 12 维文风特征与代表片段、把指纹注入当前章节的写作提示词；
  还能新建/编辑指纹、从已有章节提取指纹、从知识库书籍导入指纹。
- **代码入口**
  - 视图：`ui/views/writing-fingerprint-view.ts`（`WritingFingerprintView extends ItemView`，
    `VIEW_TYPE_WRITING_FINGERPRINT = 'novel-writer-writing-fingerprint'`）；同文件内 `EditFingerprintModal`、
    `ExtractFromChaptersModal`、`KnowledgeBookPickerModal`
  - 详情弹窗：`ui/fingerprint-detail-modal.ts`（`FingerprintDetailModal`，12 维卡片 + 统计 + 代表片段 + 操作）
  - 12 维明细渲染：`ui/views/fingerprint-v2-detail.ts`（`fingerprint-v2-detail`，被上面两者复用）
  - 页签样式：`ui/views/fingerprint-scope-logic.ts`（`buildScopeTabClass`，Slice L 起只返回类名，不再返回 style 串）
  - 库与持久化：`engine/style-fingerprint-library.ts`（`StyleFingerprintLibrary`：`loadGlobal/addGlobal/updateGlobal`、
    `loadProject/addProject/updateProject`、`addFromKnowledge`、`isGlobalEnabledForProject`、
    `setGlobalEnabledForProject`、`loadIntensityConfigs` 等）
  - 12 维定义与归一化：`engine/style/style-dimensions-v2.ts`（`rhythm`/`sentencePattern`/`wordChoice`/`rhetoric`/
    `perspective`/`emotion`/`tension`/`infoDensity`/`dialogue`/`description`/`narration`/`languageTexture`）
  - 样式：`styles-src/32-fingerprint.css`（Slice L 新增，命名空间 `nw-fp-*`，选择器统一 `.nw-scope ` 前缀）
- **相关数据**
  - 全局指纹：`<插件目录>/data/global-fingerprints.json`（`shared/paths.ts:1350 globalFingerprintsFile()`）
  - 项目指纹：`<vault>/<项目>/04-项目总控/写作指纹库/project-fingerprints.json`
    （`shared/paths.ts:1370 projectFingerprintsFile(project)`，目录由 `:897 pjControlDir(project)` 决定）
  - 模板指纹：`engine/style-fingerprint-library.ts` 的 `loadTemplate/addTemplate`（内置模板）
  - V1/V2 同存一个数组：`collectV2Fingerprints` 只取 `version === 'v2' && id && features`；
    V1 的 `features` 是七键字符串（`sentenceRhythm/wordPreference/narrativeStyle/rhetoric/dialogueStyle/
    paragraphStructure/overallTone`），V2 每维是「定量字段 + `description` + `samples` + `status`」
  - 开关/强度：全局指纹对项目的启用状态存 `loadGlobalState/saveGlobalState`；
    强度配置走 `loadIntensityConfigs/getIntensityConfig`（`engine/style/fingerprint-intensity-config`）

## 2. 现状（事实，不写愿望）

- **布局**：`renderLayout()` 建 `.nw-fingerprint-main-layout`（左栏 `-left-sidebar` 300px / 右栏 `-right-panel` 自适应），
  左栏 = 能力横幅 + 层页签（`-scope-tabs`）+ 工具栏 + 搜索/标签过滤 + 列表 + 计数；
  右栏 = 详情（选中态：注入卡、分类、统计、特征、片段、操作区；未选中：空态提示）。
- **渲染顺序**：`renderScopeTabs()` → `renderFingerprintList()` → `renderDetailPanel()`；
  切层/搜索/选标签都走这三步局部重绘，不重建外壳。
- **层页签**：`scope-logic.buildScopeTabClass(activeScope, scope)` 返回 `nw-fingerprint-scope-tab`
  加 `nw-fingerprint-scope-tab--active` 修饰类；激活态样式（2px 下边框 + 强调色 + 600 字重）在 32 号文件里，
  不再由 JS 拼 `style` 串（Slice L 前 `buildScopeTabStyle` 返回内联样式，被 `.nw-scope` 规则压掉一半）。
- **窄屏**：`styles-src/11-fingerprint-and-workbench.css:126-304` 有 `@container (max-width:860px)` /
  `(max-width:560px)` 覆盖（主布局改纵向、左栏 100% 宽 / max-height 42% / 底边框、右栏 padding 12px）。
  原文里的 `display/width/min-width/max-width/border-right/padding/overflow-y` 已合并回同文件 `:132/:137/:142`
  的基规则——**不能**写进 32 号文件的 `.nw-scope` 规则，否则 (0,2,0) 会压过 container query 造成窄屏回归。
- **注入卡**：`injectionBudget()` 按上下文预算给出建议字数；样本不足（`fp.samples.length === 0`）时
  显示黄色提示条 `.nw-fingerprint-sample-warn` + `.nw-fp-inject-warn`。
- **知识库导入**：`handleImportFromKnowledge()` 先 `getAllBooks()` 取书单，再由 `KnowledgeBookPickerModal` 选书 →
  `KnowledgeToFingerprintConverter.convert()`（顺带 `getSourceText` 取原文分块、`chunkOriginalText` 过滤出 12 条样本）
  → `library.addFromKnowledge(fingerprint)` → 重载列表。该弹窗**不带** `.nw-scope`：它是纯列表 + 按钮，沿用既有 `nw-kb-picker-*` 类，
  Slice L 实测加 `nw-scope` 会触发 `.modal.nw-scope{margin:auto}` 让弹窗横移 2px，故明确不纳入本命名空间。
- **历史包袱**：Slice L 前本模块共 405 处 `nw-u-*` 工具类（视图 228 / 详情弹窗 157 / v2 明细 20）
  + 15 行内联 `style`（14 个站点）；工具类在 `.modal button`、`input[type=text]` 面前大量失效（白底黑字），
  内联样式则反过来赢过一切——同一个弹窗里两种极端的覆盖关系并存。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| WF-01 | P1 | 视图与弹窗用 405 处 `nw-u-*` 拼样式，语义不可读 | 语义类 `nw-fp-*`（外壳保留 `nw-fingerprint-*`） | done（Slice L） |
| WF-02 | P1 | 14 个站点的内联样式（页签激活态、列表选中、按钮配色、徽标） | 全部进 `styles-src/32-fingerprint.css` | done（Slice L） |
| WF-03 | P1 | 语义类单类 (0,1,0) 被 Obsidian `.modal button`/`input[type=text]` (0,1,1) 压掉 | 选择器统一 `.nw-scope ` 前缀（(0,2,0)） | done（Slice L） |
| WF-04 | P2 | `buildScopeTabStyle` 返回 style 串，样式与逻辑混在一处 | 改为 `buildScopeTabClass` + 修饰类 | done（Slice L） |
| WF-05 | P2 | 视图与详情弹窗都叫 `nw-fp-samples-empty`，两处规则互相覆盖（视图空态被加上 20px padding） | 详情弹窗独立命名 `nw-fp-detail-samples-empty` | done（Slice L） |

## 4. 关键决策

- **2026-11-17（Slice L）**：新建 `styles-src/32-fingerprint.css`，选择器统一 `.nw-scope ` 前缀。
  理由：视图根节点与三个弹窗的 `modalEl` 都挂了 `nw-scope`（`00-header.css:13` 定义），拿到 (0,2,0) 才能压过
  Obsidian 的 `.modal button`/`input[type=text]` (0,1,1)；这是 Slice H/I 已在弹窗上验证过的做法。
- **外壳类不改名**：`nw-fingerprint-main-layout`/`-left-sidebar`/`-right-panel`/`-scope-tabs`/`-list`/
  `-detail-header` 等既有块类保留（E2E 与 container query 都按它们选择），只把它们的**声明**补齐；
  新增的 `nw-fp-*` 只用于内部构件。
- **窄屏声明留在 11 号文件**：见 §2 最后一条——(0,2,0) 会破坏 `@container` 覆盖，所以布局声明必须写进
  11 号文件的基规则（那里是 (0,1,0)，container query 仍在同文件后面生效）。
- **按设计意图恢复，而非复刻级联事故**（沿用 Slice H 结论）：
  - 搜索框：旧工具类 `nw-u-p-6px-10px nw-u-fs-12px nw-u-brd-4px` 从未生效（实际渲染 4px 8px / 13px / 5px），
    语义类让作者原意 6px 10px / 12px / 4px 真正生效 → 保留新值（实测 618 像素差，全部落在输入框内）。
  - 编辑指纹弹窗的「取消 / 💾 保存」：旧工具类被 `.modal button` 压成白底深字，语义类恢复
    `var(--background-secondary)` 灰底与强调色底 → 保留（实测 3819 像素差，bbox 正是两个按钮）。
- **详情弹窗按钮逐条复刻内联值**：`.nw-fp-btn` 基础 = `padding:6px 14px;border:1px solid var(--background-modifier-border);
  border-radius:4px;font-size:12px;cursor:pointer` 且**不设 background**（沿用 Obsidian 默认）；
  `--plain` 另加 `background:var(--background-primary)`；`--danger` = 错误色边框 + 错误色文字 + 透明底；
  `--primary` = 强调色底 + `--text-on-accent` 文字 + 无边框。原因：这些站点原本用内联样式，内联赢过 Obsidian，
  改成单类后会反过来被压掉，必须显式声明。
- **状态色/徽标改用修饰类**：`nw-fp-dim-status--complete|partial|pending`、`nw-fp-status-badge--on|off`、
  `nw-fp-item-name--muted` 替代原来的 `getStatusColor()` + 内联 `style`。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-17 | Slice L 语义化 + 像素校正（8 个场景） | 结构零差异（probes 数组逐位对齐、struct 差 0、rect 差 0）；仅 3 类**有意差异**：搜索框 618px（0.031%）、编辑弹窗按钮 3819px（0.53%）、详情弹窗 9px（0.001%，文字 AA） | `D:\nw-dev-vault\_visual-l\{before,after}`（未入库）；`D:\nw-tmp\diff-l.mjs` → `_visual-l\diff-report.json` |
| 2026-11-17 | 门禁 | typecheck / lint / inline-styles / utility / css / bundle / preflight 全绿 | preflight EXIT=0 |

场景清单：view-project-v2（项目层 V2 全维）、view-global-v1（全局层 V1 禁用）、view-global-v2-partial（多 pending 维）、
view-project-nosample（无样本 → 黄条 + 空态）、modal-detail、modal-edit、modal-extract、modal-picker。

## 6. 测试清单

- 纯逻辑：`tests/unit/ui/fingerprint-scope-logic.test.ts`（`buildScopeTabClass` 修饰类）、
  `tests/unit/ui/fingerprint-view-logic.test.ts`、`tests/unit/ui/fingerprint-detail-logic.test.ts`、
  `tests/unit/ui/fingerprint-scope.test.ts`、`tests/unit/ui/fingerprint-v2-detail.test.ts`
- UI/DOM：`tests/unit/ui/fingerprint-capability.test.ts`、`tests/unit/ui/fingerprint-intensity-styles.test.ts`、
  `tests/unit/ui/view-banners-dom.test.ts`（黄条/空态结构）
- 引擎侧回归：`tests/unit/engine/style/fingerprint-*.test.ts`（load/persist/blender/v2-create/migrator）、
  `tests/unit/engine/fingerprint-selection-b4.test.ts`、`tests/unit/engine/knowledge-injector-fingerprint.test.ts`
- 实机：reload 后检查——三层页签切换、搜索 + 标签过滤、选中/未选中详情、无样本黄条、
  详情弹窗 12 维展开、编辑保存后列表刷新、从章节提取（需要当前项目有章节）、知识库导入选书列表。

## 7. 剩余 backlog（P2/P3）

- [ ] 视图类仍留在 `writing-fingerprint-view.ts` 内（1703/1819/1972 三个 Modal），文件已 2037 行，可拆分为
  `ui/fingerprint/edit-modal.ts` 等；拆分时注意 `ExtractFromChaptersModal` 被命令面板直接引用。
- [ ] `nw-fingerprint-*` 外壳类与 `nw-fp-*` 内构件两套前缀并存，后续可统一（E2E 选择器需同步）。
- [ ] 列表与详情的空态文案仍是硬编码中文，未走 i18n（全仓同现状）。
- [x] **V2 规范模型已定稿并落地**（2026-11-21 决策，2026-11-22 P2/P3 落地；ADR：`docs/design/2026-11-21-style-fingerprint-v2-canonical.md`）：
  决策是「V2 为规范模型、V1 七维降为提示词投影（只读、可重算）」。
  - P1（已落地）：`toPersistedFingerprint` 不再回写 V1（有 V2 缓存则同步 7 维 description，无缓存则 `migrateV1ToV2` 现场生成），磁盘上只存在 V2 条目。
  - P2（已落地）：新建指纹统一走 `FingerprintExtractor.extractWithAnalysis()` —— 同一次抽取里 AI 写 7 维 prose、本地
    `StyleFeaturesAnalyzerV2` 产 12 维定量与 5 个新维文案，合并后 `add*(fp, analysis)` 落盘；加载期由
    `backfillV2Dimensions(scope)` 对「有 pending 维」的旧条目补 12 维（原文优先，无原文用样章拼接，写 `.v2backfill.bak`，每作用域每进程一次）；重抽（`refillFingerprint`）也会顺手补齐。
  - P3（已落地）：V2 独有的 5 维（sentencePattern / emotion / tension / infoDensity / description）在全局层 7 段之后
    追加「V2 深化特征（量化）：」，**默认开启**，只受强度配置约束（`globalIntensity: 0` 时整段消失、描述长度按 `descriptionLength` 截断）。
  - 相关类型标注已由 `@deprecated` 改为 `@legacy`（warn 第 11 批），不要再按「清弃用」的思路去删 V1 类型。
  - P4（已落地，2026-11-22）：内存直接持 V2 —— `load*` 先构建 `v2Fingerprints` 再 `refreshScopeProjection`，三张 V1 表成为派生投影（唯一写入口 `refreshScopeProjection`），`add*/update*` 走 `ensureV2FromEntry`，`copyFingerprint`/`syncFromTemplate` 也不再产生 5 维 pending。旧口径「加载即降级」已废弃。


## 7.1 P2/P3 实现对照（2026-11-22）

| 环节 | 入口 | 关键点 |
| --- | --- | --- |
| 抽取 | `engine/fingerprint-extractor.ts#extractWithAnalysis` | 返回 `{ fingerprint, analysis }`；`analyzeV2()` 失败只 warning（`// silent-ok`），回退成「先写投影、之后回填」 |
| 合并 | `engine/style-fingerprint-library.ts#mergeAnalysisIntoFeatures` | 以本地 12 维为基底，7 维 description 覆盖为 AI 文案并置 `complete` |
| 入库 | `addTemplate/addGlobal/addProject(fp, analysis?)` | 首行 `registerAnalysis`；无 analysis 的老调用仍可用（迁移兼容） |
| 回填 | `backfillV2Dimensions(scope)` | 由 `migrateV1ToV2Dimensions` 每作用域末尾调用；`backfilledScopes` 保证每进程一次；备份后缀 `.v2backfill.bak` |
| 重抽 | `refillFingerprint` | 重新提取 7 维后再跑分析器并 `registerAnalysis` |
| 注入 | `engine/style/dynamic-injection-engine.ts#build(..., v2Features?)` | 只追加 `V2_NEW_DIMENSIONS` 且 `status==='complete'` 的维度；`summarizeV2Dimension` 产「倒装 1.2/千字 · 设问 3%」这类定量短句 |
| 取数 | `getV2FeaturesMap(ids)` | `engine/prompt-builder.ts:339` 以 `typeof ... === 'function'` 守卫调用（兼容旧测试桩） |

## 7.2 P4 内存投影（2026-11-22）

| 环节 | 入口 | 关键点 |
| --- | --- | --- |
| 投影 | `projectV2ToV1(v2)` + `refreshScopeProjection(scope)` | V1 七维文案由 `extractV1FeaturesFromV2` 现算；三张 V1 表只读不写 |
| 合并 | `ensureV2FromEntry(fp, scope)` | 有缓存则 `syncV1DescriptionsIntoV2`，否则 `migrateV1ToV2`；元数据以调用方为准 |
| 加载 | `loadTemplate/loadGlobal/loadProject` | `collectV2Fingerprints` → 非 v2 条目现场迁移进 V2 缓存 → refresh |
| 写 | `add*/update*` | `ensureV2FromEntry` + refresh；enable/disable 复用 update* |
| 复制/同步 | `copyFingerprint`、`syncFromTemplate` | 先登记 V2 副本再 `add*`；更新分支 ensure + refresh |

验收证据：`tests/unit/engine/style/fingerprint-v2-inmemory.test.ts` 5 例（加载后投影与 V2 一致 / update 改名改文案不丢新维 / 启停不动维度 / copy 到项目层仍完整 / syncFromTemplate 只换 7 维文案）。

验收证据：`tests/unit/engine/style/fingerprint-analysis-merge.test.ts` 6 例（P2a 落盘 12 维全 complete、P2b 回填只补待补项并留备份、P3 有/无 map 与强度 0 三种注入形态）；
开发 vault 实机：`fp_demo_partial`、`fp_demo_legacy` 首次加载后由 5 维 pending 变为全 complete，生成 `global-fingerprints.json.v2backfill.bak`（18,687 字节）。

## 8. 交接备注

- 视觉改动前先确认 `.nw-scope` 是否真的在祖先上：`EditFingerprintModal`/`ExtractFromChaptersModal` 在 `onOpen`
  里 `this.modalEl.addClass('nw-scope')`；`KnowledgeBookPickerModal` **故意没有**（见 §4）。
- 截图校正必须用真实开发 vault（`D:\nw-dev-vault`）：先 `node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault`，
  再 `node D:\nw-tmp\snap-l.mjs --tag=after`；打开视图要 `getLeaf('tab').setViewState`，
  且先 detach 旧的功能叶子，否则会拿到 `width=0` 的隐藏叶子（`getScopeFingerprints is not a function`）。
- 造数据用 `D:\nw-tmp\seed-l.mjs`（3 枚全局 + 3 枚项目；含 V1 禁用与「无样本」两枚边界样本）。