# 联动场景回归清单（G7-5）

> 单模块全绿不代表链路可用。本清单定义四条跨模块联动链：
> 每次改动落在哪条链上，就按对应一节跑完自动化 + 手工验收；
> `npm run check:linked-scenarios` 会校验清单引用的入口仍然存在（防文档腐烂）。

## 什么时候跑

| 改动面 | 必跑链 | 最低要求 |
|---|---|---|
| 步骤引擎 / 提示词 / 结算 / 导出 | 链 1 | 单测 + E2E 全套 + 手工导出一次 |
| 知识库 / 向量检索 / 注入 / RAG 归因 | 链 2 | 单测 + `tests/integration/linked-scenarios.test.ts` |
| 创建向导 / 模式内容结构 / 领域工厂 | 链 3 | 单测 + E2E 短篇用例 |
| 跨链（如上下文总线、路径常量） | 全部四条 | 全套 E2E + 四条手工验收 |

四条链的自动化兜底：`npm run preflight` + `npx playwright test --project=obsidian-electron`
（E2E 需要 `OBSIDIAN_PATH`，没配置时整组显式 skip，不算通过）。

---

## 链 1：生成 → 质控 → 修订 → 结算 → 导出

| 环节 | 入口 | 产物 | 自动化覆盖 |
|---|---|---|---|
| 生成 | 工作台逐步 / `novel-writer-batch-chapters` | `步骤结果/第N卷/第N章/第N章_*.md`、`正文/第N卷/第N章_正文.md` | `step-result-saver*`、`batch-pipeline-*`、E2E「完整写作工作台」 |
| 质控 | 质量控制步骤 | `第N章_质量控制.md` | `step-*`、`quality-*` 单测 |
| 修订 | 定向修订 / `第N章_修正记录.md` | 修正稿回写正文 | `settlement-engine-behavior`、`writeFixToBody` |
| 结算 | `novel-writer-chapter-settlement` | 实体/关系/伏笔/时间线更新，正文 `status: settled`，`settlement_mode` | `settlement-engine-behavior`（成功/幂等/回滚）、`settlement-mode`、`settlement-journal` |
| 导出 | `novel-writer-export-manuscript` | `导出文件/` 下的 EPUB/DOCX/TXT | `export-precheck`、导出 builder 单测、E2E 导出用例 |

手工验收（真实 vault，200 章以内项目）：

1. 新建项目 → 跑完第 1 章全流程，确认 `步骤结果/` 与 `正文/` 各自落盘且章名一致。
2. 点「章节结算」，确认：
   - 正文 frontmatter 出现 `status: settled`、`涉及人物/地点/势力/物品`；
   - `关系状态.md`（V2）被更新，`互信息` 分节没有被结算引擎重复写入；
   - 重跑一次结算，结果不变（幂等）。
3. 故意让某一步失败（断网/无效 key），确认执行时间线给出失败步骤与原因，且不会把半章写成 `settled`。
4. 打开导出：出现「未结算/未过质控」提示时仍能导出，且导出内容与当前正文一致。
5. 覆盖写正文前确认备份已生成（`backupBeforeOverwrite` 默认开启）。

已知边界：AI 调用质量不在本链自动化范围（需要真实 key 与额度），这里只保证链路与落盘语义。

---

## 链 2：知识库 → 检索 → 注入 → 归因 → 统计

| 环节 | 入口 | 产物 | 自动化覆盖 |
|---|---|---|---|
| 建库/拆解 | 知识库工作台 | `知识库/<书>/...`、标签体系 | `knowledge-tags`、`knowledge-detail-state`、拆解任务单测 |
| 检索 | `engine/rag/retrieval-service.ts` | `RagHit[]` + telemetry | `rag-retrieval-service`、`retrieval-*` 单测 |
| 注入 | `KnowledgeInjector.inject*` | prompt 片段；`ragSink` 逐条上报 | `knowledge-injector-*` 系列 |
| 归因落盘 | `StepResultSaver`（`meta.ragSources`） | 步骤 frontmatter `rag_sources` | `tests/integration/linked-scenarios.test.ts` |
| 统计 | 写作统计 →「知识引用」 | 命中率 / 常用书目 / 最近引用 | `knowledge-usage`、`rag-sources` 单测 |

手工验收：

1. 选一本参考书并开启知识库注入，跑一章正文。
2. 打开该步骤结果文件，确认 `rag_sources` 有值且片段时间戳属于本章引用范围。
3. 打开写作统计 →「知识引用」，命中率应 > 0，书目与步骤里一致。
4. 关闭知识库/清空参考书再跑一章，确认新步骤**不写** `rag_sources`（不产生空数组脏数据）。

---

## 链 3：三模式创建 → 内容结构 → 单元写作

| 环节 | 入口 | 产物 | 自动化覆盖 |
|---|---|---|---|
| 创建 | 创建向导 / 领域工厂 | `长篇小说/书名`、`短篇小说/书名`、`剧本/书名` | `domain-project-factory`（含失败回滚） |
| 内容结构 | `shared/mode-content.ts` | 长篇 `03-大纲与章节/`；短篇 `短篇创作/`；剧本 `剧本创作/` | `mode-content` 单测 |
| 单元写作 | 单元工作台 | `03-正文/第N节_*.md`、`03-剧本/第N集*.md`，状态回写 | E2E「短篇：创建后落在创作流程页，单元工作台可写正文并回写状态」 |
| 命令守卫 | `shared/command-mode-rules.ts` | 长篇专属命令在短篇/剧本下被拦截 | `command-mode-rules`、Agent `run_command` 模式拦截单测 |

手工验收：

1. 分别创建长篇/短篇/剧本项目，确认目录结构符合上表，且不会混用长篇目录。
2. 短篇写一节正文，确认 `status` 回写且单元列表刷新。
3. 在短篇项目里执行长篇专属命令，确认给出「仅适用于长篇」类提示而不是静默失败。
4. 创建过程中强制失败（占位目录冲突），确认工厂回滚、不留半成品目录。

---

## 链 4：Agent 阶段引导 → 商业化导出检查

| 环节 | 入口 | 产物 | 自动化覆盖 |
|---|---|---|---|
| 阶段快照 | 工作台左栏阶段面板 / `get_project_status` | 统一 `CreationFlowSnapshot`（三模式阶段/进度/阻塞/下一步） | `agent-stage-panel.test`、`creation-flow.test` |
| 端口投影降级 | `ui/services/agent-port.ts::getProjectStatus` | 采集失败时省略 `flow`，章节统计照常返回 | `agent-port-status.test` |
| 出版检查 | 导出弹窗「交付级别」+「导出范围」 | 三档 blocker / warning；blocker 中止导出 | `publication-profile.test`、`export-precheck.test` |
| 自动化配置 | `npm run check:automation` | 单一 loop-state + HANDOFF/版本/信箱一致 | `scripts/check-automation.mjs` |

出版检查口径（v4.59.0 起为三档 + 显式范围，不再是布尔开关）：

| 级别 | blocker（中止导出） | warning（仅提示） |
|---|---|---|
| 草稿导出 | 缺书名、完全没有正文 | 缺作者、空单元、字数不足、单元数不足、重复标题、EPUB 无标题 |
| 成品导出（默认） | 缺书名、完全没有正文、存在空单元且未选「仅已写单元」、EPUB/DOCX 缺作者 | 字数不足、单元数不足、重复标题、EPUB 无标题 |
| 平台投稿 | 缺书名、缺作者（所有格式）、完全没有正文、空单元未排除、字数 < 下限一半 | 字数 < 下限、单元数不足、重复标题、EPUB 无标题 |

导出范围：`full` 整包（空单元参与判定）；`written-only` 先用 `splitUnitsByBody` 过滤空单元、再按过滤后事实判定（仅成品/草稿档可选）；平台投稿强制 `full` 并禁用范围选择。

手工验收：

1. 三模式各建一个项目，工作台阶段面板显示阶段与 `.project`/章节目录一致；点击阶段只把指令预填到输入框，不自动执行命令。
2. 对 Agent 说「我现在到哪一步 / 下一步做什么」，回答与阶段面板一致。
3. 阶段采集失败（如项目目录被移动/改名）时，Agent 仍回答章节进度，面板回退静态阶段且不抛错。
4. 导出分别测试三档：草稿档（空单元/缺作者仅提示，可导出）；成品档（空单元阻断，切「仅已写单元」后通过）；投稿档（缺作者或字数 < 下限一半阻断，且范围锁定整包）。

---

## 维护约定

- 新增/删除链路上的命令、文件位置或关键函数时，同步更新本文与
  `scripts/check-linked-scenarios.mjs` 的锚点清单；锚点失配会让 preflight 失败。
- 手工验收发现的问题按严重度回填到 `docs/audits/` 与 `docs/progress/program-status.json`。
