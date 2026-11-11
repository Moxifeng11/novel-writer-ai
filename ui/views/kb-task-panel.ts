/**
 * kb-task-panel.ts — 知识库任务监控页的筛选、统计与操作判定（无 DOM、无实例状态）
 *
 * 背景（v4.83.0 UI 可测性治理 · 第 7 批）：`renderTasksTab` 是 `knowledge-base-view.ts`
 * 里最大的单体（**384 行**），而该文件覆盖率 0.34%。任务面板的规则密集且**有误操作风险**：
 * 批量取消与批量删除的可操作集合不同，混用会取消掉已完成任务或试图删除运行中任务。
 *
 * 口径提醒（见 docs/audits/knowledge-base-view-structure-survey.md 风险点 #4/#5）：
 * - 批量**取消**只针对 `running | pending`（进行中/待执行）
 * - 批量**删除**只针对 `completed | failed | cancelled`（已终结）
 * - 任务状态是 **6 档**（多「已暂停 paused」），与书籍拆解状态的 **5 档** 不是同一套映射，勿混用
 */

import type { BreakdownTask, TaskStatus, BreakdownDimension } from '@/engine/deconstruction-scheduler';

/** 任务筛选值（`all` 表示不筛） */
export type TaskFilterType = 'all' | TaskStatus;

/** 状态筛选下拉选项（顺序即渲染顺序） */
export const TASK_FILTER_OPTIONS: Array<{ value: TaskFilterType; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'running', label: '运行中' },
    { value: 'pending', label: '等待中' },
    { value: 'completed', label: '已完成' },
    { value: 'failed', label: '失败' },
    { value: 'cancelled', label: '已取消' },
];

/** 任务状态徽标的语义档位（视图据此选配色） */
export type TaskStatusTone = 'success' | 'info' | 'danger' | 'warning' | 'muted';

/** 任务卡上的单个操作按钮 */
export type TaskRowActionKey = 'retry' | 'cancel' | 'delete' | 'view-book';

/** 统计卡配置 */
export interface TaskStatItem {
    label: string;
    value: number;
    color: string;
}

/** 可取消的状态集合：进行中与待执行 */
const CANCELLABLE_STATUSES: ReadonlyArray<TaskStatus> = ['running', 'pending'];

/** 可删除的状态集合：已终结的历史任务 */
const DELETABLE_STATUSES: ReadonlyArray<TaskStatus> = ['completed', 'failed', 'cancelled'];

/**
 * 任务状态 → 徽标档位。
 *
 * 六档中只映射四档语义色，`cancelled` 与未知值落回 `muted`。
 *
 * @param status - 任务状态
 * @returns 语义档位
 *
 * @example
 * resolveTaskStatusTone('running')  // => 'info'
 * resolveTaskStatusTone('cancelled') // => 'muted'
 */
export function resolveTaskStatusTone(status: TaskStatus | string): TaskStatusTone {
    switch (status) {
        case 'completed': return 'success';
        case 'running': return 'info';
        case 'failed': return 'danger';
        case 'pending': return 'warning';
        default: return 'muted';
    }
}

/**
 * 按筛选值过滤任务。
 *
 * @param tasks - 全部任务
 * @param filter - 筛选值；`all` 返回全部
 * @returns 过滤后的新数组
 */
export function filterTasks(tasks: BreakdownTask[], filter: TaskFilterType): BreakdownTask[] {
    if (filter === 'all') return [...tasks];
    return tasks.filter(task => task.status === filter);
}

/**
 * 按创建时间降序排序（最新任务在前）。
 *
 * @param tasks - 任务列表
 * @returns 排序后的新数组（不改原数组）
 */
export function sortTasksByCreatedDesc(tasks: BreakdownTask[]): BreakdownTask[] {
    return [...tasks].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 先按状态筛选、再按创建时间降序（视图过滤段的完整等价实现）。
 *
 * @param tasks - 全部任务
 * @param filter - 筛选值
 * @returns 过滤并排序后的新数组
 */
export function filterAndSortTasks(tasks: BreakdownTask[], filter: TaskFilterType): BreakdownTask[] {
    return sortTasksByCreatedDesc(filterTasks(tasks, filter));
}

/**
 * 任务面板顶部 6 张统计卡（总数 + 五状态计数，顺序与配色固定）。
 *
 * @param tasks - 全部任务
 * @returns 统计卡配置
 */
export function computeTaskStats(tasks: BreakdownTask[]): TaskStatItem[] {
    const countBy = (status: TaskStatus): number => tasks.filter(task => task.status === status).length;
    return [
        { label: '总任务数', value: tasks.length, color: 'var(--interactive-accent)' },
        { label: '运行中', value: countBy('running'), color: '#3b82f6' },
        { label: '等待中', value: countBy('pending'), color: '#f59e0b' },
        { label: '已完成', value: countBy('completed'), color: '#2ecc71' },
        { label: '失败', value: countBy('failed'), color: '#e74c3c' },
        { label: '已取消', value: countBy('cancelled'), color: '#9ca3af' },
    ];
}

/**
 * 从「当前筛选结果」中挑出可批量取消的任务（必须同时被选中）。
 *
 * @param tasks - 当前筛选后的任务
 * @param selectedIds - 已选中的任务 id 集合
 * @returns 可取消任务（running | pending）
 */
export function selectSelectedCancellable(tasks: BreakdownTask[], selectedIds: ReadonlySet<string>): BreakdownTask[] {
    return tasks.filter(task => selectedIds.has(task.id) && CANCELLABLE_STATUSES.includes(task.status));
}

/**
 * 从「当前筛选结果」中挑出可批量删除的任务（必须同时被选中）。
 *
 * 与 `selectSelectedCancellable` 的集合**不同**，不可互换——见文件头注释。
 *
 * @param tasks - 当前筛选后的任务
 * @param selectedIds - 已选中的任务 id 集合
 * @returns 可删除任务（completed | failed | cancelled）
 */
export function selectSelectedDeletable(tasks: BreakdownTask[], selectedIds: ReadonlySet<string>): BreakdownTask[] {
    return tasks.filter(task => selectedIds.has(task.id) && DELETABLE_STATUSES.includes(task.status));
}

/**
 * 「一键全部取消」的目标集合：全部任务里可取消的那些（不受选中状态影响）。
 *
 * @param tasks - 全部任务
 * @returns running | pending 的任务
 */
export function selectActiveTasks(tasks: BreakdownTask[]): BreakdownTask[] {
    return tasks.filter(task => CANCELLABLE_STATUSES.includes(task.status));
}

/**
 * 全选按钮当前应执行「全选」还是「取消全选」。
 *
 * 沿用原实现口径：已选数量等于当前筛选结果数量即视为已全选。
 *
 * @param selectedSize - 已选数量
 * @param filteredSize - 当前筛选结果数量
 * @returns true 表示已全选（按钮点击应清空）
 */
export function isAllFilteredSelected(selectedSize: number, filteredSize: number): boolean {
    return selectedSize === filteredSize;
}

/**
 * 工具栏「已选 n / m 项」文案。
 *
 * @param selectedSize - 已选数量
 * @param filteredSize - 当前筛选结果数量
 * @returns 形如「已选 2 / 5 项」
 */
export function formatSelectionLabel(selectedSize: number, filteredSize: number): string {
    return `已选 ${selectedSize} / ${filteredSize} 项`;
}

/**
 * 单张任务卡上应出现哪些操作按钮。
 *
 * 规则（原实现的三个独立 if，顺序即渲染顺序）：
 * - `failed`             → 重试
 * - `running | pending`  → 取消
 * - `completed | failed | cancelled` → 删除
 * - 任何状态都有「查看书籍」
 *
 * @param status - 任务状态
 * @returns 按钮 key 列表（按渲染顺序）
 *
 * @example
 * resolveTaskRowActions('failed')    // => ['retry', 'delete', 'view-book']
 * resolveTaskRowActions('running')   // => ['cancel', 'view-book']
 * resolveTaskRowActions('cancelled') // => ['delete', 'view-book']
 */
export function resolveTaskRowActions(status: TaskStatus | string): TaskRowActionKey[] {
    const actions: TaskRowActionKey[] = [];
    if (status === 'failed') actions.push('retry');
    if (status === 'running' || status === 'pending') actions.push('cancel');
    if (DELETABLE_STATUSES.includes(status as TaskStatus)) actions.push('delete');
    actions.push('view-book');
    return actions;
}

/**
 * 是否展示任务进度条：仅进行中/待执行，且能取到实时状态。
 *
 * @param status - 任务状态
 * @param hasEmitterState - 是否取到 emitter 状态
 * @returns 是否展示
 */
export function shouldShowTaskProgress(status: TaskStatus | string, hasEmitterState: boolean): boolean {
    return (status === 'running' || status === 'pending') && hasEmitterState;
}

/**
 * 是否展示任务消息条：进行中/待执行且 emitter 有消息。
 *
 * @param status - 任务状态
 * @param message - emitter 消息
 * @returns 是否展示
 */
export function shouldShowTaskMessage(status: TaskStatus | string, message?: string): boolean {
    return Boolean(message) && (status === 'running' || status === 'pending');
}

/**
 * 是否展示耗时/剩余时间行：仅「运行中」。
 *
 * @param status - 任务状态
 * @param hasEmitterState - 是否取到 emitter 状态
 * @returns 是否展示
 */
export function shouldShowTaskTiming(status: TaskStatus | string, hasEmitterState: boolean): boolean {
    return status === 'running' && hasEmitterState;
}

/**
 * 是否展示失败错误信息：仅 failed 且有 error。
 *
 * @param status - 任务状态
 * @param error - 错误信息
 * @returns 是否展示
 */
export function shouldShowTaskError(status: TaskStatus | string, error?: string): boolean {
    return status === 'failed' && Boolean(error);
}

/**
 * 任务维度标签拼接（用「、」连接）。
 *
 * @param dimensions - 维度列表
 * @param labels - 维度 → 中文标签映射
 * @returns 形如「人物、伏笔、技巧」；空列表返回空串
 */
export function formatTaskDimensions(
    dimensions: BreakdownDimension[] | undefined,
    labels: Record<BreakdownDimension, string>,
): string {
    if (!dimensions || dimensions.length === 0) return '';
    return dimensions.map(dimension => labels[dimension]).join('、');
}

/**
 * 进度百分比文案（四舍五入取整）。
 *
 * @param progress - 0–100 的进度值
 * @returns 形如「42%」
 */
export function formatTaskProgressPercent(progress: number): string {
    return `${Math.round(progress)}%`;
}

/**
 * 单张任务卡的按钮是否可用（批量按钮的禁用态同源规则）。
 *
 * @param enabled - 是否可点
 * @returns 不透明度
 */
export function disabledOpacity(enabled: boolean): string {
    return enabled ? '1' : '0.5';
}

/**
 * 单张任务卡的按钮光标样式。
 *
 * @param enabled - 是否可点
 * @returns CSS cursor 值
 */
export function disabledCursor(enabled: boolean): string {
    return enabled ? 'pointer' : 'not-allowed';
}
