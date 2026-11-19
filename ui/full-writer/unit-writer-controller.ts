/**
 * unit-writer-controller.ts — 短篇/剧本的单元写作工作台
 *
 * 三栏：左单元列表、中正文编辑器 + AI 工具条、右大纲/设定/上一单元结尾。
 * 与长篇章节工作台的区别：不跑 11 步流水线，只做「读上下文 → 生成/续写/
 * 改写 → 保存 → 回写状态」这一条最短闭环。
 */
import type { App } from 'obsidian';
import { t } from '@/i18n';
import { Notice } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import type { AIEngine } from '@/engine/ai-engine';
import type { CreationMode } from '@/shared/creation-mode';
import { getCreationModeLabel } from '@/shared/creation-mode';
import {
    listModeUnits,
    modeUnitDisplay,
    modeUnitLabel,
    type ModeUnitInfo,
} from '@/shared/mode-content';
import { countUnitWords, createBodyWriterUnitFilePort, createObsidianUnitFilePort, generateUnitText, loadUnitWriterContext, saveUnitBody, type UnitFilePort, type UnitGenerateOptions, type UnitWriteAction, type UnitWriterContext } from '@/engine/mode-unit-writer';
import { HumanizeReportModal } from '@/ui/humanize-report-modal';
import { evaluateModeUnitQuality, saveUnitQualityReport } from '@/engine/mode-unit-quality';
import { settleModeUnit } from '@/engine/mode-unit-settlement';
import { evaluateRevision } from '@/engine/revision/revision-guard';
import { modeRevisionOptions } from '@/shared/quality-profile';
import { namesFromEntitySummary } from '@/engine/mode-runtime';
import { resolveAssociations } from '@/engine/context/association-resolver';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';
import { OperationConfirmModal } from '@/ui/components/progress/operation-confirm-modal';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { createLogger } from '@/shared/logger';
import { pushUsageScope } from '@/services/usage-ledger';
import type { WriterTab } from './full-writer-store';
import type { FlowDocKind } from './flow-panel-controller';
import { AUTOSAVE_DELAY_MS } from '@/shared/interaction-timing';

const log = createLogger('UnitWriterController');

/**
 * UnitWriterDeps 类型定义。
 */
export interface UnitWriterDeps {
    app: App;
    plugin: NovelWriterPlugin;
    aiEngine: AIEngine;
    updateTab: (tabId: string, updates: Partial<WriterTab>) => void;
    refreshTabBar: () => void;
    onOpenDocument: (project: string, mode: CreationMode, kind: FlowDocKind) => void;
    onCreateUnits: (project: string) => void;
    onOpenFlow: (project: string) => void;
}

interface RewriteSelection {
    start: number;
    end: number;
    originalText: string;
}

/**
 * UnitWriterController 类。
 */
export class UnitWriterController {
    private container: HTMLElement | null = null;
    /** tabContent 本体；类加在子容器上，切换单元时仍需复用这层 */
    private hostEl: HTMLElement | null = null;
    private tab: WriterTab | null = null;
    private ctx: UnitWriterContext | null = null;
    private units: ModeUnitInfo[] = [];
    private port: UnitFilePort;

    private editorEl: HTMLTextAreaElement | null = null;
    private headerMetaEl: HTMLElement | null = null;
    private saveStateEl: HTMLElement | null = null;
    private aiStatusEl: HTMLElement | null = null;
    private qualityEl: HTMLElement | null = null;
    private toolbarEl: HTMLElement | null = null;

    private dirty = false;
    private saveTimer: number | null = null;
    private saving: Promise<void> | null = null;
    private pendingSaveOptions: { markWritten?: boolean; title?: string } = {};
    private running = false;
    private abortController: AbortController | null = null;
    private pendingRewrite: RewriteSelection | null = null;
    private destroyed = false;

    constructor(private readonly deps: UnitWriterDeps) {
        this.port = createObsidianUnitFilePort(deps.app);
    }

    /**
     * 渲染。
     * @param container - 容器元素
     * @param tab - 页签
     */
    async render(container: HTMLElement, tab: WriterTab): Promise<void> {
        // 控制器会跨单元/跨页签复用：先落盘，否则重新 render 会用磁盘旧内容
        // 覆盖未保存的编辑，或让旧定时器把正文写到错误路径。
        if (this.ctx && this.editorEl && (this.dirty || this.saveTimer !== null)) {
            await this.flushSave();
        }
        this.hostEl = container;
        this.tab = tab;
        this.destroyed = false;
        container.empty();
        this.container = container.createDiv({ cls: 'nw-unit-panel' });

        if (!tab.project || !tab.unitNumber) {
            this.ctx = null;
            this.container.createDiv({ cls: 'nw-unit-empty', text: t('fullwriter.uw.missingInfo') });
            return;
        }

        const loading = this.container.createDiv({ cls: 'nw-unit-loading', text: t('fullwriter.uw.readingUnit') });
        try {
            const mode = tab.mode ?? 'short';
            this.units = listModeUnits(this.deps.app, tab.project, mode);
            this.ctx = await loadUnitWriterContext(this.deps.app, tab.project, mode, tab.unitNumber, {
                vectorStore: this.deps.plugin.engineRegistry.getOrNull(ENGINE_NAMES.KNOWLEDGE_VECTOR_STORE),
                fingerprintLibrary: StyleFingerprintLibrary.get(this.deps.app, tab.project),
            });
            if (this.destroyed) return;
            loading.remove();
            this.renderLayout();
        } catch (e) {
            loading.remove();
            const message = e instanceof Error ? e.message : String(e);
            const error = this.container.createDiv({ cls: 'nw-unit-error' });
            error.createDiv({ cls: 'nw-unit-error-title', text: t('fullwriter.uw.readFailed') });
            error.createDiv({ cls: 'nw-unit-error-detail', text: message });
            const retry = error.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: t('fullwriter.fp.retry') });
            retry.onclick = () => { void this.render(container, tab); };
        }
    }

    /**
     * 释放。
     */
    dispose(): void {
        this.destroyed = true;
        this.abortController?.abort();
        this.abortController = null;
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.dirty) void this.flushSave();
        this.container = null;
        this.hostEl = null;
        this.ctx = null;
        this.tab = null;
    }

    /**
     * cancelActiveGeneration 方法。
     */
    cancelActiveGeneration(): void {
        if (!this.running && !this.abortController) return;
        this.abortController?.abort();
        this.abortController = null;
        this.running = false;
        this.setAiStatus(t('fullwriter.uw.aiCancelled'));
    }

    // ============================================================
    // 布局
    // ============================================================

    private renderLayout(): void {
        if (!this.container || !this.ctx) return;
        this.container.empty();
        const layout = this.container.createDiv({ cls: 'nw-unit-layout' });
        const sidebar = layout.createDiv({ cls: 'nw-unit-sidebar' });
        const main = layout.createDiv({ cls: 'nw-unit-main' });
        const inspector = layout.createDiv({ cls: 'nw-unit-inspector' });

        this.renderSidebar(sidebar);
        this.renderEditor(main);
        this.renderInspector(inspector);
    }

    private renderSidebar(sidebar: HTMLElement): void {
        if (!this.ctx) return;
        const mode = this.ctx.mode;
        const label = modeUnitLabel(mode);

        const head = sidebar.createDiv({ cls: 'nw-unit-sidebar-head' });
        head.createDiv({ cls: 'nw-unit-sidebar-title', text: `${getCreationModeLabel(mode)} · ${this.units.length} ${label}` });
        const createBtn = head.createEl('button', { cls: 'nw-btn nw-btn-secondary nw-unit-create', text: t('fullwriter.uw.createBtn', { unit: label }) });
        createBtn.onclick = () => {
            if (this.ctx) this.deps.onCreateUnits(this.ctx.project);
        };

        const nav = sidebar.createDiv({ cls: 'nw-unit-nav' });
        const prev = nav.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: t('fullwriter.uw.prevUnitBtn', { unit: label }) });
        prev.disabled = !this.units.some(unit => unit.number < (this.ctx?.unitNumber ?? 0));
        prev.onclick = () => {
            const target = [...this.units].reverse().find(unit => unit.number < (this.ctx?.unitNumber ?? 0));
            if (target) void this.switchUnit(target.number);
        };
        const next = nav.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: t('fullwriter.uw.nextUnitBtn', { unit: label }) });
        next.disabled = !this.units.some(unit => unit.number > (this.ctx?.unitNumber ?? 0));
        next.onclick = () => {
            const target = this.units.find(unit => unit.number > (this.ctx?.unitNumber ?? 0));
            if (target) void this.switchUnit(target.number);
        };

        if (this.units.length === 0) {
            const empty = sidebar.createDiv({ cls: 'nw-unit-sidebar-empty' });
            empty.createDiv({ text: t('fullwriter.uw.noSkeleton', { unit: label }) });
            empty.createDiv({ cls: 'nw-unit-sidebar-empty-hint', text: t('fullwriter.uw.noSkeletonHint', { unit: label }) });
            return;
        }

        const list = sidebar.createEl('ul', { cls: 'nw-unit-list' });
        for (const unit of this.units) {
            const item = list.createEl('li', {
                cls: `nw-unit-list-item${unit.number === this.ctx.unitNumber ? ' nw-is-active' : ''}${unit.status === 'written' || unit.status === 'settled' ? ' nw-is-written' : ''}`,
            });
            item.createSpan({ cls: 'nw-unit-list-num', text: unit.unitName });
            item.createSpan({ cls: 'nw-unit-list-title', text: unit.title || t('fullwriter.uw.untitled') });
            item.createSpan({
                cls: 'nw-unit-list-words',
                text: unit.words > 0 ? t('fullwriter.uw.wordCount', { count: unit.words }) : (unit.status === 'written' ? t('fullwriter.uw.written') : t('fullwriter.uw.pendingWrite')),
            });
            item.onclick = () => {
                if (unit.number !== this.ctx?.unitNumber) void this.switchUnit(unit.number);
            };
        }

        const active = list.querySelector('.is-active') as HTMLElement | null;
        active?.scrollIntoView({ block: 'nearest' });
    }

    private renderEditor(main: HTMLElement): void {
        if (!this.ctx) return;
        const header = main.createDiv({ cls: 'nw-unit-header' });

        const titleInput = header.createEl('input', {
            cls: 'nw-unit-title-input',
            attr: { type: 'text', placeholder: t('fullwriter.uw.titlePlaceholder', { unit: this.ctx.unitName }) },
        });
        titleInput.value = this.units.find(unit => unit.number === this.ctx?.unitNumber)?.title || '';
        titleInput.addEventListener('input', () => {
            this.pendingSaveOptions.title = titleInput.value.trim();
            this.dirty = true;
            this.scheduleSave();
        });

        this.headerMetaEl = header.createDiv({ cls: 'nw-unit-header-meta' });
        this.saveStateEl = this.headerMetaEl.createSpan({ cls: 'nw-unit-save-state', text: t('fullwriter.uw.stateSaved') });
        this.updateHeaderMeta();

        this.editorEl = main.createEl('textarea', {
            cls: 'nw-unit-editor',
            attr: {
                placeholder: t('fullwriter.uw.bodyPlaceholder'),
                spellcheck: 'false',
            },
        });
        this.editorEl.value = this.ctx.existingBody.replace(/^\n+/, '');
        this.editorEl.addEventListener('input', () => {
            this.dirty = true;
            this.updateHeaderMeta();
            this.setSaveState(t('fullwriter.uw.stateEditing'));
            this.scheduleSave();
        });
        this.editorEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void this.flushSave().then(ok => {
                    if (ok) showSuccessNotice(t('fullwriter.uw.savedNotice'), { timeout: 1500 });
                });
            }
        });

        this.toolbarEl = main.createDiv({ cls: 'nw-unit-toolbar' });
        this.renderToolbar();

        this.aiStatusEl = main.createDiv({ cls: 'nw-unit-ai-status' });
    }

    private renderToolbar(): void {
        if (!this.toolbarEl) return;
        this.toolbarEl.empty();
        const make = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
            const button = this.toolbarEl!.createEl('button', {
                cls: `nw-btn ${primary ? 'nw-btn-primary' : 'nw-btn-secondary'}`,
                text: label,
                attr: { type: 'button' },
            });
            button.disabled = this.running;
            button.onclick = onClick;
            return button;
        };

        const hasBody = countUnitWords(this.getBody()) > 80;
        make(hasBody ? t('fullwriter.uw.regenSectionBtn') : t('fullwriter.uw.aiGenSectionBtn'), !hasBody, () => { void this.runAI('generate'); });
        make(t('fullwriter.uw.continueBtn'), false, () => { void this.runAI('continue'); });
        make(t('fullwriter.uw.rewriteSelBtn'), false, () => { void this.runAI('rewrite'); });
        const qualityLabel = (this.ctx?.mode ?? 'short') === 'script' ? t('fullwriter.uw.qcScript') : t('fullwriter.uw.qcSixDim');
        make(qualityLabel, false, () => { void this.runQualityCheck(); });
        make(t('fullwriter.uw.humanCheckBtn'), false, () => this.openHumanizeReport());
        const complete = make(t('fullwriter.uw.completeBtn', { unit: modeUnitLabel(this.ctx?.mode ?? 'short') }), false, () => { void this.completeUnit(); });
        make(t('fullwriter.uw.settleBtn'), false, () => { void this.settleCurrentUnit(); });
        complete.addClass('nw-unit-complete');
    }

    private renderInspector(inspector: HTMLElement): void {
        if (!this.ctx) return;
        const mode = this.ctx.mode;
        const label = modeUnitLabel(mode);
        inspector.createDiv({ cls: 'nw-unit-inspector-title', text: t('fullwriter.uw.referenceTitle') });

        this.renderInspectorSection(
            inspector,
            t('fullwriter.uw.sectionOutline', { unit: label }),
            this.ctx.outlineSection || t('fullwriter.uw.noOutlineSection'),
            () => this.deps.onOpenDocument(this.ctx!.project, mode, 'outline'),
        );

        this.renderInspectorSection(
            inspector,
            mode === 'script' ? t('fullwriter.selector.qtSceneBible') : t('fullwriter.selector.qtStoryCore'),
            this.ctx.storyDoc || t('fullwriter.uw.unfilled'),
            () => this.deps.onOpenDocument(this.ctx!.project, mode, mode === 'script' ? 'bible' : 'storyCore'),
        );

        if (this.ctx.previousTail) {
            this.renderInspectorSection(inspector, t('fullwriter.uw.prevTail', { unit: label }), this.ctx.previousTail, null);
        }

        this.qualityEl = inspector.createDiv({ cls: 'nw-unit-quality' });
        this.qualityEl.createDiv({ cls: 'nw-unit-quality-empty', text: t('fullwriter.uw.qualityHint') });

        const footer = inspector.createDiv({ cls: 'nw-unit-inspector-footer' });
        const flow = footer.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: t('cowrite.brief.viewFlowBtn') });
        flow.onclick = () => this.deps.onOpenFlow(this.ctx!.project);
    }

    private renderInspectorSection(
        parent: HTMLElement,
        title: string,
        content: string,
        onEdit: (() => void) | null,
    ): void {
        const details = parent.createEl('details', { cls: 'nw-unit-inspector-section', attr: { open: 'true' } });
        const summary = details.createEl('summary', { cls: 'nw-unit-inspector-summary' });
        summary.createSpan({ text: title });
        if (onEdit) {
            const edit = summary.createEl('button', { cls: 'nw-unit-inspector-edit', text: t('fullwriter.sr.editBtn2') });
            edit.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                onEdit();
            };
        }
        const pre = details.createDiv({ cls: 'nw-unit-inspector-content' });
        pre.setText(content.length > 2400 ? `${content.slice(0, 2400)}\n…` : content);
    }

    // ============================================================
    // 状态与保存
    // ============================================================

    private getBody(): string {
        return this.editorEl?.value ?? '';
    }

    private setBody(text: string): void {
        if (!this.editorEl) return;
        this.editorEl.value = text;
        this.dirty = true;
        this.updateHeaderMeta();
    }

    private updateHeaderMeta(): void {
        if (!this.headerMetaEl || !this.ctx) return;
        const words = countUnitWords(this.getBody());
        const unit = this.units.find(item => item.number === this.ctx?.unitNumber);
        const written = unit?.status === 'written' || unit?.status === 'settled';
        this.headerMetaEl.setText(
            t('fullwriter.uw.summaryLine', { unit: this.ctx.unitName, words, state: written ? t('fullwriter.uw.written') : t('fullwriter.uw.pendingWrite') }),
        );
        if (this.saveStateEl) this.headerMetaEl.appendChild(this.saveStateEl);
    }

    private setSaveState(text: string): void {
        this.saveStateEl?.setText(text);
    }

    private setAiStatus(text: string): void {
        this.aiStatusEl?.setText(text);
    }

    private scheduleSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.flushSave();
        }, AUTOSAVE_DELAY_MS);
    }

    private async flushSave(options: { markWritten?: boolean; title?: string } = {}): Promise<boolean> {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.pendingSaveOptions = { ...this.pendingSaveOptions, ...options };
        if (!this.ctx) return false;

        if (this.saving) {
            try { await this.saving; } catch { /* 上一轮已提示 */ }
        }
        if (!this.dirty && !this.pendingSaveOptions.markWritten && !this.pendingSaveOptions.title) {
            this.setSaveState(t('fullwriter.uw.stateSaved'));
            return true;
        }

        const ctx = this.ctx;
        const body = this.getBody();
        const saveOptions = { ...this.pendingSaveOptions };
        this.pendingSaveOptions = {};
        this.dirty = false;
        this.setSaveState(t('fullwriter.uw.stateSaving'));

        let ok = false;
        const savePort = ctx.project && (ctx.mode === 'short' || ctx.mode === 'script')
            ? createBodyWriterUnitFilePort(this.deps.app, { project: ctx.project, mode: ctx.mode })
            : this.port;
        const run = saveUnitBody(savePort, ctx.unitPath, body, saveOptions);
        this.saving = run.then(() => undefined, () => undefined);
        try {
            const { words } = await run;
            this.setSaveState(t('fullwriter.uw.stateSaved'));
            const unit = this.units.find(item => item.number === ctx.unitNumber);
            if (unit) {
                unit.words = words;
                if (saveOptions.markWritten) unit.status = 'written';
            }
            ok = true;
        } catch (e) {
            this.dirty = true;
            this.setSaveState(t('fullwriter.uw.stateSaveFailed'));
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('fullwriter.uw.saveFailedTitle'), timeout: 6000 });
        } finally {
            this.saving = null;
        }
        return ok;
    }

    // ============================================================
    // AI
    // ============================================================

    private getSelection(): RewriteSelection | null {
        if (!this.editorEl) return null;
        const start = this.editorEl.selectionStart;
        const end = this.editorEl.selectionEnd;
        if (start === end) return null;
        const originalText = this.editorEl.value.slice(start, end);
        if (!originalText.trim()) return null;
        return { start, end, originalText };
    }

    private async runAI(action: UnitWriteAction): Promise<void> {
        if (this.running || !this.ctx || !this.editorEl) return;

        if (action === 'generate' && countUnitWords(this.getBody()) > 80) {
            const confirmed = await OperationConfirmModal.confirm(this.deps.app, {
                title: t('fullwriter.uw.regenConfirmTitle'),
                description: t('fullwriter.uw.regenConfirmDesc'),
                confirmText: t('fullwriter.uw.regenConfirmOk'),
                cancelText: t('common.cancel'),
                warning: t('fullwriter.uw.regenConfirmWarning'),
            });
            if (!confirmed) return;
        }

        if (action === 'rewrite') {
            const selection = this.getSelection();
            if (!selection) {
                new Notice(t('fullwriter.uw.needSelection'), 4000);
                return;
            }
            this.pendingRewrite = selection;
        }

        const ctx = this.ctx;
        const originalBody = this.getBody();
        const selection = this.pendingRewrite;
        try {
            const bundle = await resolveAssociations({
                app: this.deps.app,
                project: ctx.project,
                task: 'unit',
                text: (selection?.originalText || originalBody).slice(-1600),
                chapter: ctx.unitNumber,
                budgetTokens: 800,
            });
            ctx.associationText = bundle.text;
        } catch {
            ctx.associationText = '';
        }

        this.running = true;
        this.abortController = new AbortController();
        this.renderToolbar();
        this.setAiStatus(action === 'rewrite' ? t('fullwriter.uw.aiRewriting') : t('fullwriter.uw.aiWriting'));
        let streamed = '';
        let buffer = '';
        let flushTimer: number | null = null;

        const flushStream = (): void => {
            if (flushTimer !== null) return;
            flushTimer = window.setTimeout(() => {
                flushTimer = null;
                if (action === 'rewrite' || !this.editorEl) return;
                this.editorEl.value = buffer;
                this.editorEl.scrollTop = this.editorEl.scrollHeight;
                this.updateHeaderMeta();
            }, 60);
        };

        const options: UnitGenerateOptions = {
            model: this.deps.plugin.settings.proModel,
            maxTokens: this.deps.plugin.settings.maxOutput,
            compressionMode: this.deps.plugin.settings.contextCompressionMode ?? 'extractive',
            selection: selection?.originalText,
            signal: this.abortController.signal,
            onDelta: (chunk) => {
                streamed += chunk;
                if (action === 'rewrite') {
                    this.setAiStatus(t('fullwriter.uw.aiRewritingWords', { count: countUnitWords(streamed) }));
                    return;
                }
                buffer = action === 'generate'
                    ? streamed
                    : `${originalBody.replace(/\s+$/, '')}\n\n${streamed}`;
                flushStream();
            },
        };

        try {
            if (action === 'generate') {
                buffer = '';
                this.editorEl.value = '';
            } else if (action === 'continue') {
                buffer = originalBody.replace(/\s+$/, '');
            }
            // 用量归因：本次生成/续写/改写挂到 source=unit + 项目 + 「单元#动作」，
            // 账本记录不再全部混进「ai」来源；嵌套 try/finally 保证 scope 一定退出。
            const exitUsage = pushUsageScope({
                source: 'unit',
                project: ctx.project,
                stepKey: `${ctx.unitName}#${action}`,
            });
            try {
                await generateUnitText(this.deps.aiEngine, ctx, action, options);
            } finally {
                exitUsage();
            }

            if (action === 'rewrite' && selection) {
                const current = this.getBody();
                const gate = evaluateRevision(
                    selection.originalText,
                    streamed,
                    modeRevisionOptions(ctx.mode, namesFromEntitySummary(ctx.entities ?? '')),
                );
                if (!gate.accept) {
                    showWarningNotice(gate.reasons.join('；'), { title: t('fullwriter.uw.rewriteNotApplied'), timeout: 8000 });
                    this.setAiStatus(t('fullwriter.uw.gateBlocked'));
                } else if (current.slice(selection.start, selection.end) !== selection.originalText) {
                    showWarningNotice(t('cowrite.rewriteSourceChanged'), { timeout: 6000 });
                } else {
                    this.setBody(
                        `${current.slice(0, selection.start)}${streamed}${current.slice(selection.end)}`,
                    );
                }
            } else {
                this.editorEl.value = buffer || originalBody;
                this.dirty = true;
            }

            this.pendingRewrite = null;
            this.updateHeaderMeta();
            this.setAiStatus(t('fullwriter.uw.aiDoneSaved', { count: countUnitWords(streamed) }));
            await this.flushSave();
            this.renderToolbar();
        } catch (e) {
            const name = (e as { name?: string })?.name;
            this.editorEl.value = originalBody;
            // 生成前手写的内容可能还没到自动保存时间；取消/失败时也要落盘
            this.dirty = true;
            void this.flushSave();
            if (name === 'AbortError') {
                this.setAiStatus(t('fullwriter.uw.aiCancelledNoChange'));
            } else {
                const message = e instanceof Error ? e.message : String(e);
                log.warn('[单元写作] 生成失败:', message);
                this.setAiStatus(t('fullwriter.uw.genFailedStatus', { msg: message }));
                showErrorNotice(message, { title: t('cowrite.genFailedTitle'), timeout: 8000 });
            }
        } finally {
            if (flushTimer !== null) window.clearTimeout(flushTimer);
            this.running = false;
            this.abortController = null;
            this.renderToolbar();
        }
    }

    // ============================================================
    // 质量检查 / 完成 / 切换
    // ============================================================

    /**
     * 本单元六维质检：复用 QualityScoreEngine + 模式专属检查（开篇钩子/可拍性），
     * 结果写回单元 frontmatter 与 `04-质检`/`05-质检` 报告。不调 AI。
     */
    private async runQualityCheck(): Promise<void> {
        if (!this.qualityEl || !this.ctx) return;
        const body = this.getBody();
        if (countUnitWords(body) < 100) {
            new Notice(t('fullwriter.uw.tooShortForCheck'), 4000);
            return;
        }
        const heavy = this.deps.plugin.engineRegistry.getOrNull(ENGINE_NAMES.HEAVY_TASK_WORKER_MANAGER);
        if (!heavy) {
            new Notice(t('fullwriter.uw.qualityEngineNotInit'), 6000);
            return;
        }
        this.qualityEl.empty();
        this.qualityEl.createDiv({ cls: 'nw-unit-quality-loading', text: t('fullwriter.uw.qualityRunning') });
        try {
            const report = await evaluateModeUnitQuality({
                mode: this.ctx.mode,
                body,
                title: this.ctx.unitName,
                outline: this.ctx.outlineSection,
                characterNames: namesFromEntitySummary(this.ctx.entities ?? ''),
                evaluator: {
                    evaluate: (text, context, _signal) => heavy.evaluateQuality(text, context).catch(error => {
                        throw error;
                    }),
                },
            });
            if (!this.qualityEl) return;
            this.qualityEl.empty();

            const head = this.qualityEl.createDiv({ cls: 'nw-unit-quality-head' });
            head.createSpan({ cls: 'nw-unit-quality-score', text: String(report.overallScore) });
            head.createSpan({ cls: 'nw-unit-quality-unit', text: '/100' });
            head.createSpan({ cls: `nw-unit-quality-result ${report.passed ? 'nw-is-pass' : 'nw-is-fail'}`, text: report.passed ? t('fullwriter.uw.passed') : t('fullwriter.uw.notPassed') });
            head.createSpan({ cls: 'nw-unit-quality-level', text: report.grade });

            const grid = this.qualityEl.createDiv({ cls: 'nw-unit-quality-grid' });
            for (const item of report.dimensions) {
                const cell = grid.createDiv({ cls: 'nw-unit-quality-cell' });
                cell.createSpan({ cls: 'nw-unit-quality-label', text: item.label });
                cell.createSpan({
                    cls: `nw-unit-quality-value${item.score < 55 ? ' nw-is-low' : ''}`,
                    text: String(item.score),
                });
            }

            const extras = this.qualityEl.createDiv({ cls: 'nw-unit-quality-extras' });
            for (const item of report.extras) {
                extras.createDiv({
                    cls: `nw-unit-quality-extra${item.passed ? '' : ' nw-is-warn'}`,
                    text: `${item.passed ? '✅' : '⚠️'} ${item.label}：${item.value}`,
                });
            }

            if (report.issues.length > 0) {
                const issues = this.qualityEl.createDiv({ cls: 'nw-unit-quality-issues' });
                issues.createDiv({ cls: 'nw-unit-quality-issues-title', text: t('fullwriter.uw.mainIssues') });
                for (const issue of report.issues.slice(0, 6)) {
                    issues.createDiv({ cls: 'nw-unit-quality-issue', text: `· ${issue}` });
                }
            } else {
                this.qualityEl.createDiv({ cls: 'nw-unit-quality-empty', text: t('fullwriter.uw.noIssues') });
            }

            const path = await saveUnitQualityReport(
                this.deps.app,
                this.ctx.project,
                this.ctx.unitPath,
                this.ctx.unitName,
                report,
            );
            this.qualityEl.createDiv({ cls: 'nw-unit-quality-saved', text: t('fullwriter.uw.savedTo', { path }) });
            this.setAiStatus(t('fullwriter.uw.qualityResult', { result: report.passed ? t('fullwriter.uw.passed') : t('fullwriter.uw.notPassed'), score: report.overallScore }));
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            showErrorNotice(message, { title: t('fullwriter.uw.qualityFailedTitle'), timeout: 8000 });
            if (!this.qualityEl) return;
            this.qualityEl.empty();
            this.qualityEl.createDiv({
                cls: 'nw-unit-error-detail',
                text: t('fullwriter.uw.qualityFailedBody', { msg: message }),
            });
        }
    }

    /** 单元结算：出场确认 + status=settled；失败给可见原因。 */
    private async settleCurrentUnit(): Promise<void> {
        if (!this.ctx) return;
        const body = this.getBody();
        if (countUnitWords(body) < 50) {
            new Notice(t('fullwriter.uw.tooShortForSettle'), 5000);
            return;
        }
        const saved = await this.flushSave({ markWritten: true });
        if (!saved) return;
        const settlement = this.deps.plugin.engineRegistry.getOrNull(ENGINE_NAMES.SETTLEMENT_ENGINE);
        if (!settlement) {
            new Notice(t('fullwriter.uw.settleEngineNotInit'), 6000);
            return;
        }
        try {
            const result = await settleModeUnit(
                this.deps.app,
                settlement,
                this.ctx.project,
                this.ctx.unitPath,
                this.ctx.unitName,
                this.ctx.mode,
                body,
            );
            showSuccessNotice(t('fullwriter.uw.settled', { unit: this.ctx.unitName, count: result.updated }), { timeout: 5000 });
            this.setAiStatus(t('fullwriter.uw.settledStatus', { path: result.reportPath }));
            this.updateHeaderMeta();
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('fullwriter.uw.settleFailedTitle'), timeout: 8000 });
        }
    }

    private openHumanizeReport(): void {
        const body = this.getBody();
        if (!body.trim()) {
            new Notice(t('fullwriter.uw.bodyStillEmpty'), 3000);
            return;
        }
        new HumanizeReportModal(this.deps.app, {
            bodyText: body,
            onApply: async (nextText: string) => {
                this.setBody(nextText);
                await this.flushSave();
                showSuccessNotice(t('fullwriter.uw.rearranged'), { timeout: 3000 });
            },
        }).open();
    }

    private async completeUnit(): Promise<void> {
        if (!this.ctx) return;
        if (countUnitWords(this.getBody()) < 50) {
            new Notice(t('fullwriter.uw.tooShortToComplete'), 5000);
            return;
        }
        const saved = await this.flushSave({ markWritten: true });
        if (!saved) return;
        showSuccessNotice(t('fullwriter.uw.markedWritten', { unit: this.ctx.unitName }), { timeout: 4000 });

        const current = this.ctx.unitNumber;
        const next = this.units.find(unit => unit.number > current);
        if (next) {
            await this.switchUnit(next.number);
            return;
        }
        if (this.ctx) this.deps.onOpenFlow(this.ctx.project);
    }

    private async switchUnit(targetNumber: number): Promise<void> {
        if (!this.ctx || !this.tab) return;
        if (targetNumber === this.ctx.unitNumber) return;
        this.abortController?.abort();
        await this.flushSave();

        const mode = this.ctx.mode;
        const unitName = modeUnitDisplay(targetNumber, mode);
        this.tab.unitNumber = targetNumber;
        this.tab.unitName = unitName;
        this.tab.label = `✍️ ${unitName}`;
        this.deps.updateTab(this.tab.id, {
            unitNumber: targetNumber,
            unitName,
            label: this.tab.label,
        });
        this.deps.refreshTabBar();
        this.ctx = null;
        if (this.hostEl) await this.render(this.hostEl, this.tab);
    }
}
