# 新功能接入完整流程

## 目录

- [概述](#概述)
- [接入检查清单](#接入检查清单)
- [最小接入示例（Hello World）](#最小接入示例hello-world)
- [完整接入示例](#完整接入示例)
- [常见问题 FAQ](#常见问题-faq)

---

## 概述

本文档指导你如何将一个新功能接入到全流程进度可视化系统中。我们将从最简单的"Hello World"级别开始，逐步构建完整的功能。

### 接入层级

根据需求复杂度，你可以选择不同的接入层级：

| 层级 | 内容 | 适用场景 |
|-----|------|---------|
| Level 1 | ProgressEmitter + ProgressBar | 简单进度展示 |
| Level 2 | + StepList + 取消支持 | 多步骤操作 |
| Level 3 | + TimeEstimator + OperationConfirmModal | 有预估时间的耗时操作 |
| Level 4 | + WorkerManager | 后台执行任务 |
| Level 5 | + FloatingProgressBall / StatusBarIndicator | 全局多任务管理 |

---

## 接入检查清单

在开始接入之前，先确认以下问题：

### 功能分析

- [ ] **任务类型**：这个操作是 CPU 密集型还是 IO 密集型？
- [ ] **预计耗时**：操作大概需要多长时间？（<1s / 1-10s / 10s+）
- [ ] **是否可取消**：用户是否需要能够中途取消？
- [ ] **步骤数量**：操作可以分解为几个明确的步骤吗？
- [ ] **阻塞程度**：操作期间是否需要阻塞用户交互？

### UI 选择

- [ ] **展示位置**：进度在哪里展示？（嵌入页面 / 弹窗 / 全局）
- [ ] **展示形式**：进度条 / 步骤列表 / 任务卡片 / 悬浮球
- [ ] **是否需要确认**：执行前是否需要用户确认？

### 技术选型

- [ ] **是否需要 Worker**：操作是否会阻塞 UI 线程？
- [ ] **是否需要时间估算**：是否需要显示预估时间？
- [ ] **是否需要持久化历史**：是否需要记录历史耗时用于估算？

---

## 最小接入示例（Hello World）

> **目标**：给一个简单的异步函数添加进度条展示。

### 场景

点击一个按钮，执行一个异步任务，显示进度条。

### 步骤

#### 1. 导入依赖

```typescript
import { ProgressEmitter } from '../../shared/progress-emitter';
import { ProgressBarComponent } from '../../ui/components/progress';
```

#### 2. 创建 UI 容器

```typescript
// 假设有一个按钮和容器
const button = container.createEl('button', { text: '开始任务' });
const progressContainer = container.createDiv();
```

#### 3. 实现任务函数

```typescript
async function doSomeWork(emitter: ProgressEmitter) {
    const signal = emitter.getSignal();
    const totalSteps = 10;
    
    emitter.start();
    
    for (let i = 0; i < totalSteps; i++) {
        if (signal.aborted) return;
        
        // 模拟工作
        await new Promise(resolve => setTimeout(resolve, 200));
        
        emitter.setProgress(
            ((i + 1) / totalSteps) * 100,
            `正在处理第 ${i + 1} 项...`
        );
    }
    
    emitter.complete();
}
```

#### 4. 绑定点击事件

```typescript
button.addEventListener('click', async () => {
    // 创建 ProgressEmitter
    const emitter = new ProgressEmitter(
        `hello-world-${Date.now()}`,
        'Hello World 任务'
    );
    
    // 创建进度条组件
    const bar = new ProgressBarComponent(progressContainer, {
        height: '8px',
        showPercent: true,
        showMessage: true,
    });
    bar.bindEmitter(emitter);
    
    try {
        button.disabled = true;
        await doSomeWork(emitter);
        
        // 完成后延迟销毁
        setTimeout(() => {
            bar.destroy();
        }, 1500);
    } finally {
        button.disabled = false;
    }
});
```

### 完整代码

```typescript
import { ProgressEmitter } from '../../shared/progress-emitter';
import { ProgressBarComponent } from '../../ui/components/progress';

export function initHelloWorld(container: HTMLElement) {
    const button = container.createEl('button', { 
        text: '开始任务',
        cls: 'nw-btn nw-btn-primary'
    });
    const progressContainer = container.createDiv({ 
        attr: { style: 'margin-top: 12px;' }
    });
    
    async function doWork(emitter: ProgressEmitter) {
        const signal = emitter.getSignal();
        emitter.start();
        
        for (let i = 0; i < 10; i++) {
            if (signal.aborted) return;
            await new Promise(r => setTimeout(r, 200));
            emitter.setProgress((i + 1) * 10, `处理中 ${i + 1}/10`);
        }
        
        emitter.complete();
    }
    
    button.addEventListener('click', async () => {
        const emitter = new ProgressEmitter(`hw-${Date.now()}`, '示例任务');
        const bar = new ProgressBarComponent(progressContainer);
        bar.bindEmitter(emitter);
        
        try {
            button.disabled = true;
            await doWork(emitter);
        } finally {
            button.disabled = false;
            setTimeout(() => bar.destroy(), 1500);
        }
    });
}
```

---

## 完整接入示例

> **目标**：实现一个完整的、带步骤、取消、时间估算、Worker 后台执行的功能。

### 场景

实现一个"文档分析"功能：
- 有 4 个步骤：读取 → 解析 → 分析 → 生成报告
- 支持取消
- 显示预估时间
- 使用 Worker 后台执行
- 执行前确认

### 步骤

#### 1. 定义常量和类型

```typescript
// 任务类型
const TASK_TYPE = 'document_analysis';

// 步骤定义
const ANALYSIS_STEPS = [
    '读取文档内容',
    '解析文档结构',
    '分析文本特征',
    '生成分析报告',
];

// 输入类型
interface AnalysisInput {
    documentId: string;
    content: string;
    options: {
        deepAnalysis: boolean;
    };
}

// 输出类型
interface AnalysisResult {
    summary: string;
    keywords: string[];
    wordCount: number;
    sentiment: number;
}
```

#### 2. 实现 Worker 任务处理器

```typescript
// Worker 中执行的任务处理器
async function analysisWorkerHandler(
    input: AnalysisInput,
    context: {
        onProgress: (progress: number, message?: string) => void;
        signal: AbortSignal;
    }
): Promise<AnalysisResult> {
    const { content, options } = input;
    const { onProgress, signal } = context;
    
    const totalSteps = ANALYSIS_STEPS.length;
    let wordCount = 0;
    let keywords: string[] = [];
    let sentiment = 0;
    
    // 步骤 1: 读取文档内容
    onProgress(10 / totalSteps * 100, ANALYSIS_STEPS[0]);
    await new Promise(r => setTimeout(r, 300));
    
    if (signal.aborted) throw new Error('Cancelled');
    
    // 步骤 2: 解析文档结构
    onProgress(20 / totalSteps * 100, ANALYSIS_STEPS[1]);
    await new Promise(r => setTimeout(r, 500));
    wordCount = content.length;
    
    if (signal.aborted) throw new Error('Cancelled');
    
    // 步骤 3: 分析文本特征
    onProgress(30 / totalSteps * 100, ANALYSIS_STEPS[2]);
    await new Promise(r => setTimeout(r, options.deepAnalysis ? 1000 : 500));
    keywords = extractKeywords(content);
    sentiment = analyzeSentiment(content);
    
    if (signal.aborted) throw new Error('Cancelled');
    
    // 步骤 4: 生成分析报告
    onProgress(40 / totalSteps * 100, ANALYSIS_STEPS[3]);
    await new Promise(r => setTimeout(r, 400));
    
    const summary = generateSummary(content, keywords);
    
    onProgress(100, '完成');
    
    return { summary, keywords, wordCount, sentiment };
}

// 辅助函数
function extractKeywords(text: string): string[] {
    return ['关键词1', '关键词2', '关键词3'];
}

function analyzeSentiment(text: string): number {
    return 0.7;
}

function generateSummary(text: string, keywords: string[]): string {
    return `这是一篇关于 ${keywords.join('、')} 的文档。`;
}
```

#### 3. 创建管理器类

```typescript
import { ProgressEmitter } from '../../shared/progress-emitter';
import { TimeEstimator, refineEstimate } from '../../shared/time-estimator';
import { WorkerManager } from '../../services/worker-manager';
import { createWorkerFromHandlers } from '../../services/worker-runtime';
import { 
    OperationConfirmModal,
    LoadingOverlayComponent 
} from '../../ui/components/progress';
import { App } from 'obsidian';

export class DocumentAnalysisManager {
    private app: App;
    private workerManager: WorkerManager;
    private timeEstimator: TimeEstimator;
    private currentTask?: {
        emitter: ProgressEmitter;
        overlay: LoadingOverlayComponent;
        cancel: () => void;
    };
    
    constructor(app: App, timeEstimator: TimeEstimator) {
        this.app = app;
        this.timeEstimator = timeEstimator;
        
        // 创建 Worker
        const worker = createWorkerFromHandlers({
            [TASK_TYPE]: analysisWorkerHandler,
        });
        
        // 创建 WorkerManager
        this.workerManager = new WorkerManager({
            maxWorkers: 1,
            fallbackToMain: true,
        });
        
        // 注册降级处理器
        this.workerManager.registerFallbackHandler(
            TASK_TYPE,
            async (input, onProgress) => {
                const signal = new AbortController().signal;
                return analysisWorkerHandler(input, { 
                    onProgress: onProgress || (() => {}), 
                    signal 
                });
            }
        );
    }
    
    /**
     * 执行文档分析
     */
    async analyze(input: AnalysisInput): Promise<AnalysisResult | null> {
        const wordCount = input.content.length;
        
        // 1. 时间估算
        const estimate = this.timeEstimator.estimate({
            operationType: TASK_TYPE,
            wordCount,
            mode: input.options.deepAnalysis ? 'vector' : 'statistical',
        });
        
        // 2. 确认弹窗
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '文档分析',
            description: `将对 ${wordCount} 字的文档进行深度分析。`,
            etaMin: estimate.etaMin,
            etaMax: estimate.etaMax,
            steps: ANALYSIS_STEPS,
            confirmText: '开始分析',
            rememberKey: 'confirm-doc-analysis',
        });
        
        if (!confirmed) return null;
        
        // 3. 创建 ProgressEmitter
        const emitter = new ProgressEmitter(
            `doc-analysis-${Date.now()}`,
            '文档分析'
        );
        emitter.registerSteps(ANALYSIS_STEPS);
        
        // 4. 创建加载遮罩
        const overlay = new LoadingOverlayComponent(
            this.app.workspace.containerEl,
            {
                title: '文档分析中...',
                showCancel: true,
                showSteps: true,
            }
        );
        overlay.bindEmitter(emitter);
        overlay.onCancel(() => emitter.cancel());
        overlay.show();
        
        const startTime = Date.now();
        
        try {
            // 5. 执行任务
            const task = this.workerManager.executeTask(
                TASK_TYPE,
                input,
                (progress, message) => {
                    emitter.setProgress(progress, message);
                    
                    // 实时修正估算
                    const elapsed = Date.now() - startTime;
                    const refined = refineEstimate(estimate, elapsed, progress);
                    // 可以把 refined 显示到 UI 上
                }
            );
            
            this.currentTask = {
                emitter,
                overlay,
                cancel: () => task.cancel(),
            };
            
            emitter.start();
            emitter.nextStep(ANALYSIS_STEPS[0]);
            
            const result = await task;
            
            emitter.complete();
            
            // 6. 记录实际耗时
            const duration = Date.now() - startTime;
            this.timeEstimator.record({
                operationType: TASK_TYPE,
                wordCount,
                mode: input.options.deepAnalysis ? 'vector' : 'statistical',
                duration,
            });
            await this.timeEstimator.saveHistory();
            
            // 延迟关闭
            await new Promise(r => setTimeout(r, 1000));
            
            return result;
            
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            
            if (message.includes('cancelled') || message.includes('abort')) {
                emitter.cancel();
                return null;
            }
            
            emitter.fail(message);
            throw error;
            
        } finally {
            setTimeout(() => {
                overlay.hide();
                overlay.destroy();
                this.currentTask = undefined;
            }, 1500);
        }
    }
    
    /**
     * 取消当前任务
     */
    cancelCurrent(): void {
        this.currentTask?.cancel();
    }
    
    /**
     * 销毁
     */
    destroy(): void {
        this.workerManager.destroy();
    }
}
```

#### 4. 使用示例

```typescript
// 在插件中初始化
async function init(app: App) {
    const timeEstimator = new TimeEstimator();
    await timeEstimator.loadHistory();
    
    const analysisManager = new DocumentAnalysisManager(app, timeEstimator);
    
    // 绑定按钮点击
    analyzeButton.addEventListener('click', async () => {
        const result = await analysisManager.analyze({
            documentId: 'doc-001',
            content: '这是文档内容...',
            options: {
                deepAnalysis: true,
            },
        });
        
        if (result) {
            console.log('分析结果:', result);
        }
    });
}
```

---

## 常见问题 FAQ

### Q1: 进度更新太频繁会影响性能吗？

**A**: 不会。ProgressEmitter 内部做了节流处理，进度更新最多 10 次/秒。但业务代码仍建议避免过于频繁的调用，减少不必要的计算。

### Q2: Worker 中可以使用 Obsidian API 吗？

**A**: 不可以。Worker 无法访问 Obsidian API 和 DOM。如果需要这些 API，需要在主线程的降级处理器中实现，或者把数据传到 Worker 中处理。

### Q3: 如何处理任务失败后的重试？

**A**: 可以在 fail 状态后重新创建一个新的 ProgressEmitter 并重新执行。示例：

```typescript
card.onCancel(() => {
    // 失败时 onCancel 显示的是重试按钮
    if (emitter.getState().status === 'failed') {
        retryTask();
    } else {
        emitter.cancel();
    }
});
```

### Q4: 多个任务同时运行时怎么管理？

**A**: 使用 `FloatingProgressBall` 或 `StatusBarProgressIndicator` 组件，它们可以管理多个 ProgressEmitter。

```typescript
const ball = new FloatingProgressBall(app);
ball.bindEmitter(task1Emitter);
ball.bindEmitter(task2Emitter);
ball.show();
```

### Q5: 时间估算不准怎么办？

**A**: 
1. 多运行几次，历史数据越多估算越准
2. 检查 `operationType` 是否区分了不同模式
3. 如果发现异常数据，可以清除历史重新积累

```typescript
// 清除指定类型的历史
estimator.clearHistory('my_operation');
```

### Q6: 组件销毁时需要做什么？

**A**: 调用组件的 `destroy()` 方法，避免内存泄漏。

```typescript
// 组件卸载时
onunload() {
    if (this.progressBar) {
        this.progressBar.destroy();
        this.progressBar = undefined;
    }
    if (this.emitter) {
        // 如果任务还在运行，取消它
        if (this.emitter.getState().status === 'running') {
            this.emitter.cancel();
        }
    }
}
```

### Q7: 如何实现暂停/继续功能？

**A**: ProgressEmitter 提供了 `pause()` 和 `start()` 方法（start 可以从暂停状态恢复）。

```typescript
// 暂停
emitter.pause();

// 继续
emitter.start();
```

注意：暂停只是状态上的暂停，实际的异步操作需要你自己实现暂停逻辑。

### Q8: Worker 和主线程之间怎么传递大数据？

**A**: 
- 文本数据：直接传（但注意几 MB 以上会有明显延迟）
- 二进制数据：使用 ArrayBuffer / Transferable Objects
- 超大文件：考虑使用 IndexedDB 共享

### Q9: 如何在不同页面/视图之间共享任务状态？

**A**: 
1. 将 ProgressEmitter 实例保存在全局可访问的地方（如插件实例上）
2. 使用 FloatingProgressBall 或 StatusBarProgressIndicator 全局展示
3. 不同视图绑定同一个 ProgressEmitter

```typescript
// plugin.ts
class MyPlugin {
    public tasks: Map<string, ProgressEmitter> = new Map();
}

// 在视图中
const emitter = plugin.tasks.get('task-id');
if (emitter) {
    card.bindEmitter(emitter);
}
```

### Q10: 如何测试降级逻辑？

**A**: 可以创建一个 maxWorkers 为 0 的 WorkerManager，强制使用降级模式：

```typescript
const manager = new WorkerManager({
    maxWorkers: 0,
    fallbackToMain: true,
});
```

或者直接调用降级处理器进行测试。
