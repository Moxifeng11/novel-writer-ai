# Web Worker 接入指南

## 目录

- [概述](#概述)
- [什么时候需要 Worker](#什么时候需要-worker)
- [核心概念](#核心概念)
- [WorkerManager 基本用法](#workermanager-基本用法)
- [如何创建新的 Worker 任务](#如何创建新的-worker-任务)
- [降级策略](#降级策略)
- [调试技巧](#调试技巧)
- [注意事项和限制](#注意事项和限制)
- [最佳实践](#最佳实践)

---

## 概述

Web Worker 系统提供了完整的后台任务执行能力，支持 Worker 池化、任务队列、进度通知和自动降级。

### 主要特性

- ✅ **Worker 池化**：复用 Worker 实例，避免频繁创建销毁开销
- ✅ **任务队列**：自动排队，控制并发数
- ✅ **进度通知**：Worker 可向主线程发送进度更新
- ✅ **自动降级**：Worker 不可用时自动回退到主线程执行
- ✅ **取消支持**：支持 AbortController 取消任务
- ✅ **内联 Worker**：Blob URL 方式，无需额外构建配置

---

## 什么时候需要 Worker

### 推荐使用 Worker 的场景

| 场景 | 原因 |
|-----|------|
| 大量数据计算 | 避免阻塞 UI 线程 |
| 文本分析/拆解 | CPU 密集型操作 |
| 批量处理任务 | 可以在后台慢慢跑 |
| 长时间运行的任务 | 用户需要同时做其他事 |

### 不推荐使用 Worker 的场景

| 场景 | 原因 |
|-----|------|
| 简单的 DOM 操作 | Worker 无法访问 DOM |
| 快速完成的小任务 | 创建通信开销大于收益 |
| 需要频繁访问主线程状态 | 消息传递有成本 |
| 需要使用 Obsidian API | Worker 中不可用 |

---

## 核心概念

### 架构图

```
┌─────────────────────────────────────────────┐
│                 主线程                        │
│  ┌──────────────┐     ┌────────────────┐   │
│  │ WorkerManager │────▶│ 任务队列        │   │
│  └──────────────┘     └────────────────┘   │
│         │                                   │
│         ▼                                   │
│  ┌──────────────┐                           │
│  │ Worker 池    │  Worker1  Worker2  ...    │
│  └──────────────┘                           │
└─────────┬──────────────┬────────────────────┘
          │              │
    postMessage    postMessage
          │              │
┌─────────▼─────┐  ┌─────▼──────────┐
│   Worker 1    │  │   Worker 2     │
│  (运行时框架)  │  │  (运行时框架)   │
│  - 任务处理    │  │  - 任务处理     │
│  - 进度通知    │  │  - 进度通知     │
└───────────────┘  └────────────────┘
```

### 消息协议

主线程与 Worker 之间通过结构化消息通信：

**主线程 → Worker：**
- `task:start`：开始任务
- `task:cancel`：取消任务

**Worker → 主线程：**
- `worker:ready`：Worker 就绪
- `task:progress`：任务进度更新
- `task:complete`：任务完成
- `task:error`：任务出错
- `worker:error`：Worker 运行时错误

---

## WorkerManager 基本用法

### 创建 WorkerManager

```typescript
import { WorkerManager } from './services/worker-manager';

const manager = new WorkerManager({
    maxWorkers: 2,           // 最大 Worker 数量
    fallbackToMain: true,   // Worker 不可用时是否降级到主线程
});
```

### 配置选项

```typescript
interface WorkerManagerOptions {
    workerUrl?: string;     // 外部 Worker 脚本 URL（可选）
    maxWorkers?: number;    // 最大并发 Worker 数，默认 2
    fallbackToMain?: boolean; // 是否自动降级，默认 true
}
```

### 执行任务

```typescript
// 注册降级处理器（主线程执行的版本）
manager.registerFallbackHandler('my-task', async (input, onProgress) => {
    // 主线程中执行的任务逻辑
    for (let i = 0; i < 100; i++) {
        await doWork(i);
        onProgress?.(i + 1, `处理第 ${i + 1} 项`);
    }
    return result;
});

// 执行任务
const task = manager.executeTask(
    'my-task',           // 任务类型
    { data: '...' },     // 输入数据
    (progress, message) => {  // 进度回调
        console.log(`进度: ${progress}% - ${message}`);
    }
);

// 任务是 Promise，可以 await
try {
    const result = await task;
    console.log('结果:', result);
} catch (error) {
    console.error('错误:', error);
}

// 也可以取消任务
task.cancel();
```

### 其他方法

```typescript
// 检查 Worker 是否可用
if (manager.isWorkerAvailable()) {
    console.log('Worker 可用');
}

// 获取池状态
const stats = manager.getStats();
console.log(`总 Worker: ${stats.totalWorkers}`);
console.log(`运行中: ${stats.activeWorkers}`);
console.log(`空闲: ${stats.idleWorkers}`);
console.log(`排队中: ${stats.queuedTasks}`);

// 取消所有任务
manager.cancelAll();

// 销毁 Manager
manager.destroy();
```

---

## 如何创建新的 Worker 任务

### 方式一：使用内联 Worker（推荐）

最简单的方式，无需额外文件。

#### 步骤 1：定义任务类型常量

```typescript
// 定义任务类型
const TASK_TYPE = 'my_custom_task';
```

#### 步骤 2：实现 Worker 任务处理函数

```typescript
// 这个函数会在 Worker 中执行
// 注意：不能引用外部变量，必须是纯函数
async function myTaskHandler(input: any, context: {
    onProgress: (progress: number, message?: string) => void;
    signal: AbortSignal;
}) {
    const { count } = input;
    let result = 0;
    
    for (let i = 0; i < count; i++) {
        // 检查是否被取消
        if (context.signal.aborted) {
            throw new Error('Task cancelled');
        }
        
        // 执行计算
        result += computeSomething(i);
        
        // 报告进度
        if (i % 10 === 0) {
            context.onProgress(
                ((i + 1) / count) * 100,
                `处理第 ${i + 1} 项`
            );
        }
    }
    
    return { result };
}
```

#### 步骤 3：注册并执行

```typescript
import { createWorkerFromHandlers } from './services/worker-runtime';
import { WorkerManager } from './services/worker-manager';

// 使用自定义 handler 创建 Worker
const worker = createWorkerFromHandlers({
    [TASK_TYPE]: myTaskHandler,
});

// 创建 WorkerManager（使用自定义 Worker）
const manager = new WorkerManager({
    maxWorkers: 2,
    fallbackToMain: true,
});

// 注册降级处理器
manager.registerFallbackHandler(TASK_TYPE, async (input, onProgress) => {
    // 主线程降级版本（逻辑相同）
    const signal = new AbortController().signal;
    return myTaskHandler(input, { onProgress: onProgress || (() => {}), signal });
});

// 执行任务
const result = await manager.executeTask(
    TASK_TYPE,
    { count: 1000 },
    (progress, message) => console.log(progress, message)
);
```

### 方式二：独立 Worker 脚本

适合复杂的 Worker 逻辑。

#### worker.ts（Worker 脚本）

```typescript
import { registerTaskHandler, startWorkerRuntime } from './services/worker-runtime';

// 注册任务处理器
registerTaskHandler('my-task', async (input, context) => {
    const { onProgress, signal } = context;
    
    onProgress(0, '开始处理');
    
    // ... 任务逻辑 ...
    
    onProgress(100, '完成');
    return { success: true };
});

// 启动 Worker 运行时
startWorkerRuntime();
```

#### 主线程中使用

```typescript
const manager = new WorkerManager({
    workerUrl: 'path/to/worker.js',
    maxWorkers: 2,
});

const result = await manager.executeTask('my-task', inputData);
```

---

## 降级策略

### 自动降级触发条件

WorkerManager 在以下情况下会自动降级到主线程执行：

1. **环境不支持 Worker**：浏览器/环境中没有 `Worker` API
2. **Worker 创建失败**：初始化检测时 Worker 无法创建
3. **Worker 运行时错误**：Worker 崩溃且错误被认为是可恢复的
4. **Worker 超时**：Worker 初始化超过 5 秒

### 降级判断逻辑

```typescript
// 可恢复错误（触发降级）
- 内存不足
- 安全限制
- 初始化失败

// 不可恢复错误（直接报错）
- 网络错误
- API 调用失败
- 超时
```

### 注册降级处理器

每个任务类型都应该注册对应的降级处理器：

```typescript
manager.registerFallbackHandler('my-task', async (input, onProgress) => {
    // 主线程中执行的版本
    // 逻辑与 Worker 中的 handler 基本一致
    // 但可以使用主线程的 API
    const result = await doTheWork(input, onProgress);
    return result;
});
```

> **注意**：如果没有注册降级处理器且 Worker 不可用，任务会直接失败。

### 检查 Worker 可用性

```typescript
if (manager.isWorkerAvailable()) {
    console.log('使用 Worker 加速');
} else {
    console.log('使用主线程降级模式');
}
```

---

## 调试技巧

### 1. 查看池状态

```typescript
setInterval(() => {
    const stats = manager.getStats();
    console.log('Worker 池状态:', {
        total: stats.totalWorkers,
        active: stats.activeWorkers,
        idle: stats.idleWorkers,
        queued: stats.queuedTasks,
    });
}, 1000);
```

### 2. 强制使用降级模式

测试降级逻辑时可以禁用 Worker：

```typescript
const manager = new WorkerManager({
    maxWorkers: 0,  // 或者
    fallbackToMain: true,
});
```

### 3. Chrome DevTools 调试 Worker

1. 打开 Chrome DevTools
2. 进入 **Sources** 标签
3. 左侧找到 **Workers** 面板
4. 点击对应的 Worker 脚本
5. 可以像普通 JS 一样打断点调试

### 4. 添加日志

在任务处理器中添加日志：

```typescript
registerTaskHandler('my-task', async (input, context) => {
    console.log('[Worker] 任务开始:', input);
    
    try {
        const result = await doWork(input, context);
        console.log('[Worker] 任务完成:', result);
        return result;
    } catch (error) {
        console.error('[Worker] 任务出错:', error);
        throw error;
    }
});
```

---

## 注意事项和限制

### 1. 数据序列化

**所有在主线程和 Worker 之间传递的数据都必须是可序列化的**（结构化克隆算法支持的类型）。

✅ **可以传递：**
- 基本类型（string, number, boolean, null, undefined）
- 对象和数组
- Date, RegExp, Map, Set
- ArrayBuffer, TypedArray
- Blob, File

❌ **不能传递：**
- 函数
- DOM 节点
- 类实例（会丢失方法）
- 循环引用的对象
- Obsidian API 对象

### 2. Worker 中不可用的 API

Worker 是独立的线程，无法访问：
- `window` 对象
- DOM API
- `document`
- 大部分 Obsidian API
- 插件的主线程状态

✅ **Worker 中可用：**
- `self`（全局作用域）
- `setTimeout` / `setInterval`
- `fetch` / `XMLHttpRequest`
- `IndexedDB` / `localStorage`（有限制）
- `WebAssembly`
- 纯计算逻辑

### 3. 消息传递开销

消息传递不是免费的，大数据传递会有明显开销。

**优化建议：**
- 传递必要的最小数据
- 大文本可以考虑只传 ID，Worker 自己去取
- 进度更新不要太频繁（ProgressEmitter 已做节流）

### 4. Worker 数量

- 默认最大 2 个 Worker
- 不是越多越好，过多 Worker 会增加调度开销
- CPU 密集型任务：建议 = 核心数
- IO 密集型任务：可以适当多一些

### 5. 错误处理

Worker 中的错误不会自动冒泡到主线程，需要显式处理：

```typescript
try {
    const result = await manager.executeTask('my-task', input);
} catch (error) {
    // 处理错误
    console.error('任务失败:', error.message);
}
```

---

## 最佳实践

### 1. 始终提供降级实现

```typescript
// ✅ 好的做法
manager.registerFallbackHandler('my-task', async (input, onProgress) => {
    return mainThreadImplementation(input, onProgress);
});

// ❌ 不好的做法
// 没有降级，Worker 不可用时直接报错
```

### 2. 任务粒度适中

任务太小：创建通信开销大于收益
任务太大：用户等待太久，取消不及时

**建议：** 单个任务在 100ms ~ 30s 之间比较合适。

### 3. 支持取消

在任务处理函数中定期检查 `signal.aborted`：

```typescript
async function taskHandler(input, context) {
    const { signal } = context;
    
    for (let i = 0; i < 1000; i++) {
        if (signal.aborted) {
            throw new Error('Task cancelled');
        }
        // ... 处理第 i 项 ...
    }
}
```

### 4. 合理报告进度

- 进度更新不要太频繁（每秒几次就够了）
- 提供有意义的进度消息
- 使用 ProgressEmitter 的节流特性

### 5. 单例模式

WorkerManager 应该在应用中保持单例：

```typescript
// worker-manager-instance.ts
import { WorkerManager } from './worker-manager';

let workerManager: WorkerManager | null = null;

export function getWorkerManager(): WorkerManager {
    if (!workerManager) {
        workerManager = new WorkerManager({
            maxWorkers: 2,
            fallbackToMain: true,
        });
    }
    return workerManager;
}
```

### 6. 清理资源

不需要时记得销毁：

```typescript
// 插件卸载时
app.workspace.on('unload', () => {
    if (workerManager) {
        workerManager.destroy();
        workerManager = null;
    }
});
```

### 7. 错误分类处理

```typescript
try {
    const result = await manager.executeTask('my-task', input);
} catch (error) {
    const message = error.message || '';
    
    if (message.includes('cancelled') || message.includes('abort')) {
        // 用户取消，正常情况
        return;
    }
    
    if (message.includes('network') || message.includes('fetch')) {
        // 网络错误
        showError('网络连接失败，请检查网络设置');
        return;
    }
    
    // 其他错误
    console.error('任务失败:', error);
    showError('操作失败：' + message);
}
```
