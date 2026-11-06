# 全系统优化专项 · 进度报告

> **本文件由 `scripts/program-status.mjs` 从 `docs/progress/program-status.json` 生成，请勿手改。**
> 专项计划与验收口径见 [`docs/PROGRAM.md`](../PROGRAM.md)；结构路线见 [`docs/PLAN.md`](../PLAN.md)。

- 专项版本：v5-plan-1
- 更新时间：2026-11-06
- 当前基线：v4.59.0；单测 586 文件 / 6433 用例；E2E 37 条
- 任务进度：61/61 已完成（100%），0 进行中，0 受阻

## 一、任务组总览

| 组 | 名称 | 目标版本 | 状态 | 进度 | 责任人 |
|---|---|---|---|---|---|
| G1 | 创作主链闭环 | v4.23.0 | ✅ 已完成 | 18/18（100%） | 实现 ZCode / 验收 用户 |
| G2 | 语料与注入链 | v4.24.0 | ✅ 已完成 | 6/6（100%） | 实现 ZCode / 验收 用户 |
| G3 | 项目生命周期与三模式 | v4.24.0 | ✅ 已完成 | 5/5（100%） | 实现 ZCode / 验收 用户 |
| G4 | 配置与凭据治理 | v4.23.0 | ✅ 已完成 | 5/5（100%） | 实现 ZCode / 验收 用户 |
| G5 | 交互一致性与可访问性 | v4.25.0 | ✅ 已完成 | 6/6（100%） | 实现 ZCode / 验收 用户 |
| G6 | 性能与存储 | v4.25.0 | ✅ 已完成 | 10/10（100%） | 实现 ZCode / 验收 用户 |
| G7 | 质量基建与可观测 | v4.25.0 | ✅ 已完成 | 11/11（100%） | 实现 ZCode / 验收 用户 |

## 二、分组明细

### G1 创作主链闭环（✅ 已完成）

- 目标：正文→质控→修订→结算→上下文→统计 全链数据一致，任何写入点都不丢字段、不覆盖他方结果
- 目标版本：v4.23.0
- 责任：实现 ZCode；验收 用户

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G1-1 | 自动重试被 running 守卫短路 | ✅ 已完成 | 可重试错误第 2 次成功；不可重试错误只跑 1 次（单测锁定） | 84d1e31 + tests/unit/ui/chapter-orchestrator.test.ts |
| G1-2 | 伏笔库/时间线多入口写覆盖 | ✅ 已完成 | 所有写伏笔库路径走 withWriteLock；并发写不丢条目 | 1e34ce5 / e5d1358 |
| G1-3 | 结算幂等与连续性账本归因 | ✅ 已完成 | 同章重复结算不重复累加；账本追加带来源章节 | v4.22.0 交付 + 1e34ce5 |
| G1-4 | 章节重编号两阶段避免撞名/双份正文 | ✅ 已完成 | 插入章节后磁盘与内存编号一致；失败保留旧号不重号 | 8bda817 |
| G1-5 | 大纲树保存单遍重建（删除+插入错位、重复插入） | ✅ 已完成 | 同卷先删后加不落错章；重复保存不重复插入 | 67c53ca |
| G1-6 | 正文净增长台账接入结算事件 | ✅ 已完成 | 保存一章即出现在今日统计；改写不扣历史 | 75584a9 |
| G1-7 | 正文覆盖前自动备份实际从未执行 | ✅ 已完成 | backupBeforeOverwrite 默认 true；仅显式 false（导入/迁移）跳过 | engine/body-writer.ts（=== false 才跳过） |
| G1-8 | 版本索引读改写无锁 + 项目路径推导错误 | ✅ 已完成 | 并发 saveVersion 得到连续版本号且索引两条（单测）；版本落到正确项目目录 | services/chapter-version-service.ts + shared/paths.ts::projectIdFromPath + 单测 |
| G1-9 | 统计事件路径采信陈旧 word_count | ✅ 已完成 | modify 事件按正文内容计数，不被旧元数据固化（单测） | services/writing-stats-service.ts + 单测 |
| G1-10 | 时间线/关系/成长/互信息无锁与 append 无幂等 | ✅ 已完成 | 时间线三处写入同锁；成长/情绪/互信息/连续性账本按章去重（单测） | settlement-engine / analysis-report-engine / context-manager + settlement-growth-idempotency.test |
| G1-11 | 结算弹窗无 settled 守卫；settle / settleLight 两套语义 | ✅ 已完成 | 弹窗重复结算先确认；追加类写入已按章去重 | ui/chapter-settlement-modal.ts（settled 守卫） |
| G1-12 | 关系双通道权威源 | ✅ 已完成 | V2 关系状态.md 为唯一权威源；V1 互信息仅人读日志并整行去重（ADR + 单测） | docs/design/g1-authority-decisions.md §1 + 2 条单测 |
| G1-12a | V1 互信息整行去重 | ✅ 已完成 | 同章同描述重复结算只留 1 行；不同描述仍追加（单测） | settlement-engine.appendToMutualSection + 单测 |
| G1-12b | 禁止从互信息解析关系的契约与扫描 | ✅ 已完成 | 互信息分节只允许出现在白名单写入方/模板；preflight 与 CI 均执行 | scripts/check-relationship-authority.mjs |
| G1-13 | settle / settleLight 语义与回滚 | ✅ 已完成 | light=出场确认并标记；回滚按 journal 三类条目（ADR） | docs/design/g1-authority-decisions.md §2 |
| G1-13a | settlement_mode 标记 + 轻结算显式确认 | ✅ 已完成 | 无报告先确认；settlement_mode 落盘；空指令集返回 empty 且不写状态 | chapter-settlement-modal / settlement-engine + settlement-mode.test（5 条） |
| G1-13b | SettlementJournal 统一回滚（frontmatter/整文件/追加标记） | ✅ 已完成 | partial failure → 关系/成长/时间线等回到结算前，他处写入不误删（单测） | engine/settlement/settlement-journal.ts + 9 条单测 |
| G1-13c | 回滚失败可见性 | ✅ 已完成 | 回滚失败 critical 通知 + 产物 settlement_partial | finalizeRollback + 结算表 frontmatter |

> 强耦合簇：正文写入 / 步骤结果 / 结算产物 / 上下文缓存 / 统计台账 共享同一份磁盘事实，必须同组改动。

### G2 语料与注入链（✅ 已完成）

- 目标：知识库→拆解→向量→检索→故事上下文总线→文笔注入 全链可解释、可降级、不串项目
- 目标版本：v4.24.0
- 责任：实现 ZCode；验收 用户
- 依赖：G1

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G2-1 | 指纹库跨项目写入 | ✅ 已完成 | 切换项目后列表与增删落在当前项目 | 9c6dcd7 |
| G2-2 | 文笔样文小节解析恒失败（\s 退化） | ✅ 已完成 | 「零、参考样本」可定位；样文校验可用（单测锁定） | 84d1e31 |
| G2-4 | 上下文总线预算与去重口径统一 | ✅ 已完成 | 步骤装配/协同写作按本步模型预算设置配额并在结束后还原；32K 本地窗口各切片不低于旧常量；故事包遥测给出 deduped/dedupeRate 并在体检行展示 | shared/context-budget-policy.withActiveInputBudget（成对还原，嵌套/抛错均覆盖）+ resolveContextQuotas 增加旧常量下限；engine/step-prompt-assembly 先定预算再注入；co-writer suggestNext 包裹；StoryContextTelemetry.deduped/dedupeRate + 体检行；单测 context-budget-policy 8 条 / story-context 去重 3 条 / step-prompt-assembly-budget 2 条 |
| G2-3 | RAG 注入来源可追溯 | ✅ 已完成 | 写入 + 步骤面板可见 + 统计页命中率/常用书目 | rag-sources / knowledge-usage / step-render-controller / writing-stats-modal |
| G2-3a | rag_sources 写入步骤结果 | ✅ 已完成 | 注入命中的书/维度/分数/片段截断后写入 frontmatter；同片去重、上限 8（单测） | knowledge-injector.ragSink → step-runner meta → step-result-saver |
| G2-3b | 统计页展示知识命中与命中率 | ✅ 已完成 | 统计页显示命中率、引用片段、涉及书目、最近引用；步骤面板显示本步来源 | engine/knowledge-usage.ts + 统计弹窗「知识引用」+ 步骤结果条 |

> 知识库与指纹都属于「参考资料」域，跨项目读取是最容易出静默错误的地方。

### G3 项目生命周期与三模式（✅ 已完成）

- 目标：长篇/短篇/剧本三域的创建、迁移、重命名、删除、导出与模式守卫一致，绝不误删/误写
- 目标版本：v4.24.0
- 责任：实现 ZCode；验收 用户

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G3-1 | deleteProject 无路径防线 | ✅ 已完成 | 空串/`.`/`..` 一律拒绝（单测锁定）；正常项目逐文件删除并复核 | 67c53ca |
| G3-2 | 短篇/剧本导出前质量检查缺失 | ✅ 已完成 | 短篇/剧本导出时给出未完成单元提示 | 4e89a67 |
| G3-3 | 三模式快捷工具整组静默消失 | ✅ 已完成 | 实体/设定/标签/文笔在短篇/剧本可用；仍有专属按钮时显示「本模式暂不支持」清单（单测） | command-mode-rules ALL_MODES + getHiddenToolLabels + project-selector 提示条 |
| G3-4 | 项目迁移 dry-run 与回滚 | ✅ 已完成 | dry-run 预览；迁移后一键撤销（逆序移回、占用跳过不覆盖）；备份清单留存（单测 4 条） | project-migration-service.rollback + 设置页撤销按钮 |
| G3-5 | 项目路径推导 split('/')[0] 统一收口 | ✅ 已完成 | 7 处调用改用 projectIdFromPath；v4 两层面包与旧版单层都正确（单测） | shared/paths.ts + 单测 + 7 处替换 |

> 删除与迁移是唯二不可逆操作，验收必须包含 dry-run 与回滚演练。

### G4 配置与凭据治理（✅ 已完成）

- 目标：设置默认值、迁移、密钥加密、供应商切换、主题与偏好全部可逆且不静默丢值
- 目标版本：v4.23.0
- 责任：实现 ZCode；验收 用户

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G4-1 | 保存设置把豆包向量 Key 写成 OpenAI | ✅ 已完成 | 三个向量 Key 各写各的字段（单测锁定） | 4e1667f |
| G4-2 | 加密态保存把 API Key 写成空串 | ✅ 已完成 | 锁定态空输入不覆盖已加密值 | 4e1667f |
| G4-3 | 改当前供应商端点不生效 | ✅ 已完成 | 改 Base URL 后 apiEndpoint/availableModels 同步 | 9c6dcd7 |
| G4-4 | 内置主题画廊（7 套 × 浅深） | ✅ 已完成 | 点选即切换且 CSS 变量同步（E2E 锁定） | 1176f03 |
| G4-5 | settingsBackup 含明文密钥 | ✅ 已完成 | 升级备份不含任何密钥字段；留存键名便于排查（单测锁定） | shared/secret-redaction.ts + tests/unit/shared/secret-redaction.test.ts |

> 凭据类缺陷优先级最高：一旦写坏不可恢复。

### G5 交互一致性与可访问性（✅ 已完成）

- 目标：中文输入、键盘、空态、进度、错误提示在全插件表现一致；失败必可见、长任务可取消
- 目标版本：v4.25.0
- 责任：实现 ZCode；验收 用户
- 依赖：G1

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G5-1 | IME 守卫统一（15 处） | ✅ 已完成 | 组字中 Enter/Tab/Escape 不触发提交/切换（shared/keyboard.ts） | 67c53ca |
| G5-2 | 大纲树全局按键误删章节 | ✅ 已完成 | 焦点不在面板内或为 contenteditable 时不接管按键 | 67c53ca |
| G5-3 | 批量写作 Notice 刷屏 | ✅ 已完成 | 单条常驻提示 + 失败章汇总（最多列 5 个） | 67c53ca |
| G5-4 | 空态与失败可见性补齐 | ✅ 已完成 | 用户操作型 catch 0 处无可见提示（check:silent-failures 门禁）；拆解监控空态带「去知识库」入口 | scripts/check-silent-failures.mjs（preflight+CI）+ 备份/浮窗/结算表/信息债提示 + 监控空态 CTA |
| G5-5 | 窄屏与移动端布局 | ✅ 已完成 | 面板容器 ≤760px（写作）/≤980px（Agent）时三栏折单列并可整体滚动；左右栏限高保留、横向抓手隐藏；焦点/拖拽在宽面板下不变 | @container nw-fw / nw-awb + .novel-writer-fw-layout-host（避开 fixed 执行日志被 containment 裁切）；单测 tests/unit/ui/narrow-layout-container-queries.test.ts；E2E「工作台分隔条」新增窄屏断言 |
| G5-6 | 批量建章失败后永久进度横幅 + 静默失败 | ✅ 已完成 | finally 关闭横幅；失败给出已创建数并报原因 | ui/continue-chapters-modal.ts |

> IME 与全局按键属于「一处漏改就毁数据」的类型，优先统一原语。

### G6 性能与存储（✅ 已完成）

- 目标：长篇 200+ 章下打开/落盘/结算不卡顿；写放大与内存有上限；启动不阻塞
- 目标版本：v4.25.0
- 责任：实现 ZCode；验收 用户
- 依赖：G1、G2

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G6-1 | 文件缓存 index 全量重写 | ✅ 已完成 | index.json 只落元数据；覆盖写体积不随 value 增长（单测锁定） | 67c53ca |
| G6-2 | 上下文缓存无上限 | ✅ 已完成 | LRU 上限 16；写入 20 章后 size ≤ 16 | 1e34ce5 |
| G6-3 | 嵌入请求无超时 | ✅ 已完成 | 60s 超时并给出明确错误 | 67c53ca |
| G6-4 | 全库 getFiles 热路径收敛 | ✅ 已完成 | 落盘/结算/统计/知识用量路径 0 次全库 getFiles()（check:hotpaths 门禁）；单章/本卷查询只访问本目录文件（基准 200 章）；200 章规模下单次查询 0.6ms→0.001~0.1ms | shared/vault-tree.ts（getAbstractFileByPath+children 局部遍历）+ shared/body-path.listChapterBodyFiles；改造 settlement-engine/step-result-saver/chapter-utils/context-manager/knowledge-usage/writing-stats-service；scripts/bench/get-files-hotpath.mjs（npm run bench:hotpath）；scripts/check-hotpath-scans.mjs（preflight+CI）；单测 vault-tree 10 条 + knowledge-usage/stats 适配 |
| G6-5 | 步骤事件全量重渲染 | ✅ 已完成 | 步骤成功完成时只重绘本步 7 个区域，DOM 新增 <100 节点（E2E 实测 71；整页重建 494）；结构不完整时退回整页渲染 | ui/full-writer-view.ts（data-nw-region 7 区 + refreshAfterStep/replaceStepRegion/refreshStepNavState）；engine/step-runner afterStep 优先分片；导航 data-nw-substep；E2E STEP_REFRESH_CHURN/STEP_FULL_RENDER_CHURN；单测 step-refresh-regions 4 条 |
| G6-6 | 缓存键含裸 NUL 导致文件对 grep 不可见 | ✅ 已完成 | 源码改为 \u0000 转义，文件重新可检索 | engine/knowledge-vector-store.ts |
| G6-7 | 模型覆盖历史无上限、cache.json 线性膨胀 | ✅ 已完成 | 历史保留最近 200 条 | shared/plugin-cache.ts |
| G6-8 | 伏笔刷新无防抖 + 每次全库×项目扫描 | ✅ 已完成 | modify 事件按项目 800ms 防抖，只刷被改项目（源码契约测试） | main.ts debounceFixed(info-debt:project) + perf-contracts |
| G6-9 | 写章前 n=1..N 循环内 4 次全库扫描 | ✅ 已完成 | 一次 getFiles 快照；前文摘要最多 40 章、12000 字（源码契约测试） | ui/write-chapter-modal.ts allFiles + PREV_SUMMARY_WINDOW |
| G6-10 | 拆解监控 500ms 整块重建 + 工作台每步重建 | ✅ 已完成 | 定时刷新只 patch 文字/宽度；仅任务或状态变化才重建 DOM | knowledge-monitor updateCurrentTab + data-nw-progress |

> 先量化再优化：所有条目都要有前/后对比数字，否则不进主线。

### G7 质量基建与可观测（✅ 已完成）

- 目标：覆盖缺口可度量、门禁不可绕过、进度可追溯、问题可定位
- 目标版本：v4.25.0
- 责任：实现 ZCode；验收 用户

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G7-1 | CI 绕过架构门禁 | ✅ 已完成 | CI 跑 styles/deps/engines；漂移检查覆盖 versions.json 与 styles.css | 67c53ca |
| G7-2 | 占位测试与无效断言 | ✅ 已完成 | 0 个 `expect(true)`；`resolves.not.toThrow` 已改用实际值断言 | 4e89a67 |
| G7-3 | 专项进度台账与渲染脚本 | ✅ 已完成 | program-status.json 单一数据源；MD 由脚本生成且 --check 可校验 | docs/progress/PROGRAM-STATUS.md |
| G7-5 | 联动场景回归清单 | ✅ 已完成 | 三条联动链（生成→质控→修订→结算→导出 / 知识库→注入→归因→统计 / 三模式创建→内容结构→单元写作）均有落点清单 + 自动化覆盖；知识库链有跨模块集成用例 | docs/regression/LINKED-SCENARIOS.md（环节/入口/产物/覆盖/手工验收）+ tests/integration/linked-scenarios.test.ts（注入→rag_sources→统计，2 条）+ scripts/check-linked-scenarios.mjs（3 链 21 锚点，preflight+CI） |
| G7-6 | 结算引擎 1670 行 0 直接测试 | ✅ 已完成 | 成功结算/重复幂等/部分失败回滚 3 条真实行为用例（不再整体 mock）；并暴露正文 status 未进 journal 的缺陷 | tests/unit/engine/settlement-engine-behavior.test.ts + settlement-engine 正文快照修复 |
| G7-7 | shared/ 与 ui/ 不在覆盖率口径内 | ✅ 已完成 | vitest include 覆盖 shared/；基线 76.7% lines（含 shared），shared 域阈值 90/90/82/80 已生效 | vitest.config.ts include + 各域阈值 + test:cov 通过 |
| G7-4 | 覆盖缺口补齐（分批） | ✅ 已完成 | a/b/c/d 已完成；DOM 级测试决策：不引入 jsdom（见 ADR），DOM 行为由真实 Electron E2E 覆盖，视图逻辑继续抽纯模块 | G7-4a..4d 证据 + docs/design/g7-4-dom-testing-decision.md（2026-11-01 决策+重评条件） |
| G7-4a | 结算/Agent runner/生命周期行为测试 | ✅ 已完成 | settle 成功/幂等/回滚 3 条；SingleCallRunner 8 条（含不重试）；迁移撤销 4 条；领域工厂 6 条（含失败回滚） | settlement-engine-behavior / single-call-runner / project-migration-rollback / domain-project-factory |
| G7-4b | Agent 工具与知识库/embedding 覆盖 | ✅ 已完成 | host-tools 权限边界 16 条（命令白名单/模式守卫/危险确认/路径穿越/参数夹紧）+ 4 个 embedding provider 11 条（端点/鉴权/错误/截断/取消） | host-tools-guard.test + embedding/providers.test |
| G7-4c | 知识库 UI 与 knowledge-tags 覆盖 | ✅ 已完成 | KnowledgeTagManager 9 条（默认树/幂等/损坏留档/CRUD/级联/往返）；并修复「损坏文件静默回落默认树」 | knowledge-tags.test + parseFromMarkdown 去静默回落 |
| G7-4d | knowledge-base-view 视图级最小测试 | ✅ 已完成 | 详情加载状态机纯逻辑 9 条（8 字段整体清空/错误文案/列表守卫）；视图委托该模块 | ui/views/knowledge-detail-state.ts + knowledge-detail-state.test |

> 本组是其它组的「刹车」：没有它，前面六组改快了会翻车。

## 三、同步对象

| 对象 | 位置 | 说明 |
|---|---|---|
| 本项目结构路线 | `docs/PLAN.md` | 模块边界与里程碑 |
| 跨工具进度 | `.trae/CURRENT-PROGRESS.md` | 唯一进度数据源 |
| 进度报告 | `docs/progress/PROGRAM-STATUS.md` | 本文件（自动生成） |
| 审计取证 | `docs/audits/` | 各轮问题清单与修复证据 |

## 四、进度流水

- 2026-11-06｜G7｜第三十七批（Trae 第 37 轮，B1 引导真实回归）：agent-mode-alignment 8→12 用例，新增 realFlow() 直调 resolveCreationFlow——覆盖长篇 56%/章节写作/成稿导出阻塞、短篇 25%/分节写作、剧本 20% 分镜表→30% 分集写作、旧端口无 flow 不输出阶段行；零源码改动（tests/unit/engine/agent-mode-alignment.test.ts + docs/PLAN.md 第 37 轮）
- 2026-11-06｜G7｜v4.53.0 第一批（v5 最小闭环 B2/B3/B4/B5）：①B3 商业化出版检查 shared/publication-profile.ts（三模式阻断/建议 + 文案，7 用例），导出弹窗新增「严格出版检查（阻断导出）」；②B2 工作台「创作阶段」改为 CreationFlowSnapshot 真实快照（ui/agent-workbench/stage-panel.ts，5 用例），删除硬编码 8 阶段，agent-port 注入 flow；③B4 自动化状态单一真相源（删除 Vault 根旧副本）+ scripts/check-automation.mjs 入 preflight；④B5 新增用户手册、商业化指南、双自动化运维手册。全量 586 文件 / 6,398 用例、tsc 0、lint 0 error/1,809 warnings、any 260/260；B1 engine 侧 flow 契约待 ZCode。（ui/agent-workbench/stage-panel.ts + shared/publication-profile.ts + scripts/check-automation.mjs + docs/guides/USER-GUIDE.md + docs/guides/COMMERCIAL-GUIDE.md + docs/handbook/13-dual-automation-ops.md）
- 2026-11-06｜G7｜第三十二批（v4.52.0 之后待提交，Trae 第 29 轮）：test-hardening ui/states/chapter-state-manager.ts 失效标脏链（零源码改动）——①空 chapDir 早退且不清空既有状态；②chapDir 非 TFolder 早退；③质量控制文件晚于修正记录时把 fix 标脏并移出 stepCompleted；④分析报告含 CRITICAL_FAIL 时标脏 finalFix；⑤正文已完稿时跳过 mtime/时序标脏（防结算后误判需重做）；⑥正文 mtime 新于审查文件时标脏 fix/qualityControl/analysisReport；⑦step_status=reviewed 的空内容文件仍计为 complete。tests/unit/ui/chapter-state-recognition.test.ts 3 → 10 用例（+7，+160 行）；定向口径（8 个引用测试文件驱动）st 70.65%→85.07%（142→171/201）、br 72.86%→87.14%（51→61/70）、fn 88.9%→100%。前提纠偏：遗留候选写的 ui/states/state-manager.ts 不存在，真实文件为 ui/states/chapter-state-manager.ts，且基线 br 实测 72.86% 而非 54.6%（tests/unit/ui/chapter-state-recognition.test.ts + docs/PLAN.md 第 29 轮）
- 2026-11-06｜G7｜第三十一批（v4.52.0 之后待提交，Trae 第 28 轮）：gate-fix ui/components/smart-chart.ts any 16→0（纯类型收窄、零运行时行为变化）——新增 ChartData 联合类型（13 种图表数据形态）+ ChartRenderOptions（padding/size/width/height/showLegend）+ chartRenderer<T,O> 单点泛型适配函数，14 个注册项由内联 (data: any, opts) => fn(...) lambda 改为 chartRenderer(fn)；类内 data 字段、setData、getSortedData（排序比较器）、baseOpts、isScatterData 类型守卫、transformData、recommendType 全部去 any，改用 unknown + 结构化断言。测试守护 +2 用例（tests/unit/ui/smart-chart.test.ts）：①十四种图表类型逐型渲染出内容（注册表接线未断）；②柱状图渲染器收到 width/height/padding（适配函数原样透传选项）。实测：check:any 276→260（-16，106 文件）；bundle main.js 4,855,784 < 4,855,864 基线（-80B）；typecheck 0 错误（ui/components/smart-chart.ts + tests/unit/ui/smart-chart.test.ts + docs/PLAN.md 第 28 轮）
- 2026-11-06｜G7｜第三十批（v4.52.0 待发版，Trae 第 27 轮）：test-hardening engine/body-writer.ts 备份链（P0-3 数据安全，零源码改动、零新增待提交路径）——①默认在覆盖已有非空正文前备份一次，旧正文与 {type:'manual', note:'覆盖前自动备份'} 正确交给 ChapterVersionService.saveVersion，且备份不阻断写入；②backupBeforeOverwrite=false 跳过（导入/迁移全量替换）；③旧文件只有 frontmatter 时跳过；④请求缺 project 时跳过；⑤版本服务抛错只记日志、正文照常落盘；⑥同一路径 5 分钟内二次写入只备份第一次（协同自动保存节流）。测试用 vi.spyOn(ChapterVersionService.prototype,'saveVersion') 拦截，无需给 engine 加注入点（推翻第 12 轮「不可测」结论）；tests/unit/engine/body-writer.test.ts 25 → 31 用例（+6）；定向口径 st 67.35%→76.16%、br 68.78%→77.70%、lines 68.45%→76.19%，原未覆盖 L444-454 全部点亮（tests/unit/engine/body-writer.test.ts + docs/PLAN.md 第 27 轮）
- 2026-11-06｜G7｜第二十九批（v4.52.0 待发版，Trae 第 26 轮）：gate-fix 热路径门禁补全覆盖面（零源码改动、零新增待提交路径）——scripts/check-hotpath-scans.mjs 原只匹配字面 getFiles(，现抽出 FULL_SCAN_APIS 同时检查 vault.getFiles() / vault.getMarkdownFiles() / vault.getAllLoadedFiles()（三者均为 O(全库)，各带整改提示），逐行扫描 10 个 HOT_FILES 模块，命中任一即失败、每文件报首个命中行；同步脚本头注释与成功输出文案。实测：check:hotpaths 通过（10 模块 0 违规）；非测试代码中 getMarkdownFiles/getAllLoadedFiles 共 7 处全部为冷路径（弹窗/工作台/建章向导/项目工具），ui/project-utils.ts#getChaptersForProject 的 2 次全库遍历调用方均为渲染/导航，不属每章热路径，故不扩充 HOT_FILES（第 21 轮「82 处中仅 2 处按章/按次」的结论未被推翻）（scripts/check-hotpath-scans.mjs + docs/PERFORMANCE.md §2 + docs/PLAN.md 第二十六轮）
- 2026-11-06｜G7｜第二十八批（v4.52.0 待发版，Trae 第 22 轮）：test-hardening compact 涉及实体口径（零源码改动，只改既有 M 测试文件）——①compact 找不到正文文件时退化为全量实体清单，且不调用 getInvolvedEntities；②compact 命中真实 TFile 且涉及集合非空时，涉及人物/势力/地点/物品保留描述，非涉及项只留摘要字段（人物身份/状态/动机、势力类型/领袖/地位、地点类型/区域/重要程度、物品类型/等级/归属），卷名无「第N卷」时 volN 回落 0；③涉及集合为空时仍按全量输出。tests/unit/ui/template-vars-story-context.test.ts 40 → 43 用例（+3，经 vi.hoisted + 局部 mock 仅替换 findBodyFileV4/getInvolvedEntities，其余实现保持真实）；定向口径（仅本文件驱动）br 450/699 → 490/699（+40 分支路径，未覆盖分支点 171→145）（tests/unit/ui/template-vars-story-context.test.ts + docs/PLAN.md 第二十八批）
- 2026-11-06｜G7｜第二十七批（v4.52.0 待发版，Trae 第 21 轮）：perf 实测 + 热路径收口——ui/full-writer/batch-pipeline-runner.ts#loadStepResults（每章断点续跑一次全库 vault.getFiles）与 ui/cowrite/realtime-quality-controller.ts#loadPreviousChapterContext（每次质量刷新一次全库扫描）改用 shared/vault-tree 的 listFolderFiles 目录遍历；两处测试 mock 同步补建 TFolder.children；check-hotpath-scans 的 HOT_FILES 8 → 10；preflight:release EXIT=0，main.js 4,855,459 → 4,855,409（-50B），用例数不变（6,366）；bench:hotpath（10,080 文件）全库 0.523ms/次 vs 目录 0.004ms/次（ui/full-writer/batch-pipeline-runner.ts + ui/cowrite/realtime-quality-controller.ts + scripts/check-hotpath-scans.mjs + tests/unit/ui/batch-pipeline-resume.test.ts + tests/unit/ui/cowrite-previous-chapter-cache.test.ts + docs/PLAN.md 第二十七批）
- 2026-11-06｜G7｜第二十六批（v4.52.0 待发版，Trae 第 20 轮）：test-hardening buildTemplateVars 信号段（第 19 轮审计 A 档，零源码改动，只改既有 M 文件）——灵魂层 5 条（context character_cores 摘要+9 字段主角详情+就绪、步骤结果覆盖、回退、无匹配主角、三者皆空）、上下文体检 3 条（重复自动清空并记 dropped、关闭修复只告警、旧章 staleChapter）、自定义步骤模板 2 条（命中 customTemplates 才写 _stepOverrides、无自定义不写）、变体开关 1 条（quota/v2/countableHints/experimentGroup）；tests/unit/ui/template-vars-story-context.test.ts 29 → 40 用例（+11），不改源码；定向口径（仅本文件）br 450/699、st 541/724，全量口径未重复跑不与上轮 495/699 直接相减（tests/unit/ui/template-vars-story-context.test.ts + docs/PLAN.md 第二十六批）
- 2026-11-06｜G7｜第二十五批（v4.52.0 待发版，Trae 第 18 轮）：test-hardening template-vars-builder 实体字段缺省段——buildContextVars 上一章六字段全空时不写摘要/审查/情绪变量；buildEntityVars 四类实体备用键取名（姓名/fileName/?、名称），非字符串（年龄 16、重要程度 5）与空值/null（当前状态 ''、效果 null、描述 ''）被跳过不产生空标签；tests/unit/ui/template-vars-story-context.test.ts 27 → 29 用例（+2），不改源码；定向覆盖率 br 468→495/699（+27 分支路径）、st 605/724 不变（tests/unit/ui/template-vars-story-context.test.ts + docs/PLAN.md 第二十五批）
- 2026-11-06｜G7｜第二十四批（v4.52.0 待发版，Trae 第 17 轮，台账补记）：test-hardening shared/template-validator.ts 生产调用但零直接测试的校验器分支（worldview 散文检测、outline 范围/分卷、detectTimelineStrategy 同人、loadFanficRules 空文本、fanfic 时间线缺节、YAML 块标量与尾部回退解析、textHasContent、设定库空节、文笔风格空、看板解表、地点/物品缺键）；tests/unit/shared/template-validator.test.ts 19 → 38 用例（+19），不改源码；全量口径 st 81.41%→91.15%、br 79.27%→92.34%（46→17）、lines 83.89%→91.94%，余量为 L884-942 死代码（tests/unit/shared/template-validator.test.ts + docs/PLAN.md 第二十四批）
- 2026-11-06｜G7｜第二十三批（v4.52.0 待发版，Trae 第 15 轮）：test-hardening buildSceneStyleHint（ui/full-writer/template-vars-builder.ts:1108-1153）边界分支——非 TFile 对象早退、仅冲突强度≥4 判 battle、仅冲突强度≥2 判 emotional、段落未命中只给节奏不给片段、infoPlan 缺失回退 stepResults、读取抛错被吞掉；tests/unit/ui/template-vars-story-context.test.ts 18 → 27 用例（+9），不改源码；定向覆盖率 br 466→468/699、st 604→605/724、fn 39→39/42（边际仅 +2 分支，因既有 pure-helpers 用例已覆盖主路径）（tests/unit/ui/template-vars-story-context.test.ts + docs/PLAN.md 第二十三批）
- 2026-11-06｜G5｜第二十二批（v4.52.0 待发版，Trae 第 13 轮）：test-hardening template-vars-builder 剩余纯逻辑分支——四类实体字段全量拼装（含别名与备用键）、信息债阶梯四档与临近揭示窗口文案；tests/unit/ui/template-vars-story-context.test.ts 12 → 18 用例（+6），不改源码；定向覆盖率 br 416→466/699（+50）、st 565→604/724；同轮把 PLAN 的 br 401 口径纠偏为 416（tests/unit/ui/template-vars-story-context.test.ts + docs/PLAN.md 第二十二批）
- 2026-11-06｜G7｜第二十一批（v4.52.0 待发版，ZCode 派工）：test-hardening engine/body-writer.ts 纯逻辑分支——parseChapterNum 三条分叉（阿拉伯数字命中 / 无章号 / 中文数字 parseInt→NaN 回落）、chapterNum 与 chapterName 双缺省时无标题行与「章/标题」字段、write 空 path 守卫、dirOf 无目录分隔符退化、defaultBodyPath 卷号/章名/章号三条路径；tests/unit/engine/body-writer.test.ts 16 → 25 用例（+9），不改源码；单跑 4 个 body-writer 测试文件 br 75.15%→85.98%、st 82.9%→88.6%、lines 85.71%→89.88%、fn 88.88%→100%（tests/unit/engine/body-writer.test.ts + docs/PLAN.md 第二十一批）
- 2026-11-06｜G5｜v4.52.0（待发版）Notice 尾盘第十六批：command-ui-executor 20 处逐条核对——18 处为守卫/预检/进度/无变化（按口径保留），2 处告警（版本服务未就绪、旧版命令弃用）改走 showWarningNotice，文件确认收敛（20→18）；无新增测试，改用既有 notice-helpers 覆盖；同轮修复 v4.51.0 版本节点遗留的 check:bundle 红灯（changelog-data +452B 未实测 + 本轮 +32B，基线上调 4854975→4855459 并在 note 注明归因）（ui/command-ui-executor.ts + .bundle-baseline.json）
- 2026-11-06｜G5｜切片主线正式停止（用户拍板）：≤3,300 行目标废弃，co-writing-view 保留 3,363 行现状。依据 bundle 漂移审计——三次切片累计 +3,664B，适配层（宿主回调 739B + 句柄回填 693B + handles 返回 315B ≈ 1,747B）占净增 100%，切片对包体积为净增；此前向上调基线只是让门禁继续可用，不代表体积健康。后续主指标固定为 net-bundle + 模块内聚度，主线转 Notice 尾盘（command-ui-executor 20 处）（.bundle-baseline.json note + .trae/automation/trae-loop-state.json meta.notes）
- 2026-11-06｜G5｜v4.51.0（待发版）co-writing-view 切片第九批第 4 片：抽出 control-panel（右栏页签/概览卡片/写作控制台/更多工具面板/监控挂载点 + 模型按钮文案规则）；视图 3,443 → 3,363 行（-80 净减，含空行口径；毛减 150）；新增 1 个行为测试文件 11 用例；bundle 基线上调 +1,706B（纯迁移开销，note 已说明）。第九批收口：未达 ≤3,300（原「控制台 ≥143 行」高估，实测 886-993 为 108 行）；本批三次切片 bundle 累计 +3,664B，后续主指标改 net-bundle + 模块内聚度（ui/co-writing/control-panel.ts + ui/co-writing-view.ts + tests/unit/ui/co-writing-control-panel.test.ts）
- 2026-11-06｜G5｜v4.51.0（待发版）co-writing-view 切片第九批第 3 片：抽出 layout-assembly（顶栏导航/资源/模式装配、左栏本章简报与预览、右侧 Tab 头、字体选择器、Markdown 状态栏、布局回填、分隔条）；视图 3,556 → 3,443 行（-113，含空行口径）；新增 1 个行为测试文件 9 用例；bundle 基线上调 +968B（纯迁移开销，note 已说明）（ui/co-writing/layout-assembly.ts + ui/co-writing-view.ts + tests/unit/ui/co-writing-layout-assembly.test.ts）
- 2026-11-06｜G5｜v4.51.0（待发版）co-writing-view 切片第九批：抽出 metrics-refresh（剧情完成度刷新编排：评估节流门控、在途评估中止、切章丢弃旧结果、失败态回退）并扩展 chapter-context（resolveChapterLocation 章节身份推定 / stripChapterBody 正文去壳，锁定「缺参绑定错误卷」与标题重复两处历史 bug）；视图 3,581 → 3,556 行（-25，含空行口径）；新增 1 个行为测试文件 7 用例 + chapter-context 追加 11 用例（ui/co-writing/metrics-refresh.ts + ui/co-writing/chapter-context.ts + ui/co-writing-view.ts + tests/unit/ui/co-writing-metrics-refresh.test.ts + tests/unit/ui/co-writing-chapter-context.test.ts）
- 2026-11-06｜G5｜v4.50.0 第十五批 Notice：ai-builder-modal / appearance-settings / settings/general-sections / settings/foreshadow-section / settings/knowledge-section / project-utils 合计替换 34 处（成功/失败/告警）；settings/api-section 余 8 处均为校验守卫，0 替换并确认收敛；无新增测试，改用既有 notice-helpers 覆盖（ui/ai-builder-modal.ts + ui/appearance-settings.ts + ui/settings/general-sections.ts + ui/settings/foreshadow-section.ts + ui/settings/knowledge-section.ts + ui/project-utils.ts）
- 2026-11-06｜G5｜v4.49.0（待发版）co-writing-view 切片第八批：抽出 editor-shortcuts（编辑器快捷键决策）、metrics-render（指标面板/评分卡/方向文本）、settlement-actions（待结算提示/标记完稿/结算入口/冲突检测）、suggestion-flow（Tab 建议与流式建议主流程）四个模块；视图 3,980 → 3,581 行（-399）；新增 4 个行为测试文件 22 用例（ui/co-writing/editor-shortcuts.ts + ui/co-writing/metrics-render.ts + ui/co-writing/settlement-actions.ts + ui/co-writing/suggestion-flow.ts + ui/co-writing-view.ts）
- 2026-11-06｜G5｜v4.48.0 co-writing-view 切片第七批：抽出 suggestion-cards（建议/联想/校验/流式卡片）、suggest-feedback（错误卡/知识空态/空建议/注入提示）、brief-panel（本章简报/冷启动/按钮态）、dashboard-status（状态栏/人工率仪表盘）、kb-reference-config（参考书开关/主参考/权重）、suggestion-loading（生成中进度面板）、quality-popup（浮窗/右键菜单/编辑器定位）七个模块；视图 4,303 → 3,980 行（-323）；新增 6 个行为测试文件 27 用例（ui/co-writing/suggestion-cards.ts + ui/co-writing/suggest-feedback.ts + ui/co-writing/brief-panel.ts + ui/co-writing/dashboard-status.ts + ui/co-writing/kb-reference-config.ts + ui/co-writing/suggestion-loading.ts + ui/co-writing/quality-popup.ts + ui/co-writing-view.ts）
- 2026-11-06｜G5｜v4.47.0 co-writing-view 切片第六批：抽出 chapter-context（路径/标题/章节身份）、ghost-association（幽灵联想触发判定与提示）、quality-fix（定位/Prompt/替换决策）、monitor-cards（五张监控卡）、metrics-panel（指标面板三态与渲染）五个模块；视图 4,645 → 4,303 行（-342）；新增 5 个行为测试文件 40 用例（ui/co-writing/chapter-context.ts + ui/co-writing/ghost-association.ts + ui/co-writing/quality-fix.ts + ui/co-writing/monitor-cards.ts + ui/co-writing/metrics-panel.ts + ui/co-writing-view.ts）
- 2026-11-06｜G5｜v4.46.0 第十四批：add-fanfic-setting-modal / manage-providers-modal / style-distiller-modal 三个文件余 25 处逐条核对，全部为守卫/输入预检/无变化/常驻进度，按口径 0 替换；三文件确认收敛完成（ui/add-fanfic-setting-modal.ts + ui/manage-providers-modal.ts + ui/style-distiller-modal.ts）
- 2026-11-06｜G5｜v4.44.0 第十三批：co-writing-view / add-fanfic-setting-modal / manage-providers-modal / style-distiller-modal / create-project-modal 五个文件 Notice 13 处（成功/失败/告警），60→47；co-writing-view 余 20 处均为守卫/预检/无变化/进度，确认无可替换（ui/co-writing-view.ts + ui/add-fanfic-setting-modal.ts + ui/manage-providers-modal.ts + ui/style-distiller-modal.ts + ui/create-project-modal.ts）
- 2026-11-05｜G5｜v4.43.0 第十二批：batch-import-modal / generate-character-modal / ideation-modal / backup-center-modal / project-side-panel-view / wizard-step-renderers 六个文件 Notice 37 处（成功/失败/告警），61→24；守卫、进度、预检、无变化与信息展示保留（ui/batch-import-modal.ts + ui/generate-character-modal.ts + ui/ideation-modal.ts + ui/backup-center-modal.ts + ui/project-side-panel-view.ts + ui/full-writer/wizard-step-renderers.ts）
- 2026-11-05｜G5｜v4.42.0 第十一批：full-writer-view Notice 6 处（成功 1 / 失败 5），11→5；守卫、预检与带引导提示保留（ui/full-writer-view.ts）
- 2026-11-05｜G5｜v4.42.0 第十批：prompt-manager-settings / co-write-floating-panel / wizard-step-executors / template-manager / fanfic-review-modal 五个文件 Notice 67 处（成功/失败/告警），91→24；守卫、进度、预检与无变化提示保留（ui/prompt-manager-settings.ts + ui/co-write-floating-panel.ts + ui/full-writer/wizard-step-executors.ts + ui/template-manager.ts + ui/fanfic-review-modal.ts）
- 2026-11-05｜G5｜v4.42.0 第九批：knowledge-base-view / knowledge-base-modals / command-ui-executor / add-fanfic-setting-modal / ai-builder-modal / pre-research-modal 六个文件 Notice 87 处（成功/失败/告警），161→74；守卫、进度、预检与无变化提示保留（ui/views/knowledge-base-view.ts + ui/views/knowledge-base-modals.ts + ui/command-ui-executor.ts + ui/add-fanfic-setting-modal.ts + ui/ai-builder-modal.ts + ui/pre-research-modal.ts）
- 2026-11-05｜G5｜v4.42.0 第三批：golden-opening-modal Notice 第八批 31 处（成功 9 / 失败 22），45→14；守卫 7 与进度 7 保留（ui/golden-opening-modal.ts）
- 2026-11-05｜G5｜v4.42.0 第二批：writing-fingerprint-view Notice 第七批 21 处（成功 8 / 失败 10 / 告警 3），52→31；守卫、进度与无变化提示保留（ui/views/writing-fingerprint-view.ts）
- 2026-11-05｜G5｜v4.42.0 首批：co-writing-view Notice 第六批 40 处（成功/失败/告警），守卫/进度类保留；抽出 markdown-shortcut / quality-highlight / friendly-error / kb-panel 四个模块，文件 4,986 → 4,645 行（达标 ≤4,700）（ui/co-writing-view.ts + ui/co-writing/{markdown-shortcut,quality-highlight,friendly-error,kb-panel}.ts + 4 个单测文件（17 条））
- 2026-11-01｜G7｜建立专项台账与渲染脚本（单一数据源 + CI 可校验）（docs/progress/program-status.json）
- 2026-11-01｜G4｜版本升级备份对密钥脱敏（apiKey/providerKeys/各向量 Key/GitHub Token/考据 Key）（shared/secret-redaction.ts）
- 2026-11-01｜G1/G3｜盘点后修复：备份默认失效、版本索引并发锁、项目路径推导收口（7 处）、统计陈旧元数据（body-writer / chapter-version-service / shared/paths / writing-stats-service）
- 2026-11-01｜G5/G6｜批量建章进度横幅泄漏、缓存键 NUL、覆盖历史无上限（continue-chapters-modal / knowledge-vector-store / plugin-cache）
- 2026-11-01｜G1｜时间线三处写入加锁；成长/情绪/互信息/连续性账本按章去重；结算弹窗重复结算守卫（settlement-engine / analysis-report-engine / context-manager / chapter-settlement-modal）
- 2026-11-01｜G1｜G1-12/13 权威源决策定稿；V1 互信息改整行去重（2 条单测）（docs/design/g1-authority-decisions.md + settlement-engine）
- 2026-11-01｜G1｜G1-12b/13a/13b/13c 落地：权威源门禁、settlement_mode、SettlementJournal 三类回滚、失败标记（check-relationship-authority.mjs / settlement-journal.ts / chapter-settlement-modal.ts）
- 2026-11-01｜G2｜知识注入来源落盘：rag_sources（书/维度/分数/片段）写入步骤 frontmatter（shared/rag-sources.ts + injector/step-runner/saver + 10 条单测）
- 2026-11-01｜G2｜rag_sources 展示：步骤面板知识来源条 + 统计页命中率/常用书目/最近引用（knowledge-usage.ts + writing-stats-modal + step-render-controller）
- 2026-11-01｜G3｜短篇/剧本通用工具放开 + 模式不支持提示；项目迁移一键撤销（逆序、占用跳过）（command-mode-rules / tool-catalog-aggregator / project-migration-service）
- 2026-11-01｜G5｜静默失败清零门禁 + 关键入口补提示（备份/浮窗保存/结算表/信息债/章节加载）+ 拆解监控空态 CTA（check-silent-failures.mjs + knowledge-monitor/backup-yuan/co-write-floating/write-chapter）
- 2026-11-01｜G6｜性能三件：伏笔刷新防抖+单项目、写章一次快照+40 章窗口、监控局部更新（7 条契约测试）（main.ts / write-chapter-modal / knowledge-monitor + perf-contracts.test）
- 2026-11-01｜G7｜结算引擎真实行为测试（成功/幂等/回滚），修复正文 status 未进回滚日志（settlement-engine-behavior.test + settlement-engine updateBodyFrontmatter）
- 2026-11-01｜G7｜覆盖率口径纳入 shared/（真实基线 76.7% lines），shared 域阈值 90/90/82/80 生效（vitest.config.ts）
- 2026-11-01｜G7｜覆盖缺口第一批：SingleCallRunner 8 条 + 领域工厂 6 条（含失败回滚修复）；测试堆栈上限提高到 4G（Node 24 teardown 崩溃）（single-call-runner.test / domain-project-factory.test / package.json）
- 2026-11-01｜G7｜G7-4b：host-tools 权限边界 16 条 + 4 个 embedding provider 11 条（host-tools-guard.test / embedding/providers.test）
- 2026-11-01｜G7｜G7-4c：KnowledgeTagManager 9 条 + 修复损坏标签文件静默回落默认树（会覆盖用户原文件）（knowledge-tags.test + engine/knowledge-tags.ts）
- 2026-11-01｜G7｜G7-4d：知识库详情状态机抽纯模块 + 9 条回归（换书清空/错误文案/列表守卫）（knowledge-detail-state.ts + test）
