# 四级思考模式与拖拽强度体系

## 一、目标

把原来的 `auto/on/off` 三态升级为“四个能力等级 + 0–100% 强度滑杆”：

- 四级给用户明确预期：极速、标准、深度、极限。
- 滑杆允许在不新增等级的前提下微调思考预算。
- 兼容旧配置：未设置新字段时继续走原 `thinkingMode/thinkingBudget`。

## 二、四级能力

| 等级 | ID | 预设强度 | 思考模式 | 适用场景 | 预期 |
|---|---|---|---|---|---|
| 极速 | `fast` | 0% | off | 快速草稿、格式整理、简单改写 | 最低延迟/成本 |
| 标准 | `standard` | 35% | auto | 大多数规划、正文、分析 | 默认 |
| 深度 | `deep` | 70% | on | 复杂情节、长文推理、质量检查 | 更高推理质量 |
| 极限 | `max` | 100% | on | 高难推理、关键章节/关键反转 | 最大预算，最慢最贵 |

### 2.1 强度到预算

- 关闭/0%：预算 = 0。
- 自动预算 = `maxOutput × 0.3 × intensity%`。
- 若用户填写了显式 `thinkingBudget`：预算 = `显式预算 × intensity%`（上限 maxOutput）。
- 显式任务级 `thinkingMode` 仍可强制关闭/开启；任务级 `thinkingIntensity` 覆盖全局。

### 2.2 优先级

```text
任务级 thinkingIntensity/Level
  > 全局 thinkingIntensity/Level
  > 旧 thinkingMode/thinkingBudget
```

- 未设置新字段：完全保持旧行为，不自动改预算。
- 设置新字段后：强度是实际参数来源；`thinkingMode` 由等级/强度派生。
- 滑杆拖动：强度实时变化；松开时保存；等级自动取最接近的预设。

## 三、数据结构

```ts
export type ThinkingLevel = 'fast' | 'standard' | 'deep' | 'max';

export interface TaskBudgetOverride {
  thinkingMode?: 'off' | 'auto' | 'on';
  thinkingBudget?: number;
  thinkingLevel?: ThinkingLevel;
  thinkingIntensity?: number; // 0–100
}

export interface TaskModelSettings {
  thinkingMode?: 'off' | 'auto' | 'on';
  thinkingBudget?: number;
  thinkingLevel?: ThinkingLevel;
  thinkingIntensity?: number;
}
```

`resolveTaskModelConfig()` 返回新增：

```ts
thinkingLevel: ThinkingLevel;
thinkingIntensity: number;
```

## 四、交互逻辑

### 4.1 全局设置

```text
全局思考强度
[极速 0%] [标准 35%] [深度 70%] [极限 100%]
[========|=========] 42%
标准 · 42% — 由供应商决定是否思考，默认强度…
思考预算上限（0=按强度自动） [   0   ]
```

- 四个按钮：点击立即套用预设强度并保存。
- 滑杆：0–100，步长 5；拖动时实时显示百分比和最近等级；松开保存。
- 当前等级按钮高亮；滑杆值可与等级预设不同（显示“等级 · 实际%”）。
- 预算输入：0 表示按强度自动；非 0 作为上限，再按强度缩放。

### 4.2 任务级覆盖

每个任务卡片：

- `思考等级覆盖`：跟随全局 / 极速 / 标准 / 深度 / 极限。
- 选择等级后清除旧的 `thinkingMode` 覆盖，避免两套语义打架。
- 当前默认行显示：`思考 深度 70%`。

## 五、参数定义

| 参数 | 范围 | 默认 | 存储 |
|---|---|---|---|
| `thinkingLevel` | fast/standard/deep/max | 未设置 | 设置/任务预算 |
| `thinkingIntensity` | 0–100，整数/5 步 | 未设置 | 设置/任务预算 |
| `thinkingMode` | off/auto/on | auto | 兼容字段 |
| `thinkingBudget` | 0 或正整数 token | 0 | 兼容字段 |
| 自动预算系数 | 0.3 | 0.3 | 常量 |
| 等级阈值 | ≤? | 最近预设 | 纯函数 |

## 六、功能边界

- 四级是“能力预设”，不是模型能力保证；模型不支持思考时，供应商可能忽略参数。
- 思考强度不等于输出长度；输出长度仍由 `maxOutputTokens` 控制。
- 不新增第五个“自定义等级”；滑杆自定义强度仍归入最近的四级标签。
- 本地模型若不支持 reasoning，强度设置不会强制其产生思考。
- 旧配置未迁移前不改变实际调用行为。

## 七、验收标准

1. 设置页显示四个等级按钮与 0–100 滑杆。
2. 点击“极速”后 `thinkingIntensity=0`、模式 off、预算 0。
3. 拖动滑杆到 50% 后保存，配置保留 50；等级显示最近预设“标准”。
4. “极限”使模式 on，自动预算为 `maxOutput×0.3`。
5. 任务级强度覆盖全局；任务级显式关闭优先。
6. 未设置新字段的旧配置仍按旧 `thinkingMode/thinkingBudget` 调用。
7. 单测覆盖四级映射、最近等级、0/50/100 强度、任务覆盖、旧配置兼容。
8. 运行时滑块拖动不触发设置页重渲染/闪烁；松开后持久化。
