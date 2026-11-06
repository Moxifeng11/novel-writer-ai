# 插件结构化规划（PLAN）

> 版本：v4.53.0 · 更新：2026-11-06
> 定位：**本文件是插件仓的唯一结构性规划入口**。代码是最终真相源；本文件只回答「有哪些模块、边界在哪、下一轮做什么」。
> 历史文档：`docs/audits/`（各轮取证）、`docs/releases/`（各版本交付）、`CHANGELOG.md`（变更流水）。
> **全系统优化专项**（16 板块 / 7 任务组 / 排期与验收）：[`docs/PROGRAM.md`](PROGRAM.md) · 进度报告：[`docs/progress/PROGRAM-STATUS.md`](progress/PROGRAM-STATUS.md)。
> **开发手册**：[`docs/README.md`](README.md)（环境、模块标准、接口契约、排障、评审、注释规范）。

---

## 一、模块地图（是谁、归哪层、边界）

分层门禁（唯一可执行口径，见 `scripts/check-dependencies.mjs`）：`ui → engine/services → shared/core`；`services → shared/core`；`shared` 只依赖自身；`core` 只依赖 `shared`。`check:deps` 为棘轮，存量冻结、只降不升。目标边界与差异见 [handbook/02-architecture.md](handbook/02-architecture.md)。

| 层 | 目录 | 职责 | 不该做的事 |
|---|---|---|---|
| 入口 | `main.ts` | 插件生命周期、视图/命令注册、`onunload` 清理 | 不写业务逻辑 |
| UI | `ui/` | 视图、弹窗、控制器；只通过 engine/service 公开方法 | 不直接读写 vault 业务文件 |
| 引擎 | `engine/` | 写作流水线、上下文、结算、Agent harness、RAG | 不依赖 `ui/`、不依赖 `main` 单例 |
| 服务 | `services/` | 版本、规则注册、执行登记表、知识库、性能监控 | 不 import `engine/`（迁移/批量导入/拆解调度已下沉 engine） |
| 共享 | `shared/` | 纯函数与通用原语：路径、格式、预算、体检、评分、缓存（file-cache/multi-layer/lru）、等待（yield）、存储键 | 不依赖任何业务层 |
| 核心 | `core/` | 设置服务、命令注册表、Provider | 不依赖 `ui/` |
| 门面 | `plugin-api.ts`（根级） | 对外 API 门面（与 main.ts 同性质，不属于分层） | 只做类型聚合，不放业务 |
| 领域 | `domains/` | 长篇/短篇/剧本三域声明（harness profile、工具目录、工厂） | 不复制通用逻辑 |

### 1.1 三条主数据流

```
一键成文（流水线）
  上下文加载 → 合并规划(5 模块) → 正文(V1..V4) → 质量控制 → 定向修订/闸门/复检
  → 分析报告(指令行) → 结算(实体/伏笔/时间线/关系/连续性账本) → 章节状态快照

协同写作（逐段）
  编辑器 → BodySaveController(身份快照/外部写入守卫) → BodyWriter(唯一落盘)
  → 实时质量分/建议/幽灵联想 → 结算同源回写

Agent（harness）
  会话日志 → 工具循环(host-tools) → 单次调用契约(single-call-runner)
  → 执行登记表(get_execution_status) → 上下文压缩/spill
```

### 1.2 单一入口清单（新增代码必须复用）

| 能力 | 唯一入口 |
|---|---|
| 正文落盘 | `engine/body-writer.ts`（frontmatter 保留、标题、格式契约、覆盖前备份） |
| 正文文件定位 | `engine/chapter-utils.ts::findBodyFileByChapterNum`（带章名优先） |
| 提示词 | `engine/prompts/*` + `prompt-registry.ts`（版本元数据） |
| 写作规则 | `services/rules-registry.ts`（多版本、只生效一个） |
| 上下文装配 | `engine/context-manager.ts` + `context/story-context-*` |
| 上下文体检 | `shared/context-hygiene.ts` |
| 修订闸门/复检 | `engine/revision/revision-guard.ts` |
| 结算 | `engine/settlement-engine.ts` + `settlement/*` |
| 长流程结果 | `services/execution-ledger.ts` |
| 设置默认值 | `core/settings-service.ts::getDefaultSettings` |
| 实体读取/统计 | `shared/entity-reader.ts::listEntityFiles / countProjectEntities` |
| 等待原语 | `shared/yield.ts::yieldToUI / nextFrame`（禁止裸 setTimeout 等待 UI） |
| 样式源 | `styles-src/*.css` → `npm run build:styles` 生成 `styles.css`（`check:styles` 校验一致） |

---

## 二、质量与治理机制（已落地）

| 机制 | 落点 | 作用 |
|---|---|---|
| 版本治理 | `shared/versioned-registry.ts` + 两个注册表 | 规则/模板多版本并存、哈希漂移检测、账本可归因 |
| 上下文体检 | `shared/context-hygiene.ts` | 重复段、规则×风格冲突、串章 |
| 修订闭环 | `revision-guard` + `StepRunner` | 只接受更优版本、可回滚、复检对照 |
| 三层验收 | `engine/quality-gate.ts` | 规则/结构/模型三层，正文后运行 |
| 连续性账本 | 人物卡四字段 + 章节状态快照 | 谁在哪/知道什么/伤到哪，最新优先带来源章 |
| 执行登记表 | `services/execution-ledger.ts` | Agent 可读长流程结果 |
| 门禁链 | `preflight` / `check:*` / CI | 类型/单测/模板/CSS/分层/引擎/发布 |

---

## 三、待办矩阵（按风险与成本）

### v5 最小闭环（2026-11-06 启动）

- B1（ZCode）：`AgentProjectStatus` 增 `flow`，`get_project_status` 输出三模式阶段快照，prompt 按 `nextStageId` 引导。
- B2（Trae）：`agent-port` 注入 flow；工作台阶段面板改为统一快照（删除硬编码 8 阶段）。
- B3（Trae）：`shared/publication-profile.ts` 三模式出版阻断/建议；导出弹窗严格模式。
- B4（Trae）：自动化状态单一真相源 + `check:automation` 入 preflight；Trae 任务改 v5 使命。
- B5（Trae）：`docs/guides/USER-GUIDE.md`、`docs/guides/COMMERCIAL-GUIDE.md`、`docs/handbook/13-dual-automation-ops.md`。
- 验收：三模式阶段面板真实进度 + Agent 可答下一步；严格出版检查可阻断；`npm run check:automation` 通过；全量门禁不回归。

### v4.42.0 四批（2026-11-05，已完成）

- `ui/co-writing-view.ts`：Notice 第六批 40 处（成功/失败/告警，60→20），守卫/进度类保留；抽出 `ui/co-writing/markdown-shortcut.ts` / `quality-highlight.ts` / `friendly-error.ts` / `kb-panel.ts`，文件 4,986 → **4,645 行**（达标 ≤4,700）。
- `ui/views/writing-fingerprint-view.ts`：Notice 第七批 21 处（成功 8 / 失败 10 / 告警 3），52 → **31**；守卫、进度与无变化提示保留。
- `ui/golden-opening-modal.ts`：Notice 第八批 31 处（成功 9 / 失败 22），45 → **14**；守卫 7 与进度 7 保留。
- 第九批：`knowledge-base-view`（42→14）、`knowledge-base-modals`（16→9）、`command-ui-executor`（26→20）、`add-fanfic-setting-modal`（29→12）、`ai-builder-modal`（27→8）、`pre-research-modal`（21→11），合计替换 **87 处**，剩余守卫/进度/预检 74 处。
- 第十批：`prompt-manager-settings`（24→6）、`co-write-floating-panel`（22→11）、`wizard-step-executors`（18→1）、`template-manager`（14→1）、`fanfic-review-modal`（13→5），合计替换 **67 处**，剩余守卫/进度/预检/无变化 **24 处**。
- 第十一批：`full-writer-view`（11→5），替换 **6 处**；守卫、预检与带引导提示保留 5 处。
- 第十二批（v4.43.0）：`batch-import-modal`（11→9）、`generate-character-modal`（10→5）、`ideation-modal`（10→2）、`backup-center-modal`（10→2）、`project-side-panel-view`（10→4）、`wizard-step-renderers`（10→2），合计替换 **37 处**，剩余守卫/进度/预检/无变化/信息展示 **24 处**。
- 第十三批（v4.44.0）：`co-writing-view`（20→20，剩余全部为守卫/预检/无变化/进度）、`add-fanfic-setting-modal`（12→11）、`manage-providers-modal`（10→7）、`style-distiller-modal`（9→7）、`create-project-modal`（9→2），合计替换 **13 处**，剩余 **47 处** 均为守卫/进度/预检/无变化/信息展示。
- 第十四批（v4.46.0）：`add-fanfic-setting-modal`（余 11）、`manage-providers-modal`（余 7）、`style-distiller-modal`（余 7）共 25 处逐条核对，全部为守卫/预检/无变化/进度，**0 替换**；三文件确认收敛完成。
- 切片第六批（v4.47.0）：`ui/co-writing-view.ts` 抽出 `co-writing/chapter-context`（路径/标题/章节身份）、`ghost-association`（触发判定与提示）、`quality-fix`（定位/Prompt/替换决策）、`monitor-cards`（五张监控卡）、`metrics-panel`（三态与指标渲染）五个模块，**4,645 → 4,303 行（-342）**；新增 5 个测试文件 40 用例；下一步朝 ≤3,000 的 M5 重评条件推进。
- 切片第七批（v4.48.0）：`ui/co-writing-view.ts` 抽出 `co-writing/suggestion-cards`（建议/联想/校验/流式卡片）、`suggest-feedback`（错误卡/知识空态/空建议/注入提示）、`brief-panel`（本章简报/冷启动/按钮态）、`dashboard-status`（状态栏/人工率仪表盘）、`kb-reference-config`（参考书开关/主参考/权重）、`suggestion-loading`（生成中进度面板）、`quality-popup`（浮窗/右键菜单/编辑器定位）七个模块，**4,303 → 3,980 行（-323）**；新增 6 个测试文件 27 用例。
- 切片第八批（v4.49.0 待发版）：`ui/co-writing-view.ts` 抽出 `co-writing/editor-shortcuts`（快捷键决策）、`metrics-render`（指标面板/评分卡/方向文本）、`settlement-actions`（待结算提示/标记完稿/结算入口/冲突检测）、`suggestion-flow`（Tab 建议与流式建议主流程）四个模块，**3,980 → 3,581 行（-399）**；新增 4 个测试文件 22 用例；全量 580 文件 / 6,237 用例、lint 0 error / 1,853 warnings、tsc 0。
- 第十五批（v4.50.0）：`ai-builder-modal`（2）、`appearance-settings`（7）、`settings/general-sections`（6）、`settings/foreshadow-section`（6）、`settings/knowledge-section`（7）、`project-utils`（6）合计替换 **34 处**（成功/失败/告警）；`settings/api-section` 余 8 处均为校验守卫，**0 替换**，确认收敛；无新增测试，改用既有 `notice-helpers` 覆盖。
- 切片第九批（v4.51.0 待发版）：`ui/co-writing-view.ts` 抽出 `co-writing/metrics-refresh`（剧情完成度刷新编排：评估节流门控、在途评估中止、切章丢弃旧结果、失败态回退），并扩展 `co-writing/chapter-context`（`resolveChapterLocation` 章节身份推定 / `stripChapterBody` 正文去壳，锁定「缺参绑定错误卷」与标题重复两处历史 bug），**3,581 → 3,556 行（-25，行数口径：含空行）**；新增 1 个测试文件 7 用例 + `chapter-context` 追加 11 用例（共 18）；下一批继续渲染布局装配，目标 ≤3,300。
- 切片第九批·第 3 片（v4.51.0 待发版）：`ui/co-writing-view.ts` 抽出 `co-writing/layout-assembly`（顶栏导航/资源/模式装配、左栏本章简报与预览、右侧 Tab 头、字体选择器、Markdown 状态栏、布局回填、分隔条），**3,556 → 3,443 行（-113，含空行口径）**；新增 1 个测试文件 9 用例（字体选项解析/布局状态/状态栏文案）；全量 582 文件 / 6,264 用例、preflight 全绿；bundle 基线上调 +968B（纯迁移与回调装配开销，已在 `.bundle-baseline.json` note 说明）。
- 切片第九批·第 4 片（v4.51.0 待发版）：`ui/co-writing-view.ts` 抽出 `co-writing/control-panel`（右栏页签/概览卡片/写作控制台/更多工具面板/监控挂载点 + 模型按钮文案规则），**3,443 → 3,363 行（-80 净减，含空行口径；毛减 150 行，其余为宿主句柄回填与回调装配）**；新增 1 个测试文件 11 用例（页签/工具按钮/开关态/场景指令/模型文案）；preflight 全绿（582 文件 / 6,275 用例）；bundle 基线上调 +1,706B（纯迁移开销）。
- 第九批收口 + **切片主线正式停止（2026-11-06 用户拍板）**：分解前的「控制台 ≥143 行」高估——实测 `886-993` 为 108 行、`867-993` 为 127 行；扣掉宿主句柄回填后单片净减约 80 行。本批三次切片 bundle 累计 **+3,664B**，切片对包体积是净增（审计归因：适配层 宿主回调 739B + 句柄回填 693B + handles 返回 315B ≈ 1,747B，占净增 100%）。**≤3,300 行目标废弃**，`ui/co-writing-view.ts` 保留 3,363 行现状，后续不再按行数切片；主指标改为 net-bundle + 模块内聚度。
- 第十六批（v4.52.0 待发版）：Notice 尾盘 `command-ui-executor` 20 处逐条核对——18 处为守卫/预检/进度/无变化（按既有口径保留），2 处告警（版本服务未就绪、旧版命令弃用）改走 `showWarningNotice`，文件确认收敛（**20→18**）；无新增测试，改用既有 `notice-helpers` 覆盖。同轮修复 v4.51.0 版本节点遗留的 `check:bundle` 红灯（`changelog-data` +452B 未实测 + 本轮 +32B，基线上调 4,854,975→4,855,459 并在 note 注明归因）。
- 第十七批（v4.52.0 待发版）：test-hardening `ui/command-ui-executor.ts`——口径纠偏：该文件并非「无单测」，`pure-helpers-coverage.test.ts` 已有 3 条路由/无项目短路用例；真实缺口是执行器级守卫。本轮新增 `tests/unit/ui/command-ui-executor-guards.test.ts` 3 条（模式守卫拦截且不开弹窗、模式匹配放行、旧版命令弃用提示按命令名去重），不改源码；全量 584 文件 / 6,278 用例、lint 0 error / 1,854 warnings。
- 第十八批（v4.52.0 待发版）：test-hardening `shared/template-validator.ts`——按覆盖率实测（st 252/339、br 155/222）挑出四类实体校验器（人物/势力/地点/物品）的未覆盖分支：未闭合 YAML 的 `PARSE_ERROR`、必填键存在但值为空（「（值为空）」区别于键缺失）、tags 缺少对应实体标签；`tests/unit/shared/template-validator.test.ts` **9 → 19 用例**，不改源码；全量 584 文件 / 6,288 用例、lint 0 error / 1,854 warnings、preflight:release 全绿（bundle 持平）。
- 覆盖率实测附带结论（同轮）：`parseCharacterBlocks`（`template-validator.ts:883`）全仓仅有定义、无任何调用，0% 覆盖——属死代码，删除或接入需产品语义拍板，本轮未改；下一批覆盖率候选 `ui/full-writer/template-vars-builder.ts`（br 401/699）、`shared/file-system-port.ts`（br 88/133）。
- 第十九批（v4.52.0 待发版，ZCode 派工）：①gate-fix `any` 基线 **306 → 298**——实测 298/306（消除 8 处集中在 `ui/co-writing-view.ts` 9→1），按棘轮纪律执行 `--update-baseline` 收敛，非上调；②test-hardening `ui/full-writer/template-vars-builder.ts` 上下文装配分支，`tests/unit/ui/template-vars-story-context.test.ts` **2 → 12 用例**（`buildContextVars` 7 条：非压缩透传与类型推导、设定库占位注释回退、写作规则去重开关、文笔风格原文去重、上一章汇总与跨卷快照、开篇显式标记、压缩上下文透传；`buildEntityVars` 3 条：四类实体格式与 token 估算、超 12 名额仍强制保留主角、空数据零输出）；不改源码；全量 584 文件 / 6,298 用例。
- 第二十批（v4.52.0 待发版，ZCode 派工）：test-hardening `shared/file-system-port.ts`——按覆盖率实测（st 161/209、br 88/133）挑「索引内/索引外」分叉的纯逻辑分支：`getFileStamp` 索引内 stat 缺失回落与索引外 adapter.stat 缺字段/空值/抛错、索引内文件夹递归删除与索引外 `rmdir`、索引外不存在时静默返回、写目标是文件夹时拒绝、`mkdir` 的「已存在」吞掉与其他错误外抛、配置目录已存在时跳过 `adapter.mkdir`、`listFolders` 索引外递归与 `adapter.list` 失败返回空、`listFiles` 虚拟文件在无扩展名/无 stat 时的形状、`ObsidianVaultMeta.getFolders` 忽略非文件夹子项、`writeVaultText` 的无 adapter 守卫/最小 adapter 回退/完整 App 索引路径；`tests/unit/shared/obsidian-fs-adapter-fallback.test.ts` **7 → 19 用例**，不改源码；覆盖率实测 **st 180/209、br 112/133（84.21%）、lines 169/190**；全量 584 文件 / 6,310 用例、preflight:release 全绿（bundle 持平）。
- 第二十一批（v4.52.0 待发版，ZCode 派工）：test-hardening `engine/body-writer.ts`（唯一落盘入口）纯逻辑分支——`parseChapterNum` 三条分叉（阿拉伯数字命中 / 无章号 `!m` / 中文数字 `parseInt`→NaN 回落 undefined）、`chapterNum` 与 `chapterName` 双缺省时不生成标题行与「章/标题」字段、`write` 空 path 守卫（写入前抛出且不触碰文件系统）、`dirOf` 无目录分隔符退化为空目录、`defaultBodyPath` 卷号/章名/章号三条路径；`tests/unit/engine/body-writer.test.ts` **16 → 25 用例**（+9），不改源码；单跑 4 个 body-writer 测试文件覆盖率 **st 82.9%→88.6%、br 75.15%→85.98%、fn 88.88%→100%、lines 85.71%→89.88%**。
- 测试数据发现（不改源码）：`extractWorldviewMeta` 的 `powerSystem` 正则以 `(?=\n##|\n#|%%)` 收尾，力量体系若为文末最后一段则不提取（`ui/utils/worldview-utils.ts:69`）；如需覆盖末段行为需产品确认，本轮未动。
- 第二十二批（v4.52.0 待发版，Trae 第 13 轮）：test-hardening `ui/full-writer/template-vars-builder.ts` 剩余纯逻辑分支——①四类实体字段全量拼装（人物 15 字段顺序、势力别称/地位、地点别称/区域/地理特征/居民、物品效果/归属，含 `名称` 备用键）；②信息债阶梯四档（严重 >20 / 过高 >15 / 偏高 >10 / 轻档 >5 / 健康 ≤5）与「有无临近揭示窗口」两条文案分支；`tests/unit/ui/template-vars-story-context.test.ts` **12 → 18 用例**（+6，含 1 个 `makeForeshadows` 工厂），不改源码；定向覆盖率实测 **br 416/699（59.51%）→ 466/699（66.67%，+50）、st 565/724→604/724、fn 37/42→39/42**。同轮纠偏：PLAN 先前记录的「br 401/699，59.51%」分子口径失效（59.51% 对应 416/699）。
- 第二十三批（v4.52.0 待发版，Trae 第 15 轮）：test-hardening `buildSceneStyleHint`（`ui/full-writer/template-vars-builder.ts:1108-1153`）——补现有覆盖之外的边界分支：风格路径命中非 `TFile` 对象早退、仅冲突强度≥4 判 battle、仅冲突强度≥2 判 emotional、目标段落未命中时只给节奏不给片段、`infoPlan` 缺失回退 `stepResults`、读取风格文件抛错被吞掉；`tests/unit/ui/template-vars-story-context.test.ts` **18 → 27 用例**（+9），不改源码；定向覆盖率 **br 466→468/699、st 604→605/724、fn 39→39/42**。
- 选点口径纠偏（第 15 轮实测）：`buildSceneStyleHint` 并非「约 8 个分支全部未覆盖」——`pure-helpers-coverage.test.ts:1972/2012` 已有 2 条用例覆盖三档场景与无文件早退，本轮边际分支仅 +2。派工前必须 grep 目标函数在测试文件中的既有调用数（与第 7 轮「误判无单测」同源），不能只按覆盖率总量与行数估算收益。
- 下一步主线：`engine/body-writer.ts` 剩余未覆盖是**备份链**（`backupBeforeOverwrite` L438-455，P0-3 只有「跳过备份」与早退用例，`saveVersion` 成功/失败全链零覆盖），但 `ChapterVersionService` 在 `BodyWriter` 内直接 `new`、无注入点，测试无法替换 → 属可测性缺陷，是否加注入点需 ZCode 在 `engine/` 侧拍板；未拍板前不补该段。第 14 轮审计复核：注入**不需要新抽象**——`shared/chapter-version-port.ts` 已有 `ChapterVersionPort` 接口（core 侧保存版本只依赖它），`BodyWriterOptions`（`body-writer.ts:101-105`）只暴露 `app/fs/frontmatter`，`backupBeforeOverwrite` L447 仍硬编码 `new ChapterVersionService(this.app)`；接线成本约 3 行（可选字段 + 无注入时兜底 new），决策点是「是否接」而非「怎么设计」。
  - 备选纠偏（第 14 轮实测）：`buildTemplateVars`（L718-1102）**零 DOM 依赖**（全文件 `createEl|document|window|HTMLElement` 0 命中），只有 Vault 读取（承诺账本 L922 / 角色弧线 L934 / 风格样本经 `buildSceneStyleHint`），且 `newMockVault` + `TFile` mock 基建已存在（`pure-helpers-coverage.test.ts:2744` 的 2 条 `buildTemplateVars` 用例已跑通，deps 只需 vault/plugin/settings 字段）——原「DOM/Vault mock 重」为高估，成本应归入「Vault seed 即可」档。更便宜的下一批目标：`buildSceneStyleHint`（L1108-1153）——该目标已于第二十三批执行，实测边际仅 +2 分支（因 `pure-helpers-coverage.test.ts` 已有 2 条主路径用例），原「约 8 个分支」为高估。`involved*` 摘要路径仍需 `contextScope=compact` + 真实 TFile；`ui/co-writing-view.ts` 适配层（切片已停止，不再动）。
  - Notice 尾盘结束（权重 0.75）；any 维持 298（余量 0），新增 any 必须同轮消除；切片停止（权重 0.7）。
- 派工选点实测（第 16 轮元迭代；禁止按「未覆盖总数」排序）：~~`shared/template-validator.ts` br 176/222（46 未覆盖、纯函数、首选）~~ **已完成（第二十四批，46→17 未覆盖，余量为死代码与实测不可达分支）** → ~~`buildEntityVars` 缺省/备用键段~~ **已完成（第二十五批，br 468→495/699）** → 下一批候选 `template-vars-builder` 顶层 `buildTemplateVars` **81**（第 19 轮按函数区间精确解析；原记「64」为低估，另「匿名@918 40」经复核系归因错误——那 40 条分支属 `buildTemplateVars` 函数体，非匿名箭头）；`buildEntityVars` 剩余按路径计 22 条（第 18 轮记「15 处」为按语句计，口径差异非漂移），其中 compact 摘要段需 mock vault + 真实 TFile（`pure-helpers-coverage.test.ts` 已有正例基建）→ `shared/file-system-port.ts` br 112/133（21，第二十批残余）→ `engine/body-writer.ts` br 138/157（19，备份链待注入点拍板）→ `ui/command-ui-executor.ts` br 28/172（144，DOM/依赖 mock 高成本，暂缓）。`core/command-registry.ts` br 5.76%（注册表巨型分支）属异常缺口，请 ZCode 判断是否纳入门禁盲区清单。
- 第二十四批（v4.52.0 待发版，Trae 第 17 轮）：test-hardening `shared/template-validator.ts`——生产调用但无直接测试的公开校验器分支：①`validateWorldviewOutput` 散文检测 + `validateBulletFormat`（连续 200+ 中文字符无换行）；②`validateOutlineOutput` 章节范围格式非法 / 无任何分卷；③`detectTimelineStrategy` 原创分支与行内式「类型：同人」且无 `fanficPath`；④`loadFanficRules` 空文本；⑤`validateFanficSettings` 时间线整节缺失；⑥`readYamlFieldValue` 块标量 `>` / `|`；⑦`validateCharacterOutput` 尾部缺闭合符回退解析；⑧`textHasContent` 空标签 / 空 wikilink；⑨`isFanficValueFilled` null 与占位；⑩设定库整节缺失与内容为空两种报文；⑪文笔风格空内容；⑫时间线看板缺分节 / 遇新标题停止 / 数据行短列补空串；⑬地点 tags 缺失、物品缺键 / 空值 / 缺正文分节。`tests/unit/shared/template-validator.test.ts` **19 → 38 用例**（+19），不改源码；全量口径覆盖率 **st 81.41%→91.15%、br 79.27%→92.34%（未覆盖分支 46→17）、funcs 94.73%、lines 83.89%→91.94%**（未覆盖行仅 884-942 死代码区）。
  - 不可达分支实测（不为覆盖率凑数）：`isMeaningfulValue` L63 —— trim 后 `#` 前已无空白，注释正则不命中；`yamlNestedFieldHasValue` L130 —— 调用前已由 `yamlNestedGroupExists` 保证父组存在；`textHasContent` L161 —— trim 后不可能只剩项目符号；`parseMarkdownTable` L650 —— `||` 拆分后至少留下 1 个空串。剩余 L884-942 为 `parseCharacterBlocks` 死代码（全仓 0 调用，第 8 轮结论）。
  - 派工前提复核（第 17 轮）：全量口径 br 176/222 与第 16 轮记录一致（未高估）；`validateWorldviewOutput`（4 处生产调用）、`validateOutlineOutput`（3 处）、`detectTimelineStrategy`（`context-manager` 4 处）确认零直接测试。
- 第二十五批（v4.52.0 待发版，Trae 第 18 轮）：test-hardening `ui/full-writer/template-vars-builder.ts` 的实体字段缺省段——①`buildContextVars` 上一章字段全空（bodySummary/ending/outline/analysisReport/continuityReview/infoPlan 均为空串）时不写摘要、审查与情绪变量；②`buildEntityVars` 四类实体按备用键取名（`姓名`/`fileName`/`?`、势力与地点物品的 `名称`），非字符串字段（`年龄: 16`、`重要程度: 5`）与空值/`null`（`当前状态: ''`、`效果: null`、`描述: ''`）被跳过，不产生空标签；`tests/unit/ui/template-vars-story-context.test.ts` **27 → 29 用例**（+2），不改源码；定向覆盖率 **br 468→495/699（+27 分支路径）、st 605/724 不变**（本轮只点亮空分支，无新增语句）。剩余 15 处集中在 `contextScope=compact` 摘要段（`findBodyFileV4`/`getInvolvedEntities` 需 mock vault + 真实 TFile），下一批需先补 compact 反例基建。
  - 台账补记（第 18 轮）：第二十四批的 `program-status.json` changelog 条目此前缺失（仅改了 baseline 用例数），本轮随第二十五批一并补写，避免批次流水断档。
- 第 19 轮审计（audit-only，零源码/零测试改动；因连续 2 轮 test-hardening 触发强制换型 + 工作树 7 M 待提交 7 轮，不新增待提交路径）：按 `tmp/cov-tvb18b/coverage-final.json`（与第二十五批同一产物，495/699）用函数区间精确归因，`ui/full-writer/template-vars-builder.ts` 未覆盖分支 **204 条路径**（161 条有行号 + 43 条 `if` 分支无位置、涉 19 条 if 语句）。按函数：`buildTemplateVars` **81**、`buildEntityVars` 22、`buildContextVars` 17、`anonymous_19@397` 13、`anonymous_24/26@452/456` 7、`applyStoryContextBus` 3、`buildSceneStyleHint` 3、其余 1-2。按语义价值二分为「信号分支」与「兜底分支」，下批只取信号段。
  - 信号分支（值得测，约 45 条）：主角名兜底链 L791-796（9）、承诺账本 TFile L923 / 角色弧线 TFile L935（2）、灵魂层 character_cores 与 savedSoul 分支 L956-985（12）、上下文体检风格冲突自动修复 L1030-1059（13）、自定义步骤模板覆盖 L1087-1095（7）；另 `chapterHook` 真值 L824-825、`chapPlan` 回退 L849、`voiceMode=quota` L1006、`activeBodyTemplate` 非 auto L1014。
  - 兜底分支（覆盖只抬数字，不产生行为断言价值）：`_rulesMeta` 空串回退 L752-756、`volume` 解析 L761、`chapNum` 回退 L769、`defaultWordCount` 默认 L772、`entityParts` 三段省略 L861/864/867、`issues` 聚合守卫 L889/900/912/915、`_contextHygiene` 空串 L1058。
  - 可测性档位（决定下批成本）：A 档 = 纯 `deps.plugin.settings`/`stepResults`/`context.data` 驱动，约 30 条，无需 Vault；B 档 = 单 Vault 文件（L923/L935，需 TFile mock，基建在 `pure-helpers-coverage.test.ts:67` `newMockVault`）；C 档 = `contextScope=compact` 摘要（`anonymous_19@397` 13 条）。**测试落点注意**：`buildTemplateVars` 的 deps 工厂只在 `pure-helpers-coverage.test.ts`（已提交、非 M），而 `template-vars-story-context.test.ts`（当前 M）只调用 `buildEntityVars`/`buildContextVars`、无 deps 工厂 → 下批若要覆盖 buildTemplateVars，需在「新增 1 个待提交路径」与「在既有 M 文件内补 30-50 行 deps 工厂」之间二选一，后者不加深 ZCode 提交积压。
  - 门禁口径回答（回应 ZCode 待确认项 ①）：`vitest.config.ts` 的阈值是 **per-glob 目录聚合**（`core/**/*.ts` branches 49），不按单文件判定；因此 `core/command-registry.ts` br 5.76% 不会使门禁变红，属「同目录其他文件兜底」而非配置漏项。是否加 per-file 阈值属门禁收紧，需 ZCode 在评估在途分支后决定，Trae 不单方面改。
  - 积压风险（记录给 ZCode）：第 12-18 轮共 **7 个 M** 自 `e390636` 起未提交（PLAN / 两个 progress 文件 / body-writer.test / obsidian-fs-adapter-fallback.test / template-vars-story-context.test / template-validator.test）+ `?? tmp/`；本轮刻意不动源码与测试，避免继续加深积压。
- 第二十六批（v4.52.0 待发版，Trae 第 20 轮）：test-hardening `buildTemplateVars` 信号段（第 19 轮审计 A 档，零源码改动，只改既有 M 测试文件）——①灵魂层 5 条：context `character_cores` 完整灵魂注入摘要 + 9 字段主角详情 + 就绪标记、步骤结果 `characterSoul` 覆盖旧快照、context 无灵魂时回退步骤结果、无匹配主角不写详情/就绪、三者皆空；②上下文体检 3 条：世界观/设定库重复自动清空并记录 `dropped`、关闭自动修复只告警不清空、步骤结果引用旧章写入 `staleChapter`；③自定义步骤模板 2 条：命中 `customTemplates` 才写 `_stepOverrides`、无自定义不写（防默认值二份漂移）；④变体开关 1 条：`humanVoiceMode=quota` / `activeBodyTemplate=v2` / `countableHumanHints` / `experimentGroup`。`tests/unit/ui/template-vars-story-context.test.ts` **29 → 40 用例**（+11，含 `makeFullDeps` 工厂），不改源码；定向口径（仅本文件驱动）**br 450/699、st 541/724**，全量口径需 `test:cov`，本轮不重复跑，故不与上轮 495/699 直接相减。
  - 第 20 轮元迭代（每 4 轮）：test-hardening 1.65→1.55（连续 3 轮成功但分支增量递减，按收益递减降权）；audit-only 1.32→1.40（上轮归因可复用）；docs-correction 1.5→1.30（台账属强制记账，不应抢占优化动作）；gate-fix/notice/slice/perf 维持；`backlogGuard` 不变（本轮零新增待提交路径，仍 7 M）。
  - 下批建议换型（避免 test-hardening 连续 3 轮）：优先 perf 实测（先量 bundle/构建耗时再决定是否动手），或 compact 摘要基建（C 档，需 mock vault + 真实 TFile）；`buildEntityVars` compact 段仍为剩余大头。
  - 积压升级：7 个 M 自 `e390636` 起已 **9+ 轮**未提交；本轮仍未新增路径，但请 ZCode 优先分批提交（测试→文档→progress），否则后续轮次无法再叠加新文件。
- 第二十七批（v4.52.0 待发版，Trae 第 21 轮）：perf 实测 + 热路径收口（先量后改，零新增文件、不改 `engine/**`）——①`ui/full-writer/batch-pipeline-runner.ts#loadStepResults`（每章断点续跑一次 `vault.getFiles()` 全库扫描）改为 `listFolderFiles<TFile>(chapDir, { recursive: true })`；②`ui/cowrite/realtime-quality-controller.ts#loadPreviousChapterContext`（每次质量刷新一次全库扫描）改为 `listFolderFiles<TFile>(bodyRoot, { recursive: true })`；③`scripts/check-hotpath-scans.mjs` 的 `HOT_FILES` **8 → 10**（接入上述两文件，属门禁收紧）。实测证据：`npm run bench:hotpath`（10,080 文件模拟库）全库扫描 0.523/0.490/0.301/0.239/0.570 ms/次 vs 目录遍历 0.004/0.003/0.095/0.051/0.001 ms/次，最大单次访问 200 文件（预算 490）；生产代码 `getFiles()` 共 **82 处**（ui 53 / engine 19 / shared 7 / services 2 / utils 1），除脚本清单 8 个模块外，仅 2 处属「按章 / 按次」调用，其余均为弹窗打开、项目发现、导出等冷路径（`engine/context-manager.ts#detectProjects`、`ui/cross-volume-state-modal.ts` 已有注释豁免）。
  - 测试基建同步（本轮一并落地，否则两处改动无法验证）：`tests/unit/ui/batch-pipeline-resume.test.ts` 与 `tests/unit/ui/cowrite-previous-chapter-cache.test.ts` 的局部 vault mock 补建 `TFolder.children`（真实 vault 的目录本就带 children），使 `listFolderFiles` 路径遍历可被既有用例覆盖；先修 mock、再落地源码，首次「直接改源码」造成的 1 条/3 条失败已复现并闭环。用例数不变（6,366）。
  - 结果：`npm run preflight:release` **EXIT=0**（typecheck / lint / check:hotpaths 10 模块 0 违规 / test 6,366 全绿 / check:bundle），`main.js` **4,855,459 → 4,855,409（-50B）**，用例数不变。
- 第二十八批（v4.52.0 待发版，Trae 第 22 轮）：test-hardening `contextScope=compact` 涉及实体口径（零源码改动，只改既有 M 测试文件；`backlogGuard` 仍生效 → 不新增待提交路径）——①compact 找不到正文文件（`findBodyFileV4` 返回非 TFile）时退化为全量实体清单，且不调用 `getInvolvedEntities`；②compact 命中真实 `TFile` 且涉及集合非空时，涉及人物/势力/地点/物品保留描述，非涉及项只留摘要字段（人物身份/状态/动机、势力类型/领袖/地位、地点类型/区域/重要程度、物品类型/等级/归属），同时覆盖卷名无「第N卷」时 `volN` 回落 0；③涉及集合为空时仍按全量输出。`tests/unit/ui/template-vars-story-context.test.ts` **40 → 43 用例**（+3），不改源码；mock 采用 `vi.hoisted` + `importOriginal` 局部替换（仅 `findBodyFileV4`/`getInvolvedEntities`，`filterForeshadowsByChapter` 等保持真实，避免污染既有 40 条用例）；定向口径（仅本文件驱动，与第 20 轮同口径）**br 450/699 → 490/699（+40 分支路径，未覆盖分支点 171→145）**。
  - 第 22 轮选型纠偏（先问是不是）：原计划「gate-fix（any 298/298、bundle 余量 -50B）」经实测不成立——`check-bundle.mjs` 对 `styles.css` 做 CRLF→LF 归一（磁盘 476,287B / 计费 475,721B），差值 566B 为换行符，非门禁漂移；bundle 与 any 均为**通过但有紧余量**，且工作树 14 M 未提交 → `backlogGuard` 将「新文件路径预算」压到 0，任何源码/配置修复都会新增待提交路径，故本轮按评分改选「既有 M 测试文件内的 test-hardening」，不硬推 gate-fix。
  - 剩余观测（供下批排序）：本文件单文件口径未覆盖分支点已降至 145；compact 主体（L130/L131/L133/L152-158/L206/L240/L278）全绿；残余 `L198/L232/L270` 为摘要路径内 `||` 备用键的 4 路子路径（部分覆盖），`L121/L123` 上一章摘要段在单文件口径未覆盖、全量口径由其他测试文件补齐；继续堆叠边际收益已明显下降。
  - 积压风险（升级为最高优先级）：第 12-22 轮共 **14 个 M** 自 `e390636` 起未提交（本轮未新增路径）；建议 ZCode 按「测试文件 → 文档 → progress」分批提交，否则后续轮次只能继续在既有 M 文件内叠加。
- 第 23 轮审计（audit-only，零源码/零测试改动；`backlogGuard` 新路径预算 0）：
  - 门禁余量实测（2026-11-06，`npm run preflight` **EXIT=0**，22 道门禁全绿）：`any` **298/298**（108 个文件，零余量）、`main.js` 4,855,409B < 基线 4,855,459B（**-50B**）、内联样式通过、热路径 10 模块 0 次全库 `getFiles()`、docs/changelog/jsdoc 通过。
  - any 集中度实测（供下轮 gate-fix 选点）：`engine/deconstruction-scheduler.ts` **22**（`engine/**` 红线，Trae 不可动）→ 非 engine 首位 `ui/components/smart-chart.ts` **16**（`data: any` / `ChartRenderer` 泛型化，成本中等、不改行为）→ `ui/full-writer/intervention-controller.ts` 9、`ui/views/knowledge-base-modals.ts` 9、`services/worker-manager.ts` 7、`ui/manage-providers-modal.ts` 7。
  - 积压实测：14 M / **+1,169 −19 行**（自 `e390636` 已 11 轮未提交），确认为当前最高约束；本轮已向 ZCode 信箱发出**四批可复制提交清单**（测试 → 源码+门禁脚本 → 文档 → progress），并在当前工作树上复验 `npm run preflight` EXIT=0，可安全分批提交。
  - 下轮候选排序（`newPathBudget>0` 解除后）：①gate-fix `ui/components/smart-chart.ts` any 16→约 4（仅泛型化，不改行为）；②perf 启动加载实测（`main.ts#onload` 重模块 eager import 扫描）；③test-hardening 仅在 compact 摘要基建补齐后（边际已明显递减）。
  - 待 ZCode 决策：any 最大头位于 `engine/**`（红线内），是否由 ZCode 在 engine 侧收紧，Trae 不越界。
- 第 24 轮实测（perf 启动加载；零源码/零测试改动，零新增待提交路径；元迭代轮）：
  - 启动加载基线（方法见 `docs/PERFORMANCE.md` §5.1）：`main.js` 4,855,409B → 冷加载 105.9 / 108.0 / 109.7 / 108.0 / 107.9 ms（中位 **108.0**）；同字节副本 104.1-105.8ms；同字节纯字符串对照 18.9-21.7ms。
  - 结论（先问是不是）：启动成本由真实代码 AST 规模决定（约 89ms），**没有**「某个重模块 eager import」的可隔离证据；Obsidian 单文件加载下 `import()` 懒加载不降低解析成本 → 第 23 轮候选②「重模块 eager import 扫描」经实测不可执行，改以 bundle 体积为启动成本代理指标。
  - any 集中度沿用第 23 轮实测（engine 22 红线 / `ui/components/smart-chart.ts` 16）；本轮未动 any 基线，`298/298` 余量仍 0。
  - 台账漂移（实测）：存在两份 loop-state——插件仓内 `.trae/automation/trae-loop-state.json`（活跃，已含第 23 轮）与 Vault 根同路径文件（停在 round 22，参数/权重不同）。已以插件仓文件为准更新第 24 轮，并在 Vault 根副本标记 `stale/supersededBy`；另发现插件仓文件 `updatedAt` 曾写成 21:40（系统实际 15:39），时间戳不可信，已按系统时间纠正。
  - 阻塞项不变：14 M（+1,200 −19，其中 31 行为本轮文档增量）自 `e390636` 起 11 轮未提交；`newPathBudget=0` 未解除前，gate-fix（smart-chart）仍不可执行，需 ZCode 回执后放行。
- 第 25 轮审计（audit-only，零源码/零测试改动；`newPathBudget=0` 未解除）：
  - 对象：未提交的第二十七批（第 21 轮 perf）改动——`ui/full-writer/batch-pipeline-runner.ts#loadStepResults`、`ui/cowrite/realtime-quality-controller.ts#loadPreviousChapterContext` 改用 `listFolderFiles`，以及 `scripts/check-hotpath-scans.mjs` 的 `HOT_FILES 8→10`。目的是在 ZCode 提交前确认没有行为回归，避免把风险带进提交。
  - 行为等价实测（先问是不是）：①**扩展名**——`listFolderFiles` 默认仅返回 `md`（`shared/vault-tree.ts:88`），原 `vault.getFiles()` 返回全类型；两处下游本身已限定 `.md`（`engine/chapter-utils.ts:338/347` 的 `findChapterFile` 与 `shared/previous-chapter-window.ts:58` 的 `/^第(\d+)章.*_正文\.md$/`），过滤结果等价；②**路径归一**——`normalizeFolderPath` 去首尾斜杠，`bodyRoot` 的尾斜杠不影响目录命中；③**递归深度**——真实结构为 `正文/第N卷/第M章_正文.md`，深度 1，`maxDepth` 默认 8 足够；④**规模上限**——`maxFiles` 默认 5000，而 `正文` 目录下每章仅 1 个 md（`pjBodyFile` `shared/paths.ts:291`；修正记录等落在 `03-大纲与章节/步骤结果`，不在该目录），需约 5000 章才会截断，属不可达；⑤**mock 一致**——全局 mock `tests/__mocks__/obsidian.ts#_makeFolder` 已递归构造 `TFolder.children`，两个局部 mock 也已补建 children。
  - 结论：**无行为回归**，可随第 23 轮四批清单直接提交；唯一新增前提是「目录树必须存在且带 children」，真实 Obsidian 满足该前提。
  - 提交清单刷新（第 24 轮新增 `docs/PERFORMANCE.md`，第 23 轮的四批清单缺少该文件）：批①测试 6 个 → 批②源码+门禁脚本 3 个 → 批③文档 3 个（PLAN / PERFORMANCE / generated/code-index）→ 批④progress 2 个，合计 14 M；`?? tmp/` 不入库。
  - 阻塞不变：`newPathBudget=0`；本轮未新增待提交路径，`HEAD` 仍 `e390636`。
- 第 26 轮（gate-fix，零新增待提交路径；`newPathBudget=0` 未解除）：
  - 候选核实（先问是不是）：原计划 gate-fix `ui/components/smart-chart.ts` any 16→约 4 需新增待提交路径（该文件不在 14 M 内），按 `backlogGuard` 否决；改选**已在 M 列表**的 `scripts/check-hotpath-scans.mjs`，只补门禁、不动源码。
  - 实测缺口：门禁只匹配字面 `getFiles(`，而 `getMarkdownFiles()` / `getAllLoadedFiles()` 同为 O(全库)，只需换成其中一个 API 即可绕过 → 第 21 轮 perf 收口的成果缺少防回归面。
  - 改动（+21 −6，净 +15 行）：抽出 `FULL_SCAN_APIS`（三段正则 + 各自整改提示），逐行扫描 10 个热模块，命中任一即失败、每文件只报首个命中；同步脚本头注释与成功输出文案。
  - 验证：`npm run check:hotpaths` 通过（「0 次全库扫描（getFiles/getMarkdownFiles/getAllLoadedFiles，10 个模块）」）；新正则有效性用真实文件复验——`ui/project-utils.ts:282` 的 `getAllLoadedFiles()` 可被命中（若该文件纳入清单即会红）。
  - 现状复核（新证据，未推翻第 21 轮）：非测试代码中这两个 API 仅 7 处、全部冷路径；`ui/project-utils.ts#getChaptersForProject` 一次 = 2 次全库遍历，但调用方全为渲染/弹窗/导航，不在每章热路径 → 第 21 轮「82 处中仅 2 处按章/按次」的结论成立，不新增 `HOT_FILES`。明细见 `docs/PERFORMANCE.md` §2「门禁覆盖面」。
- 第 27 轮（test-hardening，零源码改动、零新增待提交路径；`newPathBudget=0` 未解除）：
  - 选点依据（先问是不是）：第 12 轮已认定 `engine/body-writer.ts` 唯一剩余缺口是**备份链** `backupBeforeOverwrite`（L435-455），且「无注入点、测试无法替换」的判断经复核**不成立**——`ChapterVersionService` 是 ESM 类，测试可直接 `vi.spyOn(ChapterVersionService.prototype, 'saveVersion')` 拦截所有 `new` 出来的实例，无需改 `engine/**`、无需新接线。grep 实测 `tests/` 中 `backupBeforeOverwrite` / `ChapterVersionService` 0 命中，备份成功/失败/节流三条主链此前零覆盖。
  - 改动：`tests/unit/engine/body-writer.test.ts` 新增 `BodyWriter — 覆盖前备份（P0-3）` 6 条用例（25 → 31）：①默认备份一次且把旧正文交给版本服务（`project/chapter/chapterName/path/oldRaw` 与 `{type:'manual', note}` 全断言，备份不阻断写入）；②`backupBeforeOverwrite=false` 跳过；③旧文件只有 frontmatter（正文为空）跳过；④请求缺 `project` 跳过；⑤`saveVersion` 抛错只记录日志、正文照常落盘；⑥同一路径 5 分钟内二次写入只备份第一次（协同自动保存节流）。步骤 1 采用「假 `app` + 真实 `MockFileSystem`」，各用例路径互不相同以避开模块级 `backupStamp` 串扰；不改源码。
  - 验证：定向口径（仅本文件驱动）**st 67.35%→76.16%、br 68.78%→77.70%、lines 68.45%→76.19%**，原未覆盖的 L444-454（备份守卫/成功/失败）全部点亮；`npx vitest run` 31/31 通过。
  - 余量：`engine/body-writer.ts` 单文件口径剩余未覆盖为辅助函数分支（`dirOf`/`project` 推导等），由其他 4 个 body-writer 测试文件在全量口径补齐；本轮目标是数据安全主链，不再为覆盖率凑数。
  - 积压不变：14 M（本轮仅改既有 M 文件，测试清单 +6 用例）；`HEAD` 仍 `e390636`。
- 第 28 轮（gate-fix，ZCode 派工；积压已清零（`95fbf40`，ahead 112），`newPathBudget` 解锁）：
  - 依据：ZCode 拍板「smart-chart any 16→4（含测试守护）」，`engine/deconstruction-scheduler.ts` any 22 由其本人于 `95fbf40` 收紧（本轮实测 engine 已 0）；第 23 轮实测非 engine 首位即 `ui/components/smart-chart.ts` 16。
  - 改动（`ui/components/smart-chart.ts`，16→0，零运行时行为变化）：新增 `ChartData` 联合（13 种图表数据形态）、`ChartRenderOptions`（padding/size/width/height/showLegend）、`chartRenderer<T,O>` 单点泛型适配函数；14 个注册项的内联 `(data: any, opts) => fn(data, opts)` 改为 `chartRenderer(fn)`；类内 `data`/`setData`/`getSortedData`（含两条比较器）/`baseOpts`/`isScatterData`/`transformData`/`recommendType` 全部去 any，统一 unknown + 结构化断言（排序比较器语义逐条对齐 `(a.value ?? 0) - (b.value ?? 0)` / 反向）。
  - 测试守护（`tests/unit/ui/smart-chart.test.ts` +2）：①十四种图表类型逐型渲染均产出内容（防注册表接线断裂）；②`bar` 渲染器收到 `width: 400 / height: 250 / padding: {40,20,50,50}`（防适配函数丢选项）。定向 37/37 通过。
  - 实测：`check:any` **276→260**（-16，106 个文件）；`main.js` **4,855,784 < 4,855,864**（ZCode v4.52.0 基线，-80B）；`typecheck` 0 错误。
  - 基线处理（协作口径）：本轮不自行改 `.any-baseline.json`（该文件随 `95fbf40` 刚落地，改动归属 ZCode 批次）；已回执实测 260，请 ZCode 在提交本批时执行 `npm run any:baseline` 将上限收紧到 260（余量 16 暂留，不放宽）。
  - 第 28 轮元迭代（每 4 轮）：gate-fix **1.76→1.90**（本轮首次以类型收窄直接降低 any 密度、成本低且验证强；按封顶口径只给 +8% 不给 +10%）；docs-correction **1.30→1.20**（台账属强制记账，不抢占优化动作，第 20 轮已降一档，本轮再降）；test-hardening 1.45 / audit-only 1.40 / perf 1.49 / notice 0.75 / slice 0.70 维持（无新基准、避免审计自循环）；`explorationRate` 0.15 未触发（最高分候选与上轮不同型，多样性无需干预）；`newPathBudget` 由 0 解除为 1（仅本轮 2 个文件）。
- 第 29 轮（test-hardening，换型执行；上轮 gate-fix，本轮避开「为降 any 而降 any」的指标化倾向）：
  - 前提纠偏（先问是不是）：第 28 轮遗留候选写的是 `ui/states/state-manager.ts`（br 54.6%），实测**该文件不存在**，真实文件为 `ui/states/chapter-state-manager.ts`（403 行）；且定向口径实测 br **72.86%**（51/70），并非 54.6%——该数字应为全量口径旧值，本轮以 8 个引用测试文件驱动重测为基线。
  - 缺口归因：未覆盖分支集中在**失效标脏链**——`dependsOnBody` 正文 mtime 比较（L325-331）、正文已结算跳过（L336-338）、审计→修正时序（L350-358）、分析报告 CRITICAL_FAIL → finalFix（L364-369）、`step_status=reviewed`（L239）、`chapDir` 空/非文件夹早退（L111/L115），此前全部零覆盖；这些分支决定「哪些步骤需要重做」，错了会让用户重跑已完成步骤或漏跑必要步骤。
  - 改动（仅 `tests/unit/ui/chapter-state-recognition.test.ts`，+7 用例 / +160 行，零源码改动、零行为变化）：①空 `chapDir` 早退且不清空既有状态；②`chapDir` 非 `TFolder` 早退；③质量控制文件晚于修正记录时把 `fix` 标脏且移出 `stepCompleted`；④分析报告含 `CRITICAL_FAIL` 时标脏 `finalFix`；⑤正文 `已完稿` 时**跳过** mtime/时序标脏（防结算后被误判需重做）；⑥正文 mtime 新于审查文件时把 `fix/qualityControl/analysisReport` 全部标脏；⑦`step_status=reviewed` 的空内容文件仍计为 `complete`。
  - 验证：`npx vitest run tests/unit/ui/chapter-state-recognition.test.ts` **10/10 通过**；定向覆盖率 **st 70.65%→85.07%（142→171/201）、br 72.86%→87.14%（51→61/70）、fn 88.9%→100%（8→9/9）**，上述零覆盖行段全部点亮。
  - 成本与边界：未新增 app 假件范式（复用既有 `new App()` + 手写 `TFolder.children` 记忆桩），未动 `engine/**` 与被 ZCode 认领的 `ui/agent-workbench*` 文件集。
  - 本轮性质：与 ZCode 在途的 agent-workbench 特性（6 个新路径）并行；本轮仅 +1 待提交路径，文件集无交集，ZCode 可单独分批提交。
- 第 30 轮（gate-fix，ZCode 派工；`v4.53.0` 已本地发版 `d57dd33`，v5 B2/B3/B4/B5 已入库）：
  - 归属澄清：ZCode 来信质疑工作树 13 条「未声明改动」；实测全部为 Trae 侧 v5 批次（B2 阶段面板/agent-port、B3 出版检查/导出严格模式、B4 check:automation、B5 手册与指南），非第三方；第 29 轮「bundle 红归因 ZCode agent-workbench」**不成立**，+4,375B 实为 Trae B2/B3 特性体量，ZCode 已在特性提交中按功能增长文档化上调基线至 4,860,701。
  - 改动（`ui/full-writer/intervention-controller.ts`，any 9→0，纯类型收窄、零运行时行为变化）：①步骤依赖接口 `getVars/setVar` 由 `any` 收紧为 `Record<string,string>`；②`makeStepRunCtx` 由 `() => any` → `() => StepRunCtx`（type-only 引入，不新增运行时依赖）；③`onUnderstand` 的 `catch (e: any)` → `catch (e)` + `instanceof Error` 窄化（非 Error 抛出的提示由 `undefined` 变为 `String(e)`）；④`currentReport.actions.map((a: any))` 去注解（元素类型由报告结构推导）；⑤语音识别 `onresult/onerror` 由 `any` → 本地 `SpeechResultEvent/SpeechErrorEvent`（只声明 `results` 与 `error` 两个用到的字段）。
  - 测试守护（既有 `tests/unit/ui/full-writer-view-contracts.test.ts` +2 用例，**零新增路径**）：①同一报告并发点两次「确认执行」只执行一次（`executing` 守卫生效，`setVar` 恰好 1 次）；②理解后步骤切换（`infoPlan`→`plotDistill`）拒绝执行且不写 `userIntervention`（防把 A 步意见注入 B 步）。
  - 实测：`typecheck` 0 错误；定向 **11/11 通过**；`check:any` **260→251**（-9，105 个文件，基线可下调）；`npx eslint` 改动文件 0 error（5 条既有 warning，未顺手改）。
  - 边界：未动 `engine/**`、未动 ZCode 文件集（`scripts/check-linked-scenarios.mjs` 的链 4 改动属 ZCode 在途，未触碰）；B1 engine 侧 flow 契约仍待 ZCode。
- 第 31 轮（v5-product，B2 收口 + 剧本模式回归；ZCode 在途 B1，本轮回填我方测试面）：
  - 类型收口：ZCode 已在 `engine/agent/agent-types.ts` 声明 `AgentProjectStatus.flow?: CreationFlowSnapshot`，本轮删除 Trae 侧临时交叉断言 `AgentProjectStatus & { flow?: CreationFlowSnapshot }`（`ui/services/agent-port.ts`、`ui/agent-workbench-view.ts` 各 1 行，纯类型、零运行时行为变化），B2 类型收口完成。
  - 三模式回归补齐（`tests/unit/ui/agent-stage-panel.test.ts` +3 用例，5→8）：此前只有长篇/短篇，缺剧本；新增 ①剧本五阶段顺序（`research→outline→storyboard→units→export`，分镜表为下一步时 `units=todo` / `export=blocked`）；②分镜表完成后进入「分集写作」；③预填话术带分集单元标签。
  - 验证：`npx vitest run tests/unit/ui/agent-stage-panel.test.ts` **8/8 通过**；`npm run typecheck` 0 错误。
  - 边界：未动 `engine/**`（`agent-types/host-tools/prompt-sections` 为 ZCode B1 在途改动）、未动红线文件；新增待提交路径 0（均属既有 M/已入库文件）。

来源：[v4.27 全插件审计](audits/v4.27-full-plugin-audit.md)（P0 六条已修）。

### Batch 2｜P1 正确性（历史清单；逐条状态以 program-status 为准）

> **口径纠偏（第 16 轮实测）**：本表原标「下一轮主线」已失效——v4.42–v4.51 实际主线为 Notice/覆盖率/质量，且 `program-status.json` 的 G1–G7 均已 `done`。唯一明确未决为 **P1-5**（`adapter.write` 绕过 `modify` 事件范围，需用户/ZCode 拍板），其余条目不再重复派工。

| 组 | 条目 | 影响面 |
|---|---|---|
| 写锁收口 | 伏笔库/分析报告/版本回滚统一 `withWriteLock`（P1-1/2/3） | 结算与协同并发 |
| 缓存键 | `extractProjectFromPath` 最长匹配 + 契约缓存失效（P1-4/5/6） | 编辑设定后生成用旧上下文 |
| 跨模式 | `TARGETED_REVISION` 补 mode-rules；短/剧本 catalog 换命令；双向一致性测试（P1-7/8/9） | 短篇/剧本按钮失效、越界写入 |
| 静默失败 | 写作画像读失败留档、结算非 fm 失败置 partial（P1-10/11/12） | 数据被默认值覆盖 |
| UI 正确性 | file-open 判章、项目名校验+防重复提交、IME `isComposing`、实体检测去重、右侧 leaf 争用、一键失败可见（P1-13..18） | 交互与状态错乱 |

### Batch 3｜P2 低成本 + 门禁补强

- ✅ 覆盖率 include 已加 `shared/`（2026-11-01，G7-7）；`preflight` 已补 `lint`（`2116c86`）与 `build`（`4be401f`）；`check:release` 仍待评估（构建会重写产物，放 CI 更合适）
- 占位测试/无效断言清理；未定义 CSS 类补规则；状态类统一 `nw-is-*`
- `versions.json` 生成与校验；CODE-INDEX/README 脱节条目

### 真实链路

- `E2E_REWRITE=1` 全链回归（生成→质控→修订→复检→结算），核对归因字段/settled/账本/登记表
- 遗留：`word_count: 0`（SETTLE_ONLY 特有）、复检事件未进轮询 status

---

## 四、里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | v4.21.1 已发布（RAG/Agent/执行登记表） | ✅ |
| M1 | 人味重建 + 版本治理 + 上下文体检 + 修订闭环 | ✅ v4.22.0 |
| M2 | 全插件排查 Batch 2（P1 十八条） | 已随 v4.42–v4.51 落地（逐条证据以 `program-status.json` G1–G7 为准，均 `done`；P1-6 契约缓存失效已有 `body-writer-contract-cache` 单测）；唯一未决 P1-5 `adapter.write` 绕过 `modify` 事件范围待拍板 |
| M3 | Batch 3 + 门禁补强 + 真实链路回归 | 进行中：`preflight` 已补 `lint`/`build`/文档与注释门禁；`check:release` 已入 preflight；`E2E_REWRITE=1` 待授权 |
| M4 | 发布 v4.23.x（远端 tag + Release） | ✅ v4.23.0 → v4.23.4 已发布 |

---

## 五、版本与提交纪律

- 只在**版本节点**提交：工作树累积 → 合并 CHANGELOG Unreleased 为单一版本节点 → 写 `docs/releases/vX.Y.Z.md` → 升版本 → 门禁全绿 → 本地提交。
- 不自行 push：远端发布由用户确认后执行（`release.yml` 已有资产一致性校验）。
- 每个提交必须可构建：按「运行时代码 → 测试/脚本 → 文档/版本」顺序分组。

## 六、文档真相源

| 文档 | 角色 | 更新时机 |
|---|---|---|
| `docs/README.md` | 文档总索引与真相源责任表 | 新增文档时 |
| `docs/PLAN.md`（本文件） | 结构与路线唯一入口 | 每轮收口 |
| `CHANGELOG.md` | 变更流水 | 每个版本节点 |
| `docs/releases/vX.Y.Z.md` | 版本交付说明 | 打版本时 |
| `docs/audits/vX.Y-*.md` | 取证与实验记录 | 审计/实验后 |
| `docs/generated/*` | 文件清单、门禁表、注释覆盖率（生成物） | `npm run gen:docs` |
| `docs/ARCHITECTURE.md` | 分层与数据流深度说明 | 结构变化时 |
| `docs/progress/program-status.json` | 专项进度与测试基线唯一源 | 每轮收口（`program:render`） |

> `.trae/CURRENT-PROGRESS.md` 已被 gitignore，不再作为真相源；跨工具进度以 `program-status.json` 为准。
