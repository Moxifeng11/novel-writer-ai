# 知识库接入朱雀检测（2026-11-25）

> 状态：已实现（默认关闭）· 2026-11-25 · ZCode
> 用户需求：「不能直接蒸馏朱雀模型吗，让知识库也使用朱雀检测参数。」

## 一、先回答「能不能蒸馏朱雀」

这个问题要拆成两种完全不同的东西：

### A) 用朱雀输出当训练信号，训一个本地模型（distillation）

**技术上可行**，路线是：
1. 用朱雀给几万条文本打标（人工率 / AI 率 / softmax）
2. 用这批标注训一个小模型（分类头 + 微调）
3. 本地推理，不再调 API

**但本轮做不到**，因为：
- 需要几万条标注 → 按当前额度（约 700 字）完全不可能
- 需要训练基础设施（GPU / 训练脚本 / 评估集）
- 训出来的模型精度必然低于朱雀本体（蒸馏有损）

这是一条**独立的产品线**，不是「顺便做一下」的事。

### B) 把朱雀的判定逻辑「抄」进知识库

**不可能。** 朱雀是黑盒判别模型，没有可提取的规则。
它不像「禁分号」「句长 X」那样能写成 if-else。

**唯一可行的形态**：调用它、缓存结果、把结果当成一个可信判据用。

## 二、实测确认的关键事实

### 朱雀是完全确定性的

同文本测两次：

| 文本 | 第 1 次 | 第 2 次 | 差异 |
| --- | --- | --- | --- |
| AI 模板（61 字） | 人工 0% / softmax 0.9997 | 人工 0% / softmax 0.9997 | **0.0000** |

**意义**：可以安全缓存，可以当稳定的标注源。这是做任何后续工作的前提。

### 额度是硬约束

| 文本长度 | HTTP |
| ---: | --- |
| 500 字 | 200（835 tokens） |
| 800 字 | **402** |

Makers 每月 50 万 tokens ≈ 30 万字 ≈ 120 章。
**拆解一本 15 万字的书会消耗约一半额度**——所以必须做缓存 + 采样 + 用户显式开启。

## 三、落地实现

### 3.1 `engine/zhuque-detector.ts`

核心设计三条：

| 设计 | 理由 |
| --- | --- |
| 走 `shared/http-transport` | 移动端自动切 `requestUrl`（无 CORS）；本仓规范禁止裸 `fetch` |
| 内置哈希缓存 | 朱雀确定性，同文本可安全复用，避免重复烧额度 |
| **失败不降级** | 拿不到就 `available: false` + 原因，**绝不用统计指标冒充朱雀结论** |

失败语义明确区分：
- 未启用 → `朱雀检测未启用`
- 无 key → `缺少 MAKERS_MODELS_KEY`
- 文本 <50 字 → `文本过短，检测无意义`
- 402 → `朱雀额度不足（Makers 每月 50 万 tokens），本次跳过`
- 其他 HTTP → 带状态码
- 超时/网络 → 带原始错误

### 3.2 拆解后置检查

8 个统计维度跑完后执行一次：

```ts
await this.runWithConcurrencyLimit(task.dimensions, dimConcurrency, processDimension);
if (aborted) throw new Error('任务已取消');
await this.runZhuquePostCheck(task, inputText, emitter);   // ← 新增
await this.flushBatchWrites();
```

结果写入**独立文件** `朱雀人味检测.md`，含：
- 人工率 / AI 率 / 疑似 AI / softmax
- 档位（HUMAN / LIKELY_HUMAN / MIXED / LIKELY_AI / AI）
- 检测字数 / 消耗 tokens
- **AI 味集中的分段定位**（来自 `segment_labels`，最多列 5 条）

### 3.3 为什么不做成「第 9 个维度」（试过，回退了）

我先试着把 `zhuque` 加进 `BreakdownDimension`，结果：

```
error: Property 'zhuque' is missing in type Record<BreakdownDimension, string>
  → engine/deconstruction-scheduler.ts:283
error: Property 'zhuque' is missing in type Record<BreakdownDimension, ...>
  → engine/deconstruction-scheduler.ts:294
error: Type '"zhuque"' is not assignable to type 'DeconstructDimension'
  → engine/deconstruction-scheduler.ts:1545, 1581
error: Property 'zhuque' is missing → engine/quality-scorer.ts:52
error: Property 'zhuque' is missing → services/knowledge-base-manager.ts:1155, 1215
```

**6 处 Record 类型依赖**。而且更根本的问题是：

| 维度系统假设 | 朱雀的现实 |
| --- | --- |
| 可降级到纯统计 | 拿不到就是拿不到 |
| 参与进度/失败计数 | 它是增值信息，失败不该让任务失败 |
| 可分段并发跑 | 它是整体判定（一次调用给整体分） |
| 有 `saveAnalysisToMarkdown` | 它输出完全不同的结构 |

**所以回退，改成独立后置检查。** 这是设计判断，不是妥协。

## 四、和「代理指标」的关系（重要）

本仓原有 8 个维度全是**代理指标**：

| 维度 | 本质 | 与朱雀人工率相关性 |
| --- | --- | :---: |
| style / rhythm / technique | 句长/标点/节奏统计 | 弱（长句 r=0.150） |
| readability | 展示/讲述、AI 痕迹词表 | 弱-中 |
| character / foreshadow | 实体抽取 | 不相关（不是人味指标） |

**朱雀是唯一直接测「人味」的判据。** 所以它在文件里被标成：

> 这是**唯一直接测「人味」**的判定。其余 8 个维度的句长/标点/词表
> 都是代理指标，与朱雀人工率相关性弱（长句 r=0.150），不应单独用来判断像不像人写。

## 五、使用方式

### 开启

设置 → 拆解引擎 → 「朱雀人味检测」开关（默认关闭）。

需先配置 `MAKERS_MODELS_KEY`（`.env.local` 或设置里的 Makers Key 字段）。

### 成本预估

- 单次拆解：`min(文本长度, 20000)` 字 → 约 1700–33000 tokens
- 每月 50 万 tokens → 约 15–300 次拆解（取决于书的大小）
- 默认 `zhuqueMaxChars: 20000`（约 3.3 万 tokens），一本 15 万字的书会截断到 2 万字

### 关闭

关掉开关即可，不影响其他 8 维。

## 六、验证

| 项 | 结果 |
| --- | --- |
| 新增测试 | 17 条（档位映射 / 默认关闭 / 402 / 缓存 / 截断 / 网络异常 / 路径独立） |
| 全量测试 | 5257 通过 |
| preflight | EXIT=0（54 项门禁） |
| dev-vault | md5 一致 |

## 七、待办

| 项 | 说明 |
| --- | --- |
| **额度恢复后验证真实调用** | 当前只测了 mock，没跑过真实 API |
| 加设置面板的开关 UI | 后端设置项已就绪，UI 未加 |
| 考虑「蒸馏一条产品线」 | 需先解决额度 + 训练基础设施，不是短期能做的 |
