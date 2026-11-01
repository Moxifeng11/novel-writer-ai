# 全系统优化专项 · 进度报告

> **本文件由 `scripts/program-status.mjs` 从 `docs/progress/program-status.json` 生成，请勿手改。**
> 专项计划与验收口径见 [`docs/PROGRAM.md`](../PROGRAM.md)；结构路线见 [`docs/PLAN.md`](../PLAN.md)。

- 专项版本：v5-plan-1
- 更新时间：2026-11-01
- 当前基线：v4.22.0；单测 502 文件 / 5665 用例；E2E 25 条
- 任务进度：52/59 已完成（88%），1 进行中，0 受阻

## 一、任务组总览

| 组 | 名称 | 目标版本 | 状态 | 进度 | 责任人 |
|---|---|---|---|---|---|
| G1 | 创作主链闭环 | v4.23.0 | ✅ 已完成 | 18/18（100%） | 实现 ZCode / 验收 用户 |
| G2 | 语料与注入链 | v4.24.0 | 🟡 进行中 | 5/6（83%） | 实现 ZCode / 验收 用户 |
| G3 | 项目生命周期与三模式 | v4.24.0 | ✅ 已完成 | 5/5（100%） | 实现 ZCode / 验收 用户 |
| G4 | 配置与凭据治理 | v4.23.0 | ✅ 已完成 | 5/5（100%） | 实现 ZCode / 验收 用户 |
| G5 | 交互一致性与可访问性 | v4.25.0 | 🟡 进行中 | 5/6（83%） | 实现 ZCode / 验收 用户 |
| G6 | 性能与存储 | v4.25.0 | 🟡 进行中 | 8/10（80%） | 实现 ZCode / 验收 用户 |
| G7 | 质量基建与可观测 | v4.25.0 | 🟡 进行中 | 6/9（67%） | 实现 ZCode / 验收 用户 |

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

### G2 语料与注入链（🟡 进行中）

- 目标：知识库→拆解→向量→检索→故事上下文总线→文笔注入 全链可解释、可降级、不串项目
- 目标版本：v4.24.0
- 责任：实现 ZCode；验收 用户
- 依赖：G1

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G2-1 | 指纹库跨项目写入 | ✅ 已完成 | 切换项目后列表与增删落在当前项目 | 9c6dcd7 |
| G2-2 | 文笔样文小节解析恒失败（\s 退化） | ✅ 已完成 | 「零、参考样本」可定位；样文校验可用（单测锁定） | 84d1e31 |
| G2-4 | 上下文总线预算与去重口径统一 | ⬜ 待开始 | 本地/云端双预算生效；重复段剔除率可量化（体检报告） | — |
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

### G5 交互一致性与可访问性（🟡 进行中）

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
| G5-5 | 窄屏与移动端布局 | ⬜ 待开始 | 侧栏收起时三栏视图可单列滚动；移动端无白屏（宠物/状态栏已守卫） | — |
| G5-6 | 批量建章失败后永久进度横幅 + 静默失败 | ✅ 已完成 | finally 关闭横幅；失败给出已创建数并报原因 | ui/continue-chapters-modal.ts |

> IME 与全局按键属于「一处漏改就毁数据」的类型，优先统一原语。

### G6 性能与存储（🟡 进行中）

- 目标：长篇 200+ 章下打开/落盘/结算不卡顿；写放大与内存有上限；启动不阻塞
- 目标版本：v4.25.0
- 责任：实现 ZCode；验收 用户
- 依赖：G1、G2

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G6-1 | 文件缓存 index 全量重写 | ✅ 已完成 | index.json 只落元数据；覆盖写体积不随 value 增长（单测锁定） | 67c53ca |
| G6-2 | 上下文缓存无上限 | ✅ 已完成 | LRU 上限 16；写入 20 章后 size ≤ 16 | 1e34ce5 |
| G6-3 | 嵌入请求无超时 | ✅ 已完成 | 60s 超时并给出明确错误 | 67c53ca |
| G6-4 | 全库 getFiles 热路径收敛 | ⬜ 待开始 | 落盘/结算/统计路径 0 次全库遍历；200 章落盘 <200ms | — |
| G6-5 | 步骤事件全量重渲染 | ⬜ 待开始 | 步骤完成时 DOM 变更 <100 节点（DevTools Performance） | — |
| G6-6 | 缓存键含裸 NUL 导致文件对 grep 不可见 | ✅ 已完成 | 源码改为   转义，文件重新可检索 | engine/knowledge-vector-store.ts |
| G6-7 | 模型覆盖历史无上限、cache.json 线性膨胀 | ✅ 已完成 | 历史保留最近 200 条 | shared/plugin-cache.ts |
| G6-8 | 伏笔刷新无防抖 + 每次全库×项目扫描 | ✅ 已完成 | modify 事件按项目 800ms 防抖，只刷被改项目（源码契约测试） | main.ts debounceFixed(info-debt:project) + perf-contracts |
| G6-9 | 写章前 n=1..N 循环内 4 次全库扫描 | ✅ 已完成 | 一次 getFiles 快照；前文摘要最多 40 章、12000 字（源码契约测试） | ui/write-chapter-modal.ts allFiles + PREV_SUMMARY_WINDOW |
| G6-10 | 拆解监控 500ms 整块重建 + 工作台每步重建 | ✅ 已完成 | 定时刷新只 patch 文字/宽度；仅任务或状态变化才重建 DOM | knowledge-monitor updateCurrentTab + data-nw-progress |

> 先量化再优化：所有条目都要有前/后对比数字，否则不进主线。

### G7 质量基建与可观测（🟡 进行中）

- 目标：覆盖缺口可度量、门禁不可绕过、进度可追溯、问题可定位
- 目标版本：v4.25.0
- 责任：实现 ZCode；验收 用户

| 任务 | 内容 | 状态 | 验收标准 | 证据 / 备注 |
|---|---|---|---|---|
| G7-1 | CI 绕过架构门禁 | ✅ 已完成 | CI 跑 styles/deps/engines；漂移检查覆盖 versions.json 与 styles.css | 67c53ca |
| G7-2 | 占位测试与无效断言 | ✅ 已完成 | 0 个 `expect(true)`；`resolves.not.toThrow` 已改用实际值断言 | 4e89a67 |
| G7-3 | 专项进度台账与渲染脚本 | ✅ 已完成 | program-status.json 单一数据源；MD 由脚本生成且 --check 可校验 | docs/progress/PROGRAM-STATUS.md |
| G7-5 | 联动场景回归清单 | ⬜ 待开始 | 每组改动跑「生成→质控→修订→结算→导出」+「知识库→注入」+「三模式创建」三条联动链 | — |
| G7-6 | 结算引擎 1670 行 0 直接测试 | ✅ 已完成 | 成功结算/重复幂等/部分失败回滚 3 条真实行为用例（不再整体 mock）；并暴露正文 status 未进 journal 的缺陷 | tests/unit/engine/settlement-engine-behavior.test.ts + settlement-engine 正文快照修复 |
| G7-7 | shared/ 与 ui/ 不在覆盖率口径内 | ✅ 已完成 | vitest include 覆盖 shared/；基线 76.7% lines（含 shared），shared 域阈值 90/90/82/80 已生效 | vitest.config.ts include + 各域阈值 + test:cov 通过 |
| G7-4 | 覆盖缺口补齐（分批） | 🟡 进行中 | 第一批（结算/Agent runner/生命周期）已完成；剩余 Agent 工具、知识库 UI、embedding provider 待补 | 见 G7-4a 与 G7-4b |
| G7-4a | 结算/Agent runner/生命周期行为测试 | ✅ 已完成 | settle 成功/幂等/回滚 3 条；SingleCallRunner 8 条（含不重试）；迁移撤销 4 条；领域工厂 6 条（含失败回滚） | settlement-engine-behavior / single-call-runner / project-migration-rollback / domain-project-factory |
| G7-4b | Agent 工具与知识库/embedding 覆盖 | ⬜ 待开始 | host-tools 权限与写盘边界、knowledge-tags、4 个 embedding provider 各有最小行为测试 | — |

> 本组是其它组的「刹车」：没有它，前面六组改快了会翻车。

## 三、同步对象

| 对象 | 位置 | 说明 |
|---|---|---|
| 本项目结构路线 | `docs/PLAN.md` | 模块边界与里程碑 |
| 跨工具进度 | `.trae/CURRENT-PROGRESS.md` | Trae / ZCode 共享基线 |
| 进度报告 | `docs/progress/PROGRAM-STATUS.md` | 本文件（自动生成） |
| 审计取证 | `docs/audits/` | 各轮问题清单与修复证据 |

## 四、进度流水

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
