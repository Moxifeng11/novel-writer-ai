# 现有功能迁移指南

## 目录

- [概述](#概述)
- [为什么要迁移](#为什么要迁移)
- [迁移前的准备](#迁移前的准备)
- [迁移步骤](#迁移步骤)
- [渐进式迁移策略](#渐进式迁移策略)
- [常见迁移场景](#常见迁移场景)
- [迁移验证清单](#迁移验证清单)

---

## 概述

本文档指导你如何将现有的"黑盒"操作改造为支持进度可视化的功能。迁移过程可以渐进式进行，不需要一次性完成所有改造。

### 什么是"黑盒"操作？

典型的黑盒操作特征：
- 点击按钮后，界面卡住或只显示"加载中..."
- 用户不知道当前在做什么
- 用户不知道还要等多久
- 用户无法中途取消
- 失败时只显示一个模糊的错误提示

---

## 为什么要迁移

### 用户体验提升

| 改造前 | 改造后 |
|-------|-------|
| 点击后界面无响应 | 实时显示进度 |
| "加载中..." | "正在分析第 3 章人物关系..." |
| 不知道要等多久 | "预计还需 2 分 30 秒" |
| 无法取消 | 随时可以取消 |
| 失败只显示"出错了" | 显示具体错误原因 |

### 代码质量提升

- ✅ 统一的状态管理，减少重复代码
- ✅ 更好的错误处理
- ✅ 更容易测试和调试
- ✅ 支持后台执行，不阻塞 UI
- ✅ 积累历史数据，持续优化体验

---

## 迁移前的准备

### 1. 分析现有代码

在开始迁移之前，先回答以下问题：

#### 功能分析

- [ ] 这个操作做了哪些事情？
- [ ] 可以分解为几个步骤？
- [ ] 每一步大概需要多长时间？
- [ ] 操作可以中途取消吗？
- [ ] 失败的可能原因有哪些？

#### 代码结构

- [ ] 核心逻辑在哪个函数/类中？
- [ ] 有没有循环或批量处理？
- [ ] 数据从哪里来，到哪里去？
- [ ] 有没有使用 async/await？

### 2. 选择迁移目标层级

根据实际情况选择合适的迁移深度：

| 层级 | 改动量 | 收益 | 适用场景 |
|-----|-------|------|---------|
| L1: 基本进度 | 小 | 中 | 快速改造，先跑通 |
| L2: 多步骤 | 中 | 高 | 有明确步骤的操作 |
| L3: +取消支持 | 中 | 高 | 耗时操作 |
| L4: +时间估算 | 中 | 高 | 用户关心耗时的操作 |
| L5: +Worker | 大 | 很高 | 阻塞 UI 的操作 |

---

## 迁移步骤

### 第一步：识别进度点

在现有代码中找到可以报告进度的地方。

**示例：改造前**

```typescript
async function processBooks(books: Book[]) {
    const results = [];
    
    for (const book of books) {
        // 处理每本书
        const result = await processOneBook(book);
        results.push(result);
    }
    
    return results;
}
```

**识别进度点：**
- 循环的每次迭代就是一个进度点
- 总共 `books.length` 步
- 每完成一本书进度加 1

### 第二步：引入 ProgressEmitter

**改造后：**

```typescript
import { ProgressEmitter } from '../../shared/progress-emitter';

async function processBooks(
    books: Book[],
    emitter?: ProgressEmitter
) {
    const results = [];
    const total = books.length;
    
    if (emitter) {
        emitter.start();
    }
    
    for (let i = 0; i < total; i++) {
        // 检查取消
        if (emitter?.getSignal().aborted) {
            break;
        }
        
        // 处理每本书
        const result = await processOneBook(books[i]);
        results.push(result);
        
        // 报告进度
        if (emitter) {
            emitter.setProgress(
                ((i + 1) / total) * 100,
                `正在处理 ${books[i].title} (${i + 1}/${total})`
            );
        }
    }
    
    if (emitter) {
        if (emitter.getSignal().aborted) {
            emitter.cancel();
        } else {
            emitter.complete();
        }
    }
    
    return results;
}
```

> **提示**：使用可选参数 `emitter?`，调用方可以选择是否传入。这样可以保持向后兼容。

### 第三步：添加 UI 展示

在调用的地方添加进度 UI。

**改造前：**

```typescript
button.addEventListener('click', async () => {
    button.disabled = true;
    try {
        await processBooks(books);
        showNotice('处理完成');
    } finally {
        button.disabled = false;
    }
});
```

**改造后：**

```typescript
import { ProgressBarComponent } from '../../ui/components/progress';

button.addEventListener('click', async () => {
    const emitter = new ProgressEmitter(
        `process-${Date.now()}`,
        '批量处理书籍'
    );
    
    const bar = new ProgressBarComponent(progressContainer);
    bar.bindEmitter(emitter);
    
    button.disabled = true;
    
    try {
        await processBooks(books, emitter);
    } finally {
        button.disabled = false;
        setTimeout(() => bar.destroy(), 1500);
    }
});
```

### 第四步：分解步骤（可选）

如果操作有明确的阶段，可以分解为步骤。

**改造前：**

```typescript
async function analyzeDocument(doc: Document) {
    const text = await readDocument(doc);
    const structure = await parseStructure(text);
    const features = await extractFeatures(structure);
    const report = await generateReport(features);
    return report;
}
```

**改造后：**

```typescript
async function analyzeDocument(
    doc: Document,
    emitter?: ProgressEmitter
) {
    if (emitter) {
        emitter.registerSteps([
            '读取文档',
            '解析结构',
            '提取特征',
            '生成报告',
        ]);
        emitter.start();
    }
    
    // 步骤 1
    emitter?.nextStep('读取文档');
    const text = await readDocument(doc);
    emitter?.setStepProgress(100);
    
    // 步骤 2
    emitter?.nextStep('解析结构');
    const structure = await parseStructure(text);
    emitter?.setStepProgress(100);
    
    // 步骤 3
    emitter?.nextStep('提取特征');
    const features = await extractFeatures(structure);
    emitter?.setStepProgress(100);
    
    // 步骤 4
    emitter?.nextStep('生成报告');
    const report = await generateReport(features);
    emitter?.setStepProgress(100);
    
    // 完成
    emitter?.nextStep(); // 最后一步自动 complete
    
    return report;
}
```

### 第五步：添加取消支持（可选）

确保操作可以被中途取消。

**关键点：**
- 在循环中检查 `signal.aborted`
- 将 `signal` 传给支持取消的 API（如 fetch）
- 取消后清理资源
- 正确处理取消状态

```typescript
async function processWithCancel(emitter: ProgressEmitter) {
    const signal = emitter.getSignal();
    
    try {
        // 将 signal 传给 fetch
        const response = await fetch('/api/data', { signal });
        
        // 在循环中检查
        for (const item of items) {
            if (signal.aborted) break;
            await processItem(item);
        }
        
        emitter.complete();
    } catch (error) {
        if (error.name === 'AbortError') {
            // 正常取消，不需要报错
            return;
        }
        emitter.fail(error.message);
        throw error;
    }
}
```

### 第六步：添加工人执行（可选）

如果操作会阻塞 UI，迁移到 Worker 中执行。

详见 [web-worker.md](./web-worker.md)

---

## 渐进式迁移策略

### 阶段一：最小可用（1-2 小时）

**目标**：快速看到效果，验证方向

- [ ] 引入 ProgressEmitter
- [ ] 在关键循环中添加 `setProgress()`
- [ ] 添加一个简单的 ProgressBarComponent
- [ ] 测试基本功能

### 阶段二：用户体验完善（2-4 小时）

**目标**：提供良好的用户体验

- [ ] 分解步骤（如果适用）
- [ ] 添加取消支持
- [ ] 使用 LoadingOverlay 或 TaskCard
- [ ] 完善错误处理和提示
- [ ] 添加完成/失败的视觉反馈

### 阶段三：高级特性（4-8 小时）

**目标**：专业级体验

- [ ] 添加 TimeEstimator 时间估算
- [ ] 添加 OperationConfirmModal 确认弹窗
- [ ] 迁移到 Worker 后台执行
- [ ] 接入全局进度管理（状态栏/悬浮球）
- [ ] 边界情况处理（网络错误、超时等）

### 阶段四：优化迭代（持续）

**目标**：持续优化

- [ ] 收集用户反馈
- [ ] 优化进度估算准确度
- [ ] 调整步骤粒度
- [ ] 添加更多错误提示

---

## 常见迁移场景

### 场景 1：批量处理循环

**特征**：for/while 循环处理大量数据

**迁移要点：**
- 每次循环迭代更新一次进度
- 在循环开始前检查 `signal.aborted`
- 进度消息显示当前处理项和总数

```typescript
// 改造前
for (const item of items) {
    await processItem(item);
}

// 改造后
for (let i = 0; i < items.length; i++) {
    if (emitter?.getSignal().aborted) break;
    await processItem(items[i]);
    emitter?.setProgress(
        ((i + 1) / items.length) * 100,
        `处理中 ${i + 1}/${items.length}`
    );
}
```

### 场景 2：多阶段流水线

**特征**：几个大的处理阶段依次执行

**迁移要点：**
- 使用 `registerSteps()` 注册阶段
- 每个阶段开始时调用 `nextStep()`
- 阶段内可以用 `setStepProgress()` 显示细粒度进度

```typescript
// 改造前
await step1();
await step2();
await step3();

// 改造后
emitter.registerSteps(['阶段一', '阶段二', '阶段三']);
emitter.start();

emitter.nextStep('阶段一');
await step1WithProgress(emitter);

emitter.nextStep('阶段二');
await step2WithProgress(emitter);

emitter.nextStep('阶段三');
await step3WithProgress(emitter);

emitter.nextStep(); // 自动 complete
```

### 场景 3：单一大任务

**特征**：一个不可拆分的长时间异步操作

**迁移要点：**
- 如果是 API 调用，传 `signal` 支持取消
- 显示"正在处理..."和转圈动画
- 添加超时处理
- 失败时显示具体错误

```typescript
// 改造前
const result = await apiCall(data);

// 改造后
const signal = emitter.getSignal();
emitter.start();
emitter.setProgress(0, '正在处理，请稍候...');

try {
    const result = await apiCall(data, { signal });
    emitter.setProgress(100, '完成');
    emitter.complete();
    return result;
} catch (error) {
    if (error.name === 'AbortError') {
        return;
    }
    emitter.fail(error.message);
    throw error;
}
```

### 场景 4：递归/树遍历

**特征**：递归处理树形结构

**迁移要点：**
- 先统计总节点数
- 使用计数器跟踪已处理数量
- 每次处理完一个节点更新进度

```typescript
// 改造前
function traverse(node) {
    process(node);
    for (const child of node.children) {
        traverse(child);
    }
}

// 改造后
let processed = 0;
const total = countNodes(root);

function traverse(node, emitter) {
    if (emitter?.getSignal().aborted) return;
    
    process(node);
    processed++;
    emitter?.setProgress((processed / total) * 100);
    
    for (const child of node.children) {
        traverse(child, emitter);
    }
}
```

---

## 迁移验证清单

迁移完成后，检查以下项目：

### 功能验证

- [ ] 任务正常完成，进度显示正确
- [ ] 进度从 0% 到 100% 平滑过渡
- [ ] 进度消息有意义，能反映当前操作
- [ ] 完成状态显示正确

### 取消验证

- [ ] 点击取消按钮可以取消任务
- [ ] 取消后任务真正停止执行
- [ ] 取消状态显示正确
- [ ] 取消后资源正确清理

### 错误处理

- [ ] 网络错误时有友好提示
- [ ] 错误信息具体可理解
- [ ] 失败状态显示正确
- [ ] 失败后可以重试（如果适用）

### 边界情况

- [ ] 空数据/零进度时显示正常
- [ ] 快速完成的任务（<1s）不会闪烁
- [ ] 多个任务同时运行时互不干扰
- [ ] 页面切换/组件销毁时正确清理

### 性能

- [ ] 进度更新不影响操作性能
- [ ] UI 保持流畅
- [ ] 没有内存泄漏

### 用户体验

- [ ] 用户知道当前在做什么
- [ ] 用户知道大概还要等多久
- [ ] 用户可以随时取消
- [ ] 完成/失败有明确的视觉反馈

---

## 迁移前后对比示例

### 示例：知识库批量拆解

#### 改造前

```typescript
async function deconstructBooks(books: Book[]) {
    for (const book of books) {
        await deconstructOneBook(book);
    }
}

// 调用
button.addEventListener('click', async () => {
    button.setText('拆解中...');
    button.disabled = true;
    
    try {
        await deconstructBooks(selectedBooks);
        new Notice('拆解完成');
    } catch (e) {
        new Notice('拆解失败');
    } finally {
        button.setText('开始拆解');
        button.disabled = false;
    }
});
```

#### 改造后

```typescript
import { ProgressEmitter } from '../../shared/progress-emitter';
import { 
    LoadingOverlayComponent,
    OperationConfirmModal 
} from '../../ui/components/progress';

async function deconstructBooks(
    books: Book[],
    emitter?: ProgressEmitter
) {
    const total = books.length;
    const signal = emitter?.getSignal();
    
    emitter?.registerSteps([
        '读取书籍内容',
        '分析文笔风格',
        '提取情节结构',
        '生成结构化数据',
    ]);
    
    emitter?.start();
    
    for (let i = 0; i < total; i++) {
        if (signal?.aborted) break;
        
        const book = books[i];
        
        emitter?.nextStep(`拆解《${book.title}》`);
        
        // 步骤 1: 读取
        emitter?.setStepProgress(25, '读取书籍内容');
        const text = await readBook(book);
        
        // 步骤 2: 风格分析
        emitter?.setStepProgress(50, '分析文笔风格');
        const style = await analyzeStyle(text);
        
        // 步骤 3: 情节分析
        emitter?.setStepProgress(75, '提取情节结构');
        const plot = await analyzePlot(text);
        
        // 步骤 4: 生成结果
        emitter?.setStepProgress(100, '生成结构化数据');
        await saveResult(book, style, plot);
    }
    
    if (signal?.aborted) {
        emitter?.cancel();
    } else {
        emitter?.complete();
    }
}

// 调用
button.addEventListener('click', async () => {
    const confirmed = await OperationConfirmModal.confirm(app, {
        title: '批量拆解',
        description: `将拆解 ${selectedBooks.length} 本书籍`,
        steps: ['读取内容', '风格分析', '情节分析', '生成数据'],
        rememberKey: 'confirm-batch-deconstruct',
    });
    
    if (!confirmed) return;
    
    const emitter = new ProgressEmitter(
        `batch-deconstruct-${Date.now()}`,
        '批量拆解书籍'
    );
    
    const overlay = new LoadingOverlayComponent(
        app.workspace.containerEl,
        { showCancel: true, showSteps: true }
    );
    overlay.bindEmitter(emitter);
    overlay.onCancel(() => emitter.cancel());
    overlay.show();
    
    try {
        await deconstructBooks(selectedBooks, emitter);
    } catch (e) {
        emitter.fail(e.message);
    } finally {
        setTimeout(() => {
            overlay.hide();
            overlay.destroy();
        }, 1500);
    }
});
```
