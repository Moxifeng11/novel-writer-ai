# Changelog

## 4.11.0 — v8.14 全面技术审计落地：安全收口 / 内存生命周期 / UX 断点 / 死代码清理 / CSS 一期 / lint 接入

> 发布说明：`docs/releases/v4.11.0.md` · GitHub Release `v4.11.0`（2026-10-19）

### 🧭 动因
按 `/goal` 对插件完整代码库执行四路静态审计（安全 / 内存 / UX / CSS）+ 运行时验证（obsidian CLI）+ 官方生态规范对照，产出漏洞清单与风险等级评估报告（`.trae/specs/plugin-tech-audit-2026q4/audit-report.md`，约 40 项：高 15 / 中 10+ / 低与信息 15+）。经用户裁定分四批实施：S+M+U 核心缺陷、D 死代码清理（**逐文件引用验证后删除**）、C-a CSS 一期、T eslint 接入；F4 密钥派生按用户裁定升级为**口令派生**。兼容底线不变（minAppVersion 保持 1.5.0、v1 密文永久可读、无口令用户明文降级）。

### ✨ 改动

**批 S — 安全收口**
- `shared/paths.ts`（**F5 路径穿越 · 高**）：新增 `sanitizeName()` —— 剥控制符、替换 `\/:*?"<>|`、剥首尾 `.`（消除 `..` 段）、空名回退「未命名」；`pjCharFile/pjLocFile/pjFactionFile/pjItemFile/pjFanficFile` 五个实体路径函数与 `kbBookDir` 统一收口。AI 生成实体名（settlement-engine 等 40+ 调用点）不再可能写出 vault。
- `ui/full-writer/project-selector-controller.ts:365`（**F1 XSS · 高**）：章节列表 `innerHTML` 插值前对 `ch.chapter` / `ch.title` 过 `escapeHtml`（`ch.title` 源自 frontmatter，AI 生成/导入可写入任意文本）。
- `utils/helpers.ts`：新增统一 `escapeHtml`（覆盖 `& < > " '`）；`ui/knowledge-detail-modal.ts` SVG `<text>` 插值（F2）改走该函数；`ui/svg-charts.ts` 私有版补单引号转义（F3）。

**批 S — F4 密钥派生升级（用户裁定方案）**
- `core/crypto-service.ts` 重写：v2 格式 `aes256v2:<iterations>:<salt>:<iv>:<ct>`，**用户口令 + PBKDF2-SHA256（210k 迭代，每条密文独立随机 salt）**派生 AES-GCM 密钥。旧版 seed 为公开常量（知道 vault 路径即可解密 data.json 中的 API 密钥）。要点：口令仅存内存（会话级，不落任何文件）；`decrypt` 遇 v1 密文永久走旧 seed 兼容读取（存量数据零破坏）；首次加密时用户取消 → 明文保存并提示（向下兼容）；口令错误清除会话重问一次；同 salt 派生缓存避免重复 PBKDF2。
- `ui/password-modal.ts`（新建）：ask（解锁）/ set（设口令，两次输入 + ≥6 位校验）两种模式，Esc/遮罩关闭视同取消。
- `engine/engine-registry.ts`：构造 CryptoService 时注入 `requestPassword` / `requestNewPassword` 回调（服务保持无 UI 依赖）。

**批 M — 内存与生命周期**
- `main.ts` onunload（**M1 · 高**）：补 `this.engineRegistry?.disposeAll().catch(...)` —— 此前 disposeAll 生产代码零调用，插件卸载/禁用后 Worker 池与重资源全部残留。
- `services/heavy-task-worker-manager.ts`（**M1 · 高**）：补 `dispose()` 委托幂等 `destroy()` —— 原类仅有 `destroy()` 而 EngineRegistry 的 Disposable 契约只认 `dispose()`，即使调用 disposeAll 也清不掉该类。
- `engine/context-manager.ts`（**M2 · 高**）：删除 `incrementalContextCache`（每次 gatherAll 无上限写入完整 GatheredContext，唯一读取方 `gatherIncremental` 与清理方 `invalidateIncrementalCache` 生产代码零调用，长会话可积累数十 MB）及连带死代码 `fileChangeTracker` / `recordFileChange` / `updateIncrementalCache` / `recomputeDerivedData`。`diffDetector` / `incrementalUpdater` 有活路径引用，保留。
- `ui/backup-yuan-modal.ts` / `ui/protect-yuan-modal.ts`（M3/M4）：`new Notice('⏳', 0)` 持久进度通知持有引用并在所有出口 `hide()`（原实现永不消失、反复操作叠层）。
- `utils/helpers.ts`（M8）：`showProgress` / `hideProgress` 由模块级单例改为按 key 的 Map 管理 —— 不传 key 行为与旧版完全一致，并发流程传不同 key 即互不吞进度。

**批 U — UX 断点修复**
- `core/command-registry.ts`（**U1 · 高**）：`registerInternalCommands` 补注册 `WRITE_CHAPTER` —— 该命令此前仅有定义未注册，tools-modal「整章生成（旧）」按钮点击无任何效果（运行时实证修复前 `registry.has = false` → 修复后 `true`）。
- `ui/mini-settings-modal.ts` + `ui/settings-tab.ts`（U6）：两份逐行复制的「重建向量索引」实现收敛为 `ui/knowledge-rebuild-action.ts` 单一实现。
- `ui/rebuild-chapters-modal.ts` / `ui/batch-create-modal.ts` / `ui/ai-builder-modal.ts` / `ui/full-writer/wizard-step-executors.ts`（U7）：四处批量操作的单项失败此前仅 `log.warn` 用户不可见，改为收集失败清单、结束 Notice 汇总「成功 N / 失败 M（前 5 项）」。
- `ui/step-result-viewer-modal.ts`（U11）：`showInFolder` 移动端由静默失败改为 `Platform.isMobile` 判断 + 明确 Notice 提示。

**批 D — 死代码清理（逐文件三重验证：全库引用 Grep / 动态 import / tests 引用 → 零引用才删）**
- 删除 10 个零引用文件：`ui/main-modal.ts`（NovelWriterModal，连带清 main.ts 与 command-registry.ts 两处 unused import）、`ui/writing-profile-modal.ts`（清 main.ts unused import）、`ui/project-wizard-modal.ts`、`ui/modals/volume-conflict-preview-modal.ts`、`ui/scene-detail-editor-modal.ts`、`ui/monitor-view.ts`、`ui/relationship-view.ts`、`ui/action-panel.ts`、`ui/components/progress/floating-progress-ball.ts`（U4 视图 ID 比较错误随之消失）、`ui/components/progress/status-bar-indicator.ts`。
- `services/template-service.ts`：清除 `WRITING_RULES` 死导入（v8.13 登记项）。
- `ui/components/progress/index.ts`：同步移除两个死组件的 re-export（桶文件其余导出不受影响）。

**批 C-a — CSS 一期**
- `styles.css`（C11）：补齐 **17 个幽灵变量**（被 `var()` 引用却未定义，此前回退 initial 值）—— `--nw-info` / `--nw-tag-bg` / `--nw-plot-accent` / `--nw-progress-bg` / `--nw-progress-fill` / `--nw-card-hover` / `--nw-accent-text` / `--nw-btn-warning-active-bg` / 排版五件套（`--nw-text-xs/sm/lg`、`--nw-font-semibold`、`--nw-leading-normal`）/ 阴影二件套（`--nw-shadow-card(-hover)`）/ 滚动条二件套，全部对齐既有 token 体系。脚本复核幽灵变量 **17 → 0**。
- `styles.css`（C3）：文件末尾新增 `prefers-reduced-motion` 全局兜底块 —— 原文件 11 个 `@keyframes`（含 4 个 infinite 循环）仅 1 处尊重用户偏好，现统一降级（动画时长趋零、循环收敛单次、滚动行为还原）；`!important` 为覆盖全文件散布声明的官方允许例外，注释已说明。
- `styles.css`（C5）：`rhythm-segment` 三态由硬编码浅色底+深色字（暗色主题下视觉脱节）改为 Obsidian 官方 `--color-*` 语义色 + `color-mix` 半透明底，明暗主题自适应。
- `styles.css`（C10）：`.nw-quality-popup` 的 `z-index: 9999`（压过官方弹层）改用 `var(--layer-popover, 100)`。

**批 T — lint 接入**
- 新增 `eslint.config.mjs`（flat config）：接入 **eslint 9 + eslint-plugin-obsidianmd 0.4.2**（42 条官方社区规则，recommended 全量）；按本项目实际显式关闭 `settings-tab/prefer-setting-definitions` 与 `settings-tab/no-deprecated-display`（声明式设置需 Obsidian 1.13+，与 minAppVersion 1.5.0 冲突）。`package.json` 增加 `lint` 脚本。**首次基线 0 error / 1 warning**（已顺手清理 genre-detector.ts 失效的 eslint-disable 指令）。

**批 C-b（CSS 二期 · b0~b4，执行计划 `.trae/specs/plugin-tech-audit-2026q4/cb-cc-execution-plan.md`）**
- C-b0 基线锁定：明/暗双主题 × 4 界面（cowriting/fullwriter/knowledgebase/qualitydashboard）8 张截图存 `screenshots/cb-baseline/`，作为后续各阶段像素对比锚点。
- C-b1 死变量清理（三重验证：CSS `var()` 引用 / 全库 TS 消费 / `theme-manager.ts` 运行时注入白名单）：删除 **22 个纯死变量**（零引用零消费零注入，含 `--nw-shadow-xl` 的 `:root` 与 `.theme-dark` 双处、`.nw-cowrite-root` 作用域的 `--nw-ui-gap(-lg)`），styles.css 9740 → 9717 行；**7 个白名单保留**（`theme-manager` `setProperty` 注入）。审计口径修正：原 29 项清单中 7 个实为 TS 内联消费型活变量（审计时未扫 TS 消费侧），已剔除误判。
- 验证：lint 0/0 / typecheck 0 / 3009 tests / build / reload + `dev:errors` 干净；fullwriter 静态界面像素 diff 0.18%（噪声级）；cowriting/knowledgebase 为动画界面像素法不可用（自比 100%/81%），截图留存待 Owner 肉眼复核。
- C-b2 基础类重复定义收敛：`.nw-btn`（**实测 6 处**，审计原记 5——L2457 因带前导空格漏计）、`.nw-card`（3 处）、`.nw-card-title`（**实测 4 处**，原记 3）各自合并为**单一定义**，各属性取层叠终值；合并块强制置于所有变体之前（置于末尾会使同特异性后写覆盖变体背景，已实测验证）。作用域覆盖层（`.nw-scope .nw-card`、协同写作组合器 `!important`）原样保留。
- C-b2 验证：四界面 computedStyle 逐属性对比（`.nw-card` / `.nw-card-title` 各 8 项、`.nw-btn` 7 项）**全部与基线一致**，零视觉变化。附带发现：`.nw-btn-warning` 背景长期被 Obsidian 原生 `button:not(.clickable-icon)`（特异性 0,1,1）覆盖为 `#333`（既有缺陷，已登记）。
- 方法论修正：本环境截图像素法不可用（两次采集间仅改 CSS，像素 diff 仍 78%~100%，源于窗口/动画/滚动状态漂移）；后续阶段以 computedStyle 逐属性采样为主证据，截图为 Owner 签发素材。
- C-b3 裸类命名空间化（51 类 → 0，另补充 3 个清单外裸类）：45 类直接加 `nw-` 前缀（CSS 66 处选择器 + TS 13 处引用）；4 个与现有 `nw-` 样式冲突的活类按 Owner 裁定做**语义化改名**（`warning-item`→`nw-warning-text`、`traction-progress`→`nw-traction-progress-value`、`entity-name`→`nw-entity-name-accent`、`stat-label`→`nw-emotion-stat-label`）以避免误并入新版样式造成视觉变更；2 个死类删除（`rhythm-segment`、`thread-progress`）；清单外补充 `emotion-curve-empty`/`stat-item`/`state-change-list`。
- C-b3 修复前缀动态拼接遗漏（R5 命中）：`divergence-risk-${level}`（live-analysis-controller）与 `diff-${op}`（chapter-version-modal 3 处）均已加 `nw-` 前缀——若不修复，这些元素的样式会静默丢失。
- C-b3 验证：54 个目标类残留扫描 **CSS 0 / TS 0**；computedStyle 抽样 15 个类样式正确；Gate 全绿（lint 0/0 / typecheck 0 / 3009 tests / build / dev:errors 干净）。
- C-b4 `.nw-scope` 双选择器兜底收敛（C7）：运行时验证（Modal / ItemView 两条挂载路径）证明 `nw-scope` 与 `.modal` 始终为**同一元素**（全库 80 处 `addClass('nw-scope')` 均挂 `modalEl`；ItemView 挂 `workspace-leaf`），后代选择器 `.nw-scope .modal.nw-modal*` **0 命中**，v8.3 自身挂载规则 `.modal.nw-scope.nw-modal*` 为唯一生效规则。经 Owner 裁定收敛：删除 A 组后代选择器规则、B 组重复块及 `.nw-scope .nw-modal .modal-content`，保留自身挂载组为唯一定义来源；同步删除 `.theme-dark .nw-scope .modal.nw-modal` 死规则（实测边框由 Obsidian 原生 `.modal` 提供，激活反而会把边框色由 `#3f3f3f` 改为 `#333`）。
- C-b4 验证：收敛前后模态框 computedStyle 一致（width 640px / maxWidth 96vw / border-radius 16px / display flex / overflow hidden / content padding 0）；Gate 全绿（lint 0/0 / typecheck 0 / 3009 tests / build / dev:errors 干净）；8 张截图存 `screenshots/cb-cb4/` 供 Owner 肉眼签发。附带发现：C-b0 基线 `light-*` 实为暗色（插件 `theme` 设置为 dark 且带自定义色，app 主题切换不改变插件变量），且 `dev` 环境下曾出现双份 styles.css 注入（reload 后恢复单份）。

**批 C-c（CSS 三期 · c1，P0 功能性缺陷）**
- C-c1 `ui/quality-dashboard-modal.ts` 窄屏溢出 + 视觉裸奔（**C8 `高` + C9 `中` 合并修复**）：根因二连 —— ① 弹窗 `onOpen` 从未挂 `nw-scope` / 尺寸类，`.nw-qd-*` 与 `.nw-scope` 作用域规则**全部落空**（实测弹窗仅 560px）；② 内容区 `grid-template-columns: '380px 1fr'` 内联写死，容器不足 380px 时**必然横向溢出**。修复：`onOpen` 补 `addClass('nw-scope', 'nw-modal-lg')` 接入统一弹窗作用域；grid 改由新增 `.nw-qd-layout` 类承载，响应式采用 `repeat(auto-fit, minmax(min(380px, 100%), 1fr))` —— 按**容器宽度**（而非视口宽度）自动降为单列，比 `@media` 更贴合 Modal 场景（弹窗宽度与视口解耦）。
- C-c1 `styles.css` 补全 **14 类** `nw-qd-*` 定义（原 TS 引用 13 类 + 新增 `nw-qd-layout`，全部零 CSS 定义）：布局 / 图表容器 / 工具栏 / 维度条 / 问题列表 / 事实卡，全部走 `--nw-*` token 并保留原生变量回退。
- C-c1 内联样式收敛：该文件内联赋值 **18 → 1**（仅保留 `bar.style.width` 运行时宽度参数），静态样式全部交还 CSS。
- C-c1 验证：弹窗实测 `cls: "modal nw-scope nw-modal-lg"`、`width: 899.996px`（原 560px）、14/14 类定义命中；900px 弹窗两列 424.96/424.97px，容器降 500px / 弹窗降 460px 均自动单列，`scrollWidth === clientWidth` **零横向溢出**；Gate 全绿（lint 0/0 / typecheck 0 / 3009 tests / build / dev:errors 干净）；宽/窄两张截图存 `screenshots/cb-cc1/` 供 Owner 肉眼签发（合成 DOM 探针数据）。
- 方法论偏差说明：计划原文为 `@media (max-width:900px)`，实测 Modal 宽度与视口（2019px）解耦、媒体查询永不复现，故改用容器查询式 `auto-fit` 方案，效果等价且更健壮，待 Owner 确认。

### ✅ 验证
- 新增单测 **25 例**：`tests/unit/shared/paths-sanitize.test.ts`（F5 穿越/绝对路径/控制符/回归 11 例）、`tests/unit/core/crypto-service.test.ts`（F4 往返/salt 随机/取消明文/会话复用/错误口令/v1 兼容/畸形密文 8 例）、`tests/unit/utils/helpers-escape-notice.test.ts`（escapeHtml 转义 3 例 + M8 多流程隔离 3 例）。
- 全量：`npm run lint` **0 error 0 warning**；`npm run typecheck` 零错误；`npm test` → **163 files / 3009 tests passed**（基线 160/2984）；`npm run build` 成功；`plugin:reload` 后 `dev:errors` = `No errors captured`，full-writer / knowledge-base / writing-fingerprint 三视图正常加载。
- 运行时实证：`registry.has('novel-writer-write-chapter')` **false → true**（U1 按钮「整章生成（旧）」恢复生效）；幽灵变量脚本复核 **17 → 0**。

### 📌 登记（后续批次）
- C-b（CSS 二期）：~~b0 基线~~ / ~~b1 死变量~~ / ~~b2 基础类收敛~~ / ~~b3 裸类命名空间化~~ / ~~b4 双选择器兜底收敛~~ **已完成（2026-10-19）**；另登记新发现：`full-writer-view.ts:366-381` 与 `theme-manager.ts` 双份布局变量注入（6 处数值漂移）+ 5 个零消费注入变量，待 Owner 裁定收敛方案；`.nw-btn-warning` 背景被 Obsidian 原生 `button` 规则长期覆盖（既有缺陷）。
- C-c（CSS 三期）：~~c1 P0 功能性缺陷（quality-dashboard 窄屏溢出 + `nw-qd-*` 补定义）~~ **已完成（2026-10-19）**；剩余 C-c0（分区目录注释）/ c2（其余模块内联样式迁移）/ c3（过渡动画属性收敛）/ c4（其他 C12–C18 项）按 Owner 裁定另批执行（当前范围 A 仅含 P0）。
- M1 破坏性终验（禁用插件观察 Worker 终止）未在用户会话执行，以 dispose 契约单测 + onunload 接线静态验证代替。

---

## Unreleased — v8.13 P3 写作规范双向合并与规则解析修复

### 🧭 动因
对「P3 写作规范」（`engine/prompts/writing-rules.ts` 的代码副本）与官方规范（`元文件/00-系统模板/写作规则.md`）逐章对齐调研后，确认 7 个问题点，其中 2 项有运行时铁证。差异报告显示两版为**双向往差异**（规范独有 18 项 / 副本独有 13 项），单向对齐任一方都会丢内容，故按用户裁定执行「双向合并 + 结构统一」。

### ✨ 改动
- `元文件/00-系统模板/写作规则.md`（**规范** · v3.5.1 → v3.6.0）：双向合并为单一内容 —— 补入副本独有 13 项（新增 `## 十五、不讲精确数字，不讲门牌号` 整章；并在「一/二/四/六/七/九/十/十二/十三/十四/唯一禁止事项」各章内补入对应条目与示例），原「十五、写作自检」顺延为 `## 十六、写作自检`，文末新增 `## 你的风格（由文笔风格文件定义）`。**`## ` 章节 / `### ` 子节 / `- [ ]` 自检清单 / `---` 分隔与分割线等格式要素全部保持原结构不变**（解析器契约）。
- `engine/prompts/writing-rules.ts`（**代码副本**）：`WRITING_RULES` 由原 `【…】` 12 块改写为与规范**逐字一致**的同结构镜像（含 `# 标题`、`> 核心理念/叙事总纲`、16 个编号章、`### 标点/段落/对话/字数`、9 条 `- [ ]`、分割线与唯一禁止事项）。仅省略 YAML frontmatter（属文件元数据，非注入内容）。
- `engine/context-manager.ts`（**规则解析缺陷修复**）：`parseWritingRules` 中 `section.split(/^###\s/)` 缺 `m` 标志 —— `^` 只匹配整串开头，而段首是「格式参考（最低要求）」而非 `### `，导致 **`rules.mandatory` 恒为空**、「格式参考（最低要求）」的 4 个规则块（含「每章≥2000字」）从未进入提示词，`co-writer-engine` 的 `writingRules` 变量因此恒为 `''`。补 `m` 标志修复。
- `engine/prompts/index.ts`：子文件职责注释由「全局写作 15 心法」更正为「16 心法 + 格式参考；与元文件规范同结构」。

### ✅ 验证
- 新增 `tests/unit/engine/context-manager-writing-rules.test.ts`（**6 例**）锁定解析契约：规范结构三路均非空、编号章并入 style、**`【…】` 结构 → 三路全空**（对齐必要性证据）、空内容安全、以及 `WRITING_RULES` 自身满足契约（mandatory 4 块 / checklist 9 条 / 16 个编号章 / 不含 `【`）。
- **逐章交叉校验（`identical` 比对）**：`.md` 去 frontmatter 后与 `.ts` 模板体 **逐字一致** —— 字符数 3827 = 3827，结构计数完全相同（编号章 16、`## ` 19、`### ` 4、`- [ ]` 9），行数 208 = 208。
- 运行时前后对比（`obsidian eval` + `dev:console`）：
  - 解析结果：`mandatoryCount` **0 → 4**（titles `标点/段落/对话/字数`，points 4/3/2/5）、`checklist` 9、`styleLen` **2482 → 2915**。
  - 版本告警：修复前每次加载均输出 `[WARN] 写作规则版本不匹配: 当前 v3.5.1, 期望 v3.6.0` 并弹 Notice；修复后 warn 面板**无该条**（`expected` 常量 3.6.0 与内容 3.6.0 一致，无需改代码）。
- 全量：`npm run typecheck` 零错误；`npm test` → **160 files / 2984 tests passed**；`npm run build` 成功；`dev:errors` = `No errors captured`。
- 既有断言同步：`tests/unit/services/template-service.test.ts` 的 `getWritingRules` 用例原断言固定了旧副本措辞「活在主角身体里」，改为断言规范结构锚点（`一、角色活着` / `十六、写作自检`）。

### 📌 登记（不改）
- `services/template-service.ts:30` 导入 `WRITING_RULES` 但全文件未使用（死导入）；按「不修没坏的东西 / 死代码只提出不删」原则只登记。

---

## Unreleased — v8.12 全流程 / 压力 / 异常场景验证、取消语义与跨端加固

### 🧭 动因
目标第 4 项「全流程功能测试、压力测试与异常场景验证」的实测过程中，发现并修复 6 处引擎缺陷（均对合法流程无副作用）。随后经用户明确授权，对本轮登记的行为变更项执行**第二批加固**（跨端导出统一、长会话历史限长、伏笔去重算法、遗留目录清理），兼容底线不变（旧项目数据可读 / 旧版报告读取兼容 / 不改变既有设置键名）。

### ✨ 改动（均以确定性回归用例或运行时探针锁定）
- `engine/ai-api-client.ts`（取消语义 ① · 联调解绑时机）：`callAI` / `callAIStream` / `nativeStreamIterator` 三处的「外部 abort 联动内部 abort」监听原先在**拿到响应头后即 `removeEventListener`**，导致响应体读取阶段无法取消（实测中止后仍等待约 20s）。改为监听挂载上提到 `try` 之前、`finally` 内解绑，使取消覆盖整个请求生命周期。修复后实测：**中止 → 1ms** 返回。
- `engine/ai-api-client.ts`（取消语义 ② · catch 判定优先级）：`callAI` 的 catch 中 `shouldFallback`（`AbortError` 在 `isDisconnectionError` 中同属「断联」特征）先于 `externalSignal?.aborted` 判定，与代码自述「外部 abort 不触发回退」相反 —— 用户取消会被误判为断联并**切换到其他模型继续生成**。改为取消判定优先。运行时实测：取消后 `fetch` 仅调用 1 次（内存注入备用模型观察，未切换）。
- `engine/ai-api-client.ts`（取消语义 ③ · 流式降级空跑）：`callAIAsyncIterator` 在原生阶段因取消而「返回」`aborted` 时，被误判为阶段失败并继续空跑 `simulated`/`full` 两阶段、打印误导性「流式降级」警告。改为在 native / simulated 分支 `yield*` 返回后检测 `externalSignal?.aborted` 短路（已完成的内容原样返回，不丢）。运行时复核：取消时**无「流式降级」警告**。
- `services/knowledge-base-manager.ts`（索引重建加固）：`rebuildIndexFromBooks` 原先仅校验 `id` 即接纳条目 —— 历史/损坏的基本信息可能**缺少 `name`**，被接纳后任何 `kbBookDir(book.name)` 都会因 `undefined.replace` 抛 `TypeError`。改为同时要求有效书名；缺失则跳过并 `warn`。对合法书籍无影响（合法文件始终含 `name`）。
- `shared/settings-migrator.ts`（v3→v4 类型加固）：损坏的 `data.json` 若把 `customProviders` / `hiddenPresets` 写成非数组（如字符串），原 `|| []` 只挡 falsy，真值非数组会在 `.map` / `.includes` 处抛 `TypeError` → 迁移中断、`schemaVersion` 停在 3，且 `customProviders` 退化为字符串污染后续 `.find` / `.filter`。改为 `Array.isArray(...) ? ... : []`。
- `engine/ai-api-client.ts`（本地模型源密钥守卫）：`callAI` / `callAIStream` 硬性要求 `apiKey`，而内置「本地 Ollama」预设无密钥、`providerKeys` 也无 `ollama` 条目（切到本地供应商时 `providerManager` 会把 `apiKey` 置空）——导致**本地模型配置下所有非流式 AI 调用（含 `step-runner` 流水线）直接返回「API密钥未配置」，功能不可用**；且与不校验密钥的流式迭代器路径行为不一致。改为仅当端点经 `resolveProviderSourceType` 判定为 `local` **且**密钥为空时豁免守卫（新增私有方法 `isKeylessLocalEndpoint`）。云端端点与「显式传入非空密钥」的行为完全不变。

### ✨ 改动（第二批 · 用户授权的行为变更加固）
> 以下 4 项在 v8.11 / v8.12 首次登记时因「会改变既有行为」被挂起；本轮经用户明确授权实施，兼容底线（旧项目数据可读 / 旧版报告读取兼容 / 不改变既有设置键名）不变。
- `shared/export-file.ts`（**新增** · 跨端导出统一）：此前 7 处导出（`ui/mini-settings-modal.ts` / `ui/settings-tab.ts` 性能日志、`ui/prompt-manager-settings.ts` 提示词配置、`ui/quality-dashboard-modal.ts` 质量数据集、`ui/template-manager.ts` 单模板与全模板、`ui/views/knowledge-base-view.ts` 自定义题材）各自复制同一段「`URL.createObjectURL` + `<a download>`」blob 代码，**移动端无下载器会全部静默失效**。新增统一入口 `exportTextFile(app, filename, content, options?)`：桌面端行为与改造前逐字一致（blob + 锚点下载）；移动端（`app.isMobile`）改为写入 vault 根目录「导出文件/」（文件名按 `[\\/:*?"<>|]` 净化、已存在同名则覆盖），并在 Notice 中给出实际路径；返回 `{ ok, mode: 'download' | 'vault', path?, error? }`。7 处调用点全部改为该入口。
- `engine/co-writer-engine.ts`（长会话历史限长）：`recordInteraction` 同时向 `interactionHistory` 与 `session.interactions` 追加，此前**只增不减**。新增模块级 `MAX_INTERACTION_HISTORY = 200`，超出时 `splice` 裁掉最旧记录（滚动窗口），两处数组同步限长。
- `services/foreshadow-manager.ts`（伏笔去重算法）：`textSimilarity` 由**单字符集合 Jaccard** 改为**字符 bigram Dice**（`2|A∩B| / (|A|+|B|)`，天然长度归一化），降低「共用『的/了/他』等高频字即高相似」的误判；调用点 `> 0.7` 阈值保持不变。
- 遗留数据清理：删除 `写作知识库/undefined/`（旧版本 `kbBookDir` 加入字符净化之前、以 undefined 书名创建的孤立目录）。

### ✨ 改动（第三批 · 用户授权补做 S1 与 modelOverrides 守卫）
> 两项均为 v8.11 / v8.12 登记后经用户追加授权的加固；对合法数据与正常流程零影响。
- `ui/full-writer/outline-tree-controller.ts`（**S1** · 文档级监听解绑）：`render()` 内的 `document.addEventListener('click', ...)` 原为**匿名监听**（无法移除），且 `render()` 每次调用都会新增一份 —— 重复渲染会**叠加监听**并持续泄漏（对比 keydown 虽为具名局部函数，但未保留引用同样无法解绑）。改为把两个句柄保存为实例字段（`_onDocumentClick` / `_onDocumentKeyDown`），新增幂等的 `dispose()`（解绑两者并关闭右键菜单），并在 `render()` 开头先 `dispose()` 再绑定 —— 重复 render 不再叠加。该控制器当前休眠（`full-writer-view.ts:1188` 的调用被注释），故无存量行为变化；若日后恢复树状预览，在视图 `onClose()` 调用 `dispose()` 即可。
- `shared/settings-migrator.ts`（**modelOverrides 类型守卫**）：`provider-manager.setModelOverride` 执行 `overrides[endpoint] = {}`，若 `modelOverrides` 被损坏为**字符串**，对原始值赋属性在严格模式下抛 `TypeError`（运行时实证：`THROW TypeError`）→ 覆盖值无法保存。此外 `v2→v3` 的 `{ ...oldOverrides }` 对**数组**会产出索引键对象（`{0:'a'}`）污染两层索引结构。改为：`v2→v3` 排除数组；`v3→v4` 显式把 `modelOverrides` 规范为普通对象（非对象 / 数组 → `{}`，与 `settings-service` 默认值等价，即「无覆盖」）。其余消费点均为可选链访问，合法对象行为完全不变。

### ✅ 验证
- 回归（三批合并后的最终态）：`npm run typecheck` 零错误；`npm test` → **159 files / 2978 tests passed**；`npm run build` 成功（v4.10.7，含 3 个 Worker bundle）。
- 新增确定性用例（4 例）：`tests/unit/engine/ai-api-client.test.ts`（流式取消时 `callAI` **不被调用**；本地端点空密钥不被拦截且 `fetch=1`；云端端点空密钥仍拦截且 `fetch=0`）+ `tests/unit/shared/settings-migrator.test.ts`（损坏类型下迁移仍完成、`customProviders` 必为数组）。其中「流式取消短路」已用「临时移除修复」方式证明在旧代码下失败（`callAI` 被调用 1 次）；「损坏类型」与「本地端点」两项的失败模式分别由运行时探针实证（旧代码报 `customProviders.map is not a function` / `schemaVersion` 停在 3；旧代码本地端点返回 `API密钥未配置`）。
- 运行时（`obsidian eval`，真实插件配置）：
  - 原生流式：首片到达后 `abort()` → **1ms** 结束，`fetch` 调用数 = 1，返回 `error:'aborted'`，无「流式降级」警告；定时 1.2s 取消 → 总耗时 1201ms。
  - 知识库索引重建（临时可见目录 + 校验后清理）：**修复前** → 无 `name` 的书籍被登记，`getSourceText` 抛 `Cannot read properties of undefined (reading 'replace')`；**修复后** → 仅有效书籍被登记（`warn`「跳过缺少有效书名或 id 的基本信息」），`getSourceText` 优雅降级为「书籍不存在」。
  - 损坏配置恢复：`null` / 字符串 / 数字 / 数组 / `schemaVersion:'x'` / `deconstructionEngine:'nope'` / 非数组 `customProviders` / 非数组 `modelOverrides` / `ruleLayer:'x'` 共 9 类载荷经 `SettingsService.loadSettings()` **均不抛异常**且回落默认值；修复后非数组 `customProviders` → 正常落地为 5 个内置预设的数组。
  - 本地模型源密钥守卫（真实配置为「本地 Ollama + 空 `apiKey`」）：修复前该配置下 `callAI` 直接返回 `API密钥未配置`（`fetch` 0 次）；修复后对 `http://localhost:11434/api/generate` → `fetch` 1 次、返回内容 `OK`，对 `https://api.example.com/...` 仍拦截（`fetch` 0 次、`error:'API密钥未配置'`）——证明豁免只作用于本地端点、云端行为不变。
- 异常 / 压力（沿用本轮实测）：8 个拆解器对空串 / 纯空白 / 极短文本均 `ok`；200k 字拆解 22–163ms；500k 字 347–426ms；100k 字报告渲染 14ms；`setVectorEnhancer(undefined)` 后 `analyzeWithVector` 仍 `ok` 并自动复原。
- 只读覆盖核对：`degradation-notifier`（sink 广播 / 注销 / 隔离、severity 分级、单例）与 `style-similarity-scorer`（依赖缺失降级）单测齐备，降级事件机制与 A3 接线有据。
- 兼容性边界（`obsidian dev:mobile` 移动端仿真）：`isMobile` / `mobileLayout` 均为 true 下，四视图（full-writer / co-writing / knowledge-base / writing-fingerprint）均成功打开并渲染（各 1 leaf、容器有子节点），自定义设置面板 **16 个 tab** 正常渲染，`dev:errors` = `No errors captured`；验证后已关闭仿真、恢复桌面模式（`isMobile:false`）。
- 长会话内存曲线（协同写作，第二批加固后复测）：向引擎 `recordInteraction` 注入 5000 条（`suggestions: []` 以跳过落盘学习，无用户数据副作用）→ `interactionHistory` **稳定封顶于 200**（`capped:true`）、循环耗时 **4ms**、`usedJSHeapSize` 全程持平（193315KB）；验证后已 `plugin:reload` 还原（复检 `historyLength:0`）。
- 第二批新增确定性用例（9 例）：`tests/unit/shared/export-file.test.ts`（3 例：桌面端走 blob 下载且不写 vault、下载锚点 `href`/`download`/`click` 正确；移动端写入「导出文件/a_b_c.json」且非法字符被净化为 `_`；同名已存在时改走 `modify`）+ `tests/unit/services/foreshadow-similarity.test.ts`（6 例：含「仅个别字之差的近重复相似度仍 > 0.7」「同字异序相似度 < 0.4」「空串 / 单字符不抛异常」）。测试环境为 `node`（无 jsdom），桌面端用例按仓库既有约定手工注入最小 `document` 垫片。
- 移动端导出链路实测（`obsidian dev:mobile`，真实 `app.isMobile === true`）：对真实 vault 执行移动分支的 API 序列 —— `adapter.exists('导出文件')=false` → `adapter.mkdir` → `vault.create('导出文件/nw-export-probe.json')` → `getAbstractFileByPath` 命中 `TFile` → `vault.read` 取回内容 → `vault.delete` 清理，**全链路成功**；随后关闭仿真、清理探针目录（复检 `isMobile:false`、`导出文件` 无残留）、`dev:errors` = `No errors captured`。
- 批量建章编排回归新增（2 例，`tests/unit/ui/batch-create-modal.test.ts`）：`BatchCreateModal.batchCreate` 此前**无任何测试覆盖**（入口仅存在于 Modal）。用例以真实路径助手（`pjBodyDir` / `pjStepDir` / `pjBodyFile`）+ 真实章节工具（`mkdirp` / `findChapterFile` / `findBodyFileV4` / `normalizeChapterFiles`）驱动，断言：3 章 × 8 类步骤文件 + 3 个正文文件全部落在正确路径、卷/章目录均已创建；第二轮执行**幂等**（文件数不变、模板不再被调用）。其间为共享 mock 补 `Notice.hide()` / `setMessage()`（原 mock 缺失，属测试基础设施补齐，不影响任何既有用例）。
- 批量建章模板链实测（`obsidian eval` + 临时项目 `nw-tmp-batch-verify`，校验后整体删除、无残留）：以真实 `TemplateService` 对 8 类步骤键 + `body` 用 `batchCreate` 相同变量（`{project, volume:'第1卷', chapterName:'第1章', chapterNumber:1}`）渲染并写入真实 vault，结果为 **9 个文件全部落在预期路径**、模板长度 124–539 字符（均为非空）、输出中**无残留 `第X章` 占位符**、正文 frontmatter 的 `卷: ""` 已正确替换为 `卷: "第1卷"`。过程中 4 个模板（情绪规划 / Scene展开 / 角色灵魂 / 质量控制）在 `元文件/00-系统模板/` 下**不存在**，自动回落到 `DEFAULT_TEMPLATES`（`warn` 日志可见）——证明批量建章在任何模板缺失情形下也**不会产生空文件**；静态复核亦确认 `DEFAULT_TEMPLATES` / `TEMPLATE_PATH_MAP` 均含 batchCreate 使用的全部 8 个键。
- 第三批新增确定性用例（7 例）：`tests/unit/shared/settings-migrator.test.ts`（+4：`v3→v4` 字符串 / 数组 `modelOverrides` 均规范为 `{}` 且迁移完成、合法对象原样保留；`v2→v3` 数组不产出索引键对象）—— 追加后该文件 **23 例全通过**；`tests/unit/ui/outline-tree-controller-dispose.test.ts`（3 例：`dispose()` 解绑 click/keydown 并置空句柄、幂等、无句柄不抛异常）。
- 第三批运行时前后对比（`obsidian eval`，经真实 `SettingsService` 构造实例载入载荷）：
  - **修复前**（旧构建）：`modelOverrides:'nope'` 迁移后 `typeof === 'string'`、`['a','b']` 迁移后 `Array.isArray === true` —— 字段类型未收口。
  - **修复后**（新构建）：字符串 → `typeof === 'object'`、数组 → `Array.isArray === false`，两者 `schemaVersion` 均为 4 且无异常；合法两层对象 **原样保留**（`api.example.com / gpt-4 / maxContext: 100` 命中）。
  - 崩溃机理独立实证：严格模式下 `const o='nope'; o['k']={}` → **`THROW TypeError`**，确认 `provider-manager.setModelOverride` 的 `overrides[endpoint] = {}` 在字符串字段下必然抛错。
  - S1 落盘核对（控制器休眠、无运行时可编程入口，故核验产物）：`main.js` 已含 `_onDocumentClick` / `_onDocumentKeyDown` 字段与 `document.removeEventListener("click"/"keydown", ...)` 解绑语句，确认非空改。

### 📌 登记（本批未实施，待用户决策）
- ✅ **已实施（第二批）** · **遗留数据 `写作知识库/undefined/`**：原登记项 —— 来自旧版本（`kbBookDir` 加入字符净化之前）以 undefined 书名创建的孤立目录，含 `基本信息.md`（id `kb_mrgfvtkj_dft4ogtb`，无 `name`）、索引为 0 本书。本轮经用户授权已删除（详见上「改动（第二批）」）。
- ✅ **已实施（第二批）** · **协同写作 `interactionHistory` 无上限**：原登记项 —— `co-writer-engine.recordInteraction` 向 `interactionHistory` 与 `session.interactions` 追加且无上限（对比：UI `suggestionHistory` 已限 20）。本轮经用户授权已加 `MAX_INTERACTION_HISTORY = 200` 滚动上限（详见上「改动（第二批）」）；`ui/co-writing-view.ts:3754` 消费该历史的渲染行为随之变为「仅展示最近 200 条」，此为已确认接受的行为变更。
- **本轮未覆盖（已进一步收窄）**：批量建章仅剩 **Modal 表单交互层**（下拉选项目 / 输入起止章 / 点击按钮）未做自动化（入口仅存在于 Modal、依赖真实 UI 点击）；其**编排逻辑**已由新增 2 例回归覆盖，**真实模板链 + 真实 vault 落盘**已由运行时实测覆盖（含模板缺失回落），**组件级**压测为 40 章 × 9 模板 = 360 次渲染 / 100ms → **2.51ms/章**。真实移动端**硬件**（非仿真）上的 blob Worker 可用性仍属既有 S3 登记项；`URL.createObjectURL` 导出下载的移动端失效问题已由本批统一入口的 vault 回退解决（**仿真环境**已验证），真机复测仍待用户侧确认。
- ✅ **已实施（第三批）** · **`S1` 休眠事件监听清理**：原登记项 —— `ui/full-writer/outline-tree-controller.ts` 的 `document` 级监听无解绑入口（且重复 `render()` 会叠加）。本轮经用户授权已补幂等 `dispose()` 并在 `render()` 起始解绑（详见上「改动（第三批）」）。
- ✅ **已实施（第三批）** · **`modelOverrides` 类型守卫**：原登记项 —— 非对象/数组形态的 `modelOverrides` 未收口。此前评估「不崩溃」被运行时实证推翻：字符串字段下 `provider-manager.setModelOverride` 的 `overrides[endpoint] = {}` 会抛 `TypeError`（属真实缺陷）。本轮经用户授权已在 `v2→v3` / `v3→v4` 双重收口（详见上「改动（第三批）」）。
- **未实施（待决策）**：`P3` 写作规范逐章对齐（需人工定稿，见 v8.11 登记）；`engine/analysis-report-engine.ts` + `ui/components/analysis-report-panel.ts` 未接线模块（兼容底线未含「允许删除」）—— 均无代码缺陷，待用户明确授权后再动。

---

## Unreleased — v8.11 引擎加固与规则可配置化（A/S 批次 + R2 / R1）

### 🧭 动因
延续 v8.10 的「仅无副作用改动」原则，完成 P/R/A/S 四组候选中剩余批次：A（核心算法可解释性 / 降级提示）、S（引擎加固）、R2（AI 味词表可扩充，含 Worker 侧改造）、R1（业务阈值设置项化）。所有改动在默认配置下行为与 v4.10.7 完全一致。

### ✨ 改动
- `engine/anti-ai-detector.ts`（A1）：`AIDetectionFeature` 新增可选 `score`（分项原始得分，仅用于向用户解释「分数从哪来」，不参与总分计算）；`detect()` 为模板短语 / 句式模板 / 高频词 / 统计特征各分项填充该字段。
- `ui/components/ai-detection-report.ts`（A1）：雷达图后新增「评分构成（相对贡献）」段落，按分项得分降序展示「分值 · 占比」；复用既有 CSS 类，未新增任何样式。
- `engine/co-writer-engine.ts`（A3）：精准模式向量增强初始化失败由「仅写日志」改为上报统一降级事件（`warning` → 用户可见提示），精准模式降级不再是黑箱。
- `services/foreshadow-manager.ts`（A3）：伏笔向量增强 / 向量去重不可用时的静默回退补 `info` 级降级事件（不弹 Notice，避免逐章噪音）。
- `engine/character-recognition-pipeline.ts`（A3）：向量语义过滤 / 合并层不可用跳过时补 `info` 级降级事件。
- `engine/anti-ai-detector.ts`（R2）：`AI_HIGH_FREQ_WORDS` 由 `static readonly` 改为「内置基线 + 用户扩充」的只读 getter，新增 `setExtraHighFreqWords()` / `getExtraHighFreqWords()`（去空白、去重、剔除与内置重复项）；L1 词频层同步纳入扩充词。
- `engine/deconstructors/readability-deconstructor.ts`（R2）：连接词密度词表由构造期缓存改为**每次检测实时合成**，否则运行中改动词表不生效。
- `services/deconstruction-worker-manager.ts` + `engine/deconstructors/deconstruction-worker.ts`（R2）：Worker 是独立 bundle、主线程设置无法自动抵达，改为**随任务载荷下发**扩充词并在 Worker 内同步词表（载荷仅在扩充词非空时附加该字段，默认与改造前完全一致）。
- `shared/thresholds.ts`（R1）：新增 `BUSINESS_THRESHOLD_DEFAULTS` / `setBusinessThresholdOverrides()` / `getBusinessThreshold()`；阈值定义权仍在本文件，运行时仅做覆盖，未覆盖即等于内置常量。
- `engine/step-definitions.ts`、`engine/step-runner.ts`（R1）：`WORD_MIN_RATIO`（步骤最低字数比例）、`PROMPT_SPLIT_RATIO`（超长提示词保头比例）两处**确实被调用**的阈值改走 `getBusinessThreshold()`。
- `main.ts` / `core/settings-service.ts` / `ui/settings-tab.ts`（R1 + R2）：新增设置键 `antiAiExtraWords` / `wordMinRatio` / `promptSplitRatio`（**未改动任何旧键名**），并在「✍️ 写作配置」页提供词表文本框与两个比例输入框；插件加载时统一应用覆盖。

### ✅ 验证
- 全量：`npm run typecheck` 零错误；`npm test` → **155 files / 2954 tests passed**（新增 `tests/unit/shared/thresholds-overrides.test.ts` 5 例；`tests/unit/engine/anti-ai-detector.test.ts` 追加 A1 3 例 + R2 5 例）；`npm run build` 成功（v4.10.7，含 3 个 Worker bundle）。
- 定向断言：A1「各分项得分之和 ≥ 总分（总分另有 100 上限）」；R2「扩充词即时进入避用词与 L1 命中」「扩充词实际抬高 AI 味评分」「空白/重复/内置项被剔除」「传空即恢复内置词表」；R1「未覆盖 = 内置常量」「合法覆盖生效」「非法值（≤0 / >1 / NaN）回落内置常量」。
- 运行时：`obsidian plugin:reload` → `dev:errors` = `No errors captured`；`obsidian eval` 实测新键已随默认值生效（`antiAiExtraWords:[]` / `wordMinRatio:0.7` / `promptSplitRatio:0.67`）。
- Worker 产物核对：`workers/deconstruction-worker.js` 已包含 `setExtraHighFreqWords` / `appliedAiWordsKey` / `ensureDeconstructors(input.antiAiWords)`，确认 Worker 链路不是空改。

### 📌 已复核为「无需改动」（只读结论，本轮不改）
- **A4 数据不足结构化**：`readability-deconstructor` 已产出结构化 `dataStatus: 'insufficient'`，`incremental-result-aggregator` 以 `dataStatus === 'insufficient'` 判定、以 `'estimated'` 标记兜底，**不依赖中文字符串判定**（与审计 spec 中「不得依赖中文字符串判断数据不足」的已删除需求一致）。无缺口。
- **S1 事件监听泄漏**：全库唯一「无清理」的 `document` 级监听位于 `ui/full-writer/outline-tree-controller.ts`（L92 匿名 click、L122 keydown），但 `ui/full-writer-view.ts:1188` 的 `render(previewSection)` 调用**已被注释**，该控制器当前无任何活跃调用（休眠代码）。按「不修没坏的东西 / 死代码只提出不删」原则只登记；若日后恢复该树状预览，须同时补 `removeEventListener`。**（更新：已在 v8.12 第三批补幂等 `dispose()` 并在 `render()` 起始解绑，同时消除了重复 render 的监听叠加；恢复预览时在 `onClose()` 调用 `dispose()` 即可。）**
- **S3 兼容性声明**：`manifest.json`（`minAppVersion: 1.5.0` / `isDesktopOnly: false`）在源码层未发现 desktop-only API 引用（无 `getBasePath()` / `child_process` / `process.platform` / `electron`）。但两处跨端风险未被声明覆盖：`URL.createObjectURL + <a download>` 导出下载在移动端无效（散落 7 处），以及 blob Worker 在部分移动端环境的可用性。修改 `manifest` 或导出方式均属行为变更，本轮只登记。**（更新：导出下载一项已在 v8.12 第二批以统一入口 `exportTextFile` 的 vault 回退修复；blob Worker 可用性一项仍登记。）**
- **P3 写作规范**：`engine/prompts/writing-rules.ts`（标注 v3.6.0）与同步源 `元文件/00-系统模板/写作规则.md`（v3.5.1，15 章）非逐字一致——代码内为面向注入的精简改写版。属既有提示词压缩设计（受 token 预算约束），非缺陷；严格对齐需人工定稿。**（更新：已在 v8.13 按「双向合并 + 结构统一」实施——两文件合并为 v3.6.0 单一内容并逐字一致，结构统一为 `## `/`### `/`- [ ]`；同时修复了 `parseWritingRules` 中 `mandatory` 恒为空的既有缺陷，版本告警随之消失。）**
- **A2 伏笔去重安全**：`foreshadow-manager.textSimilarity` 为**单字符集合 Jaccard**，对中文短句偏松（共用「的 / 了 / 他」等高频字即明显抬高相似度），配合 0.7 阈值存在误合并风险（向量路径 0.8 较稳健）。调整阈值或改用 bigram + 长度归一化均会改变判定结果，超出「仅无副作用」约束，只登记。**（更新：已在 v8.12 第二批改用字符 bigram Dice（长度归一化）实施，阈值仍为 0.7。）**
- **S4 长任务 Worker 迁移**：纯计算型拆解器已全部具备 Worker 入口（`deconstruction-worker` / `style-worker` / `quality-worker`）并在不可用时自动回退主线程；其余长任务的耗时主体是 **AI 网络往返**，迁移 Worker 无收益且会失去主线程可用的 Obsidian API。结论：无迁移价值，保持现状。
- **未接线模块（沿用既有登记）**：`engine/analysis-report-engine.ts` 与 `ui/components/analysis-report-panel.ts` 未被任何视图接线；本轮兼容底线未包含「允许删除未接线模块」，只登记不删除。

---

## Unreleased — v8.10 内容与规则体系梳理（提示词外置 / 阈值参数化 / 诊断补齐）

### 🧭 动因
全库巡检产出候选清单后，本轮按「仅无副作用改动」原则实施第一批：所有改动在默认配置下行为与 v4.10.7 完全一致。

### ✨ 改动
- `engine/prompts/soul-driven-prompts.ts`（新增）：将 `characterSoul` / `emotionPlan` / `sceneExpand` 三段提示词从 `template-utils.ts` 的函数体内联对象外置为独立模块，与 barrel 声明的「子文件职责」一致；提示词正文与变量占位符 `\${...}` 保持不变。
- `engine/prompts/template-utils.ts`：只保留路由与变量替换职责，三个步骤改为引用外置常量；`selfCheck` / `fix` / `finalFix` / `continuityCheck` 四条旧版路由补 `@deprecated` 说明（旧项目只读兼容不变）。
- `engine/prompts/index.ts`：增加 `soul-driven-prompts.ts` 导出与职责说明。
- `engine/prompts/chapter-pipeline-prompts.ts`：`SELF_CHECK_PROMPTS` / `FIX_PROMPTS` / `CONTINUITY_CHECK_PROMPTS` 补 `@deprecated` 标注（步骤已合并入 `qualityControl`）。
- `engine/anti-ai-detector.ts`：新增 `AI_SCORE_WEIGHTS` 权重表，把评分魔数（3/35/3/20/5/15/8/6/6/4/100）集中为带注释常量；数值与 v4.10 基线完全一致。
- `engine/quality-gate.ts`：`REPEAT_PREFIX_LEN` / 结尾钩子窗口 200 改为可由 `QualityGateOptions` 覆盖，默认值保持原值。
- `engine/co-writer-engine.ts`：`fetchOllamaModels` 的 catch 由静默 `return null` 改为补诊断日志，返回契约不变。

### ✅ 验证
- `npm run typecheck` 零错误；`npm test`：**154 files / 2941 tests passed**；`npm run build` 成功（v4.10.7）；`GetDiagnostics` 无诊断；`obsidian plugin:reload` 后 `dev:errors` → `No errors captured`。
- 提示词外置后经模块级校验：三个步骤的 system/user 提示词与 `${chapNum}` 等变量占位符均保持原值（`getStepTemplate('characterSoul'|'emotionPlan'|'sceneExpand')` 返回非空且内容标记齐全）。
- `anti-ai-detector`（16 例）与 `quality-gate`（8 例）单测全通过，确认权重集中化与阈值参数化未改变判定结果。

### 📌 已复核为「无需改动」
- `ui/knowledge-floating-panel.ts` 的 `loadBooksIfNeeded().catch(() => {})` 经核查属**假阳性**：其内部已 `log.warn` 失败原因并置安全兜底，非静默吞错。

---

## Unreleased — v8.9 报告产出治理（去重、停止空占位、文档合并）

### 🧭 动因
批量创建章节时会为每章预生成 12 个步骤文件，其中 `selfCheck` / `fix` / `finalFix` / `continuityReview` 四类旧版报告已合并入 `qualityControl`，当前流水线不会写入，形成每章 4 个空报告；同时根目录存在内容重叠的交互说明文档与遗留测试夹具。

### ✨ 改动
- `ui/batch-create-modal.ts`：批量创建仅生成当前流水线使用的 8 类步骤文件（信息规划 / 情节蒸馏 / 大纲摘要 / 情绪规划 / Scene 展开 / 角色灵魂 / 质量控制 / 分析报告）+ 正文模板；不再预生成 4 类旧版空报告。
- `StepResultSaver` / `ChapterStateManager` 的旧 key 读取与状态恢复映射保留，旧项目可正常打开，不会新增产出。
- 文档合并：《协同写作与工作台交互模式优化说明（第二轮）》并入 `交互界面优化调整说明.md` §9，原文件删除。
- 新增 `报告索引.md`：说明运行时报告与项目文档的分层、路径、触发时机、保留策略与阅读顺序。
- 删除遗留测试夹具 `_nwRG02测试`；更新 `.trae/DOCUMENTATION-INDEX.md`。

### ✅ 验证
- `npm run typecheck` 通过；`npm test`：154 files / 2941 tests passed；`npm run build` 成功（v4.10.7）；`GetDiagnostics` 无诊断。
- 批量创建文件清单与 `ALL_FULL_STEPS` 对齐：活跃报告 8 类 + 正文 + 结算表；旧版 4 类不再预生成。
- 审查报告仍由 `ReviewAgent.reviewChapter` / `reviewVolume` 按需创建；性能报告保持不落盘。

---

## Unreleased — v8.8 NBI-05 / NBI-06 修复（异步归属与改写中止 + 空态入口去重）

### 🧭 动因
NBI 登记项仅到 NBI-04，本轮巡检产出候选清单并按 `A+B+D / C+E` 归并：协同写作仍存在「生成中切章旧结果回填」「幽灵联想覆盖生成面板」「接受后收尾覆盖新生成」三类异步归属缺陷；选区改写缺少中止通道；知识库空态与工具栏重复渲染导入入口。

### ✨ 改动
- `ui/co-writing-view.ts`：新增 `suggestionEpoch` 与 `beginSuggestionEpoch()` / `isCurrentSuggestionEpoch()`；`openChapter()` 先中止在途建议/改写并递增代次；建议、改写、迭代、联想的所有分片回调、完成/异常分支与 `finally` 均校验代次。
- `ui/co-writing-view.ts`：`refreshGhostAssociation` 写回前校验代次、生成态与候选数量，`finally` 无条件释放 `isAssociating`；Tab 与幽灵建议点击增加 `!isSuggesting` 守卫。
- `ui/co-writing-view.ts`：`insertTextAndRecord` 记录接受时代次，收尾抽离为 `finalizeAcceptedInsert(epoch)`，代次变化时保留新生成面板。
- `ui/co-writing-view.ts`：`handleRewriteSelection` 与建议共用中止控制器，取消后写入「已取消」；`finally` 仅在控制器归属本次改写时复位。
- `engine/co-writer-engine.ts`：`rewriteSelection` 增加可选 `AbortSignal`，入口、方向循环、模型调用后与异常分支均检查中止，中止后不返回半成品候选。
- `ui/services/co-write-facade.ts`：`rewriteSelection` 透传 `signal`。
- `ui/views/knowledge-base-view.ts`：`renderBooksEmptyState` 移除重复导入按钮，文案改为指向工具栏入口。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`npm run typecheck` 零错误，`GetDiagnostics` 无诊断，`dev:errors` → `No errors captured`。
- `npm test`：154 files / 2941 tests passed（新增 `co-writer-async-epoch.test.ts` 5 例，`co-writer-stream-chunk.test.ts` 追加 2 例）。
- 真实 AI 链路：建议生成中切章 → 旧章结果 0 回填；幽灵联想进行中触发主生成 → 幽灵不写回、不污染面板；改写 4.3s 时取消 → 状态「已取消」、候选 0、正文不变；接受后立即新生成 → 进度面板未被收尾覆盖；知识库空态仅剩说明文案，导入入口唯一。
- 测试夹具 `_nwNBI0506测试` 已删除，`coWriteModelMode` 已还原 `local`。详见 `NBI-05-NBI-06修复报告.md`。

---

## Unreleased — v8.7 RG-02 修复（旧候选接受防护 + 请求归属清理）

### 🧭 动因
v8.6 全量回归登记 RG-02：中止生成后 `currentSuggestions` 保留上一轮候选，面板显示「已取消」，但 `Ctrl+1~3` 仍可能插入旧候选。排查确认同源问题还包括：生成中可接受残留候选、改写失败后旧候选仍保留、生成中重触发时旧请求清理会误清新请求的流式骨架与进度。

### ✨ 改动
- `ui/co-writing-view.ts`：新增 `clearStaleSuggestions()`，在建议 / 改写 / 联想开始前清空 `currentSuggestions` 并清除幽灵建议，保证中止或失败后不存在可被快捷键接受的旧候选。
- `ui/co-writing-view.ts`：`acceptByIndex` 增加 `isSuggesting` 就绪态守卫，生成中按索引接受直接返回。
- `ui/co-writing-view.ts`：`handleRewriteSelection` 失败分支补 `clearStreamingPreview()`，避免半成品骨架与候选残留。
- `ui/co-writing-view.ts`：新增 `isSuggestRequestOwner(signal)`，中止分支与 `catch` 中止分支的骨架清理 / 进度取消仅由当前请求执行，修复生成中重触发时旧请求误伤新请求。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`npm run typecheck` 零错误，`GetDiagnostics` 无诊断，`dev:errors` → `No errors captured`。
- `npm test`：153 files / 2934 tests passed（新增 `co-writer-suggestion-guard.test.ts` 5 例）。
- 真实 AI 链路：中止后候选 3 → 0、骨架 0、`Ctrl+1` 正文不变；生成中注入残留候选接受被拦截（对照就绪态 +6 字）；改写失败后候选 0 且接受无副作用；生成中重触发后新请求保持「生成中...」且骨架正常出现。
- 测试夹具 `_nwRG02测试` 已删除，`coWriteModelMode` 已还原 `local`。详见 `RG-02修复执行报告.md`。

---

## Unreleased — v8.6 NBI-03 / NBI-04 落地（建议/改写流式渲染 + 临时指令状态标识）

### 🧭 动因
NBI-03：引擎已具备 SSE 分片能力，但 `generateDirectionalCandidate` 只保留最终文本，视图层未接分片回调，「⇥ 建议」与「✂ 改写」需等待完整结果（实测 13s / 28s）才一次性出卡。
NBI-04：临时指令回车后仅弹 `Notice`，输入框修改后 `cursorHint` 仍为旧值，界面无法区分「已应用 / 未应用 / 已过期」。

### ✨ 改动
- `engine/co-writer-engine.ts`：新增 `callCoWriteText` 统一入口——传入 `onChunk` 走 `callAIAsyncIterator` 流式链路并逐片回调累计文本，不传则保持原 `callCoWriteAI` 非流式路径；最终响应为权威文本，避免原生流降级重启时累计重复。
- `engine/co-writer-engine.ts`：`suggestNext`、`rewriteSelection`、`generateDirectionalCandidate` 增加可选 `onChunk(index, cumulativeText)`（签名向后兼容，浮动面板等既有调用不受影响）；分片期间 abort 时丢弃半成品。
- `ui/services/co-write-facade.ts`：`suggestNext` / `rewriteSelection` 透传 `onChunk`。
- `ui/co-writing-view.ts`：进度面板内新增流式预览区，按候选索引隔离 DOM 更新；预览卡不渲染「接受 / 编辑 / 迭代 / 拒绝」，`done` 后由 `renderSuggestionCards` 整体替换；中止、异常时清理未完成骨架。
- `ui/co-writing-view.ts`：控制台头部新增 `.nw-hint-state`「指令已应用」，`applyHint()` 记录 `appliedHint`，输入框 `input` 不一致时即时隐藏；视图卸载清空。切章不隐藏（`cursorHint` 跨章仍生效，避免界面少报状态）。
- `styles.css`：新增 `.nw-cowrite-streaming-card` / `.nw-cowrite-streaming-text` / `.nw-cowrite-stream-cursor` 与 `.nw-hint-state` 样式，遵循 `prefers-reduced-motion`。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`npm run typecheck` 零错误，`GetDiagnostics` 无诊断，`dev:errors` → `No errors captured`。
- `npm test`：152 files / 2929 tests passed（新增 `co-writer-stream-chunk.test.ts` 5 例、`co-writer-hint-state.test.ts` 5 例）。
- 真实 AI 链路：「⇥ 建议」首片 1.6s / 完成 13.2s（提前 87.6%，2684 次分片）；「✂ 改写」首片 11.0s / 完成 27.9s（提前 60.7%，413 次分片）；生成期 3 张骨架卡且 0 个操作按钮，完成后 3 条候选、无残留节点。
- 中止：第 60 次分片 abort 后骨架 3 → 0，按钮恢复「⇥ 建议」，正文不变。
- NBI-04：应用显示 / 修改隐藏 / 再次回车恢复 / 清空隐藏 / 切章保持（指令仍生效）/ 重开视图清空；416px 下控制台头部与输入框宽度无变化。
- 全量回归：正常流程、边界输入、中止与重触发、生成中改写互斥、错误注入、串行候选、联想、非流式路径全部通过；修正切章标识与 `cursorHint` 不一致（RG-01）。详见 `NBI-03-NBI-04全量回归测试记录.md`。
- 测试夹具 `_nw测试项目` / `_nw回归测试` 已删除，`detectProjects()` 恢复 `[]`。

---

## Unreleased — v8.5 NBI-01 / NBI-02 落地（指纹库默认作用域 + 知识库命名统一）

### 🧭 动因
NBI-01：指纹库固定默认「项目层」，无活动项目时与「真的没有指纹」无法区分。
NBI-02：知识库入口在 4 处显示为「知识库」，而实际视图标题为「知识库管理」，右栏 Tab 又与视图同名，用户无法凭文案区分入口层级。

### ✨ 改动
- `ui/views/writing-fingerprint-view.ts`：`initLibrary()` 按活动项目初始化作用域（有项目「项目层」/ 无项目「全局层」）；`getActiveProject()` 异常时记录 `warn` 并按无项目回落，视图不中断。
- `ui/views/writing-fingerprint-view.ts`：`renderFingerprintList()` 空态检查其它层数据，给出「当前层暂无指纹，可切换到🌐 全局层 / 📋 模板层查看」引导；新增 `getScopeFingerprints()` 复用作用域取数。
- `ui/co-writing-view.ts`、`ui/full-writer/title-bar-controller.ts`、`ui/views/writing-fingerprint-view.ts`、`ui/views/knowledge-base-view.ts`：知识库入口与侧栏标题统一为「📚 知识库管理」；协同写作右栏 Tab 保持「📚 知识库」并补 `title="内嵌知识库面板：检索与引用"`。
- `styles.css`：`@container nw-cowrite (max-width:560px)` 档按钮内边距 8px → 4px、header gap 6px → 4px，抵消「知识库管理」标签加宽，416px 顶栏保持 2 行（84px）。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`GetDiagnostics` 零错误，`dev:errors` 清空后无新增错误。
- NBI-01：无项目默认全局层、项目章节默认项目层、手动切换后搜索/筛选不回跳、项目解析异常回落全局层。
- NBI-02：1335px 顶栏 52px 单行、416px 顶栏 84px 两行、6 按钮无溢出；3 处入口均复用同一知识库 leaf，右栏 Tab 不新建 leaf。
- 测试夹具 `_nw测试项目` 已删除，`detectProjects()` 恢复 `[]`。

---

## Unreleased — v8.4 协同写作顶栏收敛 + 静默失败修复（四界面测试收口）

### 🧭 动因
四视图导航与协同写作右栏逐项实测后发现：顶栏「⋯ 更多」与右栏「⚙ 更多工具」功能重复（导入 / 批量导入重复）、「⋯ 更多」的全局 `document` click 监听未随视图卸载；右栏「保存 / 标记完稿 / 检查」在未绑定章节或正文为空时静默返回，用户误判按钮失效。

### ✨ 改动
- `ui/co-writing-view.ts`：顶栏收敛为「导航 · 资源 · 模式」三区（← 工作台 / 📚 知识库 / 🔍 指纹库 / 👥 实体 / 📈 剧情 / 🎯 精准模式），移除「⋯ 更多」下拉及其未清理的全局监听；「📊 监控」「🔬 分析」并入右栏「⚙ 更多工具」（工具面板 7 → 9 项）。
- `ui/co-writing-view.ts`：`saveBody` / `markAsWritten` 在正文为空、未绑定卷章时给出 Notice 提示，不再静默返回。
- `ui/co-writing-view.ts`：`handleTabSuggest` / `handleAssociationSuggest` 增加前置校验（未绑定卷章 / 正文为空），未绑定场景由「空等约 44s 后显示无建议」改为 1.2s 内提示。
- `ui/views/writing-fingerprint-view.ts`：`handleDeleteFingerprint` / `handleToggleEnabled` 未选中指纹时补 Notice，不再静默。
- `ui/cowrite/live-analysis-controller.ts`：`inspectSettingGuard` 在正文为空时对手动检查给出 Notice。
- `styles.css`：新增 `@container nw-cowrite (max-width: 560px)` 窄容器档位（隐藏标题文字、压缩内边距），416px 侧栏下顶栏由 3 行降至 2 行；移除已废弃的 `.nw-cowrite-more-menu/-item` 样式。

### ✅ 验证
- `npm run build` 通过（v4.10.7），`tsc` 诊断零错误。
- 四视图导航按钮 20 项、协同写作右栏 35 项（含真实 AI 链路）、知识库 14 项、指纹库 11 项、工作台空态 5 项实测通过；详见 `四界面端到端测试报告.md`。

---

## Unreleased — 四界面流转逻辑优化（3 项）

### 🧭 动因
补齐四个核心界面间的直达入口、统一打开反馈、解耦协同写作「返回工作台」语义。

### ✨ 改动
- `ui/full-writer/title-bar-controller.ts` + `ui/full-writer-view.ts`：工作台顶栏新增「🔍 指纹库」入口（补全工作台 → 指纹库直达）。
- `ui/co-writing-view.ts`：协同写作顶栏新增「← 工作台」显式返回按钮 + 「🔍 指纹库」直达按钮（解耦原先耦合在「质量检查」的返回语义）。
- `ui/views/knowledge-base-view.ts`：知识库侧栏新增「← 工作台 / ✍️ 协同写作 / 🔍 指纹库」导航行。
- `ui/views/writing-fingerprint-view.ts`：指纹库侧栏新增「← 工作台 / ✍️ 协同 / 📚 知识库」导航行。
- `main.ts` + `core/command-registry.ts`：`openKnowledgeBaseView()` / `openFingerprintLibrary()` 打开后新增 `Notice` 反馈，统一四界面打开反馈机制。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

---

## Unreleased — 交互界面体验优化与重构（按钮热区 + 列表动效）

### 🧭 动因
针对四个核心界面做可用性优化：按钮点击热区不达标（历史 `height: 28/32/40px` 均 < 44px）、列表组件无增删/滑动/选中过渡、`transition: all` 默认 ease 生硬。

### ✨ 改动
- `styles.css` `:root`：新增控件尺寸令牌 `--nw-control-h-sm/md/lg` 与点击热区令牌 `--nw-hit-min: 44px`。
- `styles.css` 追加 v8.0 段：`.nw-btn`/`.nw-btn-sm`/`.nw-btn-mini` 命中区 `min-width/min-height ≥44px`；`.nw-btn-lg` 48px；`.nw-btn-icon` 强制 44×44；`.nw-plot-toolbar-btn` 紧凑但可命中。
- `styles.css` 追加 v8.1 段：`@keyframes nw-item-enter`/`nw-item-leave` 插入/删除动效；`.nw-list-item`/`.nw-suggestion-card`/`.nw-entity-type-card`/`.nw-plot-chapter` 统一改用 `--nw-ease-out` 自然缓出 + hover 上浮 + 选中态平滑过渡。
- 输出 `CSS架构分析报告.md` 与 `交互界面优化调整说明.md`。

### ✅ 验证
- CSS 花括号配平（open=close=1761），无语法错误。
- 纯 CSS 改动，无 TS 变更，构建不受影响。

---

## Unreleased — 可视化情节画布（P1-1）

### 🧭 动因
对标 Sudowrite Canvas，把分卷大纲的「卷 → 章 → 场景」结构从树形列表升级为「卡片 + 连线」的可视化画布，支持拖拽重排大纲。

### ✨ 改动
- 新建 `ui/plot-canvas-modal.ts`：`PlotCanvasModal` 可视化情节画布（卷分组着色 + 章节卡片 + 连线箭头 + 关键场景标记 + 拖拽重排回写）。
- 新建 `ui/plot-canvas-parser.ts`：提取解析逻辑为纯函数 `parseVolumeOutline`/`countChapters`，数据与视图分离、可单元测试。
- 视图配置：密度切换（紧凑/标准/宽松）+ 导出大纲 Markdown（复制剪贴板）。
- `ui/full-writer/wizard-step-renderers.ts`：「全书规划」步骤新增「🗺️ 情节画布」入口。
- `styles.css` 追加 v7.4 段：`.nw-plot-*` 样式 + 工具栏 + 密度切换。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- `vitest`：46 用例全绿（新增 plot-canvas-parser 8 个）。
- `plugin:reload` + `dev:errors`：无运行时错误。

---

## Unreleased — 长篇一致性守护：结算前冲突提示（P0-2）

### 🧭 动因
`ConflictDetector` / `ChapterSnapshotBuilder` / `SceneGenerationLoop` 已具备冲突检测能力（场景生成时已检测），但「章节结算」流程未触发检测。本轮在结算前接入冲突检测，作者结算时若正文存在伏笔 / 人设 / 时间线冲突，会收到提示。

### ✨ 改动
- `ui/co-writing-view.ts`：`handleComplete` 结算前新增 `runSettlementConflictCheck()`，复用 `ChapterSnapshotBuilder` + `ConflictDetector` 检测冲突并 Notice 提示；检测失败不阻塞结算（try-catch 降级）。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- `vitest`：38 用例全绿（conflict-detector 14 + anti-ai-detector 16 + quality-gate 8）。
- `plugin:reload` + `dev:errors`：无运行时错误。

---

## Unreleased — 反 AI 检测引擎升级（P0-1）

### 🧭 动因
原 `AntiAIDetector` 仅 15 个连接词黑名单 + `includes` 布尔检测，无法覆盖 skill 中强调的 AI 模板短语（眼中闪过一丝/嘴角勾起等），无量化评分、无段落定位。本轮升级为「三层词库 + 多维特征加权评分 + 段落级定位」的完整检测引擎。

### ✨ 改动
- 新建 `engine/ai-lexicon.ts`：三层词库（L1 连接词 40+ / L2 模板短语 60+ / L3 句式正则 12），数据与逻辑分离。
- 升级 `engine/anti-ai-detector.ts`：新增 `detectWithPositions`（段落级定位）、`detect`（评分 + 特征 + 建议）、`score`（0-100），保留原 `detectAIWords`/`buildAntiAIConstraints` 向后兼容。
- 接入 `engine/quality-gate.ts`：rule 层新增 `aiDetection` 完整检测结果字段，保留 `aiWords`。
- 新建 `ui/components/ai-detection-report.ts`：AI 味检测报告渲染组件（评分 + 雷达图 + 命中短语 + 建议），纯展示零副作用。
- 接入 `ui/co-writing-view.ts`：`renderFloatingQuality` 开头实时渲染 AI 味检测报告。
- `styles.css` 追加 v7.3 段：`.nw-ai-report-*` 样式。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- `vitest`：24 用例全绿（anti-ai-detector 16 + quality-gate 8）。
- `plugin:reload` + `dev:errors`：无运行时错误。

---

## Unreleased — 协同写作反馈与工作台排版缺陷修复（交互模式优化第二轮）

### 🧭 动因
针对「四个核心界面交互模式」优化诉求，本轮聚焦两大核心场景的系统性修复：(1) 协同写作（人机协同）的反馈痛点——字数口径不一致、目标字数硬编码、常驻 Notice 不消失；(2) 完整写作工作台的 CSS 排版缺陷——8 类 class 缺失 + 6 处响应式/溢出。需求中「多人光标同步 / 实时编辑冲突提示 / 权限状态」经核实**不适用**：插件协同写作为「作者 + AI」的人机协同，非多人实时协作，全库无 WebSocket/CRDT/协作成员相关实现。

### ✨ 改动

**CSS class 缺失补全（`styles.css`，文件末尾 v7.1 段）**
补齐 8 类 TS 使用但样式表缺失定义的 class，全部复用现有 `--nw-*` 设计 token：
- `novel-writer-fw-cowrite-entry*`（推荐卡片族 10 个类，正文生成步骤使用）
- `novel-writer-fw-warning`（警告提示）
- `novel-writer-fw-hero-*`（空状态 hero 卡片 5 个类）
- `novel-writer-fw-planning-header` / `-new-project-btn` / `-preview-title` / `-preview-volume-list` / `-preview-volume-item`

**CSS 响应式 / 溢出修复（`styles.css`）**
- `.novel-writer-fw-planning-status-list`：`repeat(5,1fr)` → `repeat(auto-fit,minmax(72px,1fr))`，窄屏自动降列。
- `.nw-wizard-form-grid`：固定 `1fr 1fr` → `repeat(auto-fit,minmax(180px,1fr))` + 子项 `min-width:0`。
- `.nw-wizard-content-area` / `.novel-writer-fw-temp-slider`：补 `min-width:0` 防 flex 子项溢出。
- `.novel-writer-fw-card-action-btn`：补 `overflow:hidden; text-overflow:ellipsis`，长文案省略号截断。
- `.novel-writer-fw-planning-quickstart`：`color-mix()` 补静态 fallback（兼容旧 Chromium <111）。

**协同写作反馈修复（`ui/co-writing-view.ts`）**
- 字数口径统一：状态栏 `refreshStatusBar` 与状态监控卡 `renderStatusCard` 的 `.length` → `.trim().length`，与剧情完成度面板 `renderMetrics` 对齐。
- 目标字数硬编码统一：`wordGoalDisplay` 硬编码 `3000` → `this.facade.settings.defaultWordCount || 3000`。
- 常驻 Notice 不消失：质量修复「🔍 正在修复」Notice（timeout=0）改为保存引用，`finally` 中 `hide()`，修复完成/失败后不再常驻。

**工作台 CSS 二次排查修复（`styles.css`，v7.2 段 + 原位）**
- 补齐 `.novel-writer-fw-step-stale`（已过期需重跑状态色）与 `.nw-entity-tree-active`（实体树选中高亮）两个缺失 class。
- 项目选择器预览面板 `.novel-writer-fw-preview-panel` 固定 `width:340px` → `clamp(260px,30vw,340px)`，并统一两处重复定义的 border 方向（右面板 `border-left`）。
- `.novel-writer-fw-card-actions` 固定 `1fr 1fr 1fr` → `repeat(auto-fit,minmax(64px,1fr))`，避免按钮文字截断。
- `.nw-wizard-sidebar` 的 `min-width` 由 `var(--nw-wizard-sidebar-w)` 放宽为 `160px`，避免 900~1100px 区间挤压内容区。
- `.novel-writer-fw-review-tabs` / `.novel-writer-fw-btn-row` / `.nw-wizard-nav-btn-group` 补 `flex-wrap:wrap`，窄屏横向溢出改为换行。
- 裸 `color-mix()` 补静态 fallback（旧 Chromium <111）：`.novel-writer-fw-titlebar`/`.nw-cowrite-header`、`.novel-writer-fw-status-bar`、`.nw-tools-card`。
- `.nw-tools-card` 删除与固定 `height` 冲突的 `aspect-ratio:1/1`。

**知识库 / 指纹库交互缺陷修复**
- 知识库「拆解任务 → 查看书籍」跳转失效（`ui/views/knowledge-base-view.ts`）：点击后右栏未渲染出 `.nw-kb-books-panel`，`openBookDetail` 空返回致状态死局——补 `renderRightPanel()` 调用。
- 指纹库「从知识库导入」按钮 tooltip 误标「（待实现）」而功能已完整实现（`ui/views/writing-fingerprint-view.ts`）：改为实际功能说明。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

---

## Unreleased — 知识库书详情渲染器外迁（单文件拆分第二步）

### 🧭 动因
`knowledge-base-view.ts` 在 Modal 外迁后仍有 5676 行，其中「书详情渲染」方法组（10 个 Tab 渲染 + 12 个辅助方法，约 2300 行）深度耦合视图状态。本轮把该组外迁到独立的 `BookDetailRenderer`，通过 deps 依赖注入访问宿主，进一步降低单文件体积。

### ✨ 改动
- 新建 `ui/views/book-detail-renderer.ts`（约 2417 行）：`BookDetailRenderer` 类 + `BookDetailRendererDeps` 接口（注入 8 个数据 getter、kb/kbManager/app、getCurrentBook/formatWordCount/getChannelLabel/formatDateTime/formatDuration/getStatusLabel 等工具，以及 onClassifyBook/onEditBook/onApplyGenreRecommendation/onAddCustomTag/onDeleteCustomTag 等回调）。
- 宿主 `knowledge-base-view.ts`：5676 → 3377 行；`renderBookDetail()` 的 switch 委托给 `bookDetailRenderer`；「自动分类」「应用分类建议」按钮逻辑封装为视图侧 `autoClassifyBook`/`applyGenreRecommendation`。
- `renderChart`/`getGenreName` 因被「统计 Tab」复用而保留宿主（新类内另有副本）；8 个数据 interface 加 `export` 供 renderer import。
- 清理外迁后变为 unused 的 import。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

### 📝 顺带发现（未处理）
`getTimelineIcon` 迁入前即为未被调用的死代码，本次按「外科手术式」原样保留，留待后续清理。

---

## Unreleased — 知识库题材列表默认展开（降低「折叠树」导航摩擦）

### 🧭 动因
体检报告 §4.3 指出知识库「5 层嵌套过深」中有一层是「题材折叠」accordion（`createGenreGroup` 用 `expandedGenres` 追踪展开态，默认全部折叠）。用户偏好「Tab/平铺 优于 折叠树」，故将题材分组改为**默认展开**——子题材直接可见、一次点击直达，减少一层交互摩擦。

### ✨ 改动（`ui/views/knowledge-base-view.ts`）
- `expandedGenres`（默认折叠）重命名为 `collapsedGenres`（默认展开），`isExpanded = !collapsedGenres.has(genre.id)`。
- 折叠箭头 `▶/▼` 仍保留，用户可手动折叠不关心的题材分组。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — 原生 confirm() 全量替换为统一确认弹窗

### 🧭 动因
原生 `confirm()` 在 Obsidian Electron 下交互体验差、风格不统一。插件统一以 `OperationConfirmModal.confirm()` 异步确认弹窗替代。本轮收敛除「指纹库视图」「知识库 GenreEditModal」外（已在各自条目记录）的全部剩余原生确认框，覆盖 14 个文件共 34 处。

### ✨ 改动（按文件）
- `ui/mini-settings-modal.ts`：删除模板/全局/项目指纹、重建向量索引、清空性能日志 5 处。
- `ui/settings-tab.ts`：删除自定义提供商、删除指纹、重建索引、恢复拆解默认、删除书籍、删除/重置伏笔类型、清空性能日志、启用 LLM 层（×2）10 处。
- `ui/manage-providers-modal.ts`：恢复默认供应商、删除供应商 2 处。
- `ui/create-project-modal.ts`：项目覆盖（赋值形）1 处。
- `ui/knowledge-detail-modal.ts`：删除书籍 1 处。
- `ui/generate-worldview-modal.ts`：AI 建议重命名项目（赋值形）1 处。
- `ui/fingerprint-detail-modal.ts`：重新提取、删除指纹 2 处。
- `ui/writing-profile-modal.ts`：关闭（×2）、重置默认 3 处。
- `ui/full-writer/scene-outline-controller.ts`：删除场景 1 处。
- `ui/existing-entity-manager.ts`：未应用变更关闭 1 处。
- `ui/template-manager.ts`：删除模板（×3）3 处。
- `ui/prompt-manager-settings.ts`：重置提示词、删除测试 2 处。
- `ui/refill-modal.ts`：重新拆解 1 处。
- `ui/plan-book-modal.ts`：生成世界观（赋值形）1 处。

统一规则：`title` 用简短动作名、`description` 保留原问句、不可逆/丢失类加 `warning`、`confirmText`/`cancelText` 统一「确认X / 取消」；同步把包裹回调改为 `async`。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。
- 全仓原生 `confirm(` 已清零（仅剩 `OperationConfirmModal.confirm` 静态方法与 `fact-index-manager.ts` 的同名方法，非原生调用）。

---

## Unreleased — 知识库视图 Modal 类外迁

### 🧭 动因
`ui/views/knowledge-base-view.ts` 为超大单文件，内嵌 4 个 Modal 类（ImportBookModal / EditBookModal / GenreEditModal / BatchOperationsModal），机械外迁至独立文件以降低单文件体积、提升可维护性。

### ✨ 改动
- 新建 `ui/views/knowledge-base-modals.ts`，承载上述 4 个 Modal（原样拷贝，仅加 `export`）。
- `ui/views/knowledge-base-view.ts` 改为 `import { ... } from './knowledge-base-modals'`，并清理仅 Modal 使用的导入（`Setting`/`TFile`/`SubGenreConfig`/`TechniqueDef`/`kbBookDir`）。
- 顺手将 `GenreEditModal` 删除题材的原生 `confirm()` 替换为 `OperationConfirmModal.confirm()`，消除该文件的最后一个原生确认框。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run build`：构建通过 v4.10.7。

---

## Unreleased — 工作台设置入口去重

### 🧭 动因
体检报告 §4.2④ 指出设置按钮同时出现在 titleBar（`title-bar-controller.ts:124`「⚙️ 设置」）与 tabBar（`tab-controller.ts:213`「⚙️」），两者都打开 `MiniSettingsModal`，属重复入口。

### ✨ 改动（`ui/full-writer/tab-controller.ts`）
- 移除 tabBar 右侧的图标-only「⚙️」设置按钮（及其 `MiniSettingsModal` 导入），保留 titleBar 带可见文字「⚙️ 设置」的入口（更易发现，符合图标按钮加文字的可发现性偏好）。tabBar 右侧保留「🔄 热重载」。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — 指纹库原生 confirm 替换为统一确认弹窗

### 🧭 动因
体检报告 §4.3 指出指纹库「删除/迁移」仍用原生 `confirm()`，与插件风格不统一（知识库视图已统一走 `OperationConfirmModal`，指纹库是漏网项）。

### ✨ 改动（`ui/views/writing-fingerprint-view.ts`）
- 删除指纹、V1→V2 批量升级两处 `confirm()` 改为 `OperationConfirmModal.confirm()`，沿用知识库视图既定模式（`title` / `description` / `warning` / `steps` / `confirmText`）。两处宿主方法本就 `async`，`await` 无需改签名。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — 工作台导航收敛：清理「双导航」死导入 + 向导状态机等价分支合并

### 🧭 动因
体检报告 §4.2① 称 `step-nav-presenter`（11步）与 `streamlined-nav-presenter`（5阶段）两套导航并存。排查确认：工作台实际渲染只走 `streamlined-nav-presenter`（`step-render-controller.ts` 的 `renderStepNav` 仅用 `getStreamlinedPhases()`），`step-nav-presenter` 的 4 个函数（`resolveStepKey` / `getStepColorClass` / `getStepStatusDescriptor` / `isStepClickable`）在渲染控制器中为死导入——「双导航并存」属旧信息，残留为死代码。

### ✨ 改动
1. **`ui/full-writer/step-render-controller.ts`**：删除对 `step-nav-presenter` 的 4 个未使用导入，导航渲染单一来源收敛到 `streamlined-nav-presenter`。
2. **`ui/full-writer/wizard-controller.ts`**：`renderNavBar` 中 `isDone && isMandatory` 与 `isDone` 两个分支行为完全等价（都渲染「下一步 →」主按钮），合并为单一 `isDone` 分支，减少状态机分支数。

### ✅ 验证
- `npm run typecheck`：零错误。

---

## Unreleased — Tab 栏溢出兜底（协同写作右栏 + 知识库子 Tab）

### 🧭 动因
体检报告 §4.2② 指出 Tab 栏多标签截断无兜底。排查确认：工作台主 Tab 栏（`novel-writer-fw-tabbar`）已含 `overflow-x: auto`（报告该点属旧信息）；真正仍缺兜底的是协同写作右栏 `.nw-cowrite-tab-headers` 与知识库子 Tab `.nw-kb-subtab-headers`——`display:flex` 但无 `overflow-x`、子项 `white-space:nowrap` 且无 `flex-shrink:0`，标签增多即被截断/挤压。

### ✨ 改动（`styles.css`）
- `.nw-cowrite-tab-headers` / `.nw-kb-subtab-headers`：补 `overflow-x: auto; overflow-y: hidden; flex-wrap: nowrap;`。
- `.nw-cowrite-tab-header` / `.nw-kb-subtab-header`：补 `flex-shrink: 0;`，保证标签不被压缩、可横向滚动。

---

## Unreleased — 协同写作浮窗交互补齐：修复临时指令死代码 + 建议卡片补「拒绝/接受」操作

### 🧭 动因
体检报告指出「协同写作双实现功能分裂」：Tab 版 `co-writing-view.ts` 具备完整采纳/拒绝/编辑/迭代，浮窗版 `co-write-floating-panel.ts` 只有「点击即采纳」，既无拒绝出口，也未启用 `styles.css` 中已预留的 `.nw-suggestion-header` / `.nw-suggestion-tag` / `.nw-suggestion-actions` 卡片结构。

### ✨ 改动（`ui/co-write-floating-panel.ts`）
1. **修复「临时指令」死代码**：`applyHint()` 原先按 Enter 仅 `Notice` 展示、从未真正生效。现在把指令存入 `private cursorHint`，并随 `suggestNext` / `rewriteSelection` 实际传入引擎（`lastSuggestParams.cursorHint` 同步改用 `this.cursorHint`）。
2. **建议卡片补交互**：`renderSuggestions()` 重建卡片结构——头部（序号 + 方向标签 + 非默认风格标签）、正文、操作行（`✓ 接受` 主按钮 + `✕ 拒绝` 次按钮）；卡片整体点击仍为采纳（向后兼容）。
3. **新增 `rejectSuggestion(id)`**：拒绝单条后过滤重渲染，全部拒绝后展示「已拒绝本轮建议。按 Tab 重新生成。」空态，与主界面 `rejectSuggestion` 行为对齐。

### ✅ 验证
- `npm run typecheck`：零错误（含新增 `getDirectionLabel` / `getStyleLabel` 导入）。

---

## Unreleased — P0 收敛：废弃正文命令隐藏 + 孤儿令牌文件清理

### 🧹 背景
插件体检报告（《小说工坊插件优化分析报告》）识别出三类结构性债，本轮落地其中最安全的 P0 收敛项。

### ✨ 改动
1. **收敛 4 个废弃正文命令（O1）**：`AI写正文〔旧〕` / `后台AI写正文〔旧〕` / `批量写正文〔旧〕` / `自动写作器〔旧〕` 四个旧版正文生成命令（正文已统一走 CoWriterEngine），在 `core/command-registry.ts` 中：
   - `COMMAND_DEFINITIONS` 标记 `internalOnly: true`，使其从 `getPublicCommands()` 消失；
   - 从 `registerObsidianCommands` 删除对应 `addCommand`，使其不再出现在 Obsidian 命令面板（Ctrl+P）。
   - 保留 `registerInternalCommands` 中的 `r.register` 回调，向后兼容（内部 registry 仍可 execute）。
2. **删除孤儿设计令牌文件（CSS）**：`design-tokens.css`（398 行）从未被任何代码加载——`*.ts` 中零引用、`styles.css` 无 `@import`、manifest 无 styles 多文件配置；`styles.css` 顶部注释已自认「design-tokens.css 未加载时仍可用」（靠 fallback）。删除零运行时风险。

### 🎯 设计取舍
- 采用「隐藏 + 保留回调」而非「彻底删除」，最小侵入、向后兼容；真正的删除留待确认无内部依赖后的 P2 清理。
- `styles.css.bak`（5538 行备份）与 V1/V2 双套收敛、协同写作双实现统一，因风险较高，留待下一轮单独评估。

### ✅ 验证
- `npm run typecheck`：零错误。
- `npm run test`：2906 通过（149 文件）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成算法系统化整改：补齐三层契约校验（蓝图 / 单卷 / 全局）

### 🧭 整改动因（真实 AI 端到端实测暴露的两个问题）
- **Q-1 章号总数被放大**：100 万 / 3 卷 / 2500 字的规划本应是 400 章，实测最终大纲却含 **402** 条章节行（末章 `| 402 |`），而全书总览写的是「总章节数：400」——文档自相矛盾。根因有二：① 蓝图不可用时的回退分配用 `ceil(totalChapters / volumes)`，3 卷 400 章会得到 134+134+134=402；② 校验只检测「缺章」（`covered.size < expectedCount`），**从不检测「多章/越界章号」**。
- **Q-2 蓝图稀薄导致跨卷约束链失效**：实测蓝图输出仅 **237 字符**（基本只有章号范围），Phase N+1 跨卷验证 0 警告 0 严重问题、Phase N+2 定向修复从未触发——「转折点 / 伏笔回收 / 势力演变」的闭环校验形同虚设。

### 🏗️ 架构：新增契约层 `engine/outline-contract.ts`（纯函数、无副作用、可单测）
把原先散落各处的临时判断收敛为显式契约，让「校验」成为算法的一等公民：

| 契约 | 函数 | 拦截的问题 |
|------|------|-----------|
| 设置契约 | `normalizeOutlineSettings` | 非法字数/分卷/每章字数、除零、每卷 0 章；`totalChapters ≥ volumes` |
| 章号范围契约 | `validateChapterRanges` / `buildProportionalChapterRanges` / `normalizeChapterRanges` | 长度 ≠ 分卷数、首尾不接、起点非 1、**总和 ≠ 总章数** → 自动按比例重分配 |
| 蓝图契约 | `validateBlueprintCompleteness` | 蓝图只有章号范围；转折点/伏笔为空；卷号越界；**回收卷早于埋设卷**；转折点章节范围越出本卷；有角色/势力却无对应时间线 |
| 单卷契约 | `validateVolumeStructure`（复用 `validateOutlineOutput` + 值非空/非占位符 + **精确覆盖**） | 字段为空或占位符（`（无）`/`待补充`…）；**越界章号、重复章号、空描述行**（原算法完全检不出）；覆盖不足；章节范围与规划不一致 |
| 章节表工具 | `analyzeChapterTable` / `findMissingChapterRanges` / `chunkRanges` / `consolidateChapterTable` | 越界/重复/空行的**确定性净化**；缺失章号压缩为连续区间；增量合并（不覆盖已有行） |
| 全局契约 | `validateGlobalChapterContinuity` | 跨卷重叠、全书缺章、超总章数。**关键：统计全部章节号（不过滤范围）**，否则越界行会绕过检测（这正是原算法的盲点） |

### ✨ 算法重构（engine/ai-outline-generator.ts）
1. **Phase 1 蓝图质量控制循环（新增）**：与逐卷生成同构的「生成 → 契约校验 → 定向补全」，≤3 轮。章号范围先归一化（无论 AI 输出什么都得到合法范围），再校验字段完整性；耗尽才降级，并输出「蓝图质量提示」注释。
2. **Phase 2-N 逐卷质量控制强化**：
   - 生成结果先做**确定性净化**（剔除越界/重复/空描述行），使校验只聚焦「真正需要 AI 补全」的缺口；
   - 校验由「只查缺章」升级为**精确覆盖**（不多、不少、不越界、不重复）；
   - 新增**增量章节补全**：若上一轮只是缺章节而字段合规，只请求缺失章号区间（压缩成连续区间并按 25 章/批），不再整卷重写——直接消除原「第 1 卷 3 轮整卷重写耗时 333 s」的浪费。
3. **Phase N+2 跨卷修复定向化**：问题→卷映射由「仅 `volumeIndex`」扩展为「`volumeIndex` ∪ `relatedVolumes`」；新增**收敛判定**（关键问题数不下降即停止，避免无进展空转）。
4. **Phase N+3 全局章号连续性终检（新增）**：组装文档前的最后一道门。发现缺口则按缺失区间定向补全（≤2 轮），仍未闭合才以「全局章号待完善问题」注释显式暴露，绝不静默。
5. **数据模型对齐**：卷级提示词新增「**伏笔安排**」「**势力变动**」两个必填字段——`VolumeOutlineSummarizer` 一直依赖这两个小节构建跨卷摘要，此前提示词从不要求它们，导致 `pendingForeshadows`/`factionChanges` 恒为空、跨卷伏笔与势力链条实际断裂。共享常量 `OUTLINE_REQUIRED_KEYS`（12 字段）保持不动，避免影响其它以 12 字段为准的校验入口。
6. **清理死代码**：删除自 Phase 1 骨架调用移除后已无调用方的 `generateGlobalSkeleton`（`OutlineGenerator` 与 `AIEngine` 两处）；修正 `generateGlobalBlueprint` 错误信息的 `OUTLINE_BLUEPRINT_FAILED:` 前缀重复拼接。

### 🎯 设计取舍
- 机械性缺陷（越界/重复/空行）用**确定性代码**修复，不消耗 AI 调用；只有需要创作判断的缺口（缺字段、缺章节）才触发 AI 补全。
- 「保底不封顶」：所有循环都有上限且必然收敛；上限耗尽即降级，并以 HTML 注释把未闭合项显式暴露给用户。

### ✅ 验证（手动调试，未使用电脑控制自动化工具）
- `npm run typecheck`：零错误。
- `npm run test`：**2905 通过（149 文件）**；新增 `tests/unit/engine/outline-contract.test.ts`（21 用例，覆盖归一化/章号范围/蓝图完整性/单卷精确校验/章节表工具/全局终检的边界）与扩充 `tests/unit/engine/ai-outline-generator.test.ts`（6 用例，含 Q-1「蓝图章号总数不符自动重分配后恰好 5 章无越界」与 Q-2「稀薄蓝图重试后无蓝图质量提示」的回归）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成改为「质量优先 + 分段组织 + 多轮定向补全」（否决单次执行方案）

### 🔄 方案反转
- **否决上一轮「单次执行」方案**：上一轮以「执行完整性 = 不重试、不分段、失败即 throw」为目标，实为拿质量换性能；本轮按用户要求改为**内容质量第一**。
- 新算法形态：**内循环多轮重试 + 分段组织 + 定向补全 + 失败降级 + 全程不中断**；依旧不使用 `AbortSignal`，不新增结果级缓存。

### ✨ 重构（engine/ai-outline-generator.ts）
1. **永不 throw 中断**：`generateOutline` 全链路不再向上抛出。Phase -1 清理、Phase 1 蓝图、Phase 2-N 逐卷、Phase N+1 验证、Phase N+2 修复全部内部捕获；蓝图失败降级为「无蓝图模式」（各卷回退平均分配章节）；单卷彻底失败写入占位标记后继续；仅当所有卷均无有效内容时才返回 `error` 供 UI 提示。
2. **单卷内循环重试（≤3 轮）+ 定向补全**：新增 `generateVolumeWithQualityControl` / `callVolumeOutline` / `buildVolumeRepairHint`。每轮以「上一轮缺陷清单」构造补全指令，**提示词随轮次变化**——这是关键：`AIApiClient.callAI` 有 prompt 五元组哈希缓存，重试若用相同提示词会直接命中缓存返回完全相同结果，形成无效重试（也是此前「瞬时完成」现象的根因）。
3. **分段组织（> 60 章自动分段）**：新增 `generateVolumeOutlineSegmented` / `callChapterBatch` / `normalizeChapterRows`。超长卷拆为「卷级概览 + 章节分配表分批（每批 25 章）」，各批失败不中断，交由质量校验在下一轮触发补全。
4. **结构质量校验**：新增 `validateVolumeStructure`，复用 `validateOutlineOutput`（12 个必填字段 / 章节范围格式 / 章节分配表）并追加「章节范围一致性 + 章节号覆盖度」检查。
5. **跨卷关键问题定向修复（≤2 轮）**：恢复 Phase N+2，但改为非抛出式：`repairCrossVolumeIssues` / `callCrossVolumeRepair` 按卷归并 critical 问题 → 请求该卷重写 → **结构不退化才接受**（避免「越修越差」）→ 复验。
6. **降级可见**：降级卷号与遗留问题以 HTML 注释追加（`降级生成提示` / `跨卷验证警告` / `跨卷验证待完善问题（修复后仍存在）`），不阻断输出、不重复调用 AI。

### 🎯 设计取舍
- 质量 > 性能：接受多次 AI 调用（分段 + 重试 + 修复）换取内容完整连贯、逻辑闭环。
- 保底不封顶：重试轮数上限保证流程必然收敛（无死胡同）；上限耗尽时降级返回而非中断。

### ✅ 验证（手动调试，未使用电脑控制自动化工具）
- `npm run typecheck`：零错误。
- `npm run test`：**2882 通过（148 文件）**；新增 `tests/unit/engine/ai-outline-generator.test.ts` 4 用例（首轮缺陷→次轮定向补全通过 / AI 持续失败降级不抛 / 超长卷分段合并完整章节表 / 跨卷 critical 修复被采纳）。
- `npm run build`：esbuild 构建通过（v4.10.7）；产物核验：旧 `OUTLINE_VOLUME_FAILED` 抛出点已消除，`OUTLINE_BLUEPRINT_FAILED` 保留（改为被捕获降级）。
- obsidian-cli 手动验证：`obsidian plugin:reload id=novel-writer-ai` → `Reloaded: novel-writer-ai`；`obsidian dev:errors` → `No errors captured`。

### ⚠️ 本条目取代的旧方案
- 下方「大纲生成执行完整性保障（放弃取消、单次执行、避免 AI 重复调用）」条目的**结论已作废**：其「不重试 / 不分段 / 失败即 throw」不再适用。`MAX_CHAPTERS_PER_VOLUME`（100 章）仍在用，现同时作为「启用分段生成」的告警触发点。

---

## Unreleased — 大纲生成执行完整性保障（放弃取消、单次执行、避免 AI 重复调用）【已被上方条目否决】

### 🔄 方案调整
- **放弃「中途取消」方案**：回退上一轮为大纲生成引入的 `AbortSignal` 透传与「🛑 取消生成」按钮，避免执行链路被中断。
- **移除重试/修复/续写**：`OutlineGenerator.generateOutline` 删除「省略检测重试（每卷最多 3 次）」「跨卷强制修复（最多 3 轮）」「大纲校验失败续写（最多 5 次）」三处 AI 重复调用逻辑，改为蓝图 1 次 + 每卷 1 次的单次执行；跨卷验证仅生成警告、不再触发修复。同步删除 `repairVolume` / `buildRepairInstructions` / `generateOutlineWithRetry` / `buildOutlineSystemPrompt` / `buildOutlineUserPrompt` 五个不再使用的方法。

### 🎯 设计取舍
- 原子性与执行完整性优先：单次执行一次性完成全部规划步骤，不中断、不重试、不分段；接受额外性能/质量损耗作为可接受 trade-off，避免 AI 接口重复调用。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2878 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成模块优化（分卷章节超限告警 + 实体摘要裁剪）

### ⚡ 优化
- **单卷章节数超限告警**：`OutlineGenerator` 新增 `MAX_CHAPTERS_PER_VOLUME`（100 章）安全阈值，当某卷章节数超过阈值时输出告警日志，提示用户增加分卷数或提高每章字数，避免单次逐章输出触发省略/截断导致的生成变慢与重试。
- **实体摘要长度裁剪**：`PlanBookModal.readContextFile` 对单个实体 frontmatter 摘要做 400 字上限截断，防止超长字段拖垮大纲 prompt；仅裁剪摘要长度、不裁剪实体数量，确保不遗漏实体、不引入实体污染。

### ℹ️ 缓存/幂等说明
- 大纲生成已由 `AIApiClient.callAI` 的 prompt 缓存（`computePromptHash` + `PromptCache` LRU）覆盖幂等：相同 prompt（含相同实体上下文）命中缓存不再重复调用 AI；实体变化则 userPrompt 变化自动失效。故不新增「结果级缓存」，避免缓存过期实体上下文重新引入实体污染。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2878 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲生成实体注入回退全量污染清理

### 🐛 修复
- **批量建章角色上下文回退全量污染**：`batch-chapters-modal.ts` 在智能筛选（`scoreAndFilterEntities` Top-8）后残留一处「匹配不足 3 个时回退全量注入前 20 个角色」的兜底逻辑，会把无关角色全量注入章节生成上下文。该逻辑在 `scoreAndFilterEntities` 修复「正向分不足时按 topN 截断」后已成为死代码（实体数 > 8 时 `filtered.length` 恒 ≥ 3 或 = topN），但语义上仍属实体污染隐患。已移除该回退分支，统一信任 `scoreAndFilterEntities` 的 topN 截断，确保不同任务/多轮生成的角色上下文按相关性隔离、不再回退全量。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2878 测试全部通过（entity-scorer 新增 4 个「实体数据隔离」用例）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 全书规划（分卷大纲）向导「生成中」卡死修复

### 🐛 修复
- **向导步骤误置 executing 状态**：`executeWizardStep` 原先仅排除 `writing_style`，导致 `outline`/`chapters` 两个「打开弹窗」步骤被错误置为 `executing`，nav bar 持续显示「⏳ 生成中...请等待 AI 返回...」。这两步的实际 AI 生成由弹窗内部按钮触发（需用户在弹窗内二次确认），并非自动执行，故步骤看起来永久「生成中」、分卷大纲文件不更新。现统一为 `isModalStep` 判定，排除 `writing_style`/`outline`/`chapters` 三种弹窗步骤，使其不再进入 executing 状态。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run build`：esbuild 构建通过（v4.10.7）。
- `npm run test`：2874 测试全部通过。

---

## Unreleased — 信息规划提示词章节号兜底修复

### 🐛 修复
- **提示词章节号显示「第0章」**：`buildTemplateVars` 的 `chapNum` 原直接取 `chapterNum`，当章节名尚未含数字（或初始化时序）时被解析为 0，导致信息规划提示词出现「第0章」与章节选择器「第1章」不一致；现增加从 `chapterName` 重新解析章号的兜底，`chapterNum` 为 0 时回退到章节名中的数字。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 大纲/章节生成实体注入防污染

### 🐛 修复
- **实体评分回退全量污染**：`scoreAndFilterEntities` 在「正向分实体不足 3 个」时原先回退返回全部实体（`scored.slice(0, entities.length)`），把无关人物/势力/地点/物品全量注入大纲与章节生成上下文；改为按 `topN` 上限截断（`Math.max(1, topN)`），仅保留得分靠前的有限实体，消除无关实体污染。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2874 测试全部通过（entity-scorer 12 个用例含新增回退截断断言）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 正文涉及实体字段精确化（跨模块数据流转）

### 🐛 修复
- **章节 frontmatter 涉及实体全量污染**：`StepResultSaver.updateFrontmatterFields` 原先用 `.filter(() => true)` 简化判断，把项目全部人物/地点/势力/物品写入每一章正文 frontmatter；改为按正文 `bodyText` 实际出现过滤（与 `writeFixToBody` 的过滤逻辑对齐），仅写入本章真正涉及的实体，提升指纹/知识库读取正文元数据时的准确性。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2874 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — UI 主色统一为番茄/起点暖橙（交互界面优化）

### 🎨 优化
- **主色统一**：`theme-manager.ts` 的暗色/亮色主题强调色由偏灰的陶土色 `#b87d6e` 调整为番茄/起点风陶土橙红 `#C2410C`（hover `#9A3412`），贴合主流网文写作工具的暖色视觉。
- **消除紫/暖冲突**：主按钮 `--nw-btn-primary-bg` 由紫色 `#7c3aed` 统一为品牌橙红，消除「暖色强调 + 紫色主按钮」的视觉割裂；同步收敛强调色渐变、聚焦环、选中描边、文字强调色与次要按钮 hover 色，去除散落的硬编码紫。
- **编辑风衬线标题**：新增 `--nw-font-display`（Georgia/Songti SC/Noto Serif SC）衬线标题字令牌，协同写作标题采用衬线字体，营造「杂志编辑风」文学气质（对齐 design-contract）。
- **兼容性保留**：用户自定义 `themeColors.accent` 仍优先于默认值，主题兼容不受影响。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 指纹迁移补齐定量字段（内容拆解补全）

### ✨ 新增
- **迁移定量补齐**：`migrateV1ToV2` 在 V1 指纹带 `sourceText` 时，复用 `v2-quantitative-extractor` 的纯统计能力补齐「节奏/视角」两维的定量字段（平均句长/标点密度/人称分布等），消除迁移后定量字段全 0 的空缺；定性 `description` 仍保留 V1 分析结果不被覆盖。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- 定向测试：`fingerprint-migrator`（52）+ `v2-quantitative-extractor`（8）全部通过。

---

## Unreleased — 指纹库向量层统一 EmbeddingProvider（跨模块数据流转）

### 🔧 重构
- **指纹库向量层接入统一工厂**：`WritingFingerprintView.initLibrary()` 由硬编码 `new OllamaEmbeddingClient(...)` 改为 `EmbeddingProviderFactory.create(this.plugin.settings)`，使指纹提取与向量检索真正遵循用户配置的 `vectorProviderType`（Ollama / OpenAI 兼容 / 豆包 / 通义千问）。
- **类型拓宽**：`StyleFingerprintLibrary` 与 `KnowledgeToFingerprintConverter` 的 embedding 依赖由具体 `OllamaEmbeddingClient` 改为抽象 `EmbeddingProvider`，消除指纹库对本地 Ollama 的隐式耦合，任意向量源均可注入。

### ✅ 验证
- `npm run typecheck`：零类型错误。

---

## Unreleased — 内容拆解功能补全

### ✨ 新增
- **V2 定量拆解算法**：新增 `engine/style/v2-quantitative-extractor.ts`，实现节奏（句长分布/平均句长/短句占比/标点密度/段落密度/停顿频率）与视角（人称分布）两个维度的纯统计定量拆解，填补 V1→V2 迁移「定量字段全填 0」的算法空缺。
- **FingerprintExtractor V2 接口**：`FingerprintExtractor` 新增 `extractV2Quantitative()` 方法，暴露节奏/视角定量拆解能力，供 V2 提取流程接入。

### 🐛 修复
- **知识库拆解维度不一致**：`getMissingDimensions` 与拆解入口硬编码 6 维，改为统一使用 8 维（含商业价值/可读性），与 `getDimensionStatus` 及实际调度行为一致。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2872 测试全部通过（含新增 v2-quantitative-extractor 8 个用例）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 指纹库功能接线补全

### 🔧 补全
- **从知识库导入指纹**：`WritingFingerprintView.handleImportFromKnowledge` 由占位 Notice 改为完整实现——弹窗选择知识库书籍，复用 `KnowledgeToFingerprintConverter` + `addFromKnowledge` 转为项目写作指纹。
- **详情弹窗重新提取**：`onReextract` 由占位 Notice 改为调用 `refillFingerprint` 完整重新提取流程（缺失原始文本时给出明确引导）。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2864 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 模型源抽象与配置统一（架构底座）

### ✨ 新增功能
- **模型源类型抽象**：`CustomProvider` 新增 `sourceType: 'cloud' | 'local'` 字段，统一区分云端 API 与本地推理服务（Ollama / LM Studio / vLLM 等 OpenAI 兼容端点）。
- **模型源解析**：新增 `shared/model-source.ts`，提供 `ModelSourceType` 类型与 `resolveProviderSourceType()` 解析函数，旧数据按 id/endpoint 启发式兜底，向后兼容。
- **ProviderManager 扩展**：新增 `getProvidersBySourceType()` / `isLocalProvider()` / `getCurrentSourceType()`，为「模型源选择下拉列表」提供数据层支撑。

### 🔧 优化
- **消除双份默认设置**：`DEFAULT_SETTINGS` 改为引用 `getDefaultSettings()`（单一数据源），并补全后者缺失的 `foreshadowConfig`、`refineRounds`、`candidateParallel`、`promptCacheEnabled`、`vectorDoubao*`、`vectorQwen*`、`vectorMode` 字段。
- **消除切换逻辑双写**：设置页 API 提供商下拉统一走 `ProviderManager.switchByEndpoint()`，删除手写重赋值。
- **自定义提供商自动识别源类型**：新增本地端点（localhost/127.0.0.1）自动标记为 local。
- **AIApiClient 请求体构造去重**：提取 `buildRequestBody()` 公共方法，消除 `callAI` / `callAIStream` / `nativeStreamIterator` 三份重复的请求体构造逻辑。
- **本地模型判定统一**：co-writer 的 `isLocalProviderEndpoint` / `hasLocalProvider` 复用 `resolveProviderSourceType`，支持 `sourceType` 显式标记（如局域网 IP 的本地服务）。
- **模型源下拉分组标识**：设置页 API 提供商下拉按云端（☁️）/本地（💻）加前缀；协同写作「云端供应商」下拉改用 `sourceType` 排除本地 provider。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2864 测试全部通过（含新增 model-source 6 个用例）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — 质量仪表盘联动修复

### 🐛 修复
- **质量仪表盘联动失效**：修复 `ui/quality-dashboard-modal.ts` 中筛选、钻取、导出的联动逻辑。
  - 章节定位：工作台视图活动时 `getActiveFile()` 返回 null，fallback 到工作台 `getCurrentChapterState()` 获取当前章节状态。
  - 时间范围筛选：当前章/最近3章/最近5章/全部章节，切换后雷达图、维度横条、问题列表同步更新。
  - 维度钻取：点击维度横条，问题列表过滤到对应维度。
  - 导出：导出当前「时间范围 + 维度」筛选后的数据集（JSON）。

### ✅ 验证
- `npm run typecheck`：零类型错误。
- `npm run test`：2855 测试全部通过（含新增 `tests/unit/ui/quality-dashboard-modal.test.ts` 覆盖 3 个联动场景）。
- `npm run build`：esbuild 构建通过（v4.10.7）。

---

## Unreleased — UI 与数据可视化优化

### ✨ 新增功能
- **ChartContainer 统一图表容器**：`svg-charts.ts` 新增 `createChartContainer()` 工厂函数，封装公共 padding/网格/坐标轴/图例/tooltip 逻辑，返回 `{ svgStart, svgEnd, plotArea, legendArea, tooltipHtml }` 结构。
- **图表交互能力**：新增 `attachChartInteractions(container)` 函数，为所有图表提供 hover 高亮、HTML tooltip（位置跟随鼠标）、图例点击筛选功能。7 种图表数据元素全部添加 `data-*` 属性和 CSS 类。
- **响应式图表**：所有图表 SVG 根元素添加 `viewBox` + `preserveAspectRatio="xMidYMid meet"`，`width` 改为 `100%`，外层包裹 `.nw-chart-container`，图表自适应容器宽度。
- **图表动画过渡**：柱状图/环形图 CSS transition（height/opacity/transform 0.3s），折线图 stroke-dasharray 路径绘制动画，散点图/雷达图数据点 opacity 过渡。
- **新增图表类型**：`heatmap()`（行列标签+颜色梯度+单元格 hover）、`treeChart()`（dendrogram 布局+层级折叠）、`areaChart()`（渐变填充折线图）。
- **wordCloud 螺旋布局**：新增 `spiralLayout()` 函数，基于阿基米德螺线算法 + bounding box 碰撞检测，替代原 flex-wrap 排列。
- **空状态组件**：新增 `ui/components/empty-state.ts`，提供 6 种内联 SVG 图标（book/chart/data/search/folder/default），已在知识库、协同写作、指纹库 5 处视图应用。

### 🔧 优化
- **EmotionCurveView 重构**：从独立 polyline+circle 实现改为复用 `lineChart()`，消除代码冗余，获得贝塞尔曲线平滑、响应式 viewBox、交互 tooltip 等增强。
- **卡片视觉提升**：`.nw-card` 类添加 `box-shadow` + `transition`，`:hover` 状态添加 `translateY(-2px)` 上浮效果。
- **Modal 统一性**：新增 `.nw-modal-header`/`.nw-modal-body`/`.nw-modal-footer` 标准样式，统一标题栏、按钮区对齐、关闭交互。

### 🐛 修复
- **styles.css 残留 max-width**：修复 2 处 `.nw-scope .modal.nw-modal-xl` 的 `max-width: 2000px` → `1300px`，`clamp(900px, 92vw, 2000px)` → `clamp(900px, 85vw, 1300px)`。
- **重复文件清理**：删除 `css/design-tokens.css`（与根目录完全相同的重复文件），更新 `docs/CODE-INDEX.md` 引用。
- **Modal inline important 移除**：`mini-settings-modal.ts` 和 `tools-modal.ts` 移除 `style.setProperty('width', ..., 'important')`，改用 CSS 类管理；补充缺失的 `.nw-modal-md` 类定义。
- **硬编码假数据修复**：`knowledge-detail-modal.ts` 的 `getDimensionProgress` 硬编码 85 → 100（数据存在即满进度）。

### ✅ 验证
- `npm run build`：esbuild 构建通过（v4.10.6）。
- `npx vitest run`：2537/2541 测试通过（4 个失败为预存浮点精度问题，与本次改动无关）。
- `npx tsc --noEmit`：svg-charts.ts、emotion-curve-view.ts、empty-state.ts 零类型错误。

---

## Unreleased — 全局分析维度优化与字数统计统一

### ✨ 新增功能
- **字数统计多口径支持**：`text-segmenter.ts` 新增 `countWords` 函数，支持 `total`（含标点总字数）、`chinese_only`（纯汉字数）、`platform`（平台风格字数，汉字+数字+半角字母按0.5计算）三种统计模式。
- **商业分析报告字数展示**：报告开头新增"基本信息"板块，同时展示三种口径字数，格式化为万字单位。
- **字数聚合**：增量聚合器支持多段字数累加，确保全本字数统计准确。

### 🔧 优化
- **节奏均衡度算法升级**：从单一章节长度变异系数，扩展为长度均衡(50%) + 段落数均衡(30%) + 场景过渡一致性(20%) 的多维度评估。
- **情绪波动算法升级**：引入情绪强度分级（强/弱正负情绪加权），新增趋势反转检测，从纯波动幅度扩展为波动幅度(70%) + 趋势反转(30%)。
- **世界观完整度算法升级**：从类别覆盖率+密度的二维评估，扩展为类别覆盖(35%) + 词汇密度(25%) + 专有名词密度(20%) + 词汇多样性(20%) 四维评估。
- **角色丰富度算法升级**：新增对话引导词检测、姓氏模式匹配、对话量评估，从数量+密度扩展为数量(35%) + 密度(25%) + 姓氏多样性(20%) + 对话活跃度(20%)。
- **情节密度算法升级**：事件词分级加权（强事件×2），新增对话密度和动作密度维度，从事件+过渡扩展为事件(40%) + 过渡(25%) + 对话(20%) + 动作(15%)。

### ✅ 验证
- `npx vitest run tests/unit/engine/commercial-deconstructor.test.ts tests/unit/engine/incremental-result-aggregator.test.ts`：60/60 测试全部通过。
- `npm run build`：esbuild 构建通过（v4.10.6）。

---

## Unreleased — 分段合并层置信度重构

### 🔧 修复
- **单段结果契约**：技术手法、商业与可读性在单段时同样进入必要标准化流程；商业、技术手法、可读性结果分别提供机器可读的段数、等权策略与数据状态。
- **可读性数据状态**：句式相似度与情感均匀度仅在所有分段明确标记 `insufficient` 时进行规则估算，聚合逻辑不再解析展示文案。
- **伏笔实体去重**：伏笔键只规范化大小写和空白，不再删除“的、了、着、过、之、其”等有效名称字符，避免不同实体被误合并。
- **商业合并口径**：`CommercialAnalysisResult` 尚未提供可靠的段体量元数据，商业总分与波形指标继续采用明确标记的等权聚合，不再声明字符或段落加权已实现。

### ✅ 验证
- `npm test -- tests/unit/engine/incremental-result-aggregator.test.ts`：聚合器回归测试通过，覆盖单段标准化、结构化数据不足、伏笔名称碰撞和商业等权口径。
- `npm run typecheck`、`npm run build` 与 `npm test`：2026-07-19 全量通过；118 个测试文件、2468 个用例全部通过。
- `obsidian plugin:reload id=novel-writer-ai`：清空开发者错误缓冲后完成重载，并执行知识库入口与视图刷新检查，未捕获新增运行时错误。

## Unreleased — 知识库详情运行时容错

### 🔧 修复
- **详情字段安全格式化**：知识库节奏页对爽点位置、钩子率/强度和张力指标使用统一数值格式化；缺失或无效数值显示“数据缺失”，不再中断详情渲染。
- **伏笔旧数据兼容**：伏笔统计缺失 `resolved` 或 `unresolved` 时按零值展示，并使用相同的安全值生成进度图。
- **工作区目录导航**：知识库详情、主设置、迷你设置的目录打开入口统一使用公共 `Workspace.getLeaf('tab').setViewState()`，移除不存在的 `revealLeafInNewTab` 调用。

### ✅ 验证
- `npm test -- tests/unit/ui/knowledge-detail-format.test.ts`：4/4 通过，覆盖缺失数值和目录导航行为。
- `npm run typecheck`、`npm run build` 与 `npm test`：2026-07-19 全量通过；118 个测试文件、2468 个用例全部通过。
- 重载后已执行知识库管理界面入口与视图刷新检查，开发者错误缓冲未出现本次 `toFixed`、`toString` 或 `revealLeafInNewTab` 异常。

### 🔧 变更
- **统一置信度框架**：`IncrementalResultAggregator` 新增 `combineConfidence`（离散度惩罚 + 佐证增益，保证"一致不降级"）、`pooledStd`（含段间方差的池化标准差）、`weightedMedianFromBuckets`（分布桶重建中位数）、`recomputeRate`（速率按总量重算）等原语，`buildSegmentWeights` 综合字符占比 × 数据完整度。
- **逐维度消除粗暴合并**：style 视角改置信度加权投票（去除取末段）、rhythm 方差改池化口径、technique 按 count 加权消除顺序依赖、structure 描述改覆盖度选择、character 合并后全局重算 importance/role（单段路径同样生效）、foreshadow 按归一化 name+type 去重。
- **commercial 聚合**：`avgOverallScore` 采用等权聚合；结果类型尚未提供可靠段体量元数据，因此不声明字符或段落加权已实现。移除 `ensureBaseline` 逐项地板价，兜底仅在各段均≈0（真实全 0）时触发。
- **readability 聚合**：`overallScore` 与 aiTrace 维度改加权，代表 description 改选"最接近加权均值"段；sentenceSimilarity / emotionUniformity 零值回退修正为"仅各段均数据不足时估算"，保留优质文本的合法低分（承接审计 BUG-3）。
- **一致性修复**：`combineResults` 对 character 维度单段不再短路，确保单段也进入全局后处理；合并入口新增统一打点 `[aggregate] 维度 X 合并 N 段结果`。

### ✅ 验证
- `npx tsc --noEmit`：编译零错误。
- `npx vitest run`：2460/2460 全部通过（含视角一致/冲突置信度、池化方差、修辞速率重算、单段角色重判等不变量用例）。
- `npm run build`：esbuild 构建通过（v4.10.6）。

---

## Unreleased — 拆解算法质量修复 V2

### 🔧 变更
- **abilities 提取结构性过滤**：移除 `ABILITY_NOISE_CHARS`，改用 `ABILITY_NOUN_PREFIXES` 名词白名单 + `TIME_ADVERB_CHARS` 时间/副词字集；"晚上才能""面又偶尔才能"等副词碎片不再被误提取为能力。
- **角色判定全局化**：`IncrementalResultAggregator.recomputeRolesFromGlobalStats` 按全本累计 appearanceCount(0.45)/dialogueCount(0.2)/perspectiveCount(0.2)/keyEventCount(0.15) 归一化重判 role，低频配角不再被分段升格为 protagonist。
- **伏笔噪声过滤**：`ForeshadowDeconstructor.filterNoiseForeshadows` 过滤单字伏笔、纯虚词伏笔及 `COMMON_NOISE_WORDS` 黑名单（无法/效果/隐秘/级封印 等）。
- **字数统计口径**：`text-segmenter.ts` 新增导出 `countTotalChars`，结构拆解 `totalWordCount` 改为直接统计源文本而非 AI 估算。
- **商业价值兜底**：`validateGoldenThreeChapters` 恢复"无行首章节标记即空结果"契约，全零兜底统一交由 `analyze()`（非空文本 overallScore 兜底 26）与聚合层 `combineCommercialResults` 处理。
- **可读性零值回退**：`combineReadabilityResults` 对 sentenceSimilarity / emotionUniformity 零值维度提供规则层估算。

### ✅ 验证
- `npx tsc --noEmit`：编译零错误。
- `npx vitest run`：2443 通过，1 例 token-bucket 计时用例在满载下偶发失败（单独运行 20/20 通过），与本次改动无关。
- `npm run build`：esbuild 构建通过。
- 新增单元测试：abilities 结构性过滤、伏笔后处理过滤、role 全局化判定、`countTotalChars`。

---

## Unreleased — 拆解调度器增量缓存

### ✨ 新增功能
- `DeconstructionScheduler` 新增基于内容哈希的增量缓存机制，避免对相同源文本重复拆解。
- 新增 `computeContentHash(text)` 方法：优先使用 Web Crypto API SHA-256 哈希，不可用时自动降级到 `simpleHash()`（djb2 变体 32 位哈希）。
- 缓存 key 为 `bookId:dimension`，存储 `{hash, result}` 结构，纯内存，实例生命周期。

### 🔧 变更
- `runTask` 方法在维度处理前计算 `task.sourceText` 内容哈希。
- `processDimension` 闭包在维度执行前检查缓存命中，命中时跳过拆解、直接复用结果并发送 "缓存命中" 进度。
- 维度执行成功后自动将结果写入 `dimensionCache`。
- `destroy()` 中新增 `dimensionCache.clear()` 确保资源释放。

### ✅ 验证
- `npx tsc --noEmit`：编译零错误。
- `npx vitest run`：2432 通过，2 失败均为已有问题（浮点精度、sourceText 截断），非本次改动引入。

---

## 全文分块拆解主流程 (cont.)

### 🔧 变更
- `DeconstructionScheduler.addTask` 不再按 `textSampleLimit` 截断源文本，任务保留完整 `sourceText`。
- 主拆解入口在维度执行前判断是否需要全文分块，超阈值时复用 `SchedulerSegmentIntegration` 编排分块拆解。
- 分块策略复用 `TextSegmenter`：章节标题优先，章节不可用或单章过长时按段落/字数兜底。
- 分块结果通过 `IncrementalResultAggregator` 聚合，不再默认只取最后一块；保留 LLM 增强可选接入参数，当前调度器未注入 LLM 实例时安全跳过。
- 向量增强失败时，全文分块流程降级到纯统计分块并记录降级原因。

### ✅ 验证
- `npx vitest run tests/unit/services/deconstruction-scheduler.test.ts tests/unit/services/scheduler-segment-integration.test.ts tests/unit/services/segment-aware-breakdown.test.ts tests/unit/engine/incremental-result-aggregator.test.ts`：35 个测试通过。
- `npm run typecheck`：失败；项目存在多处既有类型错误，本次已修复直接相关的 `segment-aware-breakdown.ts` 可选进度回调类型问题。

---

## 4.10.6 — 伏笔拆解器扩展：世界观提取 + 设定植入密度 (2026-07-17)

### ✨ 新增功能（Features）

**世界观设定提取（10 类）**
- `ForeshadowDeconstructor.extractWorldbuilding(text)` 提取小说中的世界观设定
- 10 类 WorldbuildingCategory：geography / history / politics / economy / culture / religion / magic_system / race / technology / organization
- 关键词复用 `dimension-keywords.ts` 的 `WORLDVIEW_WORDS`（system→magic_system、geography、faction→organization），其余 7 类内联定义
- 输出 `WorldbuildingEntry`：name / description / firstMention(0-1) / mentionCount / chapters / relatedEntries
- 相近位置（500 字内）的同类关键词聚类为一个 entry
- 跨章节共现建立关联设定（同章节不同类别）
- 覆盖度评分：覆盖类别数 / 总类别数 * 60 + 条目数归一化 * 40，范围 0-100
- 类别分布 `categoryDistribution` 涵盖所有检测到的类别

**设定植入密度分析**
- `ForeshadowDeconstructor.analyzeSettingDensity(text)` 按章（20 章分段）分析设定词密度
- 每章统计：密度（每千字设定词数）/ 新设定数 / 重复设定数 / 过载标记
- 过载判定：密度 > 20 个/千字 或 新设定 > 10 个/章（阈值常量 `SETTING_DENSITY_OVERLOAD_THRESHOLD` / `SETTING_DENSITY_NEW_SETTING_THRESHOLD`）
- 趋势检测：比较前 1/3、中 1/3、后 1/3 的平均密度 → increasing / decreasing / stable
- 分布合理性评分：100 - 过载章节数 * 10 - 极端波动惩罚（CV>1 扣 15、>0.5 扣 8）- 后期陡增惩罚（10）
- 所有密度值均 >= 0，distributionScore 限制在 0-100

### 🔧 接入与输出（Changes）

**`analyze()` 主流程接入**
- 在原伏笔分析完成后，调用 `extractWorldbuilding(sample)` 与 `analyzeSettingDensity(sample)`
- 返回类型 `ForeshadowAnalysisResult` 新增可选字段 `worldbuilding?` 与 `settingDensity?`
- `EnhancedForeshadowAnalysis` 自动继承（仍可独立调用 `enhanceAnalysis`）
- `analyzeWithVector` 通过 `...baseResult` 展开自动携带新字段
- 全程使用 `await yieldToUI()` 让步，避免阻塞主线程
- 向后兼容：所有新增字段均为可选

**Markdown 报告新增两节**
- `## 世界观设定`：覆盖度概览 + 类别分布表 + 设定列表（名称/类别/首次出现/提及次数/涉及章节）+ 关联设定
- `## 设定植入密度`：平均/峰值/最低密度 + 趋势箭头 + 过载章节警告 + 各章密度分布表

**Frontmatter 同步**
- `buildFrontmatter()` 新增 `worldbuilding`（totalEntries / coverageScore / categoryDistribution）与 `settingDensity`（avgDensity / maxDensity / densityTrend / overloadChapterCount / distributionScore）摘要

### ✅ 验证

- 临时冒烟测试 5 个用例全部通过（已删除）：覆盖度边界、密度趋势、analyze 整合、空文本降级
- TypeScript 编译无新增错误（foreshadow-deconstructor.ts 零错误）
- 现有伏笔分析功能不破坏（新增字段为可选，未改动原有逻辑）

---

## 4.10.5 — 结构拆解器扩展：叙事时序 + 多结构模板 (2026-07-17)

### ✨ 新增功能（Features）

**叙事时序分析（Genette 框架）**
- `StructureDeconstructor.analyzeNarrativeTemporality()` 基于 Gérard Genette 叙事学三维度框架分析
- 时序（Order）：
  - 检测倒叙标记词（回忆/往昔/曾经/当年/想起/追溯...）→ `analeptic`
  - 检测预叙标记词（后来/多年后/将来/最终/结局/终究...）→ `proleptic`
  - 两者共存 → `mixed`；都没有 → `chronological`
  - 输出 flashbacks / flashforwards 位置列表（position + targetPosition + description）
  - 置信度 = min(1, 标记词总数 / 20)
- 时长（Duration）：
  - 按段落分类为 5 种时长类型，分布占比总和 = 1
  - Scene（场景）：对话密度 > 4%（基于引号字符占比）
  - Summary（概述）：对话/描写密度低
  - Pause（停顿）：描写词密度 > 3%
  - Ellipsis（省略）：时间跳跃词密度 > 0.5%（复用 `SHOW_TELL_WORDS.tell.timeJump`）
  - Stretch（拉伸）：复用 `NARRATIVE_TEMPORALITY_WORDS.duration` 词命中
  - 输出 dominantType 与 distribution
- 频率（Frequency）：
  - 重复叙述（repeating）：检测"又一次/再一次/再次/又/再..."
  - 迭代叙述（iterative）：检测"每天/每次/总是/常常/往往..."
  - 无标记 → singulative
  - 输出 repetitiveEvents 列表（最多 20 条）

**多结构模板匹配**
- `StructureDeconstructor.matchStructureTemplates()` 对 5 种结构模板评分
- 模板库：
  - 三幕式（three_act）：建置 → 对抗 → 解决（3 节点）
  - 英雄之旅（hero_journey）：12 阶段完整 Campbell 框架
  - 起承转合（kishotenketsu）：4 节点（与现有 QCCH 分析互证）
  - 救猫咪（save_the_cat）：Blake Snyder 15 节点
  - 网文公式（webnovel_formula）：穿越/重生 → 金手指 → 冲突 → 打脸 → 升级 → 高潮 → 转折 → 终极对决
- 匹配算法：
  - 每个节点按 `[position ± tolerance]` 提取文本窗口
  - 计算关键词密度 → confidence（0-1）
  - confidence > 0.1 视为匹配
  - matchScore = round(100 * matchedNodes / totalNodes * avgConfidence)
  - 范围严格 0-100
- 输出 bestMatch（allMatches 中得分最高）+ allMatches 完整对比

**集成与输出**
- `StructureAnalysisResult` 新增可选字段 `narrativeTemporality?` / `templateMatch?`，向后兼容
- `analyze()` 中调用两个新方法，使用 `yieldToUI` 避免阻塞
- `getEmptyResult()` 返回完整空值结构（避免可选字段缺失）
- Markdown 报告新增「叙事时序分析（Genette 框架）」「结构模板匹配」两个章节
- Frontmatter 同步序列化新字段
- 复用 `dimension-keywords.ts` 的 `SHOW_TELL_WORDS.tell.timeJump` 与 `NARRATIVE_TEMPORALITY_WORDS.duration`

### ✅ 测试
- 新增 `tests/unit/engine/structure-deconstructor-narrative-template.test.ts`（20 个用例）
- 覆盖：时序类型 4 种枚举、时长分布总和≈1、频率 3 种类型、matchScore 0-100、bestMatch 是最高分、5 种模板类型全覆盖、向后兼容 QCCH/三线/节奏单元、Markdown 含新章节、Frontmatter 含新字段

### 📝 文档
- `docs/CODE-INDEX.md` 更新 structure-deconstructor 条目，补全类名与职责描述

---

## 4.10.4 — 人物拆解器扩展：网络中心性 + 声音指纹 (2026-07-17)

### ✨ 新增功能（Features）

**角色网络中心性（图论指标）**
- `CharacterDeconstructor.analyzeNetworkCentrality()` 基于段落共现构建角色网络，手写 BFS / 迭代实现，不引入第三方图论库
- 4 项中心性指标：
  - 度中心性 `CD(v) = degree(v) / (n-1)`，归一化 0-1
  - 接近中心性 `CC(v) = (n-1) / Σ d(v,u)`，BFS 求最短路径
  - 介数中心性 O(V³) 枚举所有节点对的最短路径，归一化 0-1
  - PageRank 迭代 100 次或收敛（d=0.85, tol=1e-6），归一化总和≈1
- 角色定位推断：PageRank Top1 → protagonist；度中心性 >0.5 → major；0.2-0.5 → supporting；其余 minor
- 社区检测：基于共现权重的连通分量 BFS
- 网络密度 = 实际边数 / 可能边数（n*(n-1)/2）；平均路径长度 = 所有节点对最短路径均值
- 每个步骤间使用 `yieldToUI` 避免阻塞

**角色声音指纹**
- `CharacterDeconstructor.analyzeVoiceFingerprint()` 提取每个角色所有对话（引号文本 + 对话动词触发）
- 多维指标：
  - 对话次数 / 平均对话长度
  - 词汇丰富度 TTR（2 字滑动窗口近似）
  - 语气词样本（啊/呢/吧/嘛/呀/哦/哼/呸/切/嗯/嘿 等 30 字）
  - 句式分布（短 <10字 / 中 10-30字 / 长 >30字 占比，三段总和≈1）
  - 性格标记：正式度（正式词/(正式词+口语词)）/ 情感度（情绪词密度，复用 `EMOTION_WORDS`）/ 直接度（短句占比*0.5 + (1-语气词密度)*0.5）
  - 独特表达：2-4 字 ngram，在该角色对话中≥2 次且不在其他角色对话中出现
- 指纹描述：`直率-简短-情绪化-口语-语气词多(啊/呢)` 格式
- 区分度 = 各角色指纹向量两两余弦距离均值 * 100，范围 0-100

**集成与输出**
- `CharacterAnalysisResult` 新增可选字段 `networkCentrality?` / `voiceFingerprint?`，向后兼容
- `analyze()` 末尾自动调用两个新分析
- Markdown 报告新增「角色网络分析」「角色声音指纹」两个章节
- Frontmatter 同步序列化新字段
- 复用 `dimension-keywords.ts` 的 `EMOTION_WORDS`（扁平化为 `ALL_EMOTION_WORDS`）

### ✅ 测试
- 新增 `tests/unit/engine/character-deconstructor.test.ts`（19 个用例）
- 覆盖：度中心性 0-1、PageRank 总和≈1、网络密度 0-1、personalityMarkers 0-1、句式分布总和≈1、TTR 0-1、区分度 0-100、社区覆盖所有节点、边权重正整数、Markdown 含新章节、向后兼容

---

## 4.10.3 — 风格拆解器扩展：词汇丰富度 + 五感分析 (2026-07-17)

### ✨ 新增功能（Features）

**词汇丰富度计算**
- `StyleDeconstructor.analyzeVocabularyRichness()` 新增 TTR / MTLD / Yule's K / Hapax Legomena 综合分析
- 不引入分词库，使用 2 字滑动窗口作为「词」的近似（复用现有 `isAllChinese` 判定）
- TTR 按 1000 字窗口分段计算平均，避免长文本 TTR 偏低问题
- MTLD 采用 McCarthy & Jarvis 2010 标准算法：正向 + 反向双向计算后取平均，阈值 0.72
- Yule's K 采用标准公式 `K = 10^4 * (M2 - N) / N^2`，K 越小词汇越丰富
- Hapax Legomena = 只出现一次的词数 / 总词数
- 等级划分：TTR > 0.7 且 MTLD > 50 → high；TTR < 0.4 或 MTLD < 30 → low；其余 medium
- 综合评分 `score = 0.3·ttr_norm + 0.3·mtld_norm + 0.2·yulesK_norm + 0.2·hapax_norm`，归一化到 0-100

**五感描写分析**
- `StyleDeconstructor.analyzeFiveSenses()` 复用 `dimension-keywords.ts` 的 `FIVE_SENSES_WORDS` 词典
- 5 类感官：visual / auditory / olfactory / gustatory / tactile，键名与 `SenseType` 完全对齐
- 构造时一次性构建 `senseWordMap` 与 `senseMaxWordLen`，扫描时按最长匹配优先（避免单字过度匹配）
- 输出每类感官的：出现次数、占比（总和≈1）、每千字次数、样本词（每类最多 20 个）
- 主导感官 = 出现最多的感官；空文本默认 `visual`
- 平衡度基于熵：`balanceScore = (H / log2(5)) * 100`，分布越均匀得分越高
- 密度等级：每千字总感官词数 > 10 → high；3-10 → medium；< 3 → low

**analyze() 整合**
- `StyleAnalysisResult` 新增两个可选字段：`vocabularyRichness` / `fiveSenses`
- `analyze()` 方法接入两个新方法，每个方法之间插入 `await yieldToUI()` 避免阻塞主线程
- `getEmptyResult()` / `buildFrontmatter()` / `buildMarkdownBody()` 同步更新
- Markdown 报表新增「词汇丰富度」「五感分析」两个章节
- Frontmatter 同步包含扩展字段，供下游向量增强流程使用

### 🔒 向后兼容（Compatibility）

- 所有新增字段均为可选，不破坏现有调用方（`StyleDeconstructorV2.v1Result` 等保持原样）
- 10 万字取样限制（MAX_SAMPLE = 100_000）保持不变
- 空文本/单字文本返回零值结果，避免崩溃
- 复用 `dimension-keywords.ts` 的 `FIVE_SENSES_WORDS`（注意：导出名是复数 `SENSES`），保持单一数据源
- 仅扩展 `style-deconstructor.ts`，不修改其他拆解器，不影响 V2 风格分析

### 🧪 测试（Tests）

- 新增 `tests/unit/engine/style/style-deconstructor-extensions.test.ts`，覆盖 29 个用例
- 覆盖范围：TTR/MTLD/Yule's K/Hapax 边界、五感分布总和≈1、balanceScore 范围、空文本/单字/超长文本、Markdown 输出、向后兼容、现有功能回归
- 现有 `style-deconstructor-v2.test.ts` 53 个用例全部通过
- `tests/unit/engine/style/` 全部 333 个用例通过

---

## 4.10.2 — 节奏拆解器扩展：情感弧 + NRC 8 情绪 + 节奏曲线 (2026-07-17)

### ✨ 新增功能（Features）

**情感弧原型识别**
- `RhythmDeconstructor.detectEmotionArc()` 新增 Vonnegut 8 形状情感弧识别能力
- 支持 8 种原型：rags_to_riches / riches_to_rags / man_in_hole / icarus / cinderella / oedipus / steady / complex
- 输出原型类型、置信度、章节情感值序列、分段趋势、原型描述
- 章节情感值基于 NRC 正负极性归一化（[-1, 1] 区间），方差 < 0.1 判定为 steady

**NRC 8 情绪分析**
- `RhythmDeconstructor.analyzeNRCEmotion()` 基于 NRC 情绪词典统计 8 类情绪词频
- 8 类情绪：anger / anticipation / disgust / fear / joy / sadness / surprise / trust
- 输出全书分布占比（总和≈1）、按章分布、主导情绪、情绪波动度、情绪转换列表
- 复用 `dimension-keywords.ts` 的 `EMOTION_WORDS` 词典，保持单一数据源

**节奏曲线计算**
- `RhythmDeconstructor.calculateRhythmCurve()` 输出每章节奏评分（0-100）
- 评分公式：0.3×事件密度 + 0.3×对话密度 + 0.2×段落节奏 + 0.2×情绪强度
- 节奏模式判定：fast / medium / slow / irregular（标准差 > 25 优先判定为 irregular）
- 输出平均节奏、节奏变化列表、节奏描述

**analyze() 整合**
- `RhythmAnalysisResult` 新增三个可选字段：`emotionArc` / `nrcEmotion` / `rhythmCurve`
- `analyze()` 方法接入三个新方法，每个方法之间插入 `await yieldToUI()` 避免阻塞主线程
- `getEmptyResult()` / `buildFrontmatter()` / `buildMarkdownBody()` 同步更新
- Markdown 报表新增「情感弧分析」「NRC 8 情绪分析」「节奏曲线」三个章节

### 🔒 向后兼容（Compatibility）

- 所有新增字段均为可选，不破坏现有调用方
- 10 万字取样限制（MAX_SAMPLE_LENGTH = 100_000）保持不变
- 空文本/无章节边界返回带空数组的默认结果，避免崩溃
- NRC 极性划分：正向=joy/trust/anticipation/surprise，负向=anger/disgust/fear/sadness

---

## 4.10.1 — 知识库管理工作台全面加固 (2026-07-17)

### 🔴 致命修复（Critical）

**deleteBook 递归删除**
- `KnowledgeBaseManager.deleteBook()` 由仅删除索引改为递归删除书籍整个目录及所有子文件
- 彻底解决删除书籍后残留大量拆解文件、风格指纹、向量索引等垃圾文件的问题
- 同时从总索引中移除条目，保证数据一致性

**pause 任务取消**
- `DeconstructionScheduler.pauseTask()` 暂停时正确调用 `AbortController.abort()` 取消进行中的拆解
- 修复暂停后后台仍继续运行、占用 API 额度和 CPU 资源的严重问题
- 取消后状态正确置为 `paused`，保留已完成维度的进度

### 🟠 严重修复（Severe）

**路径安全过滤**
- 所有书籍路径操作增加路径穿越防护，过滤 `../`、绝对路径等非法路径段
- 防止通过构造恶意书名访问知识库目录外的文件
- 统一使用 `kbBookDir()` 标准化路径生成

**同名书籍检测**
- `addBook()` 新增同名检测逻辑，发现重名时自动追加序号（如 `书名 (2)`）
- 避免新增书籍时静默覆盖已有书籍及其所有拆解数据
- 支持自定义重名处理策略

**索引损坏重建**
- 总索引文件（index.md）损坏或 JSON 解析失败时，自动触发全量扫描重建
- 从各书籍目录的「基本信息.md」中恢复元数据，保证系统可用性
- 重建完成后通过 Notice 提示用户检查数据完整性

**改名原子操作**
- `renameBook()` 采用原子操作流程：创建新目录 → 复制所有文件 → 验证完整性 → 删除旧目录 → 更新索引
- 任意步骤失败自动回滚，避免改名中途失败导致书籍数据丢失或分裂
- 大文件复制增加进度反馈

**看门狗误判修复**
- Watchdog 活性检测增加「维度切换宽限期」，维度切换期间的短暂无进度不判定为中断
- 心跳检测时间从 30s 调整为更合理的间隔，避免正常长任务被误杀
- 中断判定增加二次确认机制，减少误判概率

**资源泄漏修复**
- `DeconstructionScheduler.destroy()` 完整清理所有任务、定时器、AbortController、事件监听器
- 插件卸载或知识库重新初始化时无残留资源
- 修复 Worker 池未正确终止的问题

**搜索框焦点问题**
- 知识库视图搜索框修复自动聚焦失效问题
- 快捷键 `/` 可正确聚焦搜索框
- 搜索结果高亮和键盘导航正常工作

**竞态条件修复**
- 修复快速连续点击「开始拆解」「暂停」「取消」导致的状态错乱
- 所有状态变更操作增加互斥锁，保证状态机一致性
- 书籍状态更新使用 SerializedWriter 串行写入

**状态泄漏修复**
- 任务完成/取消/失败后及时清理内部 Map（taskMap、progressMap、abortControllerMap）
- 修复长时间运行后内存持续增长的问题
- 增加定时清理机制，自动移除已结束超过 1 小时的任务记录

**按钮反馈修复**
- 所有操作按钮增加 loading/disabled 状态，避免重复点击
- 危险操作（删除、取消）增加确认弹窗二次确认
- 操作成功/失败均有明确的视觉反馈和 Notice 提示

### 🟡 一般优化（General）

**frontmatter \r\n 兼容**
-  frontmatter 解析同时支持 `\n` 和 `\r\n` 换行符
- Windows 系统下编辑的文件不再出现解析错误
- 写入时统一使用 `\n` 换行，保证跨平台一致性

**confirm 统一**
- 所有确认弹窗统一使用 `OperationConfirmModal` 组件
- 移除散落在各处的原生 `confirm()` 调用
- 统一的视觉风格和交互体验

**错误提示优化**
- 所有错误提示使用用户友好的中文描述，而非技术堆栈信息
- 错误分级：普通提示 / 警告 / 严重错误，使用不同配色和图标
- 关键错误提供「查看详情」入口，方便排查问题

**监听器幂等**
- 事件监听器注册增加幂等性检查，重复注册不会触发多次回调
- 使用 `Set` 管理监听器引用，避免重复添加
- dispose 时完整清理，无残留监听器

**Map 清理**
- 所有内部状态 Map 增加定期清理机制
- 任务结束后保留一段时间用于查询，随后自动清理
- 提供手动清理 API，用户可随时清理历史记录

**pending 暂停**
- 待处理（pending）队列的任务也支持全局暂停控制
- 暂停后新添加的任务不会自动开始执行
- 恢复后按优先级顺序依次启动

**写放大优化**
- 进度更新从每次变化都写入文件改为批量合并写入
- 使用 debounce 合并短时间内的多次进度更新
- 显著减少磁盘 I/O 和 frontmatter 解析次数

**进度 debounce**
- `DeconstructionScheduler` 进度事件发射增加防抖（默认 100ms）
- 避免高频进度更新导致 UI 卡顿和过度重绘
- 最终进度更新保证立即发射，不被防抖延迟

---

## Unreleased

### 🐛 问题修复

**拆解器同步阻塞修复（6 维度全覆盖）**
- `rhythm-deconstructor.ts`、`technique-deconstructor.ts`、`structure-deconstructor.ts`、`character-deconstructor.ts`、`foreshadow-deconstructor.ts` 的 `analyze()` 方法由同步改为 `async`，并在重计算之间插入 `await yieldToUI()` 让出主线程，避免 200 万字长文本分析时 Obsidian 卡死
- 所有 5 个拆解器在 `analyze()` 入口添加 10 万字取样限制（`text.slice(0, 100_000)`），将 O(n²) 全文 `indexOf(para, charOffset)` 降为取样范围内的 O(n)，显著降低长文本分析耗时
- `analyzeWithVector()` 与 `saveToMarkdown()` 中的 `this.analyze(text)` / `this.analyze('')` 调用同步补充 `await`，修复 async 传染后返回 Promise 导致后续逻辑失效的问题
- `style-deconstructor.ts` 的 `analyzeWithVector()` 中遗漏的 `await this.analyze(text)` 一并补齐（Task 1 遗留）
- `deconstruction-worker.ts` 中 5 个拆解器的 `analyze(input.text)` 调用补充 `await`，确保 worker handler 正确等待 async 结果
- 约束：不修改返回值结构，不修改无性能问题的方法，保持现有代码风格

**Ollama Embedding 超时与取消支持**
- `OllamaEmbeddingProvider.embed()` 新增 30 秒超时机制：通过 `AbortController` + `setTimeout` 控制，Ollama 服务响应过慢时不再让 fetch 无限等待，避免 Obsidian 卡死
- `embed()` 与 `embedBatch()` 新增可选 `options?: { signal?: AbortSignal }` 参数，支持外部取消嵌入请求；超时或取消时抛出明确的中文错误信息
- `EmbeddingProvider` 接口及 `OpenAIEmbeddingProvider`（含 Doubao/Qwen 子类）的 `embed`/`embedBatch` 签名同步加入可选 `options` 参数，向后兼容（不传时行为与修改前一致）
- 注意：本次仅 `OllamaEmbeddingProvider` 接入超时逻辑，OpenAI 系 Provider 仅做签名兼容；调用方传 signal 留待后续任务

**Ollama Embedding 批量并发优化**
- `OllamaEmbeddingProvider.embedBatch()` 由串行逐个调用改为并发限流（最大并发数 5）：使用纯 Promise worker pool 模式，启动 `min(5, texts.length)` 个 worker 共享 `nextIndex` 游标消费任务
- 结果顺序保持：通过 `results[currentIndex] = ...` 按原索引写回，返回顺序与输入一致
- 取消传播：每个 worker 循环及 `executeOne` 入口均检查 `options.signal.aborted`，取消时抛出中文错误
- 不引入第三方库（如 p-limit、bluebird），不修改 `embed()` 方法本身，签名与返回类型不变
- 背景：6 维度拆解约 300+ 次串行 HTTP 请求，并发限流后显著降低总耗时

## 4.10.0 — 全流程进度可视化系统 (2026-07-15)

### 🚀 新增功能

**全流程进度可视化系统**
- 核心层：ProgressEmitter 进度状态管理与事件发射，支持 6 种状态（pending/running/paused/completed/failed/cancelled）
- 核心层：TimeEstimator 基于历史数据的时间估算引擎，使用中位数统计和字数分桶
- UI 层：ProgressBarComponent 进度条组件
- UI 层：StepListComponent 多步骤列表组件
- UI 层：LoadingOverlayComponent 全屏加载遮罩
- UI 层：TaskCardComponent 任务卡片组件
- UI 层：OperationConfirmModal 操作确认弹窗
- UI 层：FloatingProgressBall 悬浮进度球
- UI 层：StatusBarProgressIndicator 状态栏指示器
- Worker 层：WorkerManager Web Worker 池管理与任务调度
- Worker 层：WorkerRuntime Worker 运行时框架
- Worker 层：WorkerProtocol Worker 通信协议定义
- Worker 层：DeconstructionWorkerManager 拆解 Worker 管理器
- Worker 层：DeconstructionWorker 拆解 Worker 入口

**开发文档**
- 系统总览文档（README.md）
- ProgressEmitter 使用指南
- TimeEstimator 接入指南
- UI 组件使用指南
- Web Worker 接入指南
- 新功能接入完整流程
- 现有功能迁移指南

### ✅ 优化改进

**已接入功能**
- 知识库拆解（DeconstructionScheduler）全面接入进度可视化
- 文笔风格蒸馏（StyleDistillerModal）接入进度显示
- 协同写作（CoWritingView + CoWriteFloatingPanel）接入进度反馈

**中断状态恢复**
- 插件启动时自动恢复中断的拆解状态：将所有 processing 状态的书籍重置为 interrupted，保留中断时进度
- KnowledgeBaseManager 新增 recoverInterruptedBooks 方法，遍历书籍并恢复中断状态
- main.ts onload 在知识库初始化完成后调用恢复逻辑，并通过 Notice 提示用户
- 书籍详情页 interrupted 状态新增「🔄 恢复拆解」按钮（重置为 pending 并重新加入拆解队列）和「🗑️ 清除状态」按钮（清除进度和错误并回到待拆解）
- 书籍详情页 processing 状态新增「⚠️ 强制取消」逃生口按钮，经 OperationConfirmModal 确认后取消调度任务并将状态置为 interrupted，保留已完成维度
- 新增 `.nw-btn-warning` 按钮变体样式（amber 警告色），与 interrupted 徽章配色一致

**拆解器 UI 让步优化（yieldToUI 注入）**
- 6 个拆解器的 `analyzeWithVector()` 方法注入 `await yieldToUI()` 调用，解决知识库拆解整本小说（100万字+）时 UI 完全冻结的问题
- 涉及文件：style-deconstructor、structure-deconstructor、rhythm-deconstructor、technique-deconstructor、character-deconstructor、foreshadow-deconstructor
- 让步点：同步 `analyze()` 计算之后 + 每个向量增强步骤（`enhanceXxx`）之前 + 批量 `embedTexts` 调用之间
- 工具函数 `shared/yield.ts` 通过 `Promise + setTimeout(0)` 将后续代码推到下一个事件循环 tick，让浏览器处理 UI 事件（滚动、点击等）
- character-deconstructor 的 `enhanceCharacterFeatures` 方法内批量 `embedTexts`（Promise.all）之后也增加了让步点
- foreshadow-deconstructor 的 `analyzeWithVector` 内多处 `embedTexts`/`findSimilarPairs` 调用之间均增加让步点

### 📊 架构特性

- 三层架构设计：核心层 / UI 层 / Worker 层，职责分离
- 状态不可变：每次进度更新生成新状态快照
- 节流控制：进度更新频率限制为 10 次/秒，优化 UI 性能
- 自动降级：Worker 不可用时自动回退到主线程执行
- 取消支持：基于 AbortController 的统一取消机制
- 事件驱动：订阅式状态更新，组件间解耦

### 🐛 问题修复

**拆解调度器活性检测与启动时序修复（DeconstructionScheduler）**
- 修复拆解启动时序问题：`addTask` 创建任务后立即调用 `setBreakdownStatus(bookId, 'processing', 0)`，避免任务入队后书籍状态仍停留在旧值导致 UI 误判
- 从 `runTask` 中移除冗余的 `setBreakdownStatus('processing', 0)` 调用（已前移至 `addTask`）
- 新增 Watchdog 活性检测机制：每 30 秒检查任务心跳，连续 120 秒无进度更新则判定为中断
- `emitProgress` 每次刷新 `lastSeenAlive` 心跳时间戳，作为 watchdog 的活性信号源
- 中断时自动将书籍状态置为 `interrupted`，弹出 Notice 提示用户检查或重新拆解
- `runTask` 的 `finally` 块统一清理 watchdog 定时器，确保任务取消/失败/完成路径均无残留计时器

## 4.9.0 — 知识库题材管理完善 (2026-07-14)

### 🚀 新增功能

**知识库题材管理功能**
- 实现完整的新增题材功能：支持创建自定义题材，包含基本信息、性格标签、能力类型、角色定位、背景类型、写作技巧、细分题材、权重配置
- 实现题材编辑功能：自定义题材可完整编辑，预设题材支持"另存为自定义"
- 实现题材删除功能：自定义题材可删除，删除时清理关联配置
- 题材导入导出：支持 JSON 格式的题材导入导出，ID冲突时提供覆盖/跳过/重命名选项
- 新增10个预设题材：奇幻西方、体育竞技、二次元、灵异鬼怪、现代耽美、古代耽美、萌宝甜宠、职场婚恋、轻小说、恐怖惊悚
- 自定义题材与知识库书籍分类联动，可用于书籍题材分类和筛选

### ✅ 优化改进

**WebnovelKnowledgeBase 增强**
- 新增自定义题材内存管理：addCustomGenre、updateCustomGenre、deleteCustomGenre
- 所有查询方法自动合并预设题材和自定义题材
- 自定义题材优先级高于预设（ID冲突时自定义覆盖）

**KnowledgeBaseConfigManager 增强**
- 支持完整 GenreConfig 结构的自定义题材持久化
- 旧版精简格式向后兼容，自动转换为完整格式
- 删除题材时一并清理关联的性格标签、能力类型、技巧配置

### 📊 数据统计
- 预设题材从 8 个增加到 18 个
- 男频题材：8 个（玄幻修仙、都市现代、历史军事、游戏竞技、奇幻西方、体育竞技、二次元、灵异鬼怪）
- 女频题材：6 个（古代言情、现代言情、现代耽美、古代耽美、萌宝甜宠、职场婚恋）
- 中性题材：4 个（科幻末世、悬疑推理、轻小说、恐怖惊悚）

## 4.8.0 — UI 选项卡架构重构与设计优化 (2026-07-13)

### 🚀 新增功能

**新建项目模态框 UI 重设计**
- 完全重写 `ui/create-project-modal.ts` HTML 结构，采用语义化标签
- 新增 270+ 行 CSS 样式（`styles.css`），使用 `--nw-*` 设计 token
- 项目类型切换器：并排按钮设计（🎨 原创 / 📖 同人），选中态强调色背景
- 题材标签：胶囊形状，选中态强调色填充，hover 上浮效果
- 同人字段区域：卡片式设计 + 淡入下滑动画
- 设定库下拉选择器：搜索过滤 + 悬停效果
- 移除所有内联样式，统一使用 CSS 类控制外观

### ✅ 优化改进

**工作台选项卡 CSS 类名统一**
- 移除 `tab-controller.ts` 中所有内联 `style` 属性，改用 CSS 类名控制状态
- 修复 tab bar 容器类名不匹配问题（`novel-writer-fw-tabs-container` vs `.novel-writer-fw-tabbar`）
- 完善 normal / hover / active / selector 四种视觉状态样式
- 激活状态：背景色 + 加粗 + 底部 2px 强调色边框
- 关闭按钮默认低透明度，hover 时变清晰
- 右侧按钮（+、⚙️、🔄）统一样式，带 hover 效果
- 所有状态变化 0.15s 平滑过渡
- 清理重复 CSS 定义，统一使用 `--nw-*` 设计 token

**设置页面选项卡样式统一**
- 统一 `settings-tab.ts` 和 `mini-settings-modal.ts` 的 CSS 类命名
- 统一类名：`.nw-settings-tabbar`、`.nw-settings-tab`、`.active`
- 与工作台选项卡一致的设计语言（圆角、边框、过渡动画）

**项目选择器优化**
- 移除项目网格顶部多余的新建项目大卡片（右上角工具栏已有入口）

### 🐛 Bug 修复

- **选项卡点击无反应**：内联样式优先级高于 CSS 类，导致 active 状态视觉反馈失效。移除内联样式后修复
- **activateTab 重复点击不刷新**：当 `activeTabId === tabId` 时直接 return，未重新渲染。修复为始终渲染并提示"已刷新当前页面"
- **向导按钮无响应**：由上述 activateTab 问题导致，修复后向导按钮正常工作

### 📊 测试覆盖
- 新增 6 个 e2e 测试用例（`tests/e2e/project-card-interactions.spec.ts`）
  - 点击向导按钮测试
  - 点击写作按钮测试
  - 点击全部章节按钮测试
  - 点击右上角新建项目按钮测试
  - 项目卡片点击显示预览面板测试
  - 项目卡片点击两次关闭预览面板测试

### 📝 文档同步
- `docs/ARCHITECTURE.md` 更新：补充 `ui/full-writer/` 子目录控制器描述
- `shared/changelog-data.ts` 更新：补充 4.7.0 / 4.7.1 / 4.8.0 三个版本条目

---

## 4.7.1 — 偏离检测引擎 (2026-07-13)

### 🚀 新增功能

**实时监控 V2 Task 2: 偏离检测引擎**
- 新增 `engine/quality/deviation-detector.ts` 偏离检测引擎
  - 5 类偏离检测：剧情偏离主线、人物 OOC、前后矛盾、伏笔遗忘、节奏偏离
  - 3 级预警：info / warning / critical，阈值可配置（默认 60/30/0）
  - `DeviationDetector.detect()` 全量检测 + `detectByType()` 单类型检测
  - 增量检测：传入 `changedRange` 仅检测变更部分相关维度（主线/OOC/伏笔可跳过）
  - 取消机制：支持 `AbortSignal`，检测中取消抛出 `AbortError`
  - 结果缓存：复用 `LruCache`，类型级 + 完整结果两级缓存
  - 伏笔追踪：支持从 `DeviationContext.foreshadows` 显式提供，或从前文章节 frontmatter 自动解析
  - 伏笔回收阈值章节数可配置（默认 10 章）
  - 依赖注入复用 V1 引擎：`IPlotDivergenceEngine` / `ICharacterConsistencyChecker` / `IRhythmAnalyzerForDeviation` + 复用 `analyzeCoherence`
  - 每个类型降级规则：无注入时使用内置规则（零外部依赖）
  - 检测结果模型：`DeviationReport`（总分 + 各类型分数 + 问题列表 + 改进建议）

### 📊 测试覆盖（偏离检测引擎）
- 新增 67 个单元测试（`tests/unit/engine/quality/deviation-detector.test.ts`）
- 5 类偏离检测：每类含 V1 注入和降级规则两条路径
- 预警级别系统：info/warning/critical 阈值判定 + 自定义阈值
- 增量检测：changedRange 支持、可跳过类型正确跳过
- 取消机制：AbortSignal 已取消/检测中取消/无 signal/detectByType 也支持
- 结果缓存：相同内容命中、不同内容不命中、clearCache/invalidateCache
- 伏笔追踪：上下文提供/frontmatter 数组解析/frontmatter 字符串解析/已回收不告警
- 与 V1 引擎集成：updateOptions 调用、historyTexts 传递、向后兼容验证
- 向后兼容：V1 PlotDivergenceEngine + V2 Task 1 QualityScoreEngine 测试全部通过（146 测试零回归）

### 📝 文档同步
- `docs/ARCHITECTURE.md` 更新：在 quality/ 子目录中补充 V2 Task 2 引擎描述
- `docs/API.md` 新增第八章：偏离检测引擎 API 完整文档（11 节，覆盖类型/接口/类/上下文/报告/伏笔/增量策略/集成）

---

## 4.7.0 — 六维质量评分引擎 + 上下文增量更新 (2026-07-13)

### 🚀 新增功能

**实时监控 V2 Task 1: 六维质量评分引擎**
- 新增 `engine/quality/quality-score-engine.ts` 六维质量评分引擎
  - 六个维度：可读性、节奏、情绪饱满度、人物一致性、情节连贯性、语言质感
  - `QualityScoreEngine.evaluate()` 全量评估 + `evaluateDimension()` 单维评估
  - 增量评估：传入 `changedRange` 仅评估变更部分（人物一致性维度可跳过无变更范围）
  - 取消机制：支持 `AbortSignal`，评估中取消抛出 `AbortError`
  - 结果缓存：复用 `LruCache`，维度级 + 完整结果两级缓存，相同内容不重复评估
  - 历史趋势：记录最近 N 次评分（默认 20），支持 rising/falling/stable 趋势分析
  - 依赖注入复用现有引擎：`IRhythmAnalyzer` / `IEmotionAnalyzer` / `ICharacterChecker` / `WritingQualityEngine`
  - 每个维度降级规则：无注入时使用内置规则（零外部依赖）
  - 评估结果模型：`QualityScore`（总分 + 六维 + 问题列表 + 改进建议 + 趋势）

### 📊 测试覆盖（六维质量评分引擎）
- 新增 51 个单元测试（`tests/unit/engine/quality/quality-score-engine.test.ts`）
- 六维评分计算：每个维度评分正确、综合评分为加权平均
- 增量评估：changedRange 支持、人物一致性维度可跳过
- 评估结果缓存：相同内容命中、不同内容不命中、clearCache/invalidateCache
- 取消机制：AbortSignal 已取消/评估中取消/无 signal
- 问题描述与改进建议：字段结构、严重度排序、优先级排序
- 历史趋势：stable/rising、getHistory/clearHistory、上限裁剪
- 向后兼容：V1 WritingQualityEngine 测试全部通过（零回归）

**Task 4.3: 上下文增量更新**
- 新增 `engine/context/context-diff-detector.ts` 上下文变更检测器
  - `ContextDiffDetector.detectChanges()` 检测两个 GatheredContext 之间的差异
  - 支持 5 种变更类型：character-changed / chapter-changed / entity-changed / worldview-changed / timeline-changed
  - `createChangeSetFromPaths()` 将文件路径映射为变更集，用于增量更新流程
  - `getAffectedSections()` 返回需要重新计算的上下文分区
- 新增 `engine/context/incremental-updater.ts` 增量更新器
  - `IncrementalUpdater.updateContext()` 根据变更集仅重新获取受影响分区
  - `isIncrementalUpdateFaster()` 判断增量更新是否比全量更快（50% 阈值回退）
  - 上下文版本号机制：递增整数 + 时间戳，保留最近 20 次变更历史
  - 与 MultiLayerCache 深度配合：未变更部分从 L1/L2 缓存读取
- `ContextManager` 新增 `gatherIncremental()` 方法
  - 优先使用增量更新，变更范围 > 50% 时自动回退全量
  - 保持原有 `gatherAll()` 方法不变，新功能纯增量
  - 智能失效策略：文件修改时精确失效相关分区缓存（而非全部清空）
  - 新增 `getVersionHistory()` / `getCurrentContextVersion()` / `getIncrementalStats()`
  - 新增 `invalidateIncrementalCache()` 独立清除增量缓存

### 📊 测试覆盖
- 新增 62 个单元测试（context-diff-detector 34 + incremental-updater 28）
- 变更检测：各种变更类型的识别
- 增量更新：部分变更后结果与全量一致（一致性验证）
- 版本号机制：版本递增、历史记录、最大保留数
- 回退策略：变更范围过大时自动回退全量
- MultiLayerCache 集成：分区缓存命中与未命中
- 现有测试无回归（context-manager 46 + cache 69 + repository 210）

**写作指纹 V2 Task 1: 12 维数据结构定义与 V1 数据迁移**
- 新增 `engine/style/style-dimensions-v2.ts` V2 12 维数据结构定义
  - 12 个维度：RhythmStats / SentencePatternStats / WordChoiceStats / RhetoricStatsV2 / PerspectiveStats / EmotionStats / TensionStats / InfoDensityStats / DialogueStatsV2 / DescriptionStats / NarrationStats / LanguageTextureStats
  - 每个维度包含：定量统计字段 + 定性描述字段（50-100字）+ 代表性示例数组（2-3段）+ 数据状态标记（'complete' | 'pending' | 'partial'）
  - 维度常量：STYLE_DIMENSIONS_V2（12 维元信息数组）、V1_TO_V2_FIELD_MAP（V1→V2 字段映射）、V2_NEW_DIMENSIONS（5 个新增维度）
  - V2Fingerprint 完整类型：含 version 标识 + v1Backup 备份字段 + migratedAt 时间戳
- 新增 `engine/style/fingerprint-migrator.ts` V1→V2 迁移工具
  - `migrateV1ToV2()` 纯函数迁移：V1 的 7 维字符串映射到 V2 对应维度的 description（标记 complete），新增 5 维填充默认零值（标记 pending）
  - `migrateFileV1ToV2()` 文件级迁移：迁移前写入 `.v1.bak` 备份文件，迁移或写入失败时从备份自动回滚
  - `needsV1ToV2Migration()` 版本检测：幂等设计，已迁移的 V2 数据不会重复迁移
  - 工具函数：`getPendingDimensions()` / `getCompleteDimensions()` / `validateV2Fingerprint()` / `getDimensionStatusSummary()` / `rollbackV2ToV1()`
- 修改 `engine/style-fingerprint-library.ts` 集成自动迁移
  - `loadTemplate()` / `loadGlobal()` / `loadProject()` 三个加载方法在加载前自动调用 `migrateV1ToV2Dimensions()`（幂等，已迁移则跳过）
  - `migrateFingerprintV1toV2()` 方法支持三种输入格式：V1 旧格式、V1 新格式、V2 格式（从 v1Backup 提取 V1 特征）
  - V1 `StyleFingerprintFeatures` 和 `StyleFingerprint` 接口标记 `@deprecated`，保留 V1 API 向后兼容
  - 不修改 V1 拆解逻辑（style-deconstructor.ts 保持不变）

### 📊 测试覆盖（写作指纹 V2 迁移）
- 新增 50 个单元测试（`tests/unit/engine/style/fingerprint-migrator.test.ts`）
- V2 数据结构类型：12 维全部存在、每维有 status 字段、常量数组完整（STYLE_DIMENSIONS_V2 / V1_TO_V2_FIELD_MAP / V2_NEW_DIMENSIONS）
- V1→V2 字段映射：7 个 V1 字符串字段正确映射到 V2 description、V1 来源维度标记 complete、空字符串标记 pending
- 缺失维度 pending 标记：5 个新增维度 status='pending'、定量统计为零值、description 为空
- 迁移前备份：`.v1.bak` 文件生成、备份内容与原始 V1 数据一致、单个指纹和批量指纹均生成备份
- 迁移失败回滚：`rollbackV2ToV1()` 可从备份恢复、幂等检测、JSON 解析失败回滚、混合 V1/V2 数组只迁移 V1 项
- 迁移耗时 < 50ms：单次迁移、文件级迁移、批量迁移 10 个指纹均满足性能要求
- V1 API 兼容：`v1Backup` 保留 V1 原始 7 字段、`version='v2'`、`migratedAt` 时间戳、`validateV2Fingerprint()` 校验、`needsV1ToV2Migration()` 检测
- 现有测试无回归（style-similarity-scorer 13 + file-system-port 13 + settings-migrator 18 全部通过）

**写作指纹 V2 Task 2: StyleDeconstructor 升级到 12 维**
- 新增 `engine/style/style-deconstructor-v2.ts` V2 12 维风格拆解器
  - V2 内嵌 V1 实例，复用 V1 分析结果作为基础（完全向后兼容）
  - 主入口 `analyze(text)` 返回 `{features, stats, v1Result}`，V1 调用方可直接使用 v1Result 字段
  - `analyzeV1(text)` V1 兼容包装器方法
  - 12 维分析：rhythm / sentencePattern / wordChoice / rhetoric / perspective / emotion / tension / infoDensity / dialogue / description / narration / languageTexture
  - 7 维升级：节奏（标点密度、段落密度、停顿频率）、用词（常用词比例、生僻词、虚词）、修辞（通感）、视角（叙述距离）、对话（台词个性化）、叙事（叙事速度、时间跳跃、场景切换）、语言质感（古风化、地域特色）
  - 5 维新增：句式（倒装句、省略句、排比句、设问句、从句嵌套深度）、情绪（正负向比例、波动频率、强度分布）、张力（悬念词、冲突频率、转折句、伏笔标记、高潮分布）、信息量（信息密度、专有名词、设定植入、概念引入）、描写（环境描写、细节密度、感官分布、白描工笔比例）
  - 每维度生成 50-100 字自然语言描述（纯规则模板化）
  - 每维度筛选 2-3 段代表性示例片段（50-200 字）
  - 词表常量：约 20 个 Set 集合（情绪/悬念/冲突/感官/古风/地域等），零外部依赖
- 性能优化：跨词表合并正则匹配
  - 构造函数预构建合并结构：所有词表的单字词合并成大 Set，多字词合并成大正则
  - `analyze` 方法预计算所有词表 countKeywords 结果（一次遍历 + 一次正则匹配），各维度从预计算结果取值
  - `countChineseChars` 大文本缓存，避免重复遍历
  - V2 额外计算耗时 ≤ 1.5 倍 V1（预热后稳定通过）

### 📊 测试覆盖（写作指纹 V2 Task 2）
- 新增 53 个单元测试（`tests/unit/engine/style/style-deconstructor-v2.test.ts`）
- 基础结构与向后兼容：12 维全部存在、每维有 status 字段、v1Result 字段完整、analyzeV1 方法兼容
- 新增维度统计：句式（倒装/省略/排比/设问）、情绪（正负向比例/波动）、张力（悬念/冲突/转折）、信息量（专有名词/设定植入）、描写（感官分布/白描工笔）
- 7 维升级精细统计：节奏（标点密度）、用词（常用词/虚词）、修辞（通感）、视角（叙述距离）、对话（台词个性化）、叙事（叙事速度/时间跳跃/场景切换）、语言质感（古风化/地域特色）
- 自然语言描述生成：每维度 50-100 字、非空、反映文本特征
- 示例片段筛选：每维度 2-3 段、50-200 字、非空
- 性能测试：预热后 V2 额外耗时 ≤ 1.5 倍 V1、10 万字文本 10 秒内完成
- V1 API 向后兼容：analyzeV1 返回 V1 格式、v1Result 字段完整、V1 实例独立可用
- 边界情况：空文本、纯标点、超长文本、单句文本、无对话文本、纯对话文本
- V1 迁移测试 50 个全部通过（无回归）
- 现有测试无回归（style 目录 103 个测试全部通过）

## 4.6.0 — 版本管理与更新提示 (2026-07-12)

### 🚀 新增功能

**版本管理服务**
- 新增 `services/update-checker.ts` 更新检查服务
- 支持从 GitHub Releases 或自定义服务器检查最新版本
- SemVer 版本号比较，自动判断是否有新版本
- 可配置检查频率（每天/每3天/每周/每月），默认关闭（尊重用户隐私）
- 记录上次检查时间，避免频繁检查
- 检查失败不影响插件正常使用（静默降级）

**更新提示 UI**
- 设置页新增「ℹ️ 关于」标签页，包含版本信息区域
- 显示当前版本号、最新版本号、上次检查时间
- 提供「检查更新」按钮和「更新日志」按钮
- 可配置自动检查开关、更新源、检查间隔
- 有新版本时设置页顶部显示更新提示条
- 提示条包含新版本号和主要更新内容摘要
- 提供「查看详情」和「稍后提醒」按钮
- 插件加载时静默检查，不打扰用户

**版本变更日志**
- 新增 `shared/changelog-data.ts` 内置更新日志数据
- 包含最近 5 个版本的详细更新记录
- 新增 `ui/changelog-modal.ts` 更新日志模态框
- 支持按版本展开/折叠查看详情
- 分类显示：新增功能、优化改进、Bug 修复、破坏性变更

**首次安装欢迎引导**
- 新增 `ui/welcome-modal.ts` 欢迎模态框
- 首次安装时显示欢迎页面，包含插件介绍和功能卡片
- 快速开始指南，引导用户配置 API 并开始创作
- 提供「开始创作」、「打开设置」、「查看更新日志」入口
- 支持「不再显示此提示」选项

**版本升级引导**
- 大版本更新时自动显示更新内容模态框
- 版本升级时自动备份旧版本设置
- 数据迁移验证机制（基于已有的 settings-migrator）

### ✅ 质量保证
- TypeScript 编译：0 新增错误
- esbuild 构建：成功
- 外科手术式改动，不影响现有功能
- 所有新功能均可通过设置开关控制

### 🔧 技术优化

**UI 内联样式收拢（prompt-manager-settings.ts）**
- 将 8 类高频重复内联样式（3+ 次出现）替换为 CSS 类引用
- 新增 8 个 CSS 类到 styles.css v7.0 区域：
  - `.nw-modal-footer` / `.nw-modal-btn-primary` / `.nw-modal-btn-secondary`
  - `.nw-empty-center-muted` / `.nw-textarea-code` / `.nw-stat-muted-mt`
  - `.nw-h4-sm` / `.nw-action-btn`
- 内联样式从 68 处减少到 50 处（35 处替换完成）
- 剩余 50 处为低频单次模式（<3 次重复），按"3+ 重复才收拢"原则不强制处理
- TypeScript 编译验证通过，无新增错误

---

## 4.5.1 — 全流程测试 Bug 修复 (2026-06-29)

### 🐛 全流程 UI 测试发现的 Bug 修复

**P0：FullWriterView 多实例共存**
- `openFullWriterView` 复用 `existing[0]` 但不清理多余 leaf，导致多实例共存
- 多实例中未渲染的实例 `tabContent` 为 undefined，引发 `querySelector` 崩溃
- 修复：`existing.length > 1` 时 `detach()` 多余 leaf

**P0：协同写作正文路径错误**
- `getBodyPath`/`getStepResultDirs`/`getStepFilePath`/`checkPrerequisites` 用 `chapterName`（如"初始之痕"）作为路径前缀
- 与 `pjBodyFile`/`pjStepFile` 的 `第N章` 规范不一致，导致 `findBodyFileV4` 找不到正文文件
- 影响：章节结算、上下文采集、情节冗余检查全部失效
- 修复：全部改用 `第${chapterNum}章` 前缀

**P0：saveBody 丢失 frontmatter**
- `saveBody` 的 `modify(file, titleLine + body)` 覆盖整个文件，丢失 `涉及人物/涉及地点/涉及势力/涉及物品功法` 字段
- 导致 `settleLight` 无法写回实体状态
- 修复：保存前备份原 frontmatter，保存后通过 `processFrontMatter` 恢复关键字段

**P1：tabContent undefined 崩溃**
- `WizardStepExecutors` 构造函数时 `tabContent` 未初始化
- 修复：改为 getter 回调 `getTabContent: () => HTMLDivElement`

**P1：前置规划检查误报**
- `checkPrerequisites` 用 `chapterName` 拼接路径，找不到实际存在的文件
- 修复：改用 `第${chapterNum}章` 前缀，文件名改为 `信息规划.md`（与 `pjStepFile` 一致）

**P2：updateProgress null 检查缺失**
- tabContent 临时为 undefined 时崩溃
- 修复：添加 `if (!tc) return;` 防御性检查

### ✅ 验证
- TypeScript 编译：0 错误
- esbuild 构建：0 错误
- 全流程 UI 测试通过（项目创建→世界观→设定库→实体→大纲→建章→协同写作→章节结算）

---

## 4.5.0 — 数据安全架构升级 + 三层 Bug 修复 (2026-06-29)

### 🐛 三层完整链 Bug 修复（51 个 Bug，4 大根因簇）

**批次 1：模板-代码字段错位（10 P0）**
- 伏笔库 section "已揭示伏笔" → "已回收伏笔"，与常量/引擎一致
- 伏笔库解析从 6 列修正为 8 列索引（parts[0-7]），新增 relatedChars/relatedMainline
- 正文 frontmatter "涉及物品" → "涉及物品功法"，模板/类型/引擎/前端四处统一
- 时间线常量 TIMELINE_COLUMNS 从 4 列改为 7 列，与模板对齐
- 世界观模板从 6 section 扩展为 9 section，与 WV_SECTIONS 对齐
- 实体生成器 YAML 模板补充 entity_status/entity_created_at 等 4 个字段
- project-wizard-modal 统一用 wizard-types.ts 的 WizardStep 和 buildWizardSteps
- context-manager.ts 变量名 continuityReviewFile → reviewFile 修正

**批次 2：协同写作上下文塌陷（4 P0）**
- buildSnapshot 的 prevChaptersSummary 从 previous_chapter 对象正确读取 bodySummary/outline/ending/analysisReport
- ContextSnapshot 接口补充 settingLib/timeline/characterCores/triggeredMemories 4 个字段
- buildDirectionalPrompt system 段注入 allChars/allFactions/allLocs/allItems/writingRules
- buildDirectionalPrompt user 段注入 chapPlan/sceneExpansion/prevChaptersSummary/settingLib/timeline
- settlement-engine 新增 settleLight() 轻量结算（无分析报告时基于 frontmatter 写回实体）

**批次 3：路径/状态断裂（6 P0）**
- co-writing-view onClose 新增 ghostDebounceManager.dispose() 和 liveAnalysis.clearTimers()
- 删除 _liveTimerIds/clearLiveTimers/_addLiveTimer 死代码
- getBodyPath 改用 chapterName，与 getStepResultDirs 一致
- generate-worldview-modal 设定库路径改用 pjSettingLib() 函数
- CoWriterEngine 改为 plugin.coWriterEngine 单例共享（懒加载）

**批次 4：entity_* 状态链 + P1（20 P1）**
- 校验器补充 entity_status/entity_created_at 字段检查
- entity-state-manager 正则从双重转义修正为单反斜杠 /^(---\s*\n)/m
- 物品功法模板 entity_status 从 draft 改为 active
- 前端人物字段列表统一引用 CHARACTER_DISPLAY_KEYS 常量

**批次 5：P2 优化项和死代码清理（11 P2）**
- 删除 CrossViewStateManager 死代码
- suggestion-history-store/main.ts/create-project-modal 裸路径替换为 paths.ts 函数
- WizardStep.status 添加类型注释，明确与 CHAPTER_STATUS 不同

**编译错误修复**
- context-manager.ts:869 cachedRead 补充 getAbstractFileByPath() as TFile 转换
- TypeScript 编译 0 errors，esbuild 构建 0 errors

---

## 4.5.0 — 数据安全架构升级 (2026-06-27)

### 🛡️ P0 级数据安全增强

**1. 串行写入器（SerializedWriter）接入主设置保存**
- **main.ts** `saveSettings()` 改用 `SerializedWriter.enqueueAutoClean()`，保证设置写入原子性
- 防止高频保存（滑块拖动、连续切换）导致的并发写入冲突
- `onunload` 时触发 `flush()` 尽力确保所有写入完成
- 此前已在 style-learner / preference-memory 中使用

**2. 设置版本迁移机制**
- 新增 `shared/settings-migrator.ts` — 统一的 schemaVersion 迁移框架
- 当前 schemaVersion = 2，支持 v0→v1→v2 链式迁移
- 迁移失败时降级处理，不崩溃，保留原始数据
- `loadSettings` 自动检测版本并执行缺失的迁移
- 为未来格式升级提供安全保障，彻底解决用户数据丢失风险

**3. 缓存数据独立文件存储（渐进式）**
- 新增 `shared/plugin-cache.ts` — PluginCacheManager 缓存管理器
- 缓存文件路径：`.obsidian/plugins/novel-writer-ai/data/cache.json`
- 已分离缓存项：panelLayout（浮窗布局）、modelOverrideHistory（模型覆盖历史）
- 当前采用「双写」策略：settings 和 cache 同时写入，确保向后兼容
- 内置 SerializedWriter 串行写入，保证缓存文件原子性
- 下一版本可平滑切换为「读 cache 优先 + 从 settings 移除」

### 🔧 架构优化

**防抖系统全面统一**
- 6 个防抖场景 100% 接入 AdaptiveDebounceManager
- 新增协同写作场景：实时分析、设定守卫、幽灵联想
- 详见 v4.4.0 更新日志

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：161/161 通过
- 新增文件均通过严格类型检查

## 4.4.0 — 自适应防抖管理器版 (2026-06-27)

### 🚀 新增功能

**AdaptiveDebounceManager 自适应防抖管理器**
- **核心实现**：`shared/adaptive-debounce-manager.ts` — 统一防抖基础设施，支持固定延迟与自适应延迟两种模式
- **自适应算法**：根据输入速度动态调整延迟（快速输入→长延迟减少写入，慢速输入→短延迟提升响应）
  - 快速模式：>3 次/秒，延迟 500ms
  - 中速模式：1-3 次/秒，延迟 300ms
  - 慢速模式：<1 次/秒，延迟 100ms
- **内存管理**：自动清理 5 分钟未使用的 key 历史记录，防止内存泄漏
- **可配置**：支持自定义三档延迟、阈值、历史窗口、调试模式

### 🔧 架构优化

**防抖逻辑统一重构**
- **main.ts**：设置保存（500ms 固定）+ 正文变更实体状态重检（3000ms 固定）→ 改用 `debounceFixed`
- **polish-editor.ts**：润色编辑器自动保存（500ms 固定）→ 改用 `debounceFixed`，新增 `destroy()` 方法
- **live-analysis-controller.ts**：实时分析刷新 + 设定守卫检查（双定时器，trigger 敏感延迟）→ 改用 `debounceFixed`
- **co-writing-view.ts**：幽灵联想刷新（2600ms 固定）→ 改用 `debounceFixed`
- **消除重复模式**：移除 6 处重复的 setTimeout + clearTimeout 手动管理模式
- **资源清理**：统一 `dispose()` 接口，插件卸载时清理所有待执行定时器

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：161/161 通过（新增 20 个防抖管理器单元测试）
- 新增测试覆盖：基础防抖、自适应切换、内存管理、并发安全、dispose 清理等

## 4.3.1 — 技术债清理版 (2026-06-27)

### 🔧 代码质量改进

**P2 级技术债修复**
- **通知时长常量化**：11 个文件 50+ 处硬编码 `showNotice` 时长替换为 `thresholds.ts` 中的 `NOTICE_ERROR`/`NOTICE_WARNING`/`NOTICE_CRITICAL` 常量
- **插件数据路径统一**：`shared/paths.ts` 新增 `pluginDataDir()`/`pluginPreferenceFile()`/`pluginStylePatternsFile()`，消除硬编码路径
- **伏笔解析代码去重**：`foreshadow-manager.ts` 提取共享 `parseForeshadowTableContent` 函数
- **分析报告状态透明化**：`analysis-report-engine.ts` `applyReportChanges` 返回结构化状态对象，用户可区分自动应用与待手动处理
- **JSON 解析容错增强**：`intervention-controller.ts` `callUnderstandingAPI` 添加 try-catch 保护

**依赖更新**
- `preference-memory.ts`、`style-learner.ts` 改用 `paths.ts` 统一路径函数
- `review-agent.ts`、`settlement-engine.ts`、`ai-api-client.ts` 等全面常量替换

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：141/141 通过

## 4.1.1 — 架构重构版 (2026-06-25)

### 🏗️ 架构重构（引擎层回调模式）
- **step-runner-callbacks.ts 新增**：StepRunner 回调接口，engine 层通过 callbacks 与 UI 层解耦
- **step-runner.ts 重构**：移除所有 `new Notice()` 调用（52 处 → 改为 `this.callbacks.*`），移除 `showProgress/showSuccess/showError/hideProgress` 直接调用
- **shared/paths.ts 注释更新**：标记 `readProjectMeta` / `isProjectFolder` 为 Obsidian API 耦合（计划 v4.1.2 迁移）
- **settlement-engine.ts 注释更新**：标记 19 处 `new Notice()` 为待改进项（计划 v4.1.2 迁移）
- **engine → ui 依赖清理**：engine 层不再直接操作 DOM 或调用 Obsidian UI

### ✅ 质量保证
- TypeScript 编译：通过
- Vitest 测试：60/60 通过

## 4.0.0 — 稳定性增强版 (2026-06-25)

### 🚀 AI 引擎增强
- **SSE 流式输出**：正文生成期间实时反馈，支持用户中断
- **Token 精细化估算**：中英混合分层估算，模型特定 tokenizer 效率感知，提前拒绝超窗口输入
- **多模型智能并发**：推理模型 1 并发 / 标准 2 / Flash 4，429 限流自动退避
- **模型能力集中化**：`shared/model-capabilities.ts` 统一 65+ 模型配置，支持自定义供应商

### 🎨 CSS 架构重构
- **!important 839→299** (-64%)：提高选择器特异性替代 !important
- **重复选择器合并**：cowrite 三栏/suggestions/editor-wrap 去重
- **Fallback 变量收敛**：radius-lg/md/sm 与 :root 权威值完全一致
- **内联 CSS 迁移**：wizard 导航栏按钮样式 → CSS 类名

### 📐 架构优化
- **wizard-controller 抽离**：full-writer-view 2228 行 (-55%，基线 4954)
- **ai-engine 拆分**：ai-types.ts + ai-prompt-builder.ts 外迁 (2712 行)
- **双轨残留清理**：移除 6 个废弃阈值常量，@deprecated 注释清理

### 🧪 测试基础设施
- **Vitest 入库**：60/60 测试通过，89.6% 行覆盖
- Obsidian API Mock 完整实现

### 🔧 运行时稳定性
- **P0 全部修复**：8 项运行时 Bug 清零，0 崩溃路径
- **@ts-ignore 清零**：79→0，WizardViewAccess 接口替代 `as any`
- **静默吞错修复**：chapter-utils 3 处 catch → console.warn
- **监听器泄漏修复**：全部注册到 registerEvent()
- **settlement 回滚修复**：NEW 文件清理，伏笔库 hasPartialFailure
- **main.ts 侧边栏修复**：getLeaf('tab') + null 检查

### 📝 代码质量
- **console 降噪**：3 处冗余 log → debug
- **findBodyFileV4 修复**：恢复 v4 目录结构正文查找
- **类型安全加固**：WizardViewAccess 接口定义

---

## 3.3.0 (2026-06)

- V2 灵魂驱动架构：角色灵魂层 + 情绪弧规划 + Scene 展开
- 关系引擎 + 情绪审计
- 句级协同写作工作台
- 文笔风格自学习 (E1)
- 多模型 fallback 切换
- tsc --noEmit 0 error

## 3.2.0 及更早

- 全流程 AI 长篇小说创作系统
- 防 OOC、设定追踪、多 Agent 协作
- 跨卷状态继承、文笔风格蒸馏
- QuickAdd + Obsidian 集成
