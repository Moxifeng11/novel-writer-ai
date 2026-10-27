# 规则层

## 一、HarnessRule

```ts
interface HarnessRule {
    id: string;
    mode: CreationMode | 'all';
    scope: RuleScope;
    severity: 'must' | 'should' | 'hint';
    source: RuleSource;
    promptText: string;
    validate?: (output: string, ctx: RuleContext) => RuleViolation | RuleViolation[] | null;
}
```

## 二、严重级

| 级别 | 行为 |
|---|---|
| must | 阻止交付；必须修复或用户显式接受风险 |
| should | 警告 + 用户确认 |
| hint | 记录，不阻断 |

## 三、规则来源

```text
writing-rules | creation-mode | platform | continuity | anti-ai | user | domain
```

## 四、编译与校验

```text
compile → 去重 → 注入一次 → generate → validate → violations
```

- 同一任务内同一规则不得重复注入。
- `must` 规则不参与预算裁剪。
- 校验只做本地确定性检查，不额外调用 AI。
- 违规输出 `{ruleId, severity, message, evidence?}`。

## 五、领域 must 规则

| 模式 | must |
|---|---|
| 长篇 | 未确认实体不得入正文；不得重复已发生事件；字数下限；章末钩子；视角一致 |
| 短篇 | 每节钩子；单主线；结尾兑现；5–10 万字；禁止长篇式铺陈 |
| 剧本 | 3 秒钩子；单集冲突；每场可拍；禁止心理旁白；镜头时长误差 ≤5 秒；纯文本交付 |