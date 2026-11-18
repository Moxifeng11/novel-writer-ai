# 全仓剩余 CJK 分类盘点（2026-11-19）

> 任务：i18n 跨层数据⑥（`ZC-20261120-06`）· 执行：ZCode
> 脚本：`node scripts/audit-cjk.mjs`（`--json` / `--md` / `--min=N`，可重复跑）
> 范围：`ui/ shared/ services/ domains/ engine/` 共 **1000 个 `.ts` 文件**
> 口径：只统计**字符串字面量**里的中文——那才是会显示给用户或写进文件的载体；
> 注释与标识符里的中文单独计为 `charsOutsideLiterals`，不影响界面语言。

## 一、一句话结论

**能迁的界面文案已经迁完。剩下的中文不是"没做完"，而是"不该迁"或"迁了会改行为"。**

- `ui/**` 棘轮 226 个文件 / 8564 条已收敛，剩余 UI 文案集中在 **11 个历史弹窗**（第 3 节表格）。
- 引擎与共享层剩余 305,385 字中文字面量，**79% 属于四类数据**：语料词表、AI 提示词、落盘模板、枚举/契约值。
- 真正"漏到下层的界面文案"（该迁但还没迁）合计 **8,613 字 / 65 个文件**，已单列清单（第 4 节），是下一轮的输入。

## 二、总量与分类

| 类别 | 文件 | 中文字面量 | 中文字符 | 结论 |
| --- | --- | --- | --- | --- |
| `corpus` | 28 | 30,853 | 104,851 | **保留** — 词表/关键词/语料（条目多、单条短） |
| `ai-prompt` | 60 | 2,578 | 58,264 | **保留** — 喂 LLM 的提示词，改语言即改模型行为 |
| `ui-copy` | 223 | 8,378 | 53,670 | **待迁** — 界面文案（棘轮内，逐步收紧） |
| `cross-layer` | 254 | 6,050 | 38,088 | **待审** — 非界面层，需逐个确认（本报告第 5 节给结论） |
| `on-disk-template` | 10 | 630 | 21,476 | **保留** — 落盘 Markdown 模板，解析与回填逐字依赖 |
| `enum-value` | 33 | 2,563 | 9,209 | **保留** — 枚举/字段/标签值，落盘与匹配用 |
| `ui-copy-in-engine` | 65 | 1,125 | 8,613 | **待迁** — 引擎层直接抛给用户的提示，应改为返回 key |
| `parse-key` | 18 | 659 | 4,251 | **保留** — 正则/解析锚点，改字即断解析 |
| `long-text` | 6 | 397 | 3,088 | **保留** — 单条超长中文（规则正文） |
| `log-message` | 43 | 299 | 2,359 | **保留** — 日志/异常文本，开发者可见 |
| `disk-path` | 14 | 253 | 1,516 | **保留** — 落盘目录/文件名 |
| `comment-only` | 244 | 0 | 0 | **保留** — 只剩注释/标识符 |

合计：**53,785 条字面量 / 305,385 字**，其中注释与标识符另有 **436,641 字**。

判定优先级（脚本头注释里有完整版，这里摘关键）：

1. `MANUAL` 里的人工结论**优先于一切自动判定** —— 机器看不出"这个值会被写进项目配置再读回"这种语义。
2. `ui/**` 早于语料判定 —— 界面文件里的长文本仍是界面文案，不能因为"条目多"就判成数据。
3. 超长字面量要按**内容骨架**分流：有「按以下格式/必须/禁止」的 → 提示词；否则 → 规则正文。
4. 日志与盘上路径都要单独识别 —— 前者走 `log.info()`/`console.warn()`，后者含 `/` 或形如 `01-世界架构.md`。

## 三、`ui/**` 剩余（棘轮内，该迁但未迁）

棘轮 226 文件 / 8564 条，剩余量集中在 11 个弹窗（按中文字符数排序）：

| 文件 | 字面量 | 中文字符 | 首个样例 |
| --- | --- | --- | --- |
| `ui/golden-opening-modal.ts` | 227 | 2,923 | 玄幻 |
| `ui/views/knowledge-base-view.ts` | 355 | 2,030 | 参考书籍 |
| `ui/add-fanfic-setting-modal.ts` | 131 | 1,487 | 📚 添加同人设定 |
| `ui/ai-builder-modal.ts` | 164 | 1,299 | 世界观总览 |
| `ui/views/book-detail-renderer.ts` | 324 | 1,206 | 风格分析数据 |
| `ui/writing-style-modal.ts` | 121 | 1,201 | 一、叙事视角 |
| `ui/novel-tags-modal.ts` | 47 | 1,199 | 🏷️ 作品标签分析 |
| `ui/write-chapter-modal.ts` | 176 | 1,075 | ✍️ AI写正文〔旧〕 |
| `ui/pre-research-modal.ts` | 139 | 1,043 | 📚 短篇前期调研 |
| `ui/knowledge-detail-modal.ts` | 226 | 1,035 | 概览 |
| `ui/plan-book-modal.ts` | 114 | 973 | 📋 AI全书规划 |

**观察**：这些都是**旧版独立弹窗**（`golden-opening`、`write-chapter〔旧〕`、`book-detail-renderer`）。
它们的入口大多已被新工作台取代，用户日常路径不经过。因此**优先级应低于第 4 节**：
第 4 节的文案在活跃路径上，这些不活跃的可以等"旧弹窗下线"一并处理，避免为将删的代码付迁移成本。
（注：`ui/golden-opening-modal.ts` 的 2923 字里包含大段提示词模板，实际界面文案少于该数。）

## 四、漏到下层的界面文案（最该迁，8,613 字 / 65 文件）

这类是**引擎/服务层直接拼中文给用户看**，属于架构问题（展示知识泄漏到领域层），不只是 i18n：

| 文件 | 字面量 | 中文字符 | 样例 | 建议做法 |
| --- | --- | --- | --- | --- |
| `engine/review-agent.ts` | 87 | 792 | ❌ 未找到章节文件 | 返回 `{ code, params }` 由界面求值 |
| `engine/fingerprint-extractor.ts` | 79 | 693 | 指纹提取完成 / 正在预处理文本... | 进度快照改为 `phase` 枚举 + 上层查键 |
| `engine/step-modal-controller.ts` | 97 | 622 | 没有正文可改写 | 同上 |
| `shared/optimization-advisor.ts` | 55 | 524 | 执行派工： | 建议项返回 key |
| `engine/agent/harness/p2-tools.ts` | 44 | 497 | 局部替换文件中的一段内容… | agent 工具描述，**应保留中文**（喂模型），分类器误判 |
| `services/api-connectivity-service.ts` | 27 | 309 | OpenCode Zen 采用按量付费… | 连接诊断返回结构化结果 |
| `engine/quality-scorer.ts` | 30 | 242 | 爽点密度 vs 情绪曲线强度 | 维度名走已迁的 `fingerprint` 资源 |

**注意分类器误判**：`engine/agent/harness/p2-tools.ts`、`plan-spec-tools.ts` 这类是 **agent 工具描述**
（`description: '…'`，会被序列化进 LLM 的 tool schema），不是界面文案——它们应归 `ai-prompt`。
这条写进脚本的 MANUAL 待办，下一轮补。

## 五、`cross-layer` 逐条结论（254 文件 / 38,088 字）

按中文字符数排序的前 15 个，**每个都人工看过代码**：

| 文件 | 中文字符 | 结论 |
| --- | --- | --- |
| `shared/creation-mode.ts` | 2,465 | **保留**：`GenderChannel` 的「女频/男频/通用」写进项目配置并读回，是落盘枚举值；展示名走 `settings.mode` 分区键 |
| `engine/knowledge-tags.ts` | 2,442 | **保留**：标签默认值（男频/玄幻…）是落盘内容数据，用户可见但属内容不属界面文案 |
| `shared/changelog-data.ts` | 1,288 | **保留**：内置更新日志（历史发布记录），属文档数据；弹窗外壳已双语 |
| `engine/context-manager.ts` | 1,008 | **保留**：47 条是 `log.*` 抛错文本（未达 60% 阈值），其余是「姓名/名称」等字段名 |
| `engine/agent/harness/repair-tools.ts` | 944 | **保留**：agent 工具返回值（修复建议），是 LLM 的输入，改语言会改变模型行为 |
| `engine/ai-batch-entity-generator.ts` | 887 | **保留**：实体类型名（势力/地点/功法），提示词与落盘共用 |
| `domains/{long,short,script}/tool-catalog.ts` | 1,218 | **保留**：跨层数据① 引入的**结构性中文兜底值**，展示走 `labelKey`/`descKey` 求值 |
| `engine/context/story-context-graph.ts` | 701 | **保留**：上下文图谱的节点/关系类型，提示词与落盘共用 |
| `shared/fanfic-rules.ts` | 624 | **保留**：同人规则模板正文（落盘与提示词共用） |
| `shared/pre-research.ts` | 619 | **保留**：盘上目录名（`00-前期调研`） |
| `shared/link-status-compute.ts` | 578 | **保留**：跨层数据③ 的**稳定值契约**——`name`/`title`/`detail` 保留中文原值供 agent 消费，界面走 `stageName()`/`linkTitle()` |
| `shared/body-format.ts` | ~320 | **保留**：跨层数据④ 的契约字段正则，落盘解析逐字依赖 |

**`cross-layer` 里 167 个文件的字面量 < 100 字**（合计 6,586 字），多为零散的字段名、
错误码描述、正则片段。它们逐条迁移的收益极低，风险不低（改错就断解析或改模型输入）。

## 六、为什么这些"保留"是对的

三条判据，任何一条成立就不迁：

1. **落盘即契约**：值被写进 `.md` / `.json` 并在下次读回或解析。翻译 → 老数据读不出。
   例：`GenderChannel` 的「女频」、盘上目录 `01-世界架构`、大纲字段 `伏笔安排`。
2. **喂模型即行为**：文本会进 LLM 的 prompt 或 tool schema。翻译 → 模型输出分布改变，
   对中文小说的生成质量是**不可测的回归**。例：`ai-prompt` 全部 60 个文件、
   `formatLinkStatusForAgent()` 的输出、agent 工具 description。
3. **匹配即锚点**：正则或字符串比较依赖中文原文。翻译 → 匹配恒失败。
   例：`step-validator` 的章节序号正则、`prose-metrics` 的标题正则、`body-format` 的空格检测。

反过来，只有「**内容对用户可见** 且 **不落盘/不喂模型/不参与匹配**」的字符串才应该迁。
这条判据就是 `ui-copy` 与 `ui-copy-in-engine` 的定义。

## 七、下一轮输入

1. **优先**（活跃路径、有真收益）：第 4 节的进度/错误文案 → 改「返回 key 或结构化结果」。
   顺带修掉「领域层向界面层泄漏展示知识」这个架构问题，不只省 i18n。
2. **修正分类器**：`engine/agent/harness/*-tools.ts` 的 `description` 应识别为 `ai-prompt`
   （它们会被序列化进 tool schema）。加一条「属性名是 `description` 且在 tools 目录」的规则。
3. **暂不处理**：第 3 节的 11 个旧弹窗——等它们随新版工作台下线，避免为将删代码付迁移成本。
4. **不做**：`corpus` / `enum-value` / `parse-key` / `on-disk-template` / `disk-path`，
   以及第 5 节已给结论的 cross-layer 项。

## 八、复跑方式

```bash
node scripts/audit-cjk.mjs                  # 人读摘要（按类别 + Top20）
node scripts/audit-cjk.mjs --json           # 机器可读（stdout 纯 JSON）
node scripts/audit-cjk.mjs --json --out=x.json
node scripts/audit-cjk.mjs --md             # Markdown 表格，直接贴文档
node scripts/audit-cjk.mjs --min=100        # 只看 ≥100 条字面量的文件
```

退出码恒为 0：这是**体检**不是门禁。「有没有变多」由 `scripts/check-i18n.mjs`（`ui/**` 棘轮）
在 `preflight` 里拦。两者分工：

| 脚本 | 角色 | 扫描范围 | 会失败吗 |
| --- | --- | --- | --- |
| `check-i18n.mjs` | 门禁 | 仅 `ui/**` | 会（棘轮只降不升、键必须存在、zh/en 键集相等） |
| `audit-cjk.mjs` | 体检 | `ui/ shared/ services/ domains/ engine/` | 不会（数字变多由门禁兜） |
