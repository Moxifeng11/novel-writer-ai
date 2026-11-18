import { App } from 'obsidian';
import { t } from '@/i18n';
import type NovelWriterPlugin from '@/main';
import type { EndingTractionEngine, EndingTractionState, PlotThread } from '@/engine/ending-traction-engine';
import { CoWriteFacade } from '@/ui/services/co-write-facade';
import { createLogger } from '@/shared/logger';

const log = createLogger('FullWriterCheckup');

/** 自动体检最小间隔（毫秒）。checkTraction 每次读分卷大纲，避免频繁 IO。 */
const MIN_INTERVAL_MS = 20_000;

const RISK_LABEL: Record<EndingTractionState['divergenceRisk'], string> = {
    low: t('fullwriter.ck.riskLow'),
    medium: t('fullwriter.ck.riskMid'),
    high: t('fullwriter.ck.riskHigh'),
};

const RISK_CLASS: Record<EndingTractionState['divergenceRisk'], string> = {
    low: 'nw-fw-checkup-risk nw-fw-checkup-risk--low',
    medium: 'nw-fw-checkup-risk nw-fw-checkup-risk--medium',
    high: 'nw-fw-checkup-risk nw-fw-checkup-risk--high',
};

const THREAD_TYPE_LABEL: Record<PlotThread['type'], string> = {
    main: t('fullwriter.ck.threadMain'),
    subplot: t('fullwriter.ck.threadSub'),
    romance: t('fullwriter.ck.threadRomance'),
    mystery: t('fullwriter.ck.threadMystery'),
};

const THREAD_STATUS_LABEL: Record<PlotThread['status'], string> = {
    active: t('fullwriter.ck.statusActive'),
    dormant: t('fullwriter.ck.statusDormant'),
    resolved: t('fullwriter.ck.statusResolved'),
    abandoned: t('fullwriter.ck.statusAbandoned'),
};

/**
 * 写作体检条依赖。
 */
export interface FullWriterCheckupDeps {
    app: App;
    plugin: NovelWriterPlugin;
    getProject: () => string;
    getVolume: () => string;
    getChapterNum: () => number;
    /** 单测注入点：默认按项目新建并 initialize 真实的 EndingTractionEngine */
    createEngine?: (project: string) => Promise<EndingTractionEngine>;
}

/**
 * 全屏写作视图的「写作体检」条。
 *
 * 复用 EndingTractionEngine.checkTraction（纯正则解析分卷大纲，无 AI 调用），
 * 展示整体进度 / 偏离风险 / 首要建议，可展开看全部情节线与建议。
 * 与协同写作的 LiveAnalysisController 解耦：那边强依赖 CoWritingView 的编辑器与面板。
 */
export class FullWriterCheckupController {
    private readonly deps: FullWriterCheckupDeps;

    private rootEl: HTMLElement | null = null;
    private progressEl: HTMLElement | null = null;
    private fillEl: HTMLElement | null = null;
    private riskEl: HTMLElement | null = null;
    private tipEl: HTMLElement | null = null;
    private timeEl: HTMLElement | null = null;
    private detailBtn: HTMLElement | null = null;
    private refreshBtn: HTMLElement | null = null;
    private detailsEl: HTMLElement | null = null;

    private engine: EndingTractionEngine | null = null;
    private engineProject = '';
    private lastState: EndingTractionState | null = null;
    private lastAt = 0;
    private seq = 0;
    private busy = false;
    private expanded = false;

    constructor(deps: FullWriterCheckupDeps) {
        this.deps = deps;
    }

    /**
     * 挂载体检条。重复调用会先释放旧 DOM，避免容器重渲染后残留引用。
     * @param container - 宿主容器（全屏写作主容器）
     */
    render(container: HTMLElement): void {
        this.dispose();
        const root = container.createDiv({ cls: 'novel-writer-fw-checkup' });
        const row = root.createDiv({ cls: 'nw-fw-checkup-row' });

        row.createSpan({ text: '🎯', cls: 'nw-fw-checkup-icon' });
        row.createSpan({ text: t('fullwriter.ck.title'), cls: 'nw-fw-checkup-title' });
        this.progressEl = row.createSpan({ text: '—', cls: 'nw-fw-checkup-progress' });

        const track = row.createDiv({ cls: 'nw-fw-checkup-track' });
        this.fillEl = track.createDiv({ cls: 'nw-fw-checkup-fill' });

        this.riskEl = row.createSpan({ text: t('fullwriter.ck.riskNone'), cls: 'nw-fw-checkup-risk' });
        this.tipEl = row.createSpan({ text: t('fullwriter.ck.waiting'), cls: 'nw-fw-checkup-tip' });

        const actions = row.createDiv({ cls: 'nw-fw-checkup-actions' });
        this.timeEl = actions.createSpan({ text: '', cls: 'nw-fw-checkup-time' });
        this.refreshBtn = actions.createEl('button', { text: t('common.refresh'), cls: 'nw-fw-checkup-btn' });
        this.refreshBtn.onclick = () => { void this.refresh(true); };
        this.detailBtn = actions.createEl('button', { text: t('fullwriter.ck.detailBtn'), cls: 'nw-fw-checkup-btn nw-fw-checkup-btn--detail' });
        this.detailBtn.onclick = () => this.toggleDetails();

        this.detailsEl = root.createDiv({ cls: 'nw-fw-checkup-details' });

        this.rootEl = root;
        void this.refresh(true);
    }

    /**
     * 刷新体检结果。
     * @param force - true 时忽略最小间隔（手动刷新 / 正文生成完成后）
     */
    async refresh(force = false): Promise<void> {
        if (!this.rootEl) return;
        const project = this.deps.getProject();
        const chapterNum = this.deps.getChapterNum();
        if (!project || !chapterNum) {
            this.applyIdle(t('fullwriter.ck.idleHint'));
            return;
        }
        if (this.busy) return;
        if (!force && this.lastAt > 0 && Date.now() - this.lastAt < MIN_INTERVAL_MS) return;

        const volumeNum = parseInt(String(this.deps.getVolume()).replace(/\D/g, ''), 10) || 1;
        const token = ++this.seq;
        this.busy = true;
        this.setControlsEnabled(false);
        this.paintTip(t('fullwriter.ck.checking'), false);

        try {
            const engine = await this.ensureEngine(project);
            if (token !== this.seq) return;
            const state = await engine.checkTraction(volumeNum, chapterNum);
            if (token !== this.seq) return;
            this.lastAt = Date.now();
            this.applyState(state);
        } catch (e) {
            if (token !== this.seq) return;
            const message = e instanceof Error ? e.message : String(e);
            log.warn('体检失败:', e);
            this.paintTip(t('fullwriter.ck.checkFailed', { msg: message }), true);
        } finally {
            if (token === this.seq) {
                this.busy = false;
                this.setControlsEnabled(true);
            }
        }
    }

    /** 释放 DOM 引用与引擎缓存（视图卸载时调用） */
    dispose(): void {
        this.seq += 1;
        this.busy = false;
        this.rootEl?.empty();
        this.rootEl = null;
        this.progressEl = null;
        this.fillEl = null;
        this.riskEl = null;
        this.tipEl = null;
        this.timeEl = null;
        this.detailBtn = null;
        this.refreshBtn = null;
        this.detailsEl = null;
        this.engine = null;
        this.engineProject = '';
        this.lastState = null;
        this.lastAt = 0;
    }

    private async ensureEngine(project: string): Promise<EndingTractionEngine> {
        if (this.engine && this.engineProject === project) return this.engine;
        const engine = this.deps.createEngine
            ? await this.deps.createEngine(project)
            : await this.createDefaultEngine(project);
        this.engine = engine;
        this.engineProject = project;
        return engine;
    }

    private async createDefaultEngine(project: string): Promise<EndingTractionEngine> {
        // 不直接 new：EndingTractionEngine 在引擎守卫里是 allowedInstances=1 的 p1-deferred 类，
        // 统一走 CoWriteFacade.createEndingTractionEngine（唯一构造点，同 monitor-panel-a/b）。
        const facade = new CoWriteFacade({ plugin: this.deps.plugin });
        return facade.createEndingTractionEngine(project);
    }

    private applyState(state: EndingTractionState): void {
        this.lastState = state;
        const pct = Math.max(0, Math.min(100, Math.round(state.overallProgress)));
        if (this.progressEl) this.progressEl.textContent = `${pct}%`;
        if (this.fillEl) {
            this.fillEl.classList.remove('nw-fw-checkup-fill--empty');
            this.fillEl.style.setProperty('--nw-fw-checkup-pct', `${pct}%`);
        }
        if (this.riskEl) {
            this.riskEl.textContent = t('fullwriter.ck.riskValue', { level: RISK_LABEL[state.divergenceRisk] });
            this.riskEl.className = RISK_CLASS[state.divergenceRisk];
        }
        const tip = state.recommendations[0] ?? t('fullwriter.ck.stableTip');
        this.paintTip(tip, false);
        if (this.timeEl) this.timeEl.textContent = t('fullwriter.ck.lastChecked', { time: formatClock(new Date()) });
        this.renderDetails(state);
    }

    private applyIdle(message: string): void {
        if (this.progressEl) this.progressEl.textContent = '—';
        // 空态用修饰类归零进度条（门禁禁止字面量内联样式，动态值才允许写 CSS 变量）
        this.fillEl?.classList.add('nw-fw-checkup-fill--empty');
        if (this.riskEl) {
            this.riskEl.textContent = t('fullwriter.ck.riskNone');
            this.riskEl.className = 'nw-fw-checkup-risk';
        }
        this.paintTip(message, false);
        if (this.timeEl) this.timeEl.textContent = '';
        this.setControlsEnabled(false);
        this.detailsEl?.empty();
    }

    private paintTip(text: string, isError: boolean): void {
        if (!this.tipEl) return;
        this.tipEl.textContent = text;
        this.tipEl.title = text;
        this.tipEl.className = isError
            ? 'nw-fw-checkup-tip nw-fw-checkup-tip--error'
            : 'nw-fw-checkup-tip';
    }

    private setControlsEnabled(enabled: boolean): void {
        for (const btn of [this.refreshBtn, this.detailBtn]) {
            if (!btn) continue;
            // 直接写 DOM 属性：按钮是 <button>，禁用态交给浏览器渲染
            (btn as HTMLButtonElement).disabled = !enabled;
        }
    }

    private toggleDetails(): void {
        this.expanded = !this.expanded;
        if (this.detailBtn) this.detailBtn.textContent = this.expanded ? t('fullwriter.ck.collapseBtn') : t('fullwriter.ck.detailBtn');
        this.detailsEl?.toggleClass('nw-fw-checkup-details--open', this.expanded);
    }

    private renderDetails(state: EndingTractionState): void {
        if (!this.detailsEl) return;
        this.detailsEl.empty();

        const threads = state.threads;
        const title = this.detailsEl.createDiv({ cls: 'nw-fw-checkup-detail-title' });
        title.textContent = t('fullwriter.ck.threadsTitle', { count: threads.length });
        if (threads.length === 0) {
            this.detailsEl.createDiv({ cls: 'nw-fw-checkup-detail-item', text: t('fullwriter.ck.noThreads') });
        }
        for (const thread of threads) {
            const row = this.detailsEl.createDiv({ cls: 'nw-fw-checkup-thread' });
            row.createSpan({ text: thread.name, cls: 'nw-fw-checkup-thread-name' });
            row.createSpan({
                text: `${THREAD_TYPE_LABEL[thread.type]} · ${THREAD_STATUS_LABEL[thread.status]}`,
                cls: 'nw-fw-checkup-thread-meta',
            });
            const track = row.createDiv({ cls: 'nw-fw-checkup-track nw-fw-checkup-track--sm' });
            const fill = track.createDiv({ cls: 'nw-fw-checkup-fill' });
            fill.style.setProperty('--nw-fw-checkup-pct', `${Math.max(0, Math.min(100, Math.round(thread.currentProgress)))}%`);
            row.createSpan({ text: `${Math.round(thread.currentProgress)}%`, cls: 'nw-fw-checkup-thread-pct' });
        }

        this.detailsEl.createDiv({ cls: 'nw-fw-checkup-detail-title', text: t('fullwriter.ck.suggestionsTitle') });
        if (state.recommendations.length === 0) {
            this.detailsEl.createDiv({ cls: 'nw-fw-checkup-detail-item', text: t('fullwriter.ck.noSuggestions') });
        }
        for (const rec of state.recommendations) {
            this.detailsEl.createDiv({ cls: 'nw-fw-checkup-detail-item', text: rec });
        }
    }
}

/** 最近体检时间只用时分，避免整行抖动 */
function formatClock(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
