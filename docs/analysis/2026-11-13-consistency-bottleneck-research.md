# 联网调研 × 插件现状：AI 小说创作瓶颈与我们的取舍

> 日期：2026-11-13 · 目的：用公开研究找出「AI 长篇小说」的真实瓶颈，
> 再对照插件现状，选出**收益最高**的优化方向，避免做「看起来有用、实际没收益」的工作。

## 一、调研来源

| 来源 | 关键结论 |
|---|---|
| **ConStory-Bench / Lost in Stories**（arXiv 2603.05890，Microsoft）| 长篇小说一致性错误分类学：**5 类 19 子类**；实测**「事实与细节」「时间线与情节逻辑」是主导失效模式**；错误**集中在故事中段**、**出现在高 token 熵片段**、部分类型**共现** |
| **DOME**（arXiv 2412.13575）| 动态分层大纲 + **时序知识图谱**记忆模块，用 Temporal Conflict Analyzer 自动评一致性 |
| **ConWriter**（arXiv 2608.05169，EMNLP 2026 Findings）| 场景级增量写作 + 符号状态推理 + **不确定性风险信号**（用熵定位高风险段先校验） |
| **MAGNET**（arXiv 2607.00918）| 多智能体 + **共享结构化状态**；消融显示 structured state 贡献显著 |
| **StoryWriter**（arXiv 2506.16445）| 大纲/规划/写作三 agent，写作 agent **按当前事件动态压缩历史** |
| **WebNovelBench**（arXiv 2505.14818）| **中文网文**基准（4000+ 部），synopsis→story，8 个叙事质量维度 |
| **KG-assisted storytelling**（arXiv 2505.24803，IJHCI）| 可编辑知识图谱提升「动作性强、结构明确」的叙事；用户**控制感显著增强** |

### 最重要的一条

> "Error analysis reveals **Factual & Detail Consistency** and **Timeline & Plot Logic**
> as dominant failure modes, indicating **entity tracking and temporal reasoning**
> remain primary challenges." — ConStory-Bench §3.2.1

### 错误分类学（19 子类）

| 类别 | 子类 |
|---|---|
| **Timeline & Plot Logic** | 绝对时间矛盾 · 时长矛盾 · 同时性矛盾 · 无因之果 · 因果逻辑违规 · 废弃情节元素 |
| **Characterization** | 记忆矛盾 · 知识矛盾 · 能力波动 · 遗忘能力 |
| **World-building & Setting** | 核心规则违规 · 社会规范违规 · 地理矛盾 |
| **Factual & Detail** | 外貌不符 · **命名混淆** · **数量不符** |
| **Narrative & Style** | 视角混乱 · 语气不一致 · 文风漂移 |

### 检测管线的关键设计（四阶段）

1. **分类引导抽取**：按 5 个维度分别扫，抽「易矛盾片段」
2. **矛盾配对**：两两比对判「一致/矛盾」（降低误报）
3. **证据链**：每条矛盾必须给 `Reasoning`（为何矛盾）+ `Evidence`（**原文引文 + 字符位置**）+ `Conclusion`（错误类型）
4. **JSON 报告**：所有判断锚定到精确字符偏移

---

## 二、插件现状对照

### 已有的质量引擎维度（`engine/quality/quality-score-engine.ts`，6 组 36 项）

| 组 | 检查内容 | 性质 |
|---|---|---|
| `readability` | 长句/短句/词汇多样性/错字/重复 | 表面 |
| `rhythm` | 节奏快慢/动作描写比例/描写过载 | 表面 |
| `emotion` | 情绪弧线/强度/波动/稀疏 | 表面（单章） |
| `texture` | 精描/修辞/文风偏移 | 表面 |
| `char` | 人物提及/性格标签缺失 | 表面 |
| `coherence` | 因果词密度/重复 | 表面 |

### 已有的一致性检查器

| 文件 | 能力 | 判定方式 |
|---|---|---|
| `logic-consistency-checker.ts`（139 行）| `time_conflict` / `injury_action_conflict` / `knowledge_boundary` / `location_jump` / `identity_conflict` | **关键词启发式**（例：同一段出现昼夜时间词 → 报「时间线跳变」） |
| `character-consistency-checker.ts` | `personality` / `behavior` / `ability` / `appearance` | 标签匹配 |
| `coherence-checker.ts` | `duplicate_sentence` / `repeated_phrase` / `overused_word` | 文本统计 |

### 缺口（按论文的主导失效模式排）

| 论文维度 | 子类 | 插件 | 缺口严重度 |
|---|---|---|---|
| **Factual & Detail** | 命名混淆（人名/地名/功法名混用） | ❌ 无 | **P0**（主导失效模式） |
| | 数量不符（年龄/距离/金额/人数） | ❌ 无 | **P0**（主导失效模式） |
| | 外貌不符 | ⚠️ 仅标签匹配 | P1 |
| **Timeline & Plot** | 时长矛盾（「三天后」vs 实际跨月） | ❌ 无 | **P0**（主导失效模式） |
| | 同时性矛盾 | ❌ 无 | P0 |
| | 无因之果 / 因果违规 | ❌ 无（只有因果词密度统计） | P0 |
| | 绝对时间矛盾 | ⚠️ 仅「昼夜词同现」启发式 | P1 |
| | 废弃情节元素 | ⚠️ 伏笔管理器只追踪**显式**伏笔 | P1 |
| **Characterization** | 记忆矛盾 / 遗忘能力 | ❌ 无 | P1 |
| | 知识矛盾（角色不该知道的信息） | ⚠️ `knowledge_boundary` 启发式 | P1 |
| **World-building** | 核心规则违规 | ❌ 无 | P2 |
| **Narrative & Style** | 视角混乱 | ❌ 无 | P1 |
| | 文风漂移 | ⚠️ 指纹库有相似度，未用于审核 | P2 |

### 结论

> **插件把 90% 的质量检查能力投在了「单章表面质量」（文风/节奏/情绪/可读性），
> 而论文实测的**两大主导失效模式（跨章事实一致性 + 时间线逻辑）几乎没有覆盖**，
> 仅有的 `logic-consistency-checker` 是关键词启发式，抓不到「第3章18岁、第40章20岁但只过了3天」这类真矛盾。**

---

## 三、选定方向

### 方向：**跨章事实与时间线一致性审核（LLM 矛盾配对 + 证据链）**

**为什么收益最高**

| 判据 | 说明 |
|---|---|
| 有文献支撑，不是猜的 | ConStory-Bench 实测 Factual + Timeline 是主导失效模式；DOME/ConWriter/MAGNET 都在解决它 |
| 直接命中项目核心命题 | 用户核心痛点是「AI 忘了自己写过什么」——这正是本书的一致性审核 |
| 数据基础已具备 | 章节正文、人物档案、时间线、伏笔、知识库、章节摘要**都已存在**，只是没用于「验证」 |
| 可度量 | 直接采用论文的 **CED（每万词错误数）**，能证明改进幅度 |
| 成本可控 | 用论文的「中段 + 高熵」结论做**定位**，只审高风险段，不必全文反复喂 |
| 与现有能力不冲突 | 现有 36 项表面质量检查保留；新能力是**跨章语义层**，互补 |
| 用户可感知 | 每条问题带原文引文 + 位置 + 为什么矛盾，能直接修正文 |

**明确不做**（避免负收益）

| 不做 | 原因 |
|---|---|
| 再堆关键词反例表 | 现有 `logic-consistency-checker` 已是启发式，加词收益递减 |
| 全量 19 子类一次做齐 | 论文指出 Factual + Timeline 占大头；先做这两类（9 子类）ROI 最高 |
| 用微调/训练 | 本插件是 Obsidian 前端，无训练能力；training-free 方法（DOME/ConWriter）才是可行路径 |
| 自动改正文 | 破坏可回退性（红线）；只出**建议 + 证据**，改动由用户确认 |

### MVP 范围（第一批）

1. **事实台账提取器**：从章节正文抽取结构化事实（人名/称呼/数量/时间/地点/能力/知识边界），落 `.project` 邻域 JSON，增量更新
2. **矛盾配对器**：新事实 vs 台账做 LLM 两两判定，输出 `{reasoning, evidenceA(pos), evidenceB(pos), conclusion}`
3. **风险定位**：按「故事中段 + token 熵高」挑段送检（省 token）
4. **审核视图**：证据链列表，点击跳转到对应正文字符位置
5. **指标**：CED（每万词错误数），进质量看板

### 验收口径

- 至少覆盖 **9 个子类**（Factual 3 + Timeline 6）
- 每条 issue 必须有**原文引文 + 字符偏移 + 结论类型**（无证据不算命中）
- 用**构造的矛盾样本**做回归测试（如年龄/距离/时长），改回旧逻辑必须变红
- 真实 AI 端到端跑通（`check:prod` 扩展或独立脚本）
- 词表/提示词以文献分类学为准，不凭记忆

---

## 四、参考

- ConStory-Bench: <https://arxiv.org/abs/2603.05890>（分类学 §2.2 Table 2；管线 §2.3；主导失效模式 §3.2.1）
- DOME: <https://arxiv.org/abs/2412.13575>
- ConWriter: <https://arxiv.org/abs/2608.05169>
- MAGNET: <https://arxiv.org/abs/2607.00918>
- StoryWriter: <https://arxiv.org/abs/2506.16445>
- WebNovelBench（中文网文）: <https://arxiv.org/abs/2505.14818>
- KG-assisted storytelling: <https://arxiv.org/abs/2505.24803>
