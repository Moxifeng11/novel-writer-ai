/**
 * 进度 UI 组件集合
 *
 * 提供与 ProgressEmitter 配合使用的进度展示组件：
 * - ProgressBarComponent: 水平进度条
 * - StepListComponent: 步骤列表
 * - LoadingOverlayComponent: 加载遮罩
 * - TaskCardComponent: 任务卡片
 * - OperationConfirmModal: 操作确认弹窗
 * - FloatingProgressBall: 悬浮进度球
 * - StatusBarProgressIndicator: 状态栏进度指示器
 */

export { ProgressBarComponent } from './progress-bar';
export type { ProgressBarOptions } from './progress-bar';

export { StepListComponent } from './step-list';

export { LoadingOverlayComponent } from './loading-overlay';
export type { LoadingOverlayOptions } from './loading-overlay';

export { TaskCardComponent } from './task-card';
export type { TaskCardOptions } from './task-card';

export { OperationConfirmModal } from './operation-confirm-modal';
export type { OperationConfirmOptions } from './operation-confirm-modal';

export { FloatingProgressBall } from './floating-progress-ball';
export type { FloatingProgressBallOptions } from './floating-progress-ball';

export { StatusBarProgressIndicator } from './status-bar-indicator';
