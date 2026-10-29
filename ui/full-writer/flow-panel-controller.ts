/**
 * flow-panel-controller.ts — 「创作流程」页签
 *
 * 把三模式各自的阶段、当前进度、下一步动作收在一页里。
 * 之前这些信息只以右上角 Notice 的形式出现，用户看完就没了；
 * 这里用一个可停留、可点击、会跟着磁盘变化自动刷新的面板替代。
 */
import type { App, EventRef } from 'obsidian';
import type { CreationMode } from '../../shared/creation-mode';
import { getCreationModeLabel } from '../../shared/creation-mode';
import type { CreationFlowStageStatus, CreationFlowSnapshot } from '../../shared/creation-flow';
import { createLogger } from '../../shared/logger';
import { projectShortName } from './flow-tab';
import { collectCreationFlowState, type CreationFlowState } from './creation-flow-state';

const log = createLogger('CreationFlowPanel');

export type FlowDocKind = 'storyCore' | 'outline' | 'bible' | 'storyboard';

export interface FlowPanelDeps {
    app: App;
    /** 向导页签内存里的步骤结果（有则优先于 localStorage）；项目不是当前导航项目时返回 undefined */
    getWizardResults: (project: string) => Record<string, string> | undefined;
    /** 订阅 FullWriterStore，页签/项目变化时刷新 */
    subscribeStore: (listener: () => void) => () => void;
    onOpenWizard: (project: string) => void | Promise<void>;
    onOpenResearch: (project: string, mode: CreationMode) => void;
    onOpenDocument: (project: string, mode: CreationMode, kind: FlowDocKind) => void;
    onCreateUnits: (project: string, mode: CreationMode) => void;
    onOpenUnit: (project: string, mode: CreationMode, unitNumber: number) => void | Promise<void>;
    onBrowseUnits: (project: string, mode: CreationMode) => void;
    onSettle: (project: string) => void;
    onExport: (project: string, mode: CreationMode) => void;
    onOpenSelector: () => void;
}

const STATE_CHIP: Record<CreationFlowStageStatus['state'], string> = {
    done: '已完成',
    active: '进行中',
    blocked: '待前置',
    todo: '未开始',
};

const REFRESH_DEBOUNCE_MS = 400;

function docKindFor(stageId: string, mode: CreationMode): FlowDocKind {
    if (stageId === 'storyboard') return 'storyboard';
    if (stageId === 'outline') return 'outline';
    return mode === 'short' ? 'storyCore' : 'bible';
}

export class FlowPanelController {
    private container: HTMLElement | null = null;
    private project = '';
    private mode: CreationMode = 'long';
    private state: CreationFlowState | null = null;
    private refreshTimer: number | null = null;
    private renderSeq = 0;
    private vaultRefs: EventRef[] = [];
    private unsubscribeStore: (() => void) | null = null;
    private destroyed = false;

    constructor(private readonly deps: FlowPanelDeps) {}

    async render(container: HTMLElement, project: string, mode: CreationMode): Promise<void> {
        this.detachListeners();
        this.destroyed = false;
        this.project = project;
        this.mode = mode;
        this.state = null;
        container.empty();
        // 类加在子容器上：tabContent 是多个页签共用的，留下 .nw-flow-panel 会影响其它页
        this.container = container.createDiv({ cls: 'nw-flow-panel' });

        this.bindListeners();
        await this.refresh();
    }

    dispose(): void {
        this.destroyed = true;
        this.detachListeners();
        this.container = null;
        this.state = null;
    }

    private bindListeners(): void {
        if (!this.project) return;
        const prefix = `${this.project}/`;
        const onChange = (path: string): void => {
            if (path.startsWith(prefix) || path === this.project) this.scheduleRefresh();
        };
        try {
            this.vaultRefs.push(
                this.deps.app.vault.on('modify', file => onChange(file.path)),
                this.deps.app.vault.on('create', file => onChange(file.path)),
                this.deps.app.vault.on('delete', file => onChange(file.path)),
                this.deps.app.vault.on('rename', (file, oldPath) => {
                    onChange(file.path);
                    onChange(oldPath);
                }),
            );
        } catch (e) {
            log.warn('[创作流程] 无法监听 vault 事件:', e);
        }

        this.unsubscribeStore = this.deps.subscribeStore(() => {
            if (!this.container || this.destroyed) return;
            if (this.container.isConnected) this.scheduleRefresh();
        });
    }

    private detachListeners(): void {
        for (const ref of this.vaultRefs) {
            try {
                this.deps.app.vault.offref(ref);
            } catch {
                // 视图关闭时 vault 可能已卸载，忽略
            }
        }
        this.vaultRefs = [];
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            void this.refresh();
        }, REFRESH_DEBOUNCE_MS);
    }

    private async refresh(): Promise<void> {
        if (!this.container || this.destroyed || !this.project) return;
        // 切到别的页签后 tabContent 已被清空；继续渲染只会写进游离节点
        if (!this.container.isConnected) return;
        const seq = ++this.renderSeq;
        try {
            const state = await collectCreationFlowState(this.deps.app, this.project, {
                mode: this.mode,
                wizardResults: this.deps.getWizardResults(this.project),
            });
            if (seq !== this.renderSeq || this.destroyed || !this.container) return;
            this.state = state;
            this.renderSnapshot(state.snapshot);
        } catch (e) {
            if (seq !== this.renderSeq || !this.container) return;
            log.warn('[创作流程] 读取项目状态失败:', e);
            this.container.empty();
            const error = this.container.createDiv({ cls: 'nw-flow-error' });
            error.createDiv({ cls: 'nw-flow-error-title', text: '读取创作进度失败' });
            error.createDiv({ cls: 'nw-flow-error-detail', text: e instanceof Error ? e.message : String(e) });
            const retry = error.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '重试' });
            retry.onclick = () => void this.refresh();
        }
    }

    private renderSnapshot(snapshot: CreationFlowSnapshot): void {
        if (!this.container) return;
        const container = this.container;
        container.empty();
        container.toggleClass('is-empty', snapshot.stages.length === 0);

        this.renderHeader(container, snapshot);
        this.renderNextCard(container, snapshot);
        this.renderStages(container, snapshot);
        this.renderSecondary(container, snapshot);
    }

    private renderHeader(container: HTMLElement, snapshot: CreationFlowSnapshot): void {
        const header = container.createDiv({ cls: 'nw-flow-header' });
        const titleWrap = header.createDiv({ cls: 'nw-flow-title-wrap' });
        titleWrap.createDiv({ cls: 'nw-flow-title', text: projectShortName(snapshot.project) });
        const meta = titleWrap.createDiv({ cls: 'nw-flow-sub' });
        meta.createSpan({ cls: 'nw-flow-mode-badge', text: getCreationModeLabel(snapshot.mode) });
        meta.createSpan({ text: ` · ${snapshot.stages.length} 个阶段 · 以「${snapshot.unitLabel}」为单位` });

        const overall = header.createDiv({ cls: 'nw-flow-overall' });
        overall.createDiv({ cls: 'nw-flow-percent', text: `${Math.round(snapshot.overallRatio * 100)}%` });
        overall.createDiv({ cls: 'nw-flow-overall-label', text: '总进度' });
    }

    private renderNextCard(container: HTMLElement, snapshot: CreationFlowSnapshot): void {
        const card = container.createDiv({ cls: 'nw-flow-next' });
        const next = snapshot.stages.find(stage => stage.id === snapshot.nextStageId);

        if (!next) {
            card.addClass('nw-is-complete');
            card.createDiv({ cls: 'nw-flow-next-label', text: '🎉 全部阶段已完成' });
            card.createDiv({
                cls: 'nw-flow-next-desc',
                text: `${snapshot.unitLabel}已写完，成稿也已导出。需要修改时回到任意阶段即可。`,
            });
            const row = card.createDiv({ cls: 'nw-flow-next-actions' });
            const browse = row.createEl('button', { cls: 'nw-btn nw-btn-primary', text: `浏览全部${snapshot.unitLabel}` });
            browse.onclick = () => this.deps.onBrowseUnits(this.project, this.mode);
            const selector = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '回到项目列表' });
            selector.onclick = () => this.deps.onOpenSelector();
            return;
        }

        card.createDiv({ cls: 'nw-flow-next-label', text: '下一步' });
        card.createDiv({ cls: 'nw-flow-next-title', text: next.label });
        card.createDiv({ cls: 'nw-flow-next-desc', text: `${next.progressText}${next.blockedReason ? ` · ${next.blockedReason}` : ''}` });

        const row = card.createDiv({ cls: 'nw-flow-next-actions' });
        const primary = row.createEl('button', { cls: 'nw-btn nw-btn-primary', text: next.ctaLabel });
        primary.onclick = () => this.dispatchStage(next, snapshot);
    }

    private renderStages(container: HTMLElement, snapshot: CreationFlowSnapshot): void {
        const list = container.createEl('ol', { cls: 'nw-flow-stages' });
        snapshot.stages.forEach((stage, index) => {
            const item = list.createEl('li', { cls: `nw-flow-stage nw-is-${stage.state}` });

            const indexEl = item.createDiv({ cls: 'nw-flow-stage-index' });
            indexEl.setText(stage.state === 'done' ? '✓' : String(index + 1));

            const body = item.createDiv({ cls: 'nw-flow-stage-body' });
            const head = body.createDiv({ cls: 'nw-flow-stage-head' });
            head.createSpan({ cls: 'nw-flow-stage-title', text: stage.label });
            head.createSpan({ cls: 'nw-flow-chip', text: STATE_CHIP[stage.state] });

            body.createDiv({ cls: 'nw-flow-stage-desc', text: stage.description });

            const progress = body.createDiv({ cls: 'nw-flow-progress' });
            const bar = progress.createDiv({ cls: 'nw-flow-bar' });
            const fill = bar.createDiv({ cls: 'nw-flow-bar-fill' });
            fill.style.setProperty('width', `${Math.round(stage.ratio * 100)}%`);
            const meta = progress.createSpan({ cls: 'nw-flow-stage-meta' });
            meta.setText(stage.progressText);

            const actions = body.createDiv({ cls: 'nw-flow-stage-actions' });
            const cta = actions.createEl('button', {
                cls: stage.state === 'active' ? 'nw-btn nw-btn-primary' : 'nw-btn nw-btn-secondary',
                text: stage.ctaLabel,
            });
            cta.disabled = stage.state === 'todo';
            cta.onclick = () => this.dispatchStage(stage, snapshot);

            if (stage.blockedReason) {
                body.createDiv({ cls: 'nw-flow-stage-blocked', text: stage.blockedReason });
            }
        });
    }

    private renderSecondary(container: HTMLElement, snapshot: CreationFlowSnapshot): void {
        const footer = container.createDiv({ cls: 'nw-flow-secondary' });
        footer.createDiv({ cls: 'nw-flow-secondary-title', text: '相关工作区' });

        const row = footer.createDiv({ cls: 'nw-flow-secondary-actions' });
        const add = (label: string, onClick: () => void): void => {
            const button = row.createEl('button', { cls: 'nw-flow-link', text: label });
            button.onclick = onClick;
        };

        if (snapshot.mode !== 'long') {
            add('前期调研', () => this.deps.onOpenResearch(this.project, this.mode));
            add(snapshot.mode === 'short' ? '故事核' : '场景圣经', () =>
                this.deps.onOpenDocument(this.project, this.mode, snapshot.mode === 'short' ? 'storyCore' : 'bible'));
            add(snapshot.mode === 'short' ? '分节大纲' : '分集大纲', () =>
                this.deps.onOpenDocument(this.project, this.mode, 'outline'));
            if (snapshot.mode === 'script') {
                add('分镜表', () => this.deps.onOpenDocument(this.project, this.mode, 'storyboard'));
            }
            add(`全部${snapshot.unitLabel}`, () => this.deps.onBrowseUnits(this.project, this.mode));
        } else {
            add('初始化向导', () => void this.deps.onOpenWizard(this.project));
            add('全部章节', () => this.deps.onBrowseUnits(this.project, this.mode));
            add('章节结算', () => this.deps.onSettle(this.project));
        }
        add('回到项目列表', () => this.deps.onOpenSelector());
    }

    /** 统一的阶段动作分发；blocked 阶段先跳到它依赖的阶段 */
    private dispatchStage(stage: CreationFlowStageStatus, snapshot: CreationFlowSnapshot): void {
        if (stage.blockedBy) {
            const dependency = snapshot.stages.find(item => item.id === stage.blockedBy);
            if (dependency) {
                this.dispatchStage(dependency, snapshot);
                return;
            }
        }

        switch (stage.primaryAction) {
            case 'wizard':
                void this.deps.onOpenWizard(this.project);
                return;
            case 'research':
                if (this.mode === 'long') return;
                this.deps.onOpenResearch(this.project, this.mode);
                return;
            case 'document':
                this.deps.onOpenDocument(this.project, this.mode, docKindFor(stage.id, this.mode));
                return;
            case 'create-units':
                this.deps.onCreateUnits(this.project, this.mode);
                return;
            case 'write-unit':
                void this.deps.onOpenUnit(this.project, this.mode, snapshot.nextUnitNumber ?? 1);
                return;
            case 'settle':
                this.deps.onSettle(this.project);
                return;
            case 'export':
                this.deps.onExport(this.project, this.mode);
                return;
            default:
                this.deps.onOpenSelector();
        }
    }
}
