# 隔离边界与适配规则

## 一、总原则

三个模式的关系是：**共享基础设施，隔离创作逻辑；共享数据格式，隔离内容树；允许概念借鉴，禁止代码复用。**

一句话判据：

> 如果一段代码知道“卷/章/11 步/分卷大纲/章节结算”，它属于长篇域；短篇和剧本不得导入它。

---

## 二、共享内核与模式专属

### 2.1 允许共享（Shared Kernel）

| 能力 | 共享方式 | 约束 |
|---|---|---|
| AI 客户端与模型路由 | 共享 | 只传 prompt/messages，不传长篇步骤上下文 |
| 文件 IO / Vault 适配 | 共享 | 路径由模式域提供，共享层不拼长篇路径 |
| 日志 / 诊断 | 共享 | 带 `mode` 标签 |
| 设置存储 | 共享 | 模式开关、模型配置；不共享流程状态 |
| 导出文件写入 | 共享底层 | 内容由模式专属 exporter 生成 |
| 提示词预算/截断工具 | 共享 | 只做 token 预算，不提供长篇模板 |
| 五维分类数据 | 短篇使用 | 只读；长篇/剧本可忽略 |
| 项目索引 | 三模式使用 | 只读；由 hub 维护 |
| 通用 UI 组件 | 共享 | 按钮、弹窗、表单；不内置长篇动作 |

### 2.2 必须独立（Mode-Owned）

| 能力 | 长篇 | 短篇 | 剧本 |
|---|---|---|---|
| 流程定义 | 11 步 | 10 步 | 9 步 |
| Runner | `StepRunner` | `ShortStoryWorkflowRunner` | `ScriptWorkflowRunner` |
| 步骤键 | `infoPlan` 等 | `short.*` | `script.*` |
| 状态文件 | 章节状态 | `短篇配置/流程状态.json` | `剧本配置/流程状态.json` |
| 内容树 | 卷/章 | 故事核/分节/节 | 集/场/镜 |
| 提示词 | 长篇模板 | `short.*` 模板 | `script.*` 模板 |
| 校验器 | 长篇质量门 | 短篇节级质检 | 剧本集级/分镜质检 |
| 批量 | 批量建章 | 批量生成节 | 批量生成集/场 |
| 导出 | 全稿 | 短篇稿 | 剧本 + 分镜 CSV |
| 入口 | 长篇入口 | 短篇入口 | 剧本入口 |

---

## 三、禁止复用清单

短篇/剧本代码中**禁止导入**：

```text
engine/step-runner.ts
engine/step-definitions.ts
engine/step-validator.ts（长篇步骤校验）
ui/full-writer/batch-pipeline-runner.ts
ui/full-writer/template-vars-builder.ts（长篇变量构建）
engine/ai-outline-generator.ts（分卷大纲）
engine/chapter-state-manager.ts
engine/context-manager.ts（长篇上下文采集）
services/template-service.ts 的 getStepTemplate / getBodyTemplate 长篇分支
```

短篇/剧本中**禁止出现**：

- `ALL_FULL_STEPS`
- `stepResults` / `stepCompleted` / `stepLevels` / `staleSteps` 长篇状态字段
- `infoPlan`、`plotDistill`、`characterSoul`、`outline`、`emotionPlan`、`sceneExpand`、`bodyGeneration`、`qualityControl`、`analysisReport`、`settlement` 长篇步骤键
- `parseVolumePlan` / `countPlannedChapters` / 分卷大纲
- `03-大纲与章节/正文/第N卷/第N章_正文.md` 路径拼装
- “章”“卷”“全书规划”“批量建章”“章节结算”作为用户可见主流程术语

短篇/剧本中**允许使用但必须换实现**的概念：

- 清晰表达
- 设定规范
- 分镜/节拍
- 动作表达
- 环境描写
- 质量门

即：可以借鉴“怎么写得好”，不能调用“长篇怎么写”的代码。

---

## 四、目标模块结构

```text
shared/
  taxonomy/
    short-story-taxonomy.ts       # 五维分类、校验、默认组合
  workflow/
    short-story-workflow.ts       # 短篇 10 步定义（纯数据）
    script-workflow.ts            # 剧本 9 步定义（纯数据）
  project-index/
    project-index.ts              # 三模式项目索引
  mode/
    creation-domain.ts            # long/short/script 域描述

engine/
  short-story/
    short-story-runner.ts
    short-context-provider.ts
    short-prompt-provider.ts
    short-validators.ts
    short-exporter.ts
  script/
    script-runner.ts
    script-context-provider.ts
    script-prompt-provider.ts
    script-storyboard.ts
    script-validators.ts
    script-exporter.ts

ui/
  hub/
    creation-hub-view.ts
  short-story/
    short-entry-view.ts
    short-workflow-view.ts
    taxonomy-picker.ts
  script/
    script-entry-view.ts
    script-workflow-view.ts
    storyboard-editor.ts
```

长篇模块保持原位，不要求迁移；但短篇/剧本不得反向依赖它们。

---

## 五、数据边界

### 5.1 模式字段不可变

```ts
interface ProjectModeProfile {
  mode: 'long' | 'short' | 'script';
  modeVersion: 1;
  taxonomyVersion?: number;
  createdAt: number;
  modeLocked: true;
}
```

- `mode` 创建后不可修改。
- 跨模式使用“复制为新项目”，不原地切换。
- 读取旧项目缺少字段时默认 `long`，不猜测。

### 5.2 路径所有权

| 模式 | 根目录（推荐） | 允许写入 | 禁止写入 |
|---|---|---|---|
| 长篇 | `长篇作品/{项目}` | 长篇内容树 | 短篇/剧本目录 |
| 短篇 | `短篇作品/{项目}` | 短篇内容树 | 长篇章节、剧本集/场 |
| 剧本 | `剧本作品/{项目}` | 剧本内容树 | 长篇章节、短篇节 |

旧项目保留原路径；通过索引归属模式，但内容树仍按旧结构读写。升级前不混写。

### 5.3 状态文件

| 模式 | 状态文件 | 所有者 |
|---|---|---|
| 长篇 | 章节 frontmatter / 章节状态 | `ChapterStateManager` |
| 短篇 | `00-短篇配置/流程状态.json` | `ShortStoryWorkflowRunner` |
| 剧本 | `00-剧本配置/流程状态.json` | `ScriptWorkflowRunner` |

- 三个状态文件互不读取。
- 共享层不得提供“统一 stepResults”抽象；那会把三套流程重新绑在一起。

### 5.4 共享素材库

允许短篇/剧本**只读**引用共享素材库（人物、地名、道具、文风），但：

- 不写回长篇项目状态。
- 不把共享素材当成长篇章节上下文。
- 引用时复制为模式内快照，避免上游变更导致内容漂移。

---

## 六、提示词与模板隔离

### 6.1 命名空间

| 模式 | 模板命名 | 示例 |
|---|---|---|
| 长篇 | 现有键 | `infoPlan`、`sceneExpand` |
| 短篇 | `short.*` | `short.premise`、`short.outline`、`short.section_gen` |
| 剧本 | `script.*` | `script.episode_outline`、`script.scene_write`、`script.storyboard` |

### 6.2 禁止共用 `getStepTemplateAuto`

短篇/剧本不再通过 `getStepTemplateAuto` 追加“模式覆盖块”。改为：

```ts
interface ShortPromptProvider {
  system(step: ShortStepKey, ctx: ShortPromptContext): string;
  user(step: ShortStepKey, ctx: ShortPromptContext): string;
}

interface ScriptPromptProvider {
  system(step: ScriptStepKey, ctx: ScriptPromptContext): string;
  user(step: ScriptStepKey, ctx: ScriptPromptContext): string;
}
```

- 长篇提示词零改动。
- 短篇/剧本模板可独立迭代、独立测试、独立版本号。
- 模式提示词里只出现本模式术语；不得出现“卷/章/11 步”。

### 6.3 上下文包隔离

| 模式 | 上下文包内容 |
|---|---|
| 长篇 | 卷纲、章节步骤结果、Scene 展开、角色灵魂、信息债 |
| 短篇 | 五维分类、故事核、人物关系、反转表、当前节大纲、前情摘要 |
| 剧本 | 类型/集数、人物小传、场景圣经、分集大纲、当前集/场、前集钩子 |

短篇/剧本上下文包不得包含长篇 `Scene展开`、`章节结算`、`分析报告`。

---

## 七、长篇要素适配规则

| 长篇要素 | 短篇适配 | 剧本适配 | 说明 |
|---|---|---|---|
| 清晰表达 | 每段有信息增量；短句；节目标明确 | 每场目的明确；每句台词有功能；画面可拍 | 借鉴“信息密度”原则，重写提示词 |
| 设定规范 | 极简故事圣经：3–6 人、1 主场景、1 核心规则 | 人物小传 + 场景圣经 + 道具连续性表 | 不搬长篇世界观/势力/时间线 |
| 分镜演绎 | 节内 beat sheet：目标→阻力→选择→代价→钩子 | 集→场→镜→节拍；镜头表 | 长篇 Scene 展开器不复用 |
| 动作表达 | 身体动作/表情/可感细节替代心理独白 | △动作行；可拍动作/表演 | 长篇动作描写只作参考 |
| 环境描写 | 1–2 个感官细节服务情绪 | 场景标题 + 可视细节 + 音效/光线 | 禁止长篇环境铺陈 |
| 质量门 | 节级质检 + 全篇质检 | 集级质检 + 全剧质检 | 规则独立，不调用长篇质量门 |
| 章节结算 | 不需要；用节级状态与质检替代 | 不需要；用集/场状态与质检替代 | 不写信息债/结算表 |

### 7.1 适配的边界

- **可以借鉴写法**：节奏、信息密度、动作可感、环境服务情绪。
- **不可以复用代码**：长篇模板、步骤键、状态机、Scene 展开、章节结算。
- **不可以复用数据**：短篇不读长篇卷纲；剧本不读长篇章节正文。
- **可以复制素材**：人物/地名/道具可复制为模式内快照。

---

## 八、引擎、注册表与事件隔离

### 8.1 EngineRegistry

新增引擎名：

```ts
SHORT_STORY_RUNNER
SHORT_CONTEXT_PROVIDER
SHORT_PROMPT_PROVIDER
SCRIPT_RUNNER
SCRIPT_CONTEXT_PROVIDER
SCRIPT_PROMPT_PROVIDER
SCRIPT_STORYBOARD
```

规则：

- 短篇入口只初始化 short 相关引擎。
- 剧本入口只初始化 script 相关引擎。
- 长篇入口才初始化 `StepRunner`、`ContextManager`、`ChapterStateManager`。
- 共享引擎（AI、日志、设置）可提前初始化，但不得携带长篇状态。

### 8.2 事件

事件名带模式前缀：

```text
short:step-completed
short:section-saved
script:episode-saved
script:storyboard-updated
```

- 长篇事件监听器不得订阅 short/script 事件。
- short/script 不得监听长篇 `bodyGeneration` 等事件。

### 8.3 缓存

- 模式独立缓存键：`short:{project}`、`script:{project}`。
- 切换入口时不清空其他模式缓存，但也不交叉读取。
- 项目索引缓存三模式共用，只读。

---

## 九、门禁与测试

### 9.1 静态导入门禁

新增脚本/测试：

- 扫描 `engine/short-story/**`、`engine/script/**`、`ui/short-story/**`、`ui/script/**`。
- 禁止导入清单中的长篇模块。
- 禁止出现 `ALL_FULL_STEPS`、长篇步骤键、`parseVolumePlan`。

### 9.2 步骤键门禁

- 短篇步骤键必须以 `short.` 开头。
- 剧本步骤键必须以 `script.` 开头。
- 长篇步骤键不得出现在 short/script 定义中。
- 三套步骤键集合互不相交。

### 9.3 路径门禁

- 短篇写入路径必须匹配 `短篇作品/{项目}/...` 或旧短篇项目路径。
- 剧本写入路径必须匹配 `剧本作品/{项目}/...` 或旧剧本项目路径。
- 禁止跨模式写入；运行时路径守卫抛错并记录。

### 9.4 入口门禁

- 短篇入口只列出 `mode=short`。
- 剧本入口只列出 `mode=script`。
- 长篇入口只列出 `mode=long`/缺失模式。
- 批量生成默认当前项目；不跟随当前项目视为失败。
- 导出只使用本模式编译器。

### 9.5 回归测试

- 长篇 11 步、分卷、批量建章、导出全稿全部通过。
- 短篇 10 步可完整生成 5–10 万字。
- 剧本 9 步可完整生成 40–120 集 + 分镜。
- 旧项目索引正确、内容可读。
- 回退开关恢复旧版单列表。

---

## 十、迁移与兼容

### 10.1 模式识别

```text
.project ## 创作模式 -> short/script/long
缺失 -> long
```

- 不根据目录名猜测模式。
- 不根据正文格式猜测模式。

### 10.2 旧短篇/剧本

- 保留旧内容树与旧流程状态。
- 标记 `legacyStructure=true`。
- 新流程只对新建/升级项目启用。
- 升级动作：备份 → 复制/转换 → 校验 → 用户确认删除旧结构。
- 未升级前，旧项目仍可读取、导出；不强行运行新 runner。

### 10.3 旧长篇

- 零改动。
- 仍走原命令与原状态。
- 新增三入口只加索引，不改长篇文件。

### 10.4 回退

- `unifiedProjectGrid=true`：恢复旧版单列表。
- 新入口/新流程失败时，不影响旧长篇与旧项目读取。
- 回退不删除任何新文件；用户可手动清理。

---

## 十一、例外与评审

任何“短篇/剧本复用长篇代码”的例外必须满足：

1. 只复用无业务语义的底层工具（如 token 估算、文件写入）。
2. 不携带长篇步骤键、状态、模板、路径。
3. 在代码注释中写明为什么不是流程复用。
4. 通过静态导入门禁与架构评审。
5. 记录到 ADR（架构决策记录）。

默认结论：**不允许**。宁可复制少量基础设施，也不让三套流程重新耦合。

---

## 十二、验收标准

1. 短篇/剧本代码不导入任何长篇 Runner/步骤/模板/状态机。
2. 三套步骤键互不相交，前缀分别为空/`short.`/`script.`。
3. 短篇/剧本不读写长篇 `03-大纲与章节` 与章节状态。
4. 长篇 11 步与现有导出零回归。
5. 短篇可独立完成 10 步流程，剧本可独立完成 9 步 + 分镜。
6. 三入口项目列表互不混入；批量/导出默认当前项目。
7. 旧项目索引正确，旧短篇/剧本不因升级丢失数据。
8. 回退开关可恢复旧版单列表。
9. 静态导入、步骤键、路径、入口、导出五类门禁全部通过。
10. 任何例外有 ADR 与评审记录。
