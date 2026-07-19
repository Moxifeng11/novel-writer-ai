# UI 组件使用指南

## 目录

- [概述](#概述)
- [组件选型指南](#组件选型指南)
- [基础组件](#基础组件)
- [容器组件](#容器组件)
- [全局组件](#全局组件)
- [辅助组件](#辅助组件)
- [组合使用模式](#组合使用模式)
- [最佳实践](#最佳实践)

---

## 概述

进度可视化系统提供了 7 个 UI 组件，覆盖从简单进度条到完整任务管理的各种场景。所有组件都支持与 `ProgressEmitter` 绑定，实现自动更新。

### 组件分类

| 分类 | 组件 | 适用场景 |
|-----|------|---------|
| 基础组件 | `ProgressBarComponent` | 简单的水平进度条展示 |
| | `StepListComponent` | 多步骤进度展示 |
| 容器组件 | `LoadingOverlayComponent` | 全屏/容器内的加载遮罩 |
| | `TaskCardComponent` | 单个任务的完整信息卡片 |
| 全局组件 | `FloatingProgressBall` | 悬浮球 + 多任务面板 |
| | `StatusBarProgressIndicator` | 状态栏轻量指示器 |
| 辅助组件 | `OperationConfirmModal` | 操作前确认弹窗 |

---

## 组件选型指南

### 什么时候用哪个组件？

```
需要展示进度吗？
├── 是
│   ├── 只有一个简单任务？
│   │   ├── 嵌入页面内容 → ProgressBarComponent
│   │   ├── 阻塞用户操作 → LoadingOverlayComponent
│   │   └── 展示完整信息 → TaskCardComponent
│   │
│   ├── 有多个步骤？
│   │   ├── 只展示步骤 → StepListComponent
│   │   └── 步骤 + 遮罩 → LoadingOverlayComponent (showSteps: true)
│   │
│   └── 多个并行任务？
│       ├── 全局可见 → StatusBarProgressIndicator
│       └── 可交互管理 → FloatingProgressBall
│
└── 执行前需要确认？
    └── OperationConfirmModal
```

### 选择矩阵

| 场景 | 推荐组件 | 说明 |
|-----|---------|------|
| 简单加载中提示 | `ProgressBarComponent` | 最基础的进度条 |
| 流程式操作 | `StepListComponent` | 显示步骤列表 |
| 模态操作（阻塞 UI） | `LoadingOverlayComponent` | 全屏遮罩 + 进度 |
| 任务详情页 | `TaskCardComponent` | 完整的任务信息卡片 |
| 后台任务（不阻塞） | `StatusBarProgressIndicator` | 状态栏轻量提示 |
| 多任务管理 | `FloatingProgressBall` | 悬浮球 + 任务列表面板 |
| 耗时操作前确认 | `OperationConfirmModal` | 预估时间 + 步骤展示 |

---

## 基础组件

### ProgressBarComponent（进度条）

最简单的进度展示组件，显示水平进度条 + 百分比 + 消息文本。

#### 基本用法

```typescript
import { ProgressBarComponent } from './ui/components/progress';

const bar = new ProgressBarComponent(containerEl, {
    height: '8px',
    color: 'var(--interactive-accent)',
    showPercent: true,
    showMessage: true,
});

// 手动设置进度
bar.setProgress(50, '正在处理...');

// 绑定 ProgressEmitter 自动更新
const off = bar.bindEmitter(emitter);

// 销毁
bar.destroy();
```

#### 配置选项

```typescript
interface ProgressBarOptions {
    height?: string;      // 进度条高度，默认 '6px'
    color?: string;       // 进度条颜色，默认 'var(--interactive-accent)'
    showPercent?: boolean; // 是否显示百分比，默认 true
    showMessage?: boolean; // 是否显示消息文本，默认 true
}
```

#### API

| 方法 | 说明 |
|-----|------|
| `setProgress(progress, message?)` | 设置进度值和消息 |
| `bindEmitter(emitter): () => void` | 绑定 ProgressEmitter，返回取消绑定函数 |
| `destroy()` | 销毁组件，清理资源 |

---

### StepListComponent（步骤列表）

展示多步骤进度，已完成步骤显示绿色勾选，进行中步骤高亮并显示子进度条。

#### 基本用法

```typescript
import { StepListComponent } from './ui/components/progress';

const stepList = new StepListComponent(containerEl, [
    '情节构思',
    '场景展开',
    '正文生成',
    '质量润色',
]);

// 设置当前步骤
stepList.setCurrentStep(1);

// 更新指定步骤的进度
stepList.updateStep(1, 50, '正在构思冲突点...');

// 标记步骤完成
stepList.markStepComplete(0);

// 绑定 ProgressEmitter 自动更新
const off = stepList.bindEmitter(emitter);

// 销毁
stepList.destroy();
```

#### API

| 方法 | 说明 |
|-----|------|
| `setCurrentStep(stepIndex)` | 设置当前进行中的步骤 |
| `updateStep(stepIndex, progress, message?)` | 更新指定步骤的进度 |
| `markStepComplete(stepIndex)` | 标记指定步骤为已完成 |
| `bindEmitter(emitter): () => void` | 绑定 ProgressEmitter |
| `destroy()` | 销毁组件 |

---

## 容器组件

### LoadingOverlayComponent（加载遮罩）

全屏或容器内的半透明遮罩，居中显示进度信息。适合阻塞式操作。

#### 基本用法

```typescript
import { LoadingOverlayComponent } from './ui/components/progress';

const overlay = new LoadingOverlayComponent(containerEl, {
    title: '正在生成...',
    showCancel: true,
    showSteps: true,
});

// 显示遮罩
overlay.show();

// 绑定 ProgressEmitter
overlay.bindEmitter(emitter);

// 取消回调
overlay.onCancel(() => {
    emitter.cancel();
});

// 隐藏遮罩
overlay.hide();

// 销毁
overlay.destroy();
```

#### 配置选项

```typescript
interface LoadingOverlayOptions {
    title?: string;      // 标题，默认 '处理中...'
    showCancel?: boolean; // 是否显示取消按钮，默认 true
    showSteps?: boolean;  // 是否显示步骤列表，默认 true
}
```

#### API

| 方法 | 说明 |
|-----|------|
| `show()` | 显示遮罩 |
| `hide()` | 隐藏遮罩 |
| `bindEmitter(emitter): () => void` | 绑定 ProgressEmitter |
| `onCancel(callback)` | 设置取消回调 |
| `destroy()` | 销毁组件 |

---

### TaskCardComponent（任务卡片）

展示单个任务的完整进度信息，包含任务名称、状态标签、进度条、当前步骤、已用时间、预估剩余时间、取消按钮。

#### 基本用法

```typescript
import { TaskCardComponent } from './ui/components/progress';

const card = new TaskCardComponent(containerEl, {
    showCancel: true,
});

// 绑定 ProgressEmitter
card.bindEmitter(emitter);

// 取消回调
card.onCancel(() => {
    emitter.cancel();
});

// 销毁
card.destroy();
```

#### 配置选项

```typescript
interface TaskCardOptions {
    showCancel?: boolean; // 是否显示取消按钮，默认 true
}
```

#### API

| 方法 | 说明 |
|-----|------|
| `bindEmitter(emitter): () => void` | 绑定 ProgressEmitter |
| `onCancel(callback)` | 设置取消回调 |
| `destroy()` | 销毁组件 |

#### 展示内容

- 任务名称 + 状态徽章
- 进度条（带百分比）
- 当前步骤
- 已用时间
- 预估剩余时间（运行中时显示）
- 错误信息（失败时显示）
- 取消/重试按钮

---

## 全局组件

### FloatingProgressBall（悬浮进度球）

固定在屏幕角落的圆形悬浮球，显示总进度百分比。点击展开完整面板，展示所有进行中的任务。支持多任务管理。

#### 基本用法

```typescript
import { FloatingProgressBall } from './ui/components/progress';

const ball = new FloatingProgressBall(app, {
    position: 'bottom-right',
    size: 56,
});

// 显示悬浮球
ball.show();

// 绑定单个任务
const off1 = ball.bindEmitter(emitter1);

// 绑定多个任务
const offAll = ball.bindEmitters([emitter1, emitter2, emitter3]);

// 展开面板
ball.expand();

// 收起面板
ball.collapse();

// 隐藏
ball.hide();

// 销毁
ball.destroy();
```

#### 配置选项

```typescript
interface FloatingProgressBallOptions {
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    size?: number; // 球的大小（像素），默认 56
}
```

#### API

| 方法 | 说明 |
|-----|------|
| `show()` | 显示悬浮球 |
| `hide()` | 隐藏悬浮球 |
| `bindEmitter(emitter): () => void` | 绑定单个 ProgressEmitter |
| `bindEmitters(emitters): () => void` | 绑定多个 ProgressEmitter |
| `expand()` | 展开完整面板 |
| `collapse()` | 收起为小球 |
| `destroy()` | 销毁组件 |

#### 特性

- 环形进度条显示平均进度
- 多任务时显示任务数量角标
- 点击展开任务列表面板
- 每个任务显示进度条和状态
- 支持"全部取消"操作
- 任务完成/失败时显示通知

---

### StatusBarProgressIndicator（状态栏指示器）

在 Obsidian 状态栏右侧添加轻量级进度指示器。点击打开悬浮进度球面板。

#### 基本用法

```typescript
import { StatusBarProgressIndicator } from './ui/components/progress';

// statusBarEl 来自插件的 addStatusBarItem()
const indicator = new StatusBarProgressIndicator(statusBarEl, app);

// 绑定任务
const off = indicator.bindEmitter(emitter);

// 显示/隐藏
indicator.show();
indicator.hide();

// 销毁
indicator.destroy();
```

#### API

| 方法 | 说明 |
|-----|------|
| `bindEmitter(emitter): () => void` | 绑定单个 ProgressEmitter |
| `bindEmitters(emitters): () => void` | 绑定多个 ProgressEmitter |
| `show()` | 显示指示器 |
| `hide()` | 隐藏指示器 |
| `destroy()` | 销毁组件 |

#### 显示规则

- 单任务：显示图标 + 百分比
- 多任务：显示图标 + "N 个任务"
- 有运行中任务：图标旋转动画
- 无活动任务：自动隐藏

---

## 辅助组件

### OperationConfirmModal（操作确认弹窗）

在执行耗时操作前向用户展示操作详情、预估时间和执行步骤。支持"不再提示"功能。

#### 基本用法

```typescript
import { OperationConfirmModal } from './ui/components/progress';

// 方式 1: 静态方法（推荐）
const confirmed = await OperationConfirmModal.confirm(app, {
    title: '拆解知识库',
    description: '将对选中的书籍进行深度拆解分析。',
    etaMin: 30000,
    etaMax: 60000,
    steps: [
        '读取书籍内容',
        '提取文笔风格特征',
        '分析情节结构',
        '生成结构化数据',
    ],
    confirmText: '开始拆解',
    cancelText: '取消',
    rememberKey: 'confirm-deconstruction',
});

if (confirmed) {
    // 执行操作
}

// 方式 2: 手动创建
const modal = new OperationConfirmModal(app, options);
const result = await modal.openAndWait();

// 重置"不再提示"偏好
OperationConfirmModal.resetRemember('confirm-deconstruction');
```

#### 配置选项

```typescript
interface OperationConfirmOptions {
    title: string;           // 弹窗标题
    description: string;     // 操作描述
    etaMin?: number;         // 预估最小时间（毫秒）
    etaMax?: number;         // 预估最大时间（毫秒）
    steps?: string[];        // 执行步骤列表
    confirmText?: string;    // 确认按钮文本
    cancelText?: string;     // 取消按钮文本
    rememberKey?: string;    // "不再提示"的存储键
    warning?: string;        // 警告信息
}
```

#### API

| 方法 | 说明 |
|-----|------|
| `static confirm(app, options): Promise<boolean>` | 静态辅助方法，一行代码调用 |
| `static resetRemember(rememberKey)` | 重置"不再提示"偏好 |
| `openAndWait(): Promise<boolean>` | 打开弹窗并等待用户操作 |

---

## 组合使用模式

### 模式 1：确认弹窗 + 加载遮罩

最完整的用户体验：先确认 → 再执行 → 显示进度。

```typescript
async function runTaskWithConfirm() {
    // 1. 确认弹窗
    const confirmed = await OperationConfirmModal.confirm(app, {
        title: '生成章节',
        description: '将根据大纲生成新的章节内容。',
        etaMin: 10000,
        etaMax: 30000,
        steps: ['情节构思', '场景展开', '正文生成', '质量润色'],
        rememberKey: 'confirm-gen-chapter',
    });
    
    if (!confirmed) return;
    
    // 2. 创建 ProgressEmitter
    const emitter = new ProgressEmitter('gen-chapter', '生成章节');
    emitter.registerSteps([
        '情节构思', '场景展开', '正文生成', '质量润色'
    ]);
    
    // 3. 显示加载遮罩
    const overlay = new LoadingOverlayComponent(app.workspace.containerEl, {
        title: '生成章节',
        showCancel: true,
        showSteps: true,
    });
    overlay.bindEmitter(emitter);
    overlay.onCancel(() => emitter.cancel());
    overlay.show();
    
    try {
        // 4. 执行任务
        await generateChapter(emitter);
    } finally {
        // 5. 清理
        setTimeout(() => {
            overlay.hide();
            overlay.destroy();
        }, 1000);
    }
}
```

### 模式 2：状态栏 + 悬浮球

非阻塞式后台任务：状态栏提示 + 悬浮球管理。

```typescript
class TaskManager {
    private indicator: StatusBarProgressIndicator;
    
    constructor(statusBarEl: HTMLElement, app: App) {
        this.indicator = new StatusBarProgressIndicator(statusBarEl, app);
    }
    
    startTask(emitter: ProgressEmitter) {
        this.indicator.bindEmitter(emitter);
    }
    
    destroy() {
        this.indicator.destroy();
    }
}
```

### 模式 3：任务卡片 + 步骤列表

在详情页展示任务的完整信息。

```typescript
function renderTaskDetail(container: HTMLElement, emitter: ProgressEmitter) {
    // 任务卡片
    const card = new TaskCardComponent(container, { showCancel: true });
    card.bindEmitter(emitter);
    card.onCancel(() => emitter.cancel());
    
    // 或者自定义布局
    const section = container.createDiv();
    section.createEl('h3', { text: '执行步骤' });
    
    const stepList = new StepListComponent(section, [
        '步骤1', '步骤2', '步骤3'
    ]);
    stepList.bindEmitter(emitter);
}
```

### 模式 4：嵌入式进度条

在表单或设置页面中嵌入简单进度条。

```typescript
function renderExportSection(container: HTMLElement) {
    const progressContainer = container.createDiv();
    
    const bar = new ProgressBarComponent(progressContainer, {
        height: '4px',
        showPercent: true,
        showMessage: false,
    });
    
    exportBtn.addEventListener('click', async () => {
        const emitter = new ProgressEmitter('export', '导出数据');
        bar.bindEmitter(emitter);
        
        try {
            await doExport(emitter);
        } finally {
            setTimeout(() => {
                bar.destroy();
            }, 2000);
        }
    });
}
```

---

## 最佳实践

### 1. 始终清理组件

组件销毁时记得调用 `destroy()`，避免内存泄漏。

```typescript
// ✅ 正确
class MyView {
    private progressBar?: ProgressBarComponent;
    
    onload() {
        this.progressBar = new ProgressBarComponent(container);
    }
    
    onunload() {
        if (this.progressBar) {
            this.progressBar.destroy();
            this.progressBar = undefined;
        }
    }
}
```

### 2. 优先使用 bindEmitter

尽可能使用 `bindEmitter` 自动绑定，而不是手动监听事件。

```typescript
// ✅ 推荐
bar.bindEmitter(emitter);

// ❌ 不推荐（重复造轮子）
emitter.on((state) => {
    bar.setProgress(state.progress, state.message);
});
```

### 3. 任务完成后延迟隐藏

任务完成后不要立即隐藏 UI，给用户一个视觉反馈。

```typescript
emitter.on((state) => {
    if (state.status === 'completed') {
        setTimeout(() => {
            overlay.hide();
            overlay.destroy();
        }, 1500); // 1.5 秒后再隐藏
    }
});
```

### 4. 合理使用遮罩

- **阻塞式操作**（如生成、导出）：使用 `LoadingOverlayComponent`
- **后台任务**（如拆解、索引）：使用 `StatusBarProgressIndicator` 或 `FloatingProgressBall`

### 5. 确认弹窗的 rememberKey

对于高频操作，提供"不再提示"选项，提升使用体验。

```typescript
OperationConfirmModal.confirm(app, {
    // ...
    rememberKey: 'confirm-quick-export',
});
```

### 6. 错误状态处理

确保失败时显示有用的错误信息，而不是让用户困惑。

```typescript
// TaskCardComponent 会自动显示错误
emitter.fail('无法连接到服务器，请检查网络设置');

// 自定义处理
emitter.on((state) => {
    if (state.status === 'failed') {
        showErrorNotice(state.error || '操作失败');
    }
});
```

### 7. 全局组件单例化

`StatusBarProgressIndicator` 和 `FloatingProgressBall` 应该在应用中是单例。

```typescript
// plugin.ts
class NovelWriterPlugin {
    private progressIndicator?: StatusBarProgressIndicator;
    
    onload() {
        const statusBarEl = this.addStatusBarItem();
        this.progressIndicator = new StatusBarProgressIndicator(
            statusBarEl,
            this.app
        );
    }
    
    getProgressIndicator() {
        return this.progressIndicator;
    }
}
```
