# 其余模块关键词匹配审查（2026-11-13）

> 继 `engine/consistency/` 的审查之后，把范围扩到 `engine/` 与 `shared/` 全量。
> 本文是**清点与分级**，不含大规模重构（158 处不可能一轮改完）。

## 一、全局清点

| 指标 | 数量 |
|---|---|
| 涉及文件 | **47** 个 |
| 关键词常量数组（`*_WORDS` / `*_KEYWORDS` / `*_MARKERS` / `*_PATTERNS`） | **158** |
| `.includes('中文')` 调用 | **186** |
| `=== '中文'` 严格比较 | **65** |

### 最密集的 10 个文件

| 文件 | 数组 | includes | === | 典型常量 |
|---|---|---|---|---|
| `engine/style/style-features-v2.ts` | 25 | 0 | 0 | POSITIVE_EMOTION_WORDS / HIGH_INTENSITY_EMOTION_WORDS |
| `engine/deconstructors/style-deconstructor.ts` | 15 | 0 | 0 | VERB_KEYWORDS / APPEARANCE_KEYWORDS |
| `engine/deconstructors/foreshadow-deconstructor.ts` | 12 | 0 | 0 | SETTING_KEYWORDS / EMPHASIS_PATTERNS |
| `engine/agent/conversation-engine.ts` | 6 | **56** | 3 | CANCEL_WORDS / CONFIRM_WORDS |
| `engine/writing-quality-engine.ts` | 11 | 0 | 0 | DIALOGUE_MARKERS / COMMON_TYPO_PATTERNS |
| `engine/plot-completion-engine.ts` | 10 | 0 | 0 | SCENE_LOCATION_WORDS / GOAL_START_PATTERNS |
| `engine/deconstructors/character-deconstructor.ts` | 9 | 0 | 0 | APPEARANCE_KEYWORDS / GROWTH_KEYWORDS |
| `engine/deconstructors/commercial-deconstructor.ts` | 9 | 0 | 0 | COOL_WORDS / REVERSAL_WORDS |
| `engine/deconstructors/structure-deconstructor.ts` | 8 | 0 | 0 | MAIN_LINE_KEYWORDS / ANALEPTIC_MARKERS |
| `engine/foreshadow-manager.ts` | 0 | **45** | **14** | （表格列名与状态词） |

## 二、按风险分级（关键）

不是所有关键词匹配都是 bug 温床。按**输入来源**分三类：

### A 类 · 语义判定（高风险）

关键词用于**判断文本含义**，输入是 LLM/用户自由文本。

| 代表 | 失效后果 |
|---|---|
| `conflict-detector.DRASTIC_CHANGE_KEYWORDS`（死亡/重伤/能力变化） | 换个说法就漏报；同词不同义就误报 |
| `logic-consistency-checker.INJURY_WORDS` / `MODERN_WORDS` | 现代词表永远不全（手机→智能机→平板） |
| `plot-divergence-engine.SETTING_CONTRADICTION_PATTERNS` | 设定矛盾靠字面判断，长句/倒装即失效 |
| `cross-volume-outline-validator.FACTION_RISE_WORDS` | 「势大」不在词表就漏 |
| `writing-quality-engine.COMMON_TYPO_PATTERNS` | 错别字表天然覆盖不全 |

**这类与一致性模块当初的问题同源**：用字面猜语义。
一致性模块已经用「结构化字段 + 显式标记」根治，这五处**尚未**。

### B 类 · 结构约定（低风险）

关键词用于**我方自己规定的格式**，输入不是自由文本。

| 代表 | 为什么低风险 |
|---|---|
| `foreshadow-manager` 的表格列名（位置/回收…） | 模板由我方生成 |
| `cross-volume-outline-validator.SUBLINE_MARKERS`（支线/番外/外传） | 大纲模板固定用词 |
| `conversation-engine.CONFIRM_WORDS`（确认/好的/是） | 交互命令词，可穷举且可配置 |
| `quality-score-engine.mainlineKeywords` | 由大纲结构注入，非自由文本 |

**不需要改造**，但建议把可配置项暴露到设置里（用户可自行增补）。

### C 类 · 统计/风格（中风险）

关键词用于**风格统计**，误判只影响数字，不影响正确性判断。

| 代表 | 影响 |
|---|---|
| `style-features-v2` 的 25 个情绪词表 | 情绪分布统计偏差 |
| `style-deconstructor` / `character-deconstructor` 的词性词表 | 风格画像偏差 |
| `anti-ai-detector.DEFAULT_AI_HIGH_FREQ_WORDS` | AI 味评分偏差 |
| `dimension-keywords.GOLDEN_FINGER_WORDS` | 金手指识别偏差 |

**可以接受**：统计偏差不影响用户对正文的判断，且词表可持续扩充。

## 三、结论与优先级

| 类别 | 数量级 | 是否需改造 | 优先级 |
|---|---|---|---|
| A 语义判定 | ~5 处核心 | **需要** | P1 |
| B 结构约定 | ~多数 includes | 不需要（可配置化） | P3 |
| C 统计风格 | ~25 个词表 | 可接受 | P2 |

### A 类的收敛路径（照搬一致性模块的成功经验）

1. **输入结构化**：让上游产出结构化字段（如人物状态快照已有 `injury`/`emotion` 字段，
   就不必再从正文猜「重伤」）
2. **显式标记**：需要 LLM 判断的地方让它直接输出布尔/枚举，而不是事后用词表匹配
3. **词表只做兜底**：结构化字段缺失时才用关键词，并记录「走了兜底」

### 本轮不做的事（明确说明）

- **不做** 158 个词表的批量重写：风险高、收益不确定
- **不做** 把 C 类统计词表换成模型：成本高，且统计偏差可容忍
- **要做**（后续）：A 类 5 处逐一评估，先从 `conflict-detector` 与
  `logic-consistency-checker` 开始（它们直接影响给用户的告警）

## 四、与一致性模块的对照

| 维度 | engine/consistency（已根治） | 其余模块（本次审查） |
|---|---|---|
| 谓词匹配 | 规范枚举 + event 锚 | 仍为关键词数组 |
| 回溯语义 | `isCurrentState` 显式标记 | 无此概念，靠字面 |
| 规则层 | 统一 `predicate-match` | 各模块各自为政 |
| 评测 | 100 章真实数据、误报 0 | 无端到端评测 |

**差距是清楚的，收敛路径也是清楚的**——按 A→C 顺序推进，每处都要先有评测再改。
