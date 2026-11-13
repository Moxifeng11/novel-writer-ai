# 规范谓词 + isCurrentState 真实验证（2026-11-13）

## 改动

拆解 prompt 要求：
1. `predicate` 必须用**规范谓词**（每类唯一）：age=年龄 / location=位置 / possession=持有 /
   ability=能力 / relationship=关系 / timeline=时间 / world-rule=规则 / knowledge=认知 / memory=记忆
2. 新增 `isCurrentState`：当前状态 true；回溯/回忆 false

解析侧**强制归一化**：模型给自由谓词也映射到规范值。

## 真实验证（DeepSeek，逐章）

### 第 1 章（现代叙述）

```
[timeline]     唐帝国·时间=天启十三年春 current=true
[location]     渭城·位置=帝国广阔疆域西北端的军事边城 current=true
[world-rule]   渭城军营·规则=军官士卒…不超过三百人 current=true
[relationship] 马士襄·关系=渭城最高军事长官 current=true
[knowledge]    马士襄·认知=猜到了车队里那位贵人的身份 current=true
```

**谓词全部是枚举值**（时间/位置/规则/关系/认知），不再有「年龄约」「被提亲起始年龄」这类自由文本。

### 第 92 章（关键回溯案例）

```
[age]      宁缺·年龄=四岁 current=false  「我那年才四岁」      ← 模型自己标了回溯
[timeline] 宁缺·时间=四岁那年第一次杀人 current=false
[location] 宁缺·位置=临四十七巷老笔斋 current=true
[possession] 宁缺·持有=笠帽 current=true
```

**这正是之前产生假矛盾的那条数据**。现在：
- 谓词是规范值「年龄」（不再是「被提亲起始年龄」这类变体）
- `current=false` 明确标注回溯

规则层只需判断 `isCurrentState !== false`，**不需要猜引文关键词**。

## 三层补丁 → 一层根治

| 阶段 | 做法 | 性质 |
|---|---|---|
| 补丁 1 | 谓词前缀锚定 | 猜（靠字面） |
| 补丁 2 | 引文回溯判定 | 猜（靠关键词） |
| 补丁 3 | numeric ≤ 0 守卫 | 猜（靠阈值） |
| **根治** | 拆解侧产出枚举谓词 + 显式回溯标记 | **确定** |

旧数据无标记时仍回退到启发式（兼容既有事实库）。

## 成本

单章拆解：in 2389 / out 2360 tokens（约 ¥0.02/章），与之前同量级。
