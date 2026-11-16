# 全域审计与优化建议（v4.22.0 · 2026-10-31）

> 审计对象：`d:\小说工坊\小说工坊\.obsidian\plugins\novel-writer-ai`
> 审计方式：静态代码盘点 + 架构守卫实测 + 全量单测实跑，**审计阶段未修改任何业务代码**
> 审计基线：typecheck 0 错误 · `vitest run` **474 文件 / 5462 用例全部通过** · 分层违规 64（基线白名单内）· 循环依赖 53 · 引擎旁路 9 类 · 引擎超限 2 类
>
> ⚠️ 口径提示（2026-10-31 批次 3 修正）：以上「分层违规 64 / 循环依赖 53」是**审计当时口径**（把 `import type` 类型边与注释里的 import 示例一并计入）。实际运行时循环仅 9 个、运行时分层违规 55 条；修正后门禁指标见[第四节批次 3](#批次-3架构解耦a2a4--a1)。

---

## 一、审计范围与实测数据

| 维度 | 实测值 |
|---|---|
| 源码文件 / 行数 | 1155 个 `.ts`（含 tests）；非测试 655 个，约 20.1 万行 |
| 分层体积 | engine 280 文件 / 102,948 行；ui 181 / 83,899；tests 493 / 75,749；shared 138 / 22,594；services 38 / 14,395 |
| 单文件体量 TOP | `ui/co-writing-view.ts` 4,811 行；`ui/settings-tab.ts` 4,689；`engine/deconstructors/character-deconstructor.ts` 3,520；`engine/co-writer-engine.ts` 3,323；`styles.css` **14,097 行** |
| 构建产物 | `main.js` **9.34 MB**；`data/` **6.54 MB**（其中 8 个 `knowledge-vectors/*.json` 各约 2.9 万行） |
| 依赖 | 分层违规 64（services 49 / core 7 / shared 5 / engine 3）；循环依赖 53；`EngineRegistry` 1,153 行、22 个实例（数字为审计当时口径，运行时口径见批次 3） |
| 耦合面 | `ui/` 内 `app.vault` **683 处**、`plugin.engine.` 仅 1 处；全源码 `vault.getFiles()` **91 处**、`getAbstractFileByPath` 397 处、`vault.adapter` **189 处** |
| 代码卫生 | `: any` 247 处；`console.log/debug` 仅 3 处（已统一 logger，纪律良好）；`setTimeout` **96 处**（批次 14 复核：原审计 255 为含 `node_modules` 误计；固定字面量仅约 25 处） |
| 异常处理 | `catch` **1,504 次**（批次 14 复核：原审计 2,202 为含 `node_modules` 误计）、`throw new Error` 396 次、全局 `unhandledRejection` 兜底 58 处、`console.error` 188 处 |
| 平台适配 | 源码 **0 处** `from 'fs'/'path'/'os'`、0 处 `child_process`；`new Worker` 4 处、`localStorage` 24 处、`requestUrl` 23 处；`manifest.isDesktopOnly = false` |

> 说明：初次统计中 `child_process` 137 处、`console.log` 2097 处均为**误计**（含 `node_modules`）。本条已按源码目录重新统计，报告中一律采用上表数字。

---

## 二、问题分类与优先级

优先级定义：**P0 = 会产生错误数据或错误对象，必须最先修**；**P1 = 静默降级/性能受损，用户可感知但不出错数据**；**P2 = 结构债，随时机重构**。

### A. 架构与依赖（P1，结构债）

| 编号 | 问题 | 证据 |
|---|---|---|
| A1 | ✅ **已解决（批次 6）**：原 **EngineRegistry 是 service locator 枢纽**（1,153 行、22 个 `new` 实例、字符串 `ENGINE_NAMES` + 泛型 `get<T>()` 无编译期约束）；现新增 `EngineServiceMap`（35 个 token 的实例类型映射）与 `EngineToken`，`get`/`getOrNull`/`register`/`registerLazy` 的 typed-token 重载把服务名与实例类型在编译期绑定，84 处旧调用零改动；`TEMPLATE_MANAGER` / `CO_WRITING_SESSION_STORE` 等组合根注入项保留宽泛重载 | [engine-registry.ts](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/engine/engine-registry.ts) |
| A2 | **Engine 反向依赖 UI**（审计时 3 处）：`engine-registry.ts → ui/password-modal`、`ui/template-manager`（剩 2 处，需组合根注入）；`step-modal-controller.ts → ui/full-writer/step-modal-styles` **已在批次 3 下沉到 `shared/step-modal-styles.ts` 解决** | 守卫实测 Engine 层 3 → 2 违规 |
| A3 | **services 反向依赖 engine 49 处**：拆解调度、知识库、伏笔、模板服务全部直连 engine 实现，services 层实际是「第二引擎层」 | 守卫实测 services 49 违规 |
| A4 | ~~**shared 反向依赖 engine + ui**~~：`shared/plugin-api.ts` 同时 import `ai-engine`、`context-manager`、`engine-registry`、`ui/workspace-manager`，曾被判为全仓最大循环中心（53 条循环里 20+ 条经过它）。**批次 3 复核：这些边全部是 `import type`，运行时不成环**；**批次 5 已收敛：门面移到根级 `plugin-api.ts`（不属于任何分层），类型耦合提示 10 → 0** | [plugin-api.ts](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/plugin-api.ts) |
| A5 | ✅ **已解决（批次 7）**：`ARCHITECTURE.md` 的 UI 层职责、访问边界表、违反规则标志改为「目标边界 + 现状偏差」双口径，写明 UI 层 `app.vault` 直连（约 683 处）与 Engine 层直接 import `obsidian` 属未收口现状，且门禁只约束层间内部 import，不代表规则已达成 | [ARCHITECTURE.md#L61-L66](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/docs/ARCHITECTURE.md#L61-L66) |

### B. 冗余与重复实现（P0/P1）

| 编号 | 问题 | 证据 |
|---|---|---|
| B1 | **实体生成为三引擎 + 两弹窗并存**：`ai-entity-generator`（231 行）、`ai-batch-entity-generator`（537 行）、`ai-character-generator`（349 行）三套 frontmatter 常量与校验各自维护；`ui/ai-builder-modal.ts`（1,013 行）与 `ui/unified-entity-generate-modal.ts`（955 行）功能重叠 | 三者均 import `ENTITY_BODY_SECTIONS` 但校验函数不同（`validateFactionOutput` / `validateCharacterOutput`） |
| B2 | ✅ **批次 10 复核：属正常复用，原结论（重复实现需合并）不成立**。`unified-entity-manager-modal` 是跨类别总览（筛选 / 审计 / 补全 / 跳转），`existing-entity-manager` 是**单类别文件操作面板**（改名 / 编辑全文 / 删除 / 猜名），按 `subdir + label` 被 4 个单类别生成弹窗 + unified 总览（2 处）+ unified 生成（1 处）+ `full-writer-view` 共 7 个入口复用；两者为「总览页 → 详情页」，合并会破坏全部调用方且让总览弹窗更臃肿。已补两处职责边界注释，防止后续误判为重复实现 | [existing-entity-manager.ts#L17-L31](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/ui/existing-entity-manager.ts#L17-L31) |
| B3 | **章节列表来源单点、排序分散**：`getChaptersForProject` 返回「正文 ∪ 骨架」的合并顺序（`getAllLoadedFiles` 遍历序），各 UI 自行排序 | [project-utils.ts#L130-L193](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/ui/project-utils.ts#L130-L193) |
| B4 | **实体数量统计曾四处口径**：已收敛到 `shared/entity-reader.ts`（`countProjectEntities`；旧 `entity-stats.ts` 并入后删除），内容读取同样走 `listEntityFiles` 唯一入口 | [entity-reader.ts](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/shared/entity-reader.ts) |

### C. 性能瓶颈（P1）

| 编号 | 问题 | 证据 |
|---|---|---|
| C1 | **全库扫描进渲染热路径**：`vault.getFiles()` 91 处，`getChaptersForProject` 一次调用 = 2 次全库遍历（`getFiles` + `getAllLoadedFiles`）；项目卡片逐个项目调用 → N 个项目 = 2N 次全库扫描 | [project-utils.ts#L134-L190](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/ui/project-utils.ts#L134-L190) |
| C2 | ✅ **已收口（批次 13）**：新增 `shared/file-system-port.ts#writeVaultText` 作为「写 vault 内文本」单一出口（TFile → `vault.modify`；配置目录 / 索引外已存在 → `adapter.write`；其余 → 补父目录后 `vault.create`），替换 9 个 UI / 共享模块的 13 处用户可感知写入。**口径更正**：`vault.adapter.*` 实测 **141 调用点 / 136 行**（非 189），其中 `exists 44` / `write 36` / `mkdir 28` / `read 13` / `stat 6` / `list 5` / `remove 4` / `rename 2` / `append 1` / `basePath 1` / `rmdir 1`；危害只落在「写 vault 内 `.md`」子集，读 / 目录 / 索引外写入保留 adapter 属正确用法 | `shared/file-system-port.ts#L305-L314` |
| C3 | ✅ **已解决（批次 11）**：`styles.css` 拆为 `styles-src/` 16 个源文件（`scripts/build-styles.mjs` 按文件名顺序纯文本拼接，`check:styles` 防产物漂移，正文与拆分前逐字节相等）；`ui/settings-tab.ts` 拆为 227 行宿主（tab 栏 + 分区调度 + DOM 缓存）+ `ui/settings/` 8 个分区模块。**口径更正**：审核当时的「样式单体 14,097 行 / settings-tab 4,689 行」为旧版本数字，拆分前实测为 `styles.css` 16,027 行 / 450,911 字节、`settings-tab.ts` 5,112 行 | 文件体量实测 |
| C4 | **启动期串行阻塞**：`onload` 依次执行 `engineRegistry.initialize` → 模板 scaffold（逐文件写盘）→ 中断拆解恢复 → 规则版本检查，全部 `await` | [main.ts#L640-L694](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/main.ts#L640-L694) |
| C5 | ✅ **已解决（批次 12）**：`scripts/build.js` 开启 `minify: true` + `charset: 'utf8'`，`main.js` **9,089,917 → 4,798,890 字节（-47.2%）**；两个 worker 同步减半（1,330,977 → 680,977 / 227,172 → 107,635）。**口径更正**：原「模板资源内联导致 9.34 MB」**因果不成立**——模板 `assets/template-scaffold` 56 文件 / 79,863 字节，生成物 `template-scaffold-assets.generated.ts` 86,221 字节仅占 bundle 约 1.6%；真因是从未压缩。`data/knowledge-vectors` 6.26 MB 为本机运行时目录，不入仓不入发布包（批次 9 已核实） | `scripts/build.js` |

### D. 可维护性（P2）

| 编号 | 问题 |
|---|---|
| D1 | 千行级文件 10+（见上表），职责混杂：`co-writing-view.ts` 同时管视图、状态、事件、渲染 |
| D2 | `: any` 247 处，主要落在引擎输出解析与 UI 事件边界 |
| D3 | ✅ **批次 14 复核：原结论「无统一等待原语」不成立**。实测 `setTimeout` 为 **96 处**（非 255，原数含 `node_modules`），其中固定字面量仅约 25 处（`0ms` 7 / `16ms` 5 / `500ms` 3 / `300ms` 3，其余各 1），不存在「大量 300/500/1000ms 固定延迟」；`shared/yield.ts#yieldToUI` 早已存在，缺的是**原语复用**。真正的同类是 5 处「等一帧」`setTimeout(16)`，现新增 `nextFrame()` 并全部替换；其余 `setTimeout` 属 debounce / 节流 / 同步回调调度，有意保留 | [yield.ts](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/shared/yield.ts) |
| D4 | 测试/源码行数比 ≈ 0.38，但 474 个测试文件集中在 shared/engine；`ui/` 缺少可测交互契约 |
| D5 | 文档四件套（ARCHITECTURE / API / CODE-INDEX / DEVELOPMENT）体量已大（36+45+89+140 KB），与代码同步靠人工 |

### E. 权限与平台（P1）

| 编号 | 问题 | 证据 |
|---|---|---|
| E1 | ✅ **批次 7 复核：原结论不成立**（已有运行时能力探测）。`WorkerManager` 构造即调用 `detectWorkerSupport()`：先判 `typeof Worker === 'undefined'`，再用内联脚本实建一次 Worker 探活并 `terminate`；失败置 `workerAvailable=false`、走主线程 `fallbackToMain`，并经 `notifyWorkerUnavailable` 会话内一次提示。`resolvePluginWorkerUrl` 返回 null 时，拆解 / 质量 / 重任务三个调用方同样降级并提示。**口径更正**：`new Worker` 实为 3 处调用（`worker-manager` 2 + `worker-runtime` 1），非 4 处 | [worker-manager.ts#L89-L113](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/services/worker-manager.ts#L89-L113) |
| E2 | ✅ **已解决（批次 8）**：键名集中到 `shared/storage-keys.ts`（`STORAGE_KEYS` 3 个单值键 / `STORAGE_KEY_PREFIXES` 3 个前缀 / `LEGACY_STORAGE_KEYS` 2 个遗留键 / `projectScopedKey` 项目分桶），6 个使用方与 `main.ts` 全部改引用，源码内不再有硬编码键字面量。**键值保持不变**，避免既有收藏 / 折叠 / 向导 / 耗时 / 确认记忆失效；两套历史前缀（`novel-writer-*` / `nw-op-confirm:`）保留，统一迁移需配套回填读取，未做 | [storage-keys.ts](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/shared/storage-keys.ts) |
| E3 | ✅ **已解决（批次 7）**：新增 `shared/http-request.ts`（`requestWithPolicy` 单次尝试超时 + 可选重试 + `HttpRequestTimeoutError` + `SEARCH_REQUEST_POLICY`）。canon 检索 4 个搜索后端 + 网页抓取、趋势检索 4 个搜索后端共 9 处直连调用接入统一 15s 超时；搜索类请求对 5xx/429/网络错误重试 1 次，超时不重试。**口径更正**：直连 `requestUrl` 的服务是 4 个，其中 `api-connectivity-service` / `model-discovery` 已有自建 `Promise.race` 超时，真正缺超时的调用点为 9 处（非 23 处） | [http-request.ts](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/shared/http-request.ts) |

### F. 异常处理（P0/P1）

| 编号 | 问题 | 证据 |
|---|---|---|
| F1 | **静默降级不通知**：prompt 装配的 `droppedExtra`（知识注入被整段丢弃）只进日志，用户无感知；仅有 `truncated` 会弹 Notice | [step-runner.ts#L778-L779](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/engine/step-runner.ts#L778-L779) |
| F2 | ✅ **批次 7 复核：原结论不成立**（批量分支已闭环）。`ai-batch-entity-generator` 对势力/地点/物品执行「逐条校验 → 批量/逐条 AI 补全 → 复检」，出口再 `filter(validateFn 通过)` 丢弃不完整实体并提示「生成 N/M 个完整实体，其余已自动丢弃」；公开单条入口 `repairEntity` 补全后仍不完整时返回 null，调用方拒绝落盘 | [ai-batch-entity-generator.ts#L238](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/engine/ai-batch-entity-generator.ts#L238) |
| F3 | ✅ **批次 14 复核：原结论「2,202 次 `catch` 无分级」口径不成立**（实测 **1,504 次**，原数含 `node_modules`），且逐条分级需判断业务语义、全量改造不可行。已把「三要素」（失败对象 + 场景 + 可重试性）与「三级日志级别」写入 `docs/DEVELOPMENT.md` 作为约定，并以 `engine/deconstructors/foreshadow-deconstructor.ts` 两处降级点完成试点；其余按模块增量推进 | 源码统计 + [DEVELOPMENT.md](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/docs/DEVELOPMENT.md) |

### G. 资源加载（P2）

| 编号 | 问题 |
|---|---|
| G1 | 模板 scaffold 在 `onload` 内逐文件创建并逐条 `Notice`，全新安装时启动耗时可观 |
| G2 | ✅ **批次 9 复核：原结论不成立**（`data/` 不是分发目录）。仓库根即插件目录，`.gitignore:30` 忽略整个 `data/`（`git ls-files data` 返回空）；`release.yml#L58` 的打包命令为 `zip -r "$ZIP" main.js manifest.json styles.css workers`，Release ASSETS 同。`knowledge-vectors` 与 `*-preferences.json` 同处的是**本机运行时数据目录**，既不随仓库也不随发布包分发。测试项目偏好文件只是本机残留，清理属本地卫生，非代码优化项 | 证据：`.gitignore:30` / [release.yml#L58](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/.github/workflows/release.yml#L53-L59) |
| G3 | 字体、样章、模板三类资源各有一套加载函数，无统一资源清单与失败降级表 |

---

## 三、优先级矩阵

| 优先级 | 条目 | 影响 | 改动成本 | 风险 |
|---|---|---|---|---|
| **P0** | ✅ B1 实体生成三引擎归一（批次 4 完成） | 数据不一致、双入口互相覆盖 | 高 | 中（需回归 3 个生成器测试） |
| **P0** | ✅ B3 章节排序下沉到数据源（批次 1 完成） | 多处显示乱序（同类缺陷反复修） | 低 | 低 |
| **P0** | ✅ F1 `droppedExtra` 上抛提示（批次 1 完成） | 用户「文笔指纹没生效」无解释 | 低 | 低 |
| **P0** | ✅ A2/A4 打破 `plugin-api` 循环（批次 3 / 4 完成，A4 原结论已修订） | 重载/热更新时的隐式初始化顺序故障 | 中 | 中 |
| **P1** | ✅ C1 全库扫描改局部扫描 + 缓存（批次 2 完成） | 项目页/章节页卡顿随章节数线性增长 | 中 | 中 |
| **P1** | ✅ C2 `vault.adapter` 写入收口到 `writeVaultText`（批次 13 完成） | 索引不同步、写锁绕过 | 高 | 高 |
| **P1** | ✅ E1 移动端能力探测（批次 7 复核：原结论不成立，已有运行时探测） | 移动端 Worker 失败无提示 | 低 | 低 |
| **P1** | ✅ A1 Registry 字符串键改类型化注册（批次 6 完成） | 服务取错/取空只到运行时才炸 | 中 | 中 |
| **P1** | ✅ C5 构建产物压缩（批次 12 完成，`main.js` -47.2%） | 安装包与加载体积 | 低 | 低 |
| **P2** | ✅ C3 样式拆分 + 增量渲染（批次 11 完成） | 设置页切换卡顿 | 中 | 低 |
| **P2** | D1 千行文件拆分 | 单人维护成本 | 高 | 中 |
| **P2** | ✅ G2 分发目录混放（批次 9 复核：原结论不成立） / G3 资源清单化 | 分发体积、加载失败不可观测 | 低 | 低 |

---

## 四、实施路径（四个批次，每批自带验收门）

### 批次 1：低风险 P0（先做，1 批内可完成）
1. `getChaptersForProject` 出口即排序（`sortChaptersByNumber`），删除各 UI 的重复排序调用。
2. `StepPromptAssemblyResult` 增加 `droppedExtra` 明细并在 `step-runner` 弹一次性 Notice/降级提示（与 `truncated` 同路径）。
3. 统一 `entity-stats` 之外的**实体内容读取**入口：`shared/entity-reader.ts`，三处调用方改调同一函数。
- **验收**：`npm run preflight` 全绿（typecheck / test / check:css / check:deps 基线不变）。

### 批次 2：性能（C1 + C3 局部）— ✅ 已完成（2026-10-31）
1. ~~新增 `ui/project-scan-cache.ts`（vault 事件增量索引）~~ → **改为 `ui/project-utils.ts#scanProjectChapters`：一次遍历 + 按 `项目/03-大纲与章节/` 前缀分桶**。偏离原方案的理由：Obsidian 的 `vault.on` 在外部改动 / 批量操作时事件不全，长驻索引会留下陈旧数据（章节列表错漏比慢更严重）；而 `getFiles()` 本身是内存数组遍历，真正的浪费是「每项目各跑一轮」而非单轮成本。
2. 项目卡片渲染改为一次扫描产出全部项目数据 ✅：`project-selector-controller.render()` 内一次 `scanProjectChapters` 预填长篇项目章节，并对 meta / 单元列表做 render 作用域复用（原先每项目 `getProjectMeta` 读 2 次，选中项目章节被卡片 / 详情 / 快捷工具各算 1 次）。缓存随 render 丢弃，不做长驻索引。
- **验收（证据）**：`tests/unit/ui/project-scan.test.ts`（8 项目 / 400 章）钉住「批量结果 == 逐项目查询逐项一致」与「`vault.getFiles` 调用 2 次，旧路径 16 次」；另覆盖空列表、无章节项目、项目名互为前缀（书 / 书2）不串数据。

### 批次 3：架构解耦（A2/A4 + A1）— 第一步 + 第二步已完成（2026-10-31），A1 / plugin-api 端口注入待办

**第一步：守卫口径修正 + 常量下沉 + 类型边清理（已完成）**
1. **守卫口径修正**（`scripts/check-dependencies.mjs`）：`import type` / `import { type X }` 编译后擦除，不再计入分层违规、不参与成环；注释里的 import 示例先剥离再解析。门禁只对「运行时分层违规 + 运行时循环」做棘轮，类型耦合单列为提示项。
   - 影响：审计口径下的「53 个循环」实为 **9 个**（44 条为类型边/注释误报）；「64 个分层违规」实为 **55 条运行时 + 9 条类型**。
   - 结论修订：A4「plugin-api 是最大循环中心」**不成立**——它的 import 全是 `import type`，运行时没有环；真实问题是 shared→ui/engine 的类型反向耦合。
2. **`ENGINE_NAMES` 下沉**：由 `engine/engine-registry.ts` 迁到 `shared/engine-names.ts`（常量零 import），engine-registry 保留 `export { ENGINE_NAMES }` 再导出。切断 23 处对 engine-registry 的运行时依赖（`core/command-registry`、`engine/ai-engine`、`engine/co-writer-engine`、19 个 ui 弹窗等）。
3. **类型边清理**：`engine/review-agent.ts`、`engine/emotion-planner.ts` 的 `AIEngine` 与 `shared/api-response-utils.ts` 的 `APIResponse` 改为 `import type`（三处都只作类型使用）。
4. **零依赖模块下沉 shared**（消除「文件放错层」造成的反向依赖）：
   - `engine/webnovel-knowledge-base.ts` → `shared/webnovel-knowledge-base.ts`（2696 行纯数据，零 import；engine 拆解器、services 分类器、ui 知识库视图共用）
   - `engine/repository/lru-cache.ts` → `shared/lru-cache.ts`（201 行通用 LRU；`engine/repository/index.ts` 保留再导出）
   - `ui/full-writer/step-modal-styles.ts` → `shared/step-modal-styles.ts`（76 行 CSS 注入；engine 与 ui 共用）
5. **Engine 层 UI 能力改组合根注入**：`engine/engine-registry.ts` 不再 import `ui/password-modal`、`ui/template-manager`——`InitializeOptions` 新增 `passwordPort`（`requestPassword` / `requestNewPassword`）与 `createTemplateManager` 工厂，由 `main.ts` 在 `initialize(...)` 时注入。Engine 层运行时违规归零。

**第二步：services 编排模块上移 `engine/`（已完成）**
1. 9 个「编排 engine 原语」的模块物理迁移：`deconstruction-scheduler`、`deconstruction-worker-manager`、`heavy-task-worker-manager`、`scheduler-segment-integration`、`segment-aware-breakdown`、`foreshadow-manager`、`template-service`、`project-migration-service`、`batch-import-manager`。判定标准：模块的运行时依赖指向 engine 原语（拆解器 / `text-segmenter` / `quality-scorer` / `vector-enhancer` / `llm-enhancer` / `context-manager`），说明它是 engine 编排层而非通用服务；`batch-import-manager` 自身零 engine 引用，但运行时会 `import` scheduler，一并上移以免留下 services→engine 运行时边。
2. **零依赖配置下沉 `shared/`**（core 生成 `DEFAULT_SETTINGS` 需要，是 core→engine 6 条的根因）：新增 `shared/deconstruction-settings.ts`（维度类型 + `DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS` + `ALL_BREAKDOWN_DIMENSIONS` + `DIMENSION_LABELS`）、`shared/foreshadow-config.ts`（`ForeshadowTypeConfig` / `ForeshadowConfig` + 默认值）；`services/prompt-manager-types.ts` → `shared/prompt-manager-types.ts`、`engine/internal-registry.ts` → `shared/internal-registry.ts`。原 engine / services 模块保留再导出，ui 与 main 的既有引用零改动。
3. `services/example-project-service.ts` → `core/example-project-service.ts`（只依赖 Obsidian `App` + 模板脚手架，与 `core/command-registry` 同层）。
4. `core/command-registry.ts` 的 `ChapterVersionService` 只在 `get<ChapterVersionService>()` 泛型参数位置出现 → 改 `import type`（编译擦除，不构成运行时依赖）。
5. 同步更新的运行时引用：`main.ts` 的动态 `import('./engine/batch-import-manager')`、`shared/plugin-capabilities.ts` 的 `import('../engine/foreshadow-manager')`、`ui/batch-create-modal` 的 `vi.mock('../../../engine/template-service')`、质量评分单测里的源码守卫字符串。

**证据**：运行时循环 **9 → 1**（仅剩 `ui/unified-entity-manager-modal ↔ ui/unified-entity-generate-modal` 兄弟模态互开）；运行时分层违规 **55 → 0**（services 41 + core 6 全部消除，UI / Engine / Services / Shared / Core 五层归零）；`tsc --noEmit` 0 错误；`vitest run` 476 文件 / 5477 用例通过；`npm run build` 成功；`.arch-baseline.json` 已收紧（分层 47 条全部移除、循环基线保持 1 条）。

**保留的已知债务**：唯一剩余循环是两个实体模态「管理 ↔ 生成」互开。二者类只在方法体内 `new`、无模块级副作用，运行时安全；打破它需要引入回调注入或动态 import，收益低于成本，故留在基线内由棘轮锁定（不得新增循环）。

**剩余未完成**
1. ~~`shared/plugin-api.ts` 中 `ui/workspace-manager` 与 `engine/*` 改为端口接口注入~~ ✅ 已消除（批次 5：`plugin-api.ts` 移到根级门面层，不属于任何分层；其余 6 条走「纯类型下沉 / 实现下沉 / 端口接口」，类型耦合 **10 → 0**）。
2. ~~`EngineRegistry` 的 `register<T>(typed token)` 封装（A1），保留一层字符串键兼容。~~ ✅ 已完成（批次 6：`EngineServiceMap` + `EngineToken`，`get` / `getOrNull` / `register` / `registerLazy` typed-token 重载，保留 `<T>(string)` 兼容重载）。
3. ~~**services → engine 反向依赖 41 处**（`deconstruction-scheduler` 12、`deconstruction-worker-manager` 11、`heavy-task-worker-manager` 8 等）+ **core → engine/services 6 处**（`command-registry` 3、`settings-service` 3）：这是真正的分层倒置，需要把调度器上移 engine 或改为端口注入；工作量大，单列后续批次。~~ ✅ 已全部消除（第二步：9 个 services 编排模块上移 `engine/`；`deconstruction-settings` / `foreshadow-config` / `prompt-manager-types` / `internal-registry` 下沉 shared；`example-project-service` 移到 core；`ChapterVersionService` 改 `import type`）。
4. ~~Engine 层 UI 反向依赖 3 处~~ ✅ 已全部消除（`step-modal-controller → step-modal-styles` 靠下沉 shared；`engine-registry → password-modal / template-manager` 靠 `main.ts` 注入 `passwordPort` 与 `createTemplateManager`）。

**验收口径修订**：原「循环 ≤40」已达成（批次 4 第二步断环后为 **0**）；原「分层违规 ≤50」在新口径下为 55 条**运行时**违规，批次 3 第二步后降到 **0 条**（五层全部归零）；批次 5 后 10 条 `import type` 类型耦合提示项也归零（**10 → 0**，守卫输出不再有提示行）。

### 批次 4：数据层归一（B1）+ 入口收敛 —— 全部完成（2026-10-31）
1. ✅ **实体生成已归一**：`ai-entity-generator` 收敛为「`EntityKindSpec` 配置表 + `generateByKind` 单一实现」（三个 public 方法签名与 prompt 文本零变化，新增 parity 单测 7 用例）；实体示例模板下沉 `shared/entity-templates.ts` 作为**唯一来源**，`ai-batch-entity-generator` 三个批量方法改调同一函数——此前两份模板分叉（Batch 势力/地点缺元字段、地点字段顺序不同）已消除。`ai-character-generator` 暂未动：其 `extractRelevantWorldview` 两步检索与角色 prompt 属独立链路，合并风险高于收益。
2. ✅ **技术侧断环已完成**：`unified-entity-generate-modal` 的「打开实体管理」改走 `main.ts` 组合根 `openEntityManagerModal(project)`，不再 import 管理弹窗；兄弟模态变为单向依赖（manager → generate），运行时循环 **1 → 0**，`.arch-baseline.json` 循环项清空。
3. ✅ **产品侧双入口已收敛（决策：保留统一实体生成）**：`ai-builder-modal` 移除势力 / 地点 / 物品功法三类 Tab，只保留世界观与人物创作入口，仪表盘底部改为「🏰 打开统一实体生成器」跳转；实体生成唯一入口为 `unified-entity-generate-modal`（已具备四类实体、名称输入、批量数量、设定库、`ensureEntityIntegrity` 复检），能力无损失，入口不再分叉。
- **验收**：单条与批量生成的 frontmatter 已同源（`shared/entity-templates.ts`），运行时循环归零，实体生成入口唯一，全量单测 477 文件 / 5484 用例全绿。
- **证据**：`tsc --noEmit` 0 错误；`check:deps --baseline` 退出 0（**分层 0 / 循环 0**）；`npm run build` 成功。

### 批次 5：类型耦合提示项归零（10 → 0）—— 全部完成（2026-10-31）
批次 3 守卫口径修正后单列出的 10 条 `import type` 跨层类型耦合（不计入门禁，仅作 `ℹ️` 提示），按「纯类型下沉 / 实现下沉 / 门面外移 / 端口接口」逐一消除：
1. **纯类型下沉 `shared/`**：`APIResponse` → 新增 `shared/api-types.ts`（原定义在 `engine/ai-engine.ts`，`shared/api-response-utils.ts` 只能反向 import）；`EmbeddingAvailability` / `ProviderInfo` / `EmbeddingOptions` / `EmbeddingProvider` → 新增 `shared/embedding-provider.ts`（原 `engine/embedding/embedding-provider.ts`）。两处 engine 侧均保留再导出，engine 内部 12 + 37 处引用零改动。
2. **改导入源**：`BreakdownDimension` 本就定义在 `shared/deconstruction-settings.ts`（`engine/deconstruction-scheduler.ts` 只是再导出），`services/knowledge-base-manager.ts` 直接改从 shared 取，零新增文件。
3. **实现下沉 `shared/`**：`engine/cache/file-cache.ts`、`engine/cache/multi-layer-cache.ts` → `shared/file-cache.ts`、`shared/multi-layer-cache.ts`（两者只依赖 `lru-cache` / `logger` / `file-system-port`，零 engine 依赖）；`engine/cache/index.ts` 改再导出；3 个单测路径同步。`engine/cache/` 现只剩 `preload-manager.ts`。
4. **门面外移根级**：`shared/plugin-api.ts` → 根级 `plugin-api.ts`（与 `main.ts` 同性质的外部 API 门面，不属于任何分层），一次性消除对 `engine/ai-engine` / `engine/context-manager` / `engine/engine-registry` / `ui/workspace-manager` 的 4 条提示；6 处引用改路径。
5. **端口接口**：新增 `shared/chapter-version-port.ts`（`ChapterVersionPort#saveVersion`），`core/command-registry.ts` 的 `get<ChapterVersionService>` 改 `get<ChapterVersionPort>`（沿用 `commandUiPort` 先例）。
- **证据**：`tsc --noEmit` 0 错误；全量 vitest **477 文件 / 5484 用例**通过；`check:deps --baseline` 退出 0（**五层运行时 0 / 循环 0 / 类型耦合提示 0 条**）；`npm run build` 成功。

### 批次 6：A1 注册表类型化取用 —— 全部完成（2026-10-31）
1. **`EngineServiceMap` / `EngineToken`**：在 `engine/engine-registry.ts` 内建 35 个 token 的「引擎名 → 实例类型」映射（`CACHE_MANAGER`→`PluginCacheManager`、`AI_ENGINE`→`AIEngine`、`PROMPT_CACHE`→`ReturnType<typeof getPromptCache>`、`PROJECT_REPOSITORY`→`ProjectRepository` 等），全部复用文件已有的运行时 import，零新增跨层耦合；`TEMPLATE_MANAGER`（注册值为 `unknown`）与 `CO_WRITING_SESSION_STORE`（UI 层注入）不收录。
2. **重载兼容**：`get` / `getOrNull` / `register` / `registerLazy` 均新增 typed-token 重载在前、`<T>(string)` 宽泛重载在后。84 处既有 `get<T>(ENGINE_NAMES.X)` 调用零改动编译通过；`core/command-registry` 的 `get<ChapterVersionPort>` 继续走兼容重载。
3. **取用点迁移**：`main.ts`（17 处）、`settings-tab.ts`、`mini-settings-modal.ts`、`step-runner.ts`、`ai-engine.ts`、`co-writer-engine.ts` 及 15 个 ui 弹窗/视图的冗余显式泛型改为推导；`getOrNull<any>(UPDATE_CHECKER)` 10 处恢复为 `UpdateChecker | null`。全仓剩余显式泛型 7 处，均为有意保留：`TemplateManager` ×2（不在映射内）、`ChapterVersionPort` ×1（端口）、`getOrNull<any>(CACHE_MANAGER)` ×4（`PluginCacheManager.getUpdateLastResult(): unknown` 的既有类型精度问题不在本批次范围）。
- **证据**：`tsc --noEmit` 0 错误；全量 vitest **477 文件 / 5484 用例**通过；`check:deps --baseline` 退出 0（**五层运行时 0 / 循环 0 / 无类型耦合提示行**）；`npm run build` 成功。

### 批次 7：E3 网络出口统一 + A5 文档校准 + E1/F2 复核 —— 全部完成（2026-10-31）
1. **新增 `shared/http-request.ts`**：`requestWithPolicy(execute, params, policy)` 用 `Promise.race` 实现单次尝试超时（默认 30s），超时抛 `HttpRequestTimeoutError`（含 url 与预算）；`retries` / `retryDelayMs` / `retryOn` 可配，默认只对 5xx / 429 / 网络类错误重试。**已知边界**：Obsidian `requestUrl` 不支持 `AbortSignal`，超时只能拒绝等待并丢弃迟到结果，无法中断请求本身（已在文件头注明）。
2. **9 处直连调用接入**：`services/canon-research-service.ts` 的 bing / brave / serper / tavily 搜索与 `fetchPage`（网页抓取保留 15s 超时、不重试，避免对目标站点加压）；`engine/harness/trend-research-service.ts` 的 4 个搜索后端统一经 `requestJson` 包装。搜索策略 `SEARCH_REQUEST_POLICY`（15s + 重试 1 次）由 shared 统一导出，两处不再各自定义。`api-connectivity-service` / `model-discovery` 已有自建 `Promise.race` 超时与状态分类，本轮不动（避免改变其 timeout 分类语义）。
3. **A5 文档校准**：`ARCHITECTURE.md` 的 UI 层职责、访问边界表、「违反规则的标志」三条改为「目标边界 + 现状偏差」：明确 Facade 只覆盖协同写作与项目/章节仓储查询、UI 层 `app.vault` 直连约 683 处属未收口技术债（收敛见 C2），以及 Engine 层仍直接 import `obsidian`（`FileSystemPort` 只覆盖仓储层数据读写）。
4. **E1 / F2 复核为「原结论不成立」**：E1 的能力探测早已在 `WorkerManager#detectWorkerSupport` 落地（`typeof Worker` + 实建探活 + 主线程降级 + 会话内一次提示）；F2 的批量分支在 `ai-batch-entity-generator` 内已做「校验 → 补全 → 复检 → 出口过滤」，不完整实体不落盘。两条审计结论基于旧版本，已在条目内更正并给出证据。
- **验收**：新增 `tests/unit/shared/http-request.test.ts` 4 用例（正常透传 / 超时不重试 / 5xx 重试一次成功 / 401 不重试）。
- **证据**：`tsc --noEmit` 0 错误；全量 vitest **478 文件 / 5488 用例**通过（+4）；`check:deps --baseline` 退出 0（**五层运行时 0 / 循环 0 / 无类型耦合提示**，668 文件 / 3153 import）；`npm run build` 成功。

### 批次 8：E2 localStorage 键名集中化 —— 全部完成（2026-10-31）

1. **新增 `shared/storage-keys.ts`（零依赖，任何层可引用）**：`NOVEL_WRITER_KEY_PREFIX`、`STORAGE_KEYS`（`ideationFavorites` / `sidePanelCollapsed` / `timeEstimatorHistory`）、`STORAGE_KEY_PREFIXES`（`operationConfirm` / `flowExport` / `wizardResults`）、`LEGACY_STORAGE_KEYS`（`reload-state` / `user-reload`，仅清理不写入）、`projectScopedKey(prefix, project)`（空项目落 `global`）。
2. **7 处使用方改引用**：`ui/ideation-modal`、`ui/components/progress/operation-confirm-modal`、`ui/full-writer/creation-flow-state`、`ui/full-writer/wizard-results-store`、`ui/project-side-panel-view`、`shared/time-estimator`，以及 `main.ts` 两处遗留键清理改为 `for (const key of LEGACY_STORAGE_KEYS)`。顺带消除向导 key 的两处重复拼接（`creation-flow-state` 与 `wizard-results-store` 此前各自拼 `novel-writer-wizard-${project||'global'}`）。
3. **不改键值＝零迁移**：这些键在用户设备上已有数据，改前缀会让收藏 / 折叠状态 / 向导结果 / 耗时历史 / 「不再提示」记忆静默失效。两套历史前缀保持原样；后续若要统一到 `nw:` 命名空间，需配套「读新键失败 → 读旧键 → 回填」迁移，不在本批次范围。
- **验收**：新增 `tests/unit/shared/storage-keys.test.ts` 5 用例（单值键值不变 / 前缀值不变 / 遗留键值不变 / 项目分桶 global 兜底 / 全部键落在已知命名空间）。
- **证据**：`tsc --noEmit` 0 错误；全量 vitest **479 文件 / 5493 用例**通过（+5）；`check:deps --baseline` 退出 0（**五层运行时 0 / 循环 0 / 无类型耦合提示**，669 文件 / 3160 import）；`npm run build` 成功。

### 批次 9：G2 分发目录混放复核 —— 原结论不成立（2026-10-31，无代码改动）

审计条目称 `data/knowledge-vectors` 与 `*-preferences.json` 混在「分发目录」。复核后确认前提不成立：

- 仓库根即插件目录（`git rev-parse --show-toplevel` 返回 `.../novel-writer-ai`）。
- `.gitignore:30` 的 `data/` 规则命中 `data/knowledge-vectors/index.json` 与 `data/{项目}-preferences.json`；`git ls-files data` 返回空，即 **data 目录无任何文件入库**。
- `.github/workflows/release.yml#L58` 的打包命令为 `zip -r "$ZIP" main.js manifest.json styles.css workers`，Release 资产清单也只含这 4 项加 zip，**data 不随发布包分发**。
- `data/` 实为本机运行时数据目录：`knowledge-vectors/`（本机作品向量）、`human-samples/`（本机抽样，CHANGELOG 已注明「仅本机，不入仓库不入包」）、`experiments/`、`{项目}-preferences.json`、`cache.json`。同处一个运行时目录是正常形态；拆分子目录会破坏既有偏好读取且无分发收益，故不改。

> 结论：G2 属伪问题（与 E1 / F2 同类），不产生代码改动；门禁状态沿用批次 8。

### 批次 10：B2 实体管理弹窗嵌套复核 —— 属正常复用（2026-10-31，仅注释）

- **事实**：`unified-entity-manager-modal` 内确有 2 处 `new ExistingEntityManagerModal(...)`（分类页「管理」按钮、实体详情「编辑实体」按钮），`unified-entity-generate-modal` 另有 1 处。
- **职责分离**：`ExistingEntityManagerModal` 的构造签名是 `(app, plugin, project, folderName, displayLabel)`，只操作一个类别目录（改名 / 编辑全文 / 删除 / 智能猜名）；4 个单类别生成弹窗（人物 / 势力 / 地点 / 物品功法）也直接用它。`UnifiedEntityManagerModal` 做跨类别聚合、筛选、完整性审计与原地补全，不做文件级操作。
- **结论**：这是标准的「总览页 → 详情页」复用，不是重复实现；合并会把 486 行文件操作塞进 826 行总览弹窗，并破坏 7 个调用入口。处置：在两处文件头补职责边界注释（防止后续被误判为重复实现而擅自合并），不改变任何逻辑。
- **门禁**（批次 10 后实测复跑）：仅注释改动，`tsc --noEmit` 0 错误、全量 vitest **479 文件 / 5493 用例**通过（42.03s）、`check:deps` 五层 0 违规 / 0 循环 / 669 文件 3160 import、`npm run build` 成功（v4.22.0，模板资产 56）。

### 批次 11：C3 样式单体拆分 + 设置页分区 —— 全部完成（2026-10-31）

**样式拆分（零视觉风险）**
- `styles.css`（16,027 行 / 450,911 字节）按**原顺序**切为 `styles-src/` 16 个源文件（`00-header.css` … `15-late-fixes.css`），不按功能域重组：后置文件本就是覆盖层，重排会改变层叠结果且无测试可捕获。
- 新增 `scripts/build-styles.mjs`：按文件名顺序**纯文本拼接**（不压缩、不合并选择器），头部写「自动生成，请勿直接编辑」；`--check` 模式比对产物与源。`npm run build` / `dev` 前置生成，`preflight` 内置 `check:styles`，直接改根目录 `styles.css` 会失败。
- **字节等价验证**：16 个切片 `join('')` 与拆分前原文逐字符相等（450,911 = 450,911）；产物 452,262 字节的 +1,351 全部来自自动生成头注释，选择器与规则零改动（`.css-baseline.json` 仅 `bytes` 上调，`!important 164` / `hardcodedHex 154` / `rgbHsl 181` / `uniqueClasses 2346` / `otherClasses 87` / `maxSelectorDepth 4` 全部持平）。

**设置页分区（`ui/settings-tab.ts` 5,112 → 227 行 + 8 模块）**
- 宿主只保留 tab 栏、分区调度与 DOM 缓存；8 个分区模块共 5,125 行：`api-section`（1,215）、`knowledge-section`（765）、`fingerprint-section`（373）、`deconstruction-section`（325）、`foreshadow-section`（280）、`writing-sections`（737，协同 / 写作 / 模板 / 外观 / 项目库 / 布局 6 个分区）、`general-sections`（1,095，性能 / 提示词 / 规则 / 关于 / 角色识别 / 建议 6 个分区）、`provider-modals`（335）。
- `section-base.ts` 定义 `SettingsSectionHost`（`app` / `plugin` / `refresh` / `reopen`）与 `SettingsSection` 抽象基类（只读 getter），分区方法体保留 `this.plugin` / `this.app` / `this.refresh()` 原写法，搬移零逻辑改写。
- **tab DOM 缓存**：纯切换复用 `panelCache` 中已渲染的 DOM；`refresh()`（任何设置变更）清空**全部**缓存并重绘当前 tab，避免「A 分区改设置、B 分区显示旧值」；异步分区（知识库 / 指纹库 / 模板 / 规则版本）命中缓存时不重新拉数据，需点分区内刷新按钮或重开设置页（文件头已注明）。
- `.nw-settings-panel` 包裹层是普通 block div（CSS 无该类），`nw-settings-tab-content` 的规则全为后代选择器（无 `>`），布局与拆分前一致。
- 未接线项如实保留：`provider-modals.ts` 的 `showEditCustomProviderForm` / `showManageProvidersModal` / `showAddCustomProviderForm` 在原 `settings-tab.ts` 中即无调用点，原样搬到新模块待后续接入，未删除。

**门禁（批次 11 后实测）**：`tsc --noEmit` 0 错误；全量 vitest **479 文件 / 5493 用例**通过（48.82s）；`check:deps --baseline` 五层 0 违规 / 0 循环（678 文件 / 3,196 import）；`npm run build` 成功（v4.22.0，模板 56，`styles` 16 源文件 → 16,052 行）；`check:styles` 一致；`check:css` 通过（452,262 bytes / 16,053 行，各项预算持平）；`check:release` 通过。
- 同步修改 3 个源码结构断言测试（`api-format-wiring` / `settings-no-duplicate-render` / `panel-resizer-and-motion`）改读新路径；`settings-no-duplicate-render` 的两个「全页扫描」用例仍读宿主文件，拆分后对宿主恒真（守卫强度已弱化，待后续按分区结构重写）。

### 批次 12：C5 构建体积 —— 已完成（2026-10-31）

**先问是不是**：原审计「模板资源内联进 bundle 导致 9.34 MB」因果不成立。实测模板 `assets/template-scaffold` 56 文件 / 79,863 字节，生成物 `shared/template-scaffold-assets.generated.ts` 86,221 字节，占产物约 1.6%；`data/knowledge-vectors` 6.26 MB 为本机运行时目录（批次 9 已核实不入仓不入包）。真因是 `scripts/build.js` 从未开启压缩。

1. `buildOptions` 增 `minify: true` 与 `charset: 'utf8'`。esbuild 默认 `charset: 'ascii'` 会把本项目中大量中文提示词 / 模板转成 `\uXXXX`，实测 minify+ascii 5.52 MB vs minify+utf8 3.92 MB（字符数口径）；Obsidian 运行于 Electron 且按 UTF-8 读产物，保留原字符安全。
2. 配套修正 `scripts/check-release.mjs` 的产物内省口径：原三个 marker 中「模块路径注释」「顶层变量名」在压缩后必然消失。改为断言「排序后前 2 个模板 key 的 JSON 字符串字面量」——压缩只会改标识符，不会改字符串内容。
3. 已验证压缩无运行时副作用：`createWorkerFromHandlers`（`handler.toString()` 依赖函数名）无任何调用点；源码无 `constructor.name` / `Function.name` 依赖；`scripts/`、`tests/` 均不读 `main.js`。

**体积实测（字节）**

| 产物 | 压缩前 | 压缩后 | 变化 |
|---|---|---|---|
| `main.js` | 9,089,917 | 4,798,890 | **-47.2%** |
| `workers/deconstruction-worker.js` | 1,330,977 | 680,977 | -48.8% |
| `workers/quality-worker.js` | 227,172 | 107,635 | -52.6% |

**门禁**：`npm run build` 成功；`node --check main.js` 通过；`check:release` 通过（v4.22.0，worker 资产一致）。体积 top 模块（压缩前，用于后续参考）：`shared/webnovel-knowledge-base.ts` 387.5 KB（4.4%）、`ui/co-writing-view.ts` 216 KB、`engine/deconstructors/foreshadow-deconstructor.ts` 182.9 KB。

### 批次 13：C2 `vault.adapter` 写入收口 —— 已完成（2026-10-31）

**先问是不是**：实测 `vault.adapter.*` 为 **141 调用点 / 136 行**（非审计的 189），分布 `exists 44` / `write 36` / `mkdir 28` / `read 13` / `stat 6` / `list 5` / `remove 4` / `rename 2` / `append 1` / `basePath 1` / `rmdir 1`。其中 `exists` / `mkdir` / `read` / `stat` / `list` 对配置目录与索引外文件是唯一可行路径，本身无问题；真正的危害子集是「用 `adapter.write` 写 vault 索引内的 `.md`」——不触发 `metadataCache` 重解析、绕过 `vault.process` 写锁，移动端（无外部文件监听）新建文件可长时间不出现在文件浏览器 / 双链。

1. **新增单一出口** `shared/file-system-port.ts#writeVaultText(app, path, content)`：复用既有的 `ObsidianFileSystem` 四路分流（TFile → `vault.modify`；路径是文件夹 → 抛错；配置目录 / 索引外已存在 → `adapter.write`；其余 → 补父目录后 `vault.create`），并在写前补齐父目录。
2. **替换 9 个模块的 13 处用户可感知写入**：`ui/full-writer-view.ts`（2 处指南）、`ui/story-settings-modal.ts`（2 处指南）、`ui/services/project-create-service.ts`（2 处建项目指南）、`ui/mode-document-modal.ts`、`ui/chapter-outline-tree-modal.ts`（2 处大纲回写）、`ui/plot-canvas-modal.ts`、`ui/batch-create-modal.ts`、`ui/full-writer/batch-pipeline-runner.ts`（叙事总览）、`shared/template-scaffold.ts`（模板自举 56 文件）。
3. **有意保留 `adapter` 的写入点**（按证据分类，不是遗漏）：
   - `engine` 层 11 处拆解器知识库写入（`写作知识库/` 下 `.md`）：批量后台写入，读取同样走 adapter 闭环；改走索引会在拆解期间产生大量 `metadataCache` 重解析与 `vault.on` 抖动，收益为负。
   - `services/chapter-version-service.ts#writeFile`：已自带正确分流（TFile → `vault.modify`），无需改造。
   - 索引外 / 非 `.md`：`ui/full-writer-view.ts` 与 `ui/story-settings-modal.ts` 的 `.project` 隐藏文件、`shared/plugin-cache.ts` 的 JSON 缓存、`ui/services/agent-spill-store.ts` 与 `agent-session-store.ts` 的内部会话数据、`vault.adapter.basePath`（1 处，需绝对路径）。这些路径 `getAbstractFileByPath` 恒为 null，`vault.create` 建不出来。
4. **测试同步**：`tests/unit/shared/template-scaffold.test.ts#makeApp` 补齐 `getAbstractFileByPath` / `createFolder` / `create` / `modify` 最小替身（原 mock 只有 `vault.adapter`，模板自举改走索引后 4 个用例全部失败）。断言零改动。

**门禁（批次 12 + 13 后实测）**：`tsc --noEmit` 0 错误；全量 vitest **479 文件 / 5493 用例**通过；`check:deps --baseline` exit 0（五层 0 违规 / 0 循环，678 文件 / 3,205 import）；`npm run build` 成功；`check:templates`（56 文件）/ `check:styles` / `check:css` / `check:release` 全部通过。

### 批次 14：D3 等待原语收口 + F3 catch 分级试点 —— 已完成（2026-10-31）

**先问是不是**：D3「255 处 `setTimeout` 无统一等待原语」、F3「2,202 次 `catch` 无分级」两条口径都先复核，两条都不成立。

**D3 复核**

1. 全库（排除 `node_modules` / `tests` / `scripts`）实测 `setTimeout(` **96 处**，非 255。固定字面量仅约 25 处：`0ms` 7、`16ms` 5、`500ms` 3、`300ms` 3，其余各 1——不存在「大量 300/500/1000ms 固定延迟」。
2. 「无统一等待原语」不成立：`shared/yield.ts#yieldToUI()` 早已存在并在多个拆解器批量循环中使用。缺的不是原语，是**原语未被复用**。
3. 真正同类的「等一帧」只有 5 处，且每处上方都写着同一行注释「P0-2 修复: 后台窗口 rAF 不触发会导致永久挂起，改用 setTimeout」——同一段事故知识被复制了 5 份。
4. `shared/yield.ts` 新增 `nextFrame()`：双重 `requestAnimationFrame`（首个回调保证 DOM 变更已解析、第二个保证布局绘制完成），**同时与 50ms 超时竞速**兜底「后台窗口不触发 rAF」的历史 P0-2 事故；无 rAF 环境（jsdom 单测）退化为 `setTimeout(16)`。
5. 替换 5 处：`ui/generate-character-modal.ts` / `generate-faction-modal.ts` / `generate-item-modal.ts` / `generate-location-modal.ts`（先让进度条渲染再请求模型）、`ui/full-writer/wizard-step-executors.ts`（步骤「执行中」状态先可见）；`ui/views/knowledge-base-view.ts` 批量归类循环的 `setTimeout(0)` 改 `yieldToUI()`。
6. **有意不改**（按形态判定，非遗漏）：`token-bucket-rate-limiter.ts`（同步队列调度）、`manage-providers-modal.ts` / `api-section.ts`（`window.setTimeout(autosize, 0)` 同步回调）、`rename-project-modal.ts` / `project-selector-controller.ts`（`window.setTimeout(focus, 0)`）、`knowledge-base-view.ts#completeRefreshTimer`（debounce 合并刷新状态机）——改成 `await` 会改变调用时序语义。

**F3 复核与试点**

1. `catch` 实测 **1,504 次**（非 2,202），原数同样含 `node_modules`。逐条分级需要判断每条的业务语义，无法机械替换，全量改造不可行。
2. 约定写入 [DEVELOPMENT.md](file:///d:/小说工坊/小说工坊/.obsidian/plugins/novel-writer-ai/docs/DEVELOPMENT.md)：每条 `catch` 日志须能回答 **失败对象**（哪个实体 / 维度 / 文件）、**场景**（在做什么）、**可重试性**（可重试 / 不可重试 / 可降级继续）；级别按三级选择——业务失败 `error` + 上抛或用户提示、可重试失败 `warn` + 重试计数、可降级失败 `warn` + 写明降级结果。
3. 试点 `engine/deconstructors/foreshadow-deconstructor.ts` 两处可选增强降级点（LLM 增强 / 向量增强），日志补齐维度、文本长度、`可重试=否` 与降级去向，作为「可降级失败」的样例。
4. 其余模块按「改到哪里、顺手改到哪里」增量推进，不做一次性全量替换。

**门禁（批次 14 后实测）**：`tsc --noEmit` 0 错误；全量 vitest **480 文件 / 5497 用例**通过（45.74s，新增 `tests/unit/shared/yield.test.ts` 4 用例覆盖 `yieldToUI`、无 rAF 退化、双帧等待、50ms 兜底）；`npm run build` 成功（v4.22.0，模板 56，`styles` 16 源文件 → 16,052 行）；`check:release` 通过；`npm run preflight` exit 0。

**顺带闭环的两项历史门禁**（批次 11 当时未跑）：
- `check:inline-styles`：C3 拆出的 `ui/settings/` 5 个新文件（14 + 11 + 2 + 2 + 1 = 30 处）不在旧基线内。核对总量为 **1068 → 1024（静态 840 → 800，动态 228 → 224）**，属「文件搬迁 + 净下降」，按棘轮规则用 `npm run inline:baseline` 收紧。
- `check-engines`：`main.ts:653` 的 `createTemplateManager: () => new TemplateManager(this.app)` 被记为新增违规。该处是批次 3 第二步「engine 层不 import ui/」的组合根注入（`ui/template-manager` 不可能由 engine 内部 new），已在 `.engine-registry-whitelist.json` 增 `TemplateManager`（`allowedInstances: 1`，新 category `composite-root-injected`，并补 notes 说明）。

---

## 五、首批 P0 落地清单（下一步立即执行）

| 顺序 | 改动点 | 文件 | 验证方式 |
|---|---|---|---|
| 1 | 章节排序下沉 | `ui/project-utils.ts` | 新增单测：乱序输入 → 升序输出；`showAllChapters` 结果不变 |
| 2 | `droppedExtra` 上抛 | `engine/step-prompt-assembly.ts`、`engine/step-runner.ts` | 单测：注入超大 extra → 返回 `droppedExtra=true` 且 UI 收到提示 |
| 3 | 实体读取唯一入口 | 新增 `shared/entity-reader.ts`，改 `context-manager` / `ai-builder-modal` / `unified-entity-manager-modal` | 三处读取同一项目实体数量一致 |

> 执行约束：每项改动前先跑 `think-before-coding` / `code-rehearsal`；改完同步 `CHANGELOG.md`、`docs/DEVELOPMENT.md`、`docs/CODE-INDEX.md`，并跑 `npm run preflight`。

**进度（2026-10-31）**

| 顺序 | 状态 | 落地说明 |
|---|---|---|
| 1 | ✅ 已完成 | `getChaptersForProject` 出口改为 `sortChaptersByNumber(result)`；新增用例「乱序种子 → 出口即升序」 |
| 2 | ✅ 已完成 | 复核后确认 `droppedExtra` 已进账本（v4.22），但「仅丢增强尾部」时无 Notice；补 `step-warning` + `NOTICE_WARNING` |
| 3 | ✅ 已完成 | 新增 `shared/entity-reader.ts`（`listEntityFiles` / `countProjectEntities` / `entityDir`）；unified 管理器 / `context-manager` / `entity-audit` / `ai-builder` 改调同一函数；旧 `entity-stats.ts` 删除（模板不再计入统计，消除「生成器 5 人 / 管理器 4 人」口径分歧） |

> 验证：批次 1 `tsc --noEmit` 0 错误、全量 `vitest run` 475 文件 / 5471 用例；批次 2 `tsc --noEmit` 0 错误、全量 `vitest run` 476 文件 / 5477 用例（+6）；批次 3 第一步 + 第二步 `tsc --noEmit` 0 错误、全量 `vitest run` 476 文件 / 5477 用例、`check:deps --baseline` exit 0（**运行时分层 0 / 运行时循环 1**，基线已收紧至 0）；批次 4 三步 `tsc --noEmit` 0 错误、全量 `vitest run` **477 文件 / 5484 用例**（+7）、`check:deps --baseline` exit 0（**运行时分层 0 / 循环基线已清空）；批次 5 类型耦合提示项归零（10 → 0）；批次 6 A1 注册表类型化取用 `tsc --noEmit` 0 错误、全量 `vitest run` **477 文件 / 5484 用例**、`check:deps --baseline` exit 0（**运行时分层 0 / 运行时循环 0 / 无类型耦合提示**）；批次 7 E3 网络出口统一 + A5 文档校准 `tsc --noEmit` 0 错误、全量 `vitest run` **478 文件 / 5488 用例**、`check:deps --baseline` exit 0（**运行时分层 0 / 运行时循环 0 / 无类型耦合提示**）；批次 8 E2 localStorage 键名集中化 `tsc --noEmit` 0 错误、全量 `vitest run` **479 文件 / 5493 用例**（+5）、`check:deps --baseline` exit 0（**五层运行时 0 / 循环 0 / 无类型耦合提示**，669 文件 / 3160 import）；批次 9 / 10 无运行时逻辑改动（仅文档 + 注释），批次 10 后复跑 tsc / vitest / check:deps / build 四项全绿；批次 11 C3 样式拆分 + 设置页分区 `tsc --noEmit` 0 错误、全量 `vitest run` **479 文件 / 5493 用例**、`check:deps --baseline` exit 0（**五层运行时 0 / 循环 0**，678 文件 / 3,196 import）、`npm run build` + `check:styles` + `check:css` + `check:release` 全通过；批次 12 C5 构建体积 + 批次 13 C2 `vault.adapter` 写入收口 `tsc --noEmit` 0 错误、全量 `vitest run` **479 文件 / 5493 用例**、`check:deps --baseline` exit 0（678 文件 / 3,205 import）、`build` + `check:templates` + `check:styles` + `check:css` + `check:release` + `check:inline-styles` + `check-engines` 全通过；十一次代码改动后 `npm run build` 均成功。

> **批次 1 首批 P0 三项全部闭环，批次 2 性能项同步完成，批次 3 架构解耦第一/第二步完成（五层运行时分层违规归零），批次 4 数据层归一 + 技术侧断环 + 产品侧入口收敛全部完成（实体生成器配置驱动、模板单一来源、实体生成唯一入口、运行时循环归零），批次 5 类型耦合提示项归零（10 → 0），批次 6 A1 注册表类型化取用完成，批次 7 E3 网络出口统一 + A5 文档校准 + E1/F2 复核完成，批次 8 E2 localStorage 键名集中化完成，批次 9 G2 分发目录混放复核为「原结论不成立」（`data/` 不入仓不入包，无代码改动），批次 10 B2 实体管理弹窗嵌套复核为「属正常复用，不合并」（仅补职责边界注释），批次 11 C3 样式单体拆分 + 设置页分区完成（`styles.css` 改为 `styles-src/` 16 源文件的拼接产物且逐字节等价，`settings-tab.ts` 5,112 行拆为 227 行宿主 + 8 个分区模块 + tab DOM 缓存），批次 12 C5 构建体积压缩完成（`minify: true` + `charset: 'utf8'`，`main.js` 9,089,917 → 4,798,890 字节，-47.2%；两个 worker 同步减半），批次 13 C2 `vault.adapter` 写入收口完成（新增 `writeVaultText` 单一出口，替换 9 个模块 13 处用户可感知写入；实测 141 调用点 / 136 行，非审计的 189 处；engine 批量知识库写入与索引外写入按证据保留），批次 14 D3 等待原语收口 + F3 catch 分级试点完成（新增 `nextFrame()` 替换 5 处「等一帧」`setTimeout(16)`、`yieldToUI()` 替代 1 处 `setTimeout(0)`；`setTimeout` 实测 96 处、`catch` 实测 1,504 次，原审计 255 / 2,202 均含 `node_modules`；三要素日志约定写入 `DEVELOPMENT.md` 并以 `foreshadow-deconstructor` 两处降级点为样例），均为 2026-10-31。** 原审计的 P0 / P1 条目至此**全部闭环或复核为「原结论不成立」**。剩余仅 P2 可维护性项：D1 千行文件拆分、D2 `: any` 收敛、D5 文档同步自动化、C4 启动期串行、G1/G3 资源清单化，以及 D3 / F3 的存量部分（等待原语已收口、分级约定与试点已落地，其余按模块增量推进）——均为长期项，不在当前批次范围。
