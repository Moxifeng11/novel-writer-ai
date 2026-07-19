# ProgressEmitter 使用指南

## 目录

- [概述](#概述)
- [核心概念](#核心概念)
- [快速开始](#快速开始)
- [API 参考](#api-参考)
- [使用示例](#使用示例)
- [最佳实践](#最佳实践)

---

## 概述

`ProgressEmitter` 是进度可视化系统的核心类，提供统一的进度状态管理和事件通知机制。它是一个纯 TypeScript 类，零依赖，可在任何环境（主线程、Worker、Node.js）中运行。

### 主要特性

- ✅ **6 种状态管理**：pending / running / paused / completed / failed / cancelled
- ✅ **多步骤进度**：支持步骤注册、推进和步骤内进度
- ✅ **时间统计**：自动计算已用时间和 ETA 预估
- ✅ **事件订阅**：on/off 订阅机制，支持多个监听器
- ✅ **节流控制**：进度更新最多 10 次/秒，状态变化立即发送
- ✅ **取消支持**：集成 AbortSignal，一键取消关联的异步操作
- ✅ **状态不可变**：每次更新生成新的状态快照

---

## 核心概念

### ProgressStatus（进度状态）

```typescript
type ProgressStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
```

| 状态 | 说明 |
|-----|------|
| `pending` | 等待中，尚未开始 |
| `running` | 运行中 |
| `paused` | 已暂停 |
| `completed` | 已完成 |
| `failed` | 失败 |
| `cancelled` | 已取消 |

### ProgressStep（步骤）

```typescript
interface ProgressStep {
    name: string;
    status: ProgressStatus;
    progress: number;
    message?: string;
}
```

### ProgressState（状态快照）

```typescript
interface ProgressState {
    id: string;           // 任务唯一 ID
    name: string;         // 任务名称
    status: ProgressStatus;
    progress: number;     // 总进度 0-100
    currentStep?: string; // 当前步骤名称
    message?: string;     // 进度消息
    elapsed: number;      // 已用时间（毫秒）
    eta?: number;         // 预估剩余时间（毫秒）
    etaMin?: number;      // 预估最小时间
    etaMax?: number;      // 预估最大时间
    error?: string;       // 错误信息
    steps?: ProgressStep[]; // 步骤列表
}
```

---

## 快速开始

### 基本用法

```typescript
import { ProgressEmitter } from './shared/progress-emitter';

// 1. 创建实例
const emitter = new ProgressEmitter('task-001', 'AI 生成章节');

// 2. 订阅事件
const off = emitter.on((state) => {
    console.log(`[${state.status}] ${state.name}: ${state.progress}%`);
    if (state.message) console.log('  ' + state.message);
    if (state.eta !== undefined) console.log(`  剩余: ${Math.round(state.eta / 1000)}s`);
});

// 3. 开始任务
emitter.start();

// 4. 更新进度
emitter.setProgress(30, '正在构思情节...');
emitter.setProgress(60, '正在生成正文...');
emitter.setProgress(90, '正在润色...');

// 5. 完成任务
emitter.complete();

// 6. 取消订阅
off();
```

---

## API 参考

### 构造函数

```typescript
constructor(id: string, name: string)
```

| 参数 | 类型 | 说明 |
|-----|------|------|
| `id` | `string` | 任务唯一标识符 |
| `name` | `string` | 任务显示名称 |

### 事件订阅

#### `on(callback): () => void`

订阅进度事件。

```typescript
const off = emitter.on((state: ProgressState) => {
    // 处理进度更新
});
// 取消订阅
off();
```

**返回值**：取消订阅函数

#### `off(callback): void`

取消订阅进度事件。

```typescript
emitter.off(myCallback);
```

### 状态控制

#### `start(): void`

开始运行。将状态从 `pending` 改为 `running`，记录开始时间。

```typescript
emitter.start();
```

#### `pause(): void`

暂停进度。

```typescript
emitter.pause();
```

#### `setProgress(progress, message?): void`

设置进度值。

```typescript
emitter.setProgress(50);
emitter.setProgress(75, '正在处理中...');
```

| 参数 | 类型 | 说明 |
|-----|------|------|
| `progress` | `number` | 进度值 0-100，超出范围会被截断 |
| `message` | `string` | 可选的进度消息 |

#### `complete(): void`

标记任务完成。自动将进度设为 100%。

```typescript
emitter.complete();
```

#### `fail(error): void`

标记任务失败。

```typescript
emitter.fail('网络连接超时，请重试');
```

| 参数 | 类型 | 说明 |
|-----|------|------|
| `error` | `string` | 错误信息 |

#### `cancel(): void`

取消任务。同时触发关联的 AbortSignal 中止。

```typescript
emitter.cancel();
```

#### `getState(): ProgressState`

获取当前状态快照。

```typescript
const state = emitter.getState();
console.log(state.status);
```

#### `getSignal(): AbortSignal`

获取 AbortSignal，用于取消关联的异步操作。

```typescript
const signal = emitter.getSignal();
// 在 fetch 中使用
const response = await fetch('/api/generate', { signal });
```

### 步骤管理

#### `registerSteps(stepNames): void`

预定义所有步骤。**必须在 start() 之前调用**。

```typescript
emitter.registerSteps([
    '情节构思',
    '场景展开',
    '正文生成',
    '连贯性审查',
    '质量润色',
]);
```

| 参数 | 类型 | 说明 |
|-----|------|------|
| `stepNames` | `string[]` | 步骤名称列表 |

#### `nextStep(message?): void`

推进到下一步。标记当前步骤完成，进入下一步并将其设为 running。

```typescript
emitter.nextStep();
emitter.nextStep('开始场景展开');
```

如果已经是最后一步，调用 `nextStep()` 会自动触发 `complete()`。

#### `setStepProgress(stepProgress, message?): void`

设置当前步骤的进度（0-100）。总进度会自动根据步骤进度计算。

```typescript
emitter.setStepProgress(50, '正在构思冲突点...');
```

| 参数 | 类型 | 说明 |
|-----|------|------|
| `stepProgress` | `number` | 步骤内进度 0-100 |
| `message` | `string` | 可选的消息 |

---

## 使用示例

### 示例 1：基本单步进度

```typescript
async function generateChapter(emitter: ProgressEmitter) {
    const signal = emitter.getSignal();
    
    emitter.start();
    emitter.setProgress(0, '开始生成...');
    
    for (let i = 1; i <= 10; i++) {
        if (signal.aborted) break;
        
        await doSomeWork(i);
        emitter.setProgress(i * 10, `正在处理第 ${i} 部分...`);
    }
    
    if (!signal.aborted) {
        emitter.complete();
    }
}

const emitter = new ProgressEmitter('gen-001', '生成章节');
generateChapter(emitter);
```

### 示例 2：多步骤进度

```typescript
async function runPipeline(emitter: ProgressEmitter) {
    emitter.registerSteps([
        '情节构思',
        '场景展开',
        '正文生成',
        '质量润色',
    ]);
    
    emitter.start();
    
    // 步骤 1: 情节构思
    emitter.nextStep('开始构思情节');
    for (let i = 0; i < 10; i++) {
        await构思情节片段(i);
        emitter.setStepProgress((i + 1) * 10);
    }
    
    // 步骤 2: 场景展开
    emitter.nextStep('开始场景展开');
    for (let i = 0; i < 10; i++) {
        await展开场景(i);
        emitter.setStepProgress((i + 1) * 10);
    }
    
    // 步骤 3: 正文生成
    emitter.nextStep('开始生成正文');
    for (let i = 0; i < 10; i++) {
        await生成正文(i);
        emitter.setStepProgress((i + 1) * 10);
    }
    
    // 步骤 4: 质量润色
    emitter.nextStep('开始质量润色');
    for (let i = 0; i < 10; i++) {
        await润色(i);
        emitter.setStepProgress((i + 1) * 10);
    }
    
    // 最后一步完成后自动 complete
    emitter.nextStep();
}
```

### 示例 3：取消支持

```typescript
const emitter = new ProgressEmitter('cancel-demo', '可取消任务');
const signal = emitter.getSignal();

// 异步函数中检查取消
async function longRunningTask() {
    emitter.start();
    
    for (let i = 0; i < 100; i++) {
        if (signal.aborted) {
            console.log('任务被取消');
            return;
        }
        
        await doWork(i);
        emitter.setProgress(i + 1);
    }
    
    emitter.complete();
}

// 用户点击取消按钮
cancelButton.addEventListener('click', () => {
    emitter.cancel();
});

// 启动任务
longRunningTask();
```

### 示例 4：错误处理

```typescript
async function safeTask(emitter: ProgressEmitter) {
    try {
        emitter.start();
        emitter.setProgress(30, '第一步...');
        
        const result = await riskyOperation();
        
        emitter.setProgress(100, '完成');
        emitter.complete();
        return result;
    } catch (error) {
        emitter.fail(error instanceof Error ? error.message : '未知错误');
        throw error;
    }
}
```

---

## 最佳实践

### 1. 始终提供唯一 ID

每个 ProgressEmitter 实例应该有唯一的 ID，便于在多任务场景中区分。

```typescript
// 推荐：使用有意义的前缀 + 唯一标识
const emitter = new ProgressEmitter(`chapter-gen-${projectId}-${chapterId}`, '生成章节');
```

### 2. 尽早注册步骤

如果使用多步骤进度，应该在 `start()` 之前调用 `registerSteps()`。

```typescript
// ✅ 正确
emitter.registerSteps(['步骤1', '步骤2']);
emitter.start();

// ❌ 错误（registerSteps 在非 pending 状态下无效）
emitter.start();
emitter.registerSteps(['步骤1', '步骤2']);
```

### 3. 正确处理取消

- 使用 `getSignal()` 获取 AbortSignal
- 在异步操作中定期检查 `signal.aborted`
- 捕获 `AbortError` 并优雅退出

```typescript
async function fetchWithProgress(url: string, emitter: ProgressEmitter) {
    const signal = emitter.getSignal();
    
    try {
        emitter.start();
        const response = await fetch(url, { signal });
        // ... 处理响应
        emitter.complete();
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            // 取消是正常操作，不需要 fail
            return;
        }
        emitter.fail(error.message);
        throw error;
    }
}
```

### 4. 合理的进度更新频率

ProgressEmitter 内部已经做了节流（10 次/秒），但业务代码仍应避免过于频繁的更新。

```typescript
// ✅ 推荐：每处理一批数据更新一次
for (let i = 0; i < total; i += batchSize) {
    await processBatch(i, Math.min(i + batchSize, total));
    emitter.setProgress(Math.min(100, ((i + batchSize) / total) * 100));
}

// ❌ 不推荐：每条数据都更新一次（不必要的性能开销）
for (let i = 0; i < total; i++) {
    await processItem(i);
    emitter.setProgress(((i + 1) / total) * 100);
}
```

### 5. 订阅后记得清理

组件销毁时记得取消订阅，避免内存泄漏。

```typescript
class MyComponent {
    private emitter: ProgressEmitter;
    private offProgress?: () => void;
    
    constructor() {
        this.emitter = new ProgressEmitter('task-1', '任务');
        this.offProgress = this.emitter.on((state) => {
            this.updateUI(state);
        });
    }
    
    destroy() {
        if (this.offProgress) {
            this.offProgress();
            this.offProgress = undefined;
        }
    }
}
```

### 6. 失败时提供有用的错误信息

```typescript
// ✅ 好的错误信息
emitter.fail('无法连接到 AI 服务：网络超时。请检查网络连接后重试。');

// ❌ 不好的错误信息
emitter.fail('错误');
```

### 7. 使用消息提供上下文

在 `setProgress` 和 `nextStep` 中提供有意义的消息，让用户知道当前在做什么。

```typescript
// ✅ 好的消息
emitter.setProgress(40, '正在分析第 3 章的人物关系...');
emitter.nextStep('开始生成正文内容');

// ❌ 不好的消息
emitter.setProgress(40, '处理中...');
```
