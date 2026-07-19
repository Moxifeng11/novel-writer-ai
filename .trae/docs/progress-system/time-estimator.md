# TimeEstimator 接入指南

## 目录

- [概述](#概述)
- [基本原理](#基本原理)
- [快速开始](#快速开始)
- [配置选项](#配置选项)
- [API 参考](#api-参考)
- [任务类型定义](#任务类型定义)
- [历史数据存储](#历史数据存储)
- [使用示例](#使用示例)
- [最佳实践](#最佳实践)

---

## 概述

`TimeEstimator` 是基于历史数据的精准时间估算引擎，采用中位数统计算法，为各种耗时操作提供可靠的时间预估。

### 主要特性

- ✅ **中位数统计**：稳健抗异常，不受极端值影响
- ✅ **字数分桶**：按字数分桶统计，粒度可控
- ✅ **实时修正**：根据已用时间和进度动态调整估算
- ✅ **置信度评估**：基于历史数据量给出估算可信度
- ✅ **本地持久化**：localStorage 存储历史数据，刷新不丢失
- ✅ **零依赖**：纯 TypeScript，可在任何环境运行

---

## 基本原理

### 中位数统计算法

与平均值相比，中位数统计有以下优势：
- 不受极端值（如某次网络超时导致的超长耗时）影响
- 更能反映典型情况下的真实耗时
- 数据量较小时更稳定

### 字数分桶策略

1. 将历史记录按字数分入不同的"桶"（默认每 10000 字一桶）
2. 估算时优先使用同桶内的历史数据
3. 如果同桶数据不足，自动向相邻桶扩展
4. 不同字数的记录会按比例缩放后再统计

### 实时修正机制

执行过程中，根据已用时间和当前进度动态修正估算：

```
修正后估算 = 历史估算 × (1 - 权重) + 实时估算 × 权重
```

其中权重随进度增加而增大：
- 进度 0%：完全信任历史估算
- 进度 50%：历史和实时各占约 25%/75%
- 进度 100%：完全信任实时估算

---

## 快速开始

### 基本用法

```typescript
import { TimeEstimator } from './shared/time-estimator';

// 1. 创建实例
const estimator = new TimeEstimator();

// 2. 加载历史数据
await estimator.loadHistory();

// 3. 预估时间
const result = estimator.estimate({
    operationType: 'outline_generation',
    wordCount: 50000,
    mode: 'statistical'
});

console.log(`预估耗时: ${(result.eta / 1000).toFixed(1)}s`);
console.log(`最快: ${(result.etaMin / 1000).toFixed(1)}s`);
console.log(`最慢: ${(result.etaMax / 1000).toFixed(1)}s`);
console.log(`置信度: ${(result.confidence * 100).toFixed(0)}%`);

// 4. 记录实际耗时
estimator.record({
    operationType: 'outline_generation',
    wordCount: 50000,
    mode: 'statistical',
    duration: 8500
});

// 5. 保存历史数据
await estimator.saveHistory();
```

---

## 配置选项

### TimeEstimatorOptions

```typescript
interface TimeEstimatorOptions {
    storageKey?: string;           // localStorage 存储键名
    maxHistoryPerType?: number;    // 每种类型最多保留的历史记录数
    bucketSize?: number;           // 字数分桶大小（字）
}
```

| 选项 | 默认值 | 说明 |
|-----|--------|------|
| `storageKey` | `'novel-writer-time-estimator-history'` | localStorage 存储键名 |
| `maxHistoryPerType` | `50` | 每种操作类型最多保留的历史记录数 |
| `bucketSize` | `10000` | 字数分桶大小，单位为字 |

### 自定义配置示例

```typescript
const estimator = new TimeEstimator({
    storageKey: 'my-custom-history',
    maxHistoryPerType: 100,
    bucketSize: 5000
});
```

---

## API 参考

### 构造函数

```typescript
constructor(options?: TimeEstimatorOptions)
```

### 核心方法

#### `estimate(config): EstimationResult`

估算操作耗时。

```typescript
const result = estimator.estimate({
    operationType: 'deconstruction_style',
    wordCount: 30000,
    mode: 'statistical'
});
```

**参数**：

| 参数 | 类型 | 说明 |
|-----|------|------|
| `config.operationType` | `string` | 操作类型标识 |
| `config.wordCount` | `number` | 字数 |
| `config.mode` | `'statistical' \| 'vector'` | 模式，默认 `'statistical'` |

**返回值**：

```typescript
interface EstimationResult {
    eta: number;           // 预估耗时（毫秒）
    etaMin: number;        // 乐观估计（25 分位）
    etaMax: number;        // 悲观估计（75 分位）
    confidence: number;    // 置信度 0-1
}
```

#### `record(config): void`

记录实际耗时，用于后续估算。

```typescript
estimator.record({
    operationType: 'deconstruction_style',
    wordCount: 30000,
    mode: 'statistical',
    duration: 8500  // 实际耗时（毫秒）
});
```

### 持久化

#### `loadHistory(): Promise<void>`

从 localStorage 加载历史数据。

```typescript
await estimator.loadHistory();
```

#### `saveHistory(): Promise<void>`

保存历史数据到 localStorage。

```typescript
await estimator.saveHistory();
```

#### `clearHistory(operationType?): void`

清空历史数据。

```typescript
// 清空所有历史
estimator.clearHistory();

// 清空指定操作类型的历史
estimator.clearHistory('old_operation_type');
```

### 统计信息

#### `getStats(operationType?, mode?): object`

获取统计摘要。

```typescript
// 获取所有统计
const allStats = estimator.getStats();

// 获取指定操作类型的统计
const stats = estimator.getStats('deconstruction_style', 'statistical');
```

---

## 任务类型定义

### 命名规范

操作类型（operationType）建议使用以下命名规范：

```
{领域}_{操作名}
```

### 已定义的任务类型

| 操作类型 | 说明 | 推荐模式 |
|---------|------|---------|
| `deconstruction_style` | 文笔风格拆解 | statistical |
| `deconstruction_plot` | 情节拆解 | statistical |
| `deconstruction_character` | 人物拆解 | statistical |
| `outline_generation` | 大纲生成 | vector |
| `chapter_generation` | 章节生成 | vector |
| `style_distillation` | 风格蒸馏 | statistical |
| `quality_check` | 质量检测 | vector |

### 自定义任务类型

```typescript
// 定义你的操作类型
const MY_OPERATION = 'my_feature_custom_task';

// 使用时
const result = estimator.estimate({
    operationType: MY_OPERATION,
    wordCount: 10000,
    mode: 'statistical'
});
```

---

## 历史数据存储

### 存储结构

历史数据以 JSON 格式存储在 localStorage 中，键名默认为 `novel-writer-time-estimator-history`。

```typescript
// 存储结构
type StorageFormat = Record<string, HistoryRecord[]>;

// key 格式: `${operationType}:${mode}`
// 例如: "deconstruction_style:statistical"
```

### HistoryRecord 结构

```typescript
interface HistoryRecord {
    operationType: string;
    wordCount: number;
    mode: 'statistical' | 'vector';
    duration: number;      // 实际耗时（毫秒）
    timestamp: number;     // 记录时间戳
}
```

### 数据淘汰策略

- 每种操作类型最多保留 `maxHistoryPerType` 条记录（默认 50 条）
- 超出时删除最旧的记录
- 确保数据不会无限增长

---

## 使用示例

### 示例 1：基本估算与记录

```typescript
async function processDocument(wordCount: number) {
    const estimator = new TimeEstimator();
    await estimator.loadHistory();
    
    const startTime = Date.now();
    
    // 预估算
    const estimate = estimator.estimate({
        operationType: 'doc_processing',
        wordCount,
        mode: 'statistical'
    });
    console.log(`预计需要 ${estimate.eta / 1000} 秒`);
    
    // 实际执行
    await doTheWork(wordCount);
    
    // 记录实际耗时
    const duration = Date.now() - startTime;
    estimator.record({
        operationType: 'doc_processing',
        wordCount,
        mode: 'statistical',
        duration
    });
    
    // 保存历史
    await estimator.saveHistory();
}
```

### 示例 2：进度实时修正

```typescript
import { refineEstimate } from './shared/time-estimator';

async function longTask(wordCount: number, emitter: ProgressEmitter) {
    const estimator = new TimeEstimator();
    await estimator.loadHistory();
    
    const baseEstimate = estimator.estimate({
        operationType: 'long_task',
        wordCount,
        mode: 'vector'
    });
    
    emitter.start();
    
    for (let i = 0; i < 100; i++) {
        await doStep(i);
        
        const progress = i + 1;
        const elapsed = Date.now() - startTime;
        
        // 实时修正估算
        const refined = refineEstimate(baseEstimate, elapsed, progress);
        
        emitter.setProgress(progress, `还剩约 ${Math.round(refined.eta / 1000)} 秒`);
    }
    
    emitter.complete();
}
```

### 示例 3：显示置信度

```typescript
function formatEta(result: EstimationResult): string {
    const etaSec = Math.round(result.eta / 1000);
    
    if (result.confidence >= 0.8) {
        return `约 ${etaSec} 秒`;
    } else if (result.confidence >= 0.3) {
        const minSec = Math.round(result.etaMin / 1000);
        const maxSec = Math.round(result.etaMax / 1000);
        return `约 ${minSec} - ${maxSec} 秒`;
    } else {
        return `预计 ${etaSec} 秒（估算仅供参考）`;
    }
}
```

---

## 最佳实践

### 1. 单例模式

建议在应用中使用单例模式，避免重复加载历史数据。

```typescript
// estimator.ts
import { TimeEstimator } from './shared/time-estimator';

let estimator: TimeEstimator | null = null;
let initPromise: Promise<void> | null = null;

export async function getTimeEstimator(): Promise<TimeEstimator> {
    if (estimator) return estimator;
    
    if (initPromise) {
        await initPromise;
        return estimator!;
    }
    
    estimator = new TimeEstimator();
    initPromise = estimator.loadHistory();
    await initPromise;
    
    return estimator;
}

// 使用
const estimator = await getTimeEstimator();
```

### 2. 及时保存历史数据

任务完成后尽快记录并保存，避免数据丢失。

```typescript
try {
    const result = await longRunningTask();
    
    // 记录成功的耗时
    estimator.record({ ...config, duration: elapsed });
    await estimator.saveHistory();
    
    return result;
} catch (error) {
    // 失败的任务也可以考虑记录（如果失败不是异常情况）
    // estimator.record({ ...config, duration: elapsed });
    throw error;
}
```

### 3. 合理设置分桶大小

分桶大小影响估算精度：
- **太小**（如 1000）：每个桶数据量不足，估算不准
- **太大**（如 100000）：粒度太粗，字数差异大

```typescript
// 如果你的任务字数差异大，建议用默认值 10000
const estimator = new TimeEstimator({ bucketSize: 10000 });

// 如果任务字数都在小范围内，可以调小
const estimator = new TimeEstimator({ bucketSize: 2000 });
```

### 4. 区分操作模式

`statistical` 和 `vector` 两种模式适合不同场景：

| 模式 | 适用场景 | 特点 |
|-----|---------|------|
| `statistical` | 统计模式、规则处理、本地计算 | 速度快，耗时相对稳定 |
| `vector` | AI 生成、向量计算、API 调用 | 速度慢，耗时波动大 |

### 5. 定期清理异常数据

如果发现估算偏差很大，可以考虑清除异常数据。

```typescript
// 清除指定操作类型的历史，重新积累
estimator.clearHistory('problematic_operation');
```

### 6. 与 ProgressEmitter 结合使用

```typescript
async function taskWithEstimation(
    wordCount: number,
    emitter: ProgressEmitter,
    estimator: TimeEstimator
) {
    const startTime = Date.now();
    
    // 初始估算
    const baseEstimate = estimator.estimate({
        operationType: 'my_task',
        wordCount,
        mode: 'statistical'
    });
    
    emitter.start();
    emitter.setProgress(0, `预计需要 ${Math.round(baseEstimate.eta / 1000)} 秒`);
    
    // 执行任务
    for (let i = 0; i < 10; i++) {
        await doStep(i);
        
        const progress = (i + 1) * 10;
        const elapsed = Date.now() - startTime;
        const refined = refineEstimate(baseEstimate, elapsed, progress);
        
        emitter.setProgress(progress, `还剩约 ${Math.round(refined.eta / 1000)} 秒`);
    }
    
    emitter.complete();
    
    // 记录实际耗时
    estimator.record({
        operationType: 'my_task',
        wordCount,
        mode: 'statistical',
        duration: Date.now() - startTime
    });
    await estimator.saveHistory();
}
```

### 7. 置信度低时给出范围提示

当历史数据不足时，不要给出精确的时间，而是给出范围或注明"仅供参考"。

```typescript
function getEtaText(result: EstimationResult): string {
    const etaSec = Math.round(result.eta / 1000);
    
    if (result.confidence < 0.3) {
        return `约 ${etaSec} 秒（首次运行，估算仅供参考）`;
    }
    
    if (result.confidence < 0.7) {
        const min = Math.round(result.etaMin / 1000);
        const max = Math.round(result.etaMax / 1000);
        return `约 ${min} - ${max} 秒`;
    }
    
    return `约 ${etaSec} 秒`;
}
```
