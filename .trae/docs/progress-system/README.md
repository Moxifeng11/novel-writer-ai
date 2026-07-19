# 全流程进度可视化系统

## 目录

- [系统概述](#系统概述)
- [核心设计理念](#核心设计理念)
- [三层架构](#三层架构)
- [已接入功能列表](#已接入功能列表)
- [快速开始](#快速开始)
- [文档索引](#文档索引)

---

## 系统概述

全流程进度可视化系统是小说工坊 AI 插件的核心基础设施，为所有耗时操作提供统一的进度状态管理、时间估算、UI 展示和 Web Worker 后台执行能力。

该系统采用分层架构设计，确保：
- **业务逻辑与 UI 分离**：核心层纯 TypeScript，零依赖，可在任何环境运行
- **渐进式接入**：从简单进度条到完整的多步骤进度，按需选用
- **优雅降级**：Worker 不可用时自动回退到主线程，不影响功能
- **统一体验**：所有功能使用一致的进度展示风格

---

## 核心设计理念

### 1. 状态不可变
每次进度更新生成新的状态快照，避免引用共享导致的意外修改。

### 2. 节流控制
进度数值更新最多 10 次/秒，避免频繁 UI 重绘导致卡顿；状态变化（开始/完成/失败）立即发送。

### 3. 取消优先
所有异步操作都支持 `AbortSignal` 取消机制，确保用户可以随时中断任务。

### 4. 中位数统计
时间估算基于历史数据的中位数统计，而非平均值，更稳健抗异常。

### 5. 组件组合
UI 组件可独立使用，也可组合使用，灵活适配不同场景。

---

## 三层架构

```
┌─────────────────────────────────────────────────┐
│                   UI 层                          │
│  ProgressBar / StepList / LoadingOverlay        │
│  TaskCard / FloatingBall / StatusBarIndicator   │
│  OperationConfirmModal                          │
└───────────────────┬─────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│                  核心层                          │
│       ProgressEmitter    TimeEstimator           │
│  (状态管理 / 事件发射 / 时间估算)                │
└───────────────────┬─────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│                 Worker 层                        │
│  WorkerManager / WorkerRuntime / WorkerProtocol  │
│  (线程池 / 任务调度 / 自动降级)                  │
└─────────────────────────────────────────────────┘
```

### 核心层（Core Layer）
- **ProgressEmitter**：进度状态管理与事件发射
  - 6 种状态：pending / running / paused / completed / failed / cancelled
  - 步骤管理：注册步骤、推进步骤、步骤内进度
  - 时间统计：已用时间、ETA 线性预估
  - AbortSignal 集成
  - 节流控制（10 次/秒）

- **TimeEstimator**：基于历史数据的精准时间估算
  - 中位数统计算法，稳健抗异常
  - 字数分桶，粒度可控
  - 实时进度修正（进度越高越准确）
  - 置信度评估
  - localStorage 持久化

### UI 层（UI Layer）
- **基础组件**
  - `ProgressBarComponent`：水平进度条
  - `StepListComponent`：步骤列表

- **容器组件**
  - `LoadingOverlayComponent`：加载遮罩（全屏/容器内）
  - `TaskCardComponent`：任务卡片（完整信息展示）

- **全局组件**
  - `FloatingProgressBall`：悬浮进度球（多任务管理）
  - `StatusBarProgressIndicator`：状态栏指示器

- **辅助组件**
  - `OperationConfirmModal`：操作确认弹窗（执行前确认）

### Worker 层（Worker Layer）
- **WorkerManager**：主线程侧的 Worker 池管理
  - Worker 池化复用
  - 任务队列 + 并发控制
  - 自动降级策略
  - 任务取消支持

- **WorkerRuntime**：Worker 侧的运行时框架
  - 任务注册与调度
  - 进度通知
  - 错误处理

- **WorkerProtocol**：通信协议定义
  - 类型安全的消息格式
  - 统一的任务执行接口

---

## 已接入功能列表

| 功能模块 | 核心文件 | 进度展示 | Worker | 时间估算 |
|---------|---------|---------|--------|---------|
| 知识库拆解 | `DeconstructionScheduler` | ✅ 步骤列表 + 进度条 | ✅ | ✅ |
| 文笔风格蒸馏 | `StyleDistillerModal` | ✅ 加载遮罩 | ✅ | ✅ |
| 协同写作 | `CoWritingView` + `CoWriteFloatingPanel` | ✅ 悬浮进度球 | ✅ | ✅ |

---

## 快速开始

### 最小示例

```typescript
import { ProgressEmitter } from './shared/progress-emitter';
import { ProgressBarComponent } from './ui/components/progress';

const emitter = new ProgressEmitter('task-001', '生成章节');
const bar = new ProgressBarComponent(containerEl);
bar.bindEmitter(emitter);

emitter.start();
emitter.setProgress(50, '正在处理...');
emitter.complete();
```

### 完整示例

参见 [integration-guide.md](./integration-guide.md)

---

## 文档索引

| 文档 | 说明 | 适用人群 |
|-----|------|---------|
| [progress-emitter.md](./progress-emitter.md) | ProgressEmitter 使用指南 | 需要管理进度状态的开发者 |
| [time-estimator.md](./time-estimator.md) | TimeEstimator 接入指南 | 需要时间估算功能的开发者 |
| [ui-components.md](./ui-components.md) | UI 组件使用指南 | 需要展示进度 UI 的开发者 |
| [web-worker.md](./web-worker.md) | Web Worker 接入指南 | 需要后台执行任务的开发者 |
| [integration-guide.md](./integration-guide.md) | 新功能接入完整流程 | 新功能开发 |
| [migration-guide.md](./migration-guide.md) | 现有功能迁移指南 | 旧功能改造 |
