import { App, Modal, Notice } from 'obsidian';
import { DeconstructionScheduler, BreakdownProgress, BreakdownTask, BreakdownDimension } from '../engine/deconstruction-scheduler';
import { KnowledgeBaseManager } from '../services/knowledge-base-manager';
import { createLogger } from '../shared/logger';


const log = createLogger('KnowledgeMonitorModal');
interface TaskRecord {
    id: string;
    bookId: string;
    bookName: string;
    status: 'completed' | 'failed' | 'cancelled';
    startTime: number;
    endTime: number;
    error?: string;
    dimensions: string[];
}

const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
    style: '风格分析',
    rhythm: '节奏分析',
    technique: '写作技巧',
    structure: '结构拆解',
    character: '人设提取',
    foreshadow: '伏笔梳理',
    commercial: '商业价值',
    readability: '可读性分析',
};

const STATUS_ICONS: Record<string, string> = {
    completed: '✅',
    failed: '❌',
    cancelled: '⏸️',
};

export class KnowledgeMonitorModal extends Modal {
    private scheduler: DeconstructionScheduler;
    private knowledgeManager: KnowledgeBaseManager;
    private activeTab: 'current' | 'history' = 'current';
    private refreshTimer: number | null = null;
    private currentProgress: BreakdownProgress | null = null;
    private progressUnsubscribe: (() => void) | null = null;
    private completeUnsubscribe: (() => void) | null = null;
    private failedUnsubscribe: (() => void) | null = null;

    constructor(
        app: App,
        scheduler: DeconstructionScheduler,
        knowledgeManager: KnowledgeBaseManager
    ) {
        super(app);
        this.scheduler = scheduler;
        this.knowledgeManager = knowledgeManager;
    }

    onOpen() {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.modalEl.addClass('no-close-button');
        this.setupCallbacks();
        this.render();
        this.startRefreshTimer();
    }

    onClose() {
        this.stopRefreshTimer();
        this.cleanupCallbacks();
        this.contentEl.empty();
    }

    private setupCallbacks(): void {
        this.progressUnsubscribe = this.scheduler.onProgress((progress) => {
            this.currentProgress = progress;
            if (this.activeTab === 'current') {
                this.updateCurrentTab();
            }
        });

        this.completeUnsubscribe = this.scheduler.onTaskComplete(() => {
            if (this.activeTab === 'history') {
                this.renderHistoryTab();
            }
        });

        this.failedUnsubscribe = this.scheduler.onTaskFailed(() => {
            if (this.activeTab === 'history') {
                this.renderHistoryTab();
            }
        });
    }

    private cleanupCallbacks(): void {
        if (this.progressUnsubscribe) {
            this.progressUnsubscribe();
            this.progressUnsubscribe = null;
        }
        if (this.completeUnsubscribe) {
            this.completeUnsubscribe();
            this.completeUnsubscribe = null;
        }
        if (this.failedUnsubscribe) {
            this.failedUnsubscribe();
            this.failedUnsubscribe = null;
        }
    }

    private startRefreshTimer(): void {
        this.stopRefreshTimer();
        this.refreshTimer = window.setInterval(() => {
            if (this.activeTab === 'current') {
                this.updateCurrentTab();
            }
        }, 500);
    }

    private stopRefreshTimer(): void {
        if (this.refreshTimer !== null) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const header = contentEl.createDiv({ attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;' } });
        header.createEl('h3', { text: '📊 拆解监控', attr: { style: 'margin:0;' } });

        const closeBtn = header.createEl('button', {
            text: '✕',
            attr: {
                style: 'padding:4px 10px;cursor:pointer;border:none;background:transparent;color:var(--text-muted);font-size:16px;border-radius:4px;'
            }
        });
        closeBtn.addEventListener('click', () => this.close());
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'var(--background-modifier-hover)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'transparent';
        });

        const tabBar = contentEl.createDiv({
            attr: { style: 'display:flex;border-bottom:1px solid var(--background-modifier-border);margin-bottom:16px;' }
        });

        const currentTab = tabBar.createEl('button', {
            text: '当前任务',
            attr: {
                style: `padding:8px 16px;cursor:pointer;border:none;background:transparent;font-size:13px;border-bottom:2px solid ${this.activeTab === 'current' ? 'var(--interactive-accent)' : 'transparent'};color:${this.activeTab === 'current' ? 'var(--text-normal)' : 'var(--text-muted)'};`
            }
        });
        currentTab.addEventListener('click', () => {
            this.activeTab = 'current';
            this.render();
            this.startRefreshTimer();
        });

        const historyTab = tabBar.createEl('button', {
            text: '历史任务',
            attr: {
                style: `padding:8px 16px;cursor:pointer;border:none;background:transparent;font-size:13px;border-bottom:2px solid ${this.activeTab === 'history' ? 'var(--interactive-accent)' : 'transparent'};color:${this.activeTab === 'history' ? 'var(--text-normal)' : 'var(--text-muted)'};`
            }
        });
        historyTab.addEventListener('click', () => {
            this.activeTab = 'history';
            this.stopRefreshTimer();
            this.render();
        });

        // data-tab-content 是刷新入口的锚点：updateCurrentTab / 无参 renderHistoryTab
        // 都靠 querySelector('[data-tab-content]') 定位。缺了它，进度条永远停在打开瞬间，
        // 历史页还会在旧列表下面再追加一份。
        const tabContent = contentEl.createDiv({
            attr: { 'data-tab-content': '', style: 'min-height:300px;' }
        });

        if (this.activeTab === 'current') {
            this.renderCurrentTab(tabContent);
        } else {
            this.renderHistoryTab(tabContent);
        }
    }

    private renderCurrentTab(container?: HTMLElement): void {
        const target = container || this.contentEl.querySelector('[data-tab-content]') as HTMLElement;
        if (target) {
            target.empty();
        }
        const wrap = target || this.contentEl.createDiv({ attr: { 'data-tab-content': '', style: 'min-height:300px;' } });

        const activeTasks = this.scheduler.getActiveTasks();

        if (activeTasks.length === 0) {
            this.renderEmptyHint(wrap, '暂无进行中的拆解任务', '去知识库导入一本书并启动拆解，进度会实时显示在这里。');
            return;
        }

        const currentTask = activeTasks[0];

        const taskCard = wrap.createDiv({
            attr: {
                style: 'padding:16px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary);',
                'data-nw-task-id': currentTask.id,
                'data-nw-task-status': currentTask.status,
            }
        });

        taskCard.createEl('div', {
            text: `📖 ${currentTask.bookName}`,
            attr: { style: 'font-size:15px;font-weight:600;margin-bottom:12px;' }
        });

        const totalProgress = this.currentProgress?.totalProgress ?? currentTask.progress;
        const totalHeader = taskCard.createDiv({
            attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' }
        });
        totalHeader.createEl('span', { text: '总进度', attr: { style: 'font-size:13px;font-weight:500;' } });
        totalHeader.createEl('span', {
            text: `${totalProgress}%`,
            attr: { style: 'font-size:12px;color:var(--text-muted);', 'data-nw-progress': 'total-text' },
        });

        const totalBarBg = taskCard.createDiv({
            attr: { style: 'width:100%;height:10px;background:var(--background-modifier-border);border-radius:5px;overflow:hidden;margin-bottom:16px;' }
        });
        totalBarBg.createDiv({
            attr: {
                style: `height:100%;width:${totalProgress}%;background:var(--interactive-accent);border-radius:5px;transition:width 0.3s ease;`,
                'data-nw-progress': 'total-bar',
            }
        });

        const currentDimension = this.currentProgress?.currentDimension;
        const dimensionProgress = this.currentProgress?.dimensionProgress ?? 0;
        const phase = this.currentProgress?.phase || '准备中';
        const message = this.currentProgress?.message || phase;

        if (currentTask.status === 'running' && currentDimension) {
            const dimLabel = DIMENSION_LABELS[currentDimension] || currentDimension;

            const dimHeader = taskCard.createDiv({
                attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' }
            });
            dimHeader.createEl('span', {
                text: `当前维度：${dimLabel}`,
                attr: { style: 'font-size:13px;font-weight:500;', 'data-nw-progress': 'dim-label' }
            });
            dimHeader.createEl('span', {
                text: `${dimensionProgress}%`,
                attr: { style: 'font-size:12px;color:var(--text-muted);', 'data-nw-progress': 'dim-text' },
            });

            const dimBarBg = taskCard.createDiv({
                attr: { style: 'width:100%;height:8px;background:var(--background-modifier-border);border-radius:4px;overflow:hidden;margin-bottom:12px;' }
            });
            dimBarBg.createDiv({
                attr: {
                    style: `height:100%;width:${dimensionProgress}%;background:var(--text-accent);border-radius:4px;transition:width 0.3s ease;`,
                    'data-nw-progress': 'dim-bar',
                }
            });

            taskCard.createEl('div', {
                text: message,
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;', 'data-nw-progress': 'message' }
            });
        } else if (currentTask.status === 'pending') {
            taskCard.createEl('div', {
                text: '⏳ 排队中，等待执行...',
                attr: { style: 'font-size:13px;color:var(--text-muted);margin-bottom:16px;' }
            });
        } else if (currentTask.status === 'paused') {
            taskCard.createEl('div', {
                text: '⏸️ 任务已暂停',
                attr: { style: 'font-size:13px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        const btnRow = taskCard.createDiv({ attr: { style: 'display:flex;gap:8px;justify-content:flex-end;' } });

        if (currentTask.status === 'running' || currentTask.status === 'pending') {
            btnRow.createEl('button', {
                text: '取消任务',
                attr: {
                    style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-error);border-radius:4px;color:var(--text-error);background:transparent;font-size:13px;'
                }
            }).addEventListener('click', async () => {
                await this.scheduler.cancelTask(currentTask.id);
                new Notice('任务已取消');
            });
        }
    }

    /**
     * 定时/事件刷新：结构不变时只改文字与进度宽度（G6-10）。
     * 旧实现每 500ms empty() 重建整块，展开态/滚动位置/焦点全丢。
     */
    private updateCurrentTab(): void {
        const tabContent = this.contentEl.querySelector('[data-tab-content]') as HTMLElement;
        if (!tabContent || this.activeTab !== 'current') return;

        const currentTask = this.scheduler.getActiveTasks()[0];
        const card = tabContent.querySelector('[data-nw-task-id]') as HTMLElement | null;
        const sameTask = !!currentTask && !!card
            && card.getAttribute('data-nw-task-id') === currentTask.id
            && card.getAttribute('data-nw-task-status') === currentTask.status;
        if (!sameTask) {
            this.renderCurrentTab(tabContent);
            return;
        }

        const total = this.currentProgress?.totalProgress ?? currentTask.progress;
        this.patchProgressNode(card, 'total-text', `${total}%`);
        this.patchProgressWidth(card, 'total-bar', total);

        const dimension = this.currentProgress?.currentDimension;
        if (dimension) {
            const label = DIMENSION_LABELS[dimension] || dimension;
            const pct = this.currentProgress?.dimensionProgress ?? 0;
            this.patchProgressNode(card, 'dim-label', `当前维度：${label}`);
            this.patchProgressNode(card, 'dim-text', `${pct}%`);
            this.patchProgressWidth(card, 'dim-bar', pct);
        }
        const message = this.currentProgress?.message || this.currentProgress?.phase;
        if (message) this.patchProgressNode(card, 'message', message);
    }

    private patchProgressNode(root: HTMLElement, key: string, text: string): void {
        const node = root.querySelector(`[data-nw-progress="${key}"]`);
        if (node && node.textContent !== text) node.textContent = text;
    }

    private patchProgressWidth(root: HTMLElement, key: string, percent: number): void {
        const node = root.querySelector(`[data-nw-progress="${key}"]`) as HTMLElement | null;
        if (!node) return;
        const next = `${percent}%`;
        if (node.style.width !== next) node.style.width = next;
    }

    private renderHistoryTab(container?: HTMLElement): void {
        const target = container || this.contentEl.querySelector('[data-tab-content]') as HTMLElement;
        if (target) {
            target.empty();
        }
        const wrap = target || this.contentEl.createDiv({ attr: { 'data-tab-content': '', style: 'min-height:300px;' } });

        const allTasks = this.scheduler.getAllTasks();
        const historyTasks = allTasks
            .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

        if (historyTasks.length === 0) {
            this.renderEmptyHint(wrap, '暂无历史任务记录', '完成或中断过一次拆解后，这里会保留最近的任务结果。');
            return;
        }

        const list = wrap.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;' } });

        for (const task of historyTasks) {
            this.renderHistoryItem(list, task);
        }
    }

    /** 空态：标题 + 一句话说明 + 去知识库的入口（G5-4：空面板必须有下一步） */
    private renderEmptyHint(container: HTMLElement, title: string, desc: string): void {
        // 复用快捷工具空态样式，避免新增内联样式（内联样式基线只降不升）
        const box = container.createDiv({ cls: 'nw-qt-empty-hint' });
        box.createDiv({ text: title, cls: 'nw-qt-empty-title' });
        box.createDiv({ text: desc, cls: 'nw-qt-empty-desc' });
        const btn = box.createEl('button', { text: '📚 打开知识库开始拆解', cls: 'nw-btn nw-btn-secondary' });
        btn.onclick = () => {
            (this.app as unknown as { commands?: { executeCommandById?: (id: string) => boolean } })
                .commands?.executeCommandById?.('novel-writer-open-knowledge-base');
            this.close();
        };
    }

    private renderHistoryItem(container: HTMLElement, task: BreakdownTask): void {
        const isFailed = task.status === 'failed';
        const icon = STATUS_ICONS[task.status] || '❓';
        const duration = task.startedAt && task.completedAt
            ? this.formatDuration(task.completedAt - task.startedAt)
            : '-';
        const finishTime = task.completedAt
            ? this.formatTime(task.completedAt)
            : '-';

        const item = container.createDiv({
            attr: {
                style: `padding:12px;border:1px solid ${isFailed ? 'var(--background-modifier-error)' : 'var(--background-modifier-border)'};border-radius:6px;background:${isFailed ? 'rgba(var(--background-modifier-error-rgb), 0.05)' : 'var(--background-secondary)'};`
            }
        });

        const headerRow = item.createDiv({
            attr: { style: 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;' }
        });

        const leftInfo = headerRow.createDiv({ attr: { style: 'flex:1;min-width:0;' } });

        const titleRow = leftInfo.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;' } });
        titleRow.createEl('span', { text: icon, attr: { style: 'font-size:16px;' } });
        titleRow.createEl('span', {
            text: task.bookName,
            attr: { style: `font-size:14px;font-weight:500;${isFailed ? 'color:var(--text-error);' : ''}` }
        });

        const metaRow = leftInfo.createDiv({
            attr: { style: 'font-size:12px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap;' }
        });
        metaRow.createEl('span', { text: `耗时：${duration}` });
        metaRow.createEl('span', { text: `完成：${finishTime}` });

        const actionBtns = headerRow.createDiv({ attr: { style: 'display:flex;gap:6px;flex-shrink:0;' } });

        actionBtns.createEl('button', {
            text: '查看',
            attr: {
                style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
            }
        }).addEventListener('click', () => {
            this.navigateToBook(task.bookId);
        });

        if (isFailed) {
            actionBtns.createEl('button', {
                text: '重试',
                attr: {
                    style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--interactive-accent);border-radius:4px;font-size:12px;background:var(--interactive-accent);color:var(--text-on-accent);'
                }
            }).addEventListener('click', () => {
                this.retryTask(task);
            });
        }

        if (isFailed && task.error) {
            item.createEl('div', {
                text: `错误：${task.error}`,
                attr: { style: 'font-size:12px;color:var(--text-error);margin-top:8px;padding-top:8px;border-top:1px solid var(--background-modifier-error);' }
            });
        }

        const dims = task.dimensions.map(d => DIMENSION_LABELS[d as BreakdownDimension] || d).join('、');
        item.createEl('div', {
            text: `维度：${dims}`,
            attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:6px;' }
        });
    }

    private async navigateToBook(bookId: string): Promise<void> {
        try {
            const book = await this.knowledgeManager.getBook(bookId);
            if (book) {
                new Notice(`跳转到《${book.name}》`);
            }
        } catch (e) {
            log.error('[KnowledgeMonitorModal] 跳转失败:', e);
            new Notice('跳转失败');
        }
    }

    private async retryTask(task: BreakdownTask): Promise<void> {
        try {
            await this.scheduler.addTask(task.bookId, task.sourceText, task.dimensions as BreakdownDimension[]);
            new Notice(`已重新提交《${task.bookName}》的拆解任务`);
            this.activeTab = 'current';
            this.render();
            this.startRefreshTimer();
        } catch (e) {
            log.error('[KnowledgeMonitorModal] 重试失败:', e);
            new Notice(`重试失败：${e instanceof Error ? e.message : '未知错误'}`);
        }
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}小时${minutes % 60}分`;
        } else if (minutes > 0) {
            return `${minutes}分${seconds % 60}秒`;
        } else {
            return `${seconds}秒`;
        }
    }

    private formatTime(timestamp: number): string {
        const date = new Date(timestamp);
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
}
