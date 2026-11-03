# 历史未发布记录归档（v8.x / 4.10.x）

> 从 `CHANGELOG.md` 迁出：这些条目是早期开发阶段以 `## Unreleased` 记录、未形成正式版本节点的批次。
> 原文完整保留，仅按迁出顺序排列；当前版本记录请看仓库根目录 `CHANGELOG.md`。

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

