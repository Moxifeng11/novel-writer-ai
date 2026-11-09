/**
 * unit-writer-controller.ts — 短篇/剧本的单元写作工作台
 *
 * 三栏：左单元列表、中正文编辑器 + AI 工具条、右大纲/设定/上一单元结尾。
 * 与长篇章节工作台的区别：不跑 11 步流水线，只做「读上下文 → 生成/续写/
 * 改写 → 保存 → 回写状态」这一条最短闭环。
 */
import type { App } from 'obsidian';
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
import { countUnitWords, createObsidianUnitFilePort, generateUnitText, loadUnitWriterContext, saveUnitBody, type UnitFilePort, type UnitGenerateOptions, type UnitWriteAction, type UnitWriterContext } from '@/engine/mode-unit-writer';
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

const log = createLogger('UnitWriterController');

const AUTOSAVE_DELAY_MS = 800;

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
            this.container.createDiv({ cls: 'nw-unit-empty', text: '缺少项目或单元信息' });
            return;
        }

        const loading = this.container.createDiv({ cls: 'nw-unit-loading', text: '正在读取单元内容…' });
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
            error.createDiv({ cls: 'nw-unit-error-title', text: '读取单元失败' });
            error.createDiv({ cls: 'nw-unit-error-detail', text: message });
            const retry = error.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '重试' });
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
        this.setAiStatus('已取消生成');
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
        const createBtn = head.createEl('button', { cls: 'nw-btn nw-btn-secondary nw-unit-create', text: `＋ 建${label}` });
        createBtn.onclick = () => {
            if (this.ctx) this.deps.onCreateUnits(this.ctx.project);
        };

        const nav = sidebar.createDiv({ cls: 'nw-unit-nav' });
        const prev = nav.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: `← 上一${label}` });
        prev.disabled = !this.units.some(unit => unit.number < (this.ctx?.unitNumber ?? 0));
        prev.onclick = () => {
            const target = [...this.units].reverse().find(unit => unit.number < (this.ctx?.unitNumber ?? 0));
            if (target) void this.switchUnit(target.number);
        };
        const next = nav.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: `下一${label} →` });
        next.disabled = !this.units.some(unit => unit.number > (this.ctx?.unitNumber ?? 0));
        next.onclick = () => {
            const target = this.units.find(unit => unit.number > (this.ctx?.unitNumber ?? 0));
            if (target) void this.switchUnit(target.number);
        };

        if (this.units.length === 0) {
            const empty = sidebar.createDiv({ cls: 'nw-unit-sidebar-empty' });
            empty.createDiv({ text: `还没有${label}骨架` });
            empty.createDiv({ cls: 'nw-unit-sidebar-empty-hint', text: `先点上方「建${label}」批量创建，或回创作流程查看下一步。` });
            return;
        }

        const list = sidebar.createEl('ul', { cls: 'nw-unit-list' });
        for (const unit of this.units) {
            const item = list.createEl('li', {
                cls: `nw-unit-list-item${unit.number === this.ctx.unitNumber ? ' nw-is-active' : ''}${unit.status === 'written' || unit.status === 'settled' ? ' nw-is-written' : ''}`,
            });
            item.createSpan({ cls: 'nw-unit-list-num', text: unit.unitName });
            item.createSpan({ cls: 'nw-unit-list-title', text: unit.title || '无标题' });
            item.createSpan({
                cls: 'nw-unit-list-words',
                text: unit.words > 0 ? `${unit.words} 字` : (unit.status === 'written' ? '已写' : '待写'),
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
            attr: { type: 'text', placeholder: `${this.ctx.unitName} 标题（可选）` },
        });
        titleInput.value = this.units.find(unit => unit.number === this.ctx?.unitNumber)?.title || '';
        titleInput.addEventListener('input', () => {
            this.pendingSaveOptions.title = titleInput.value.trim();
            this.dirty = true;
            this.scheduleSave();
        });

        this.headerMetaEl = header.createDiv({ cls: 'nw-unit-header-meta' });
        this.saveStateEl = this.headerMetaEl.createSpan({ cls: 'nw-unit-save-state', text: '已保存' });
        this.updateHeaderMeta();

        this.editorEl = main.createEl('textarea', {
            cls: 'nw-unit-editor',
            attr: {
                placeholder: '在这里写正文，或点下方「AI 生成本节」。',
                spellcheck: 'false',
            },
        });
        this.editorEl.value = this.ctx.existingBody.replace(/^\n+/, '');
        this.editorEl.addEventListener('input', () => {
            this.dirty = true;
            this.updateHeaderMeta();
            this.setSaveState('编辑中…');
            this.scheduleSave();
        });
        this.editorEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void this.flushSave().then(ok => {
                    if (ok) showSuccessNotice('已保存', { timeout: 1500 });
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
        make(hasBody ? '🤖 重新生成本节' : '🤖 AI 生成本节', !hasBody, () => { void this.runAI('generate'); });
        make('✨ 续写', false, () => { void this.runAI('continue'); });
        make('✂️ 改写选区', false, () => { void this.runAI('rewrite'); });
        const qualityLabel = (this.ctx?.mode ?? 'short') === 'script' ? '🎬 可拍质检' : '🧪 六维质检';
        make(qualityLabel, false, () => { void this.runQualityCheck(); });
        make('🫧 人味体检', false, () => this.openHumanizeReport());
        const complete = make(`✅ 完成本${modeUnitLabel(this.ctx?.mode ?? 'short')}`, false, () => { void this.completeUnit(); });
        make(`🧾 单元结算`, false, () => { void this.settleCurrentUnit(); });
        complete.addClass('nw-unit-complete');
    }

    private renderInspector(inspector: HTMLElement): void {
        if (!this.ctx) return;
        const mode = this.ctx.mode;
        const label = modeUnitLabel(mode);
        inspector.createDiv({ cls: 'nw-unit-inspector-title', text: '本节参考' });

        this.renderInspectorSection(
            inspector,
            `本${label}大纲`,
            this.ctx.outlineSection || '大纲里还没有这一节的段落。',
            () => this.deps.onOpenDocument(this.ctx!.project, mode, 'outline'),
        );

        this.renderInspectorSection(
            inspector,
            mode === 'script' ? '场景圣经' : '故事核',
            this.ctx.storyDoc || '（尚未填写）',
            () => this.deps.onOpenDocument(this.ctx!.project, mode, mode === 'script' ? 'bible' : 'storyCore'),
        );

        if (this.ctx.previousTail) {
            this.renderInspectorSection(inspector, `上一${label}结尾`, this.ctx.previousTail, null);
        }

        this.qualityEl = inspector.createDiv({ cls: 'nw-unit-quality' });
        this.qualityEl.createDiv({ cls: 'nw-unit-quality-empty', text: '点「质量检查」查看六维评分' });

        const footer = inspector.createDiv({ cls: 'nw-unit-inspector-footer' });
        const flow = footer.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '🧭 查看创作流程' });
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
            const edit = summary.createEl('button', { cls: 'nw-unit-inspector-edit', text: '编辑' });
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
            `${this.ctx.unitName} · ${words} 字 · ${written ? '已写' : '待写'}`,
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
            this.setSaveState('已保存');
            return true;
        }

        const ctx = this.ctx;
        const body = this.getBody();
        const saveOptions = { ...this.pendingSaveOptions };
        this.pendingSaveOptions = {};
        this.dirty = false;
        this.setSaveState('保存中…');

        let ok = false;
        const run = saveUnitBody(this.port, ctx.unitPath, body, saveOptions);
        this.saving = run.then(() => undefined, () => undefined);
        try {
            const { words } = await run;
            this.setSaveState('已保存');
            const unit = this.units.find(item => item.number === ctx.unitNumber);
            if (unit) {
                unit.words = words;
                if (saveOptions.markWritten) unit.status = 'written';
            }
            ok = true;
        } catch (e) {
            this.dirty = true;
            this.setSaveState('保存失败');
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '保存失败', timeout: 6000 });
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
                title: '重新生成本节？',
                description: '当前正文会被清空并重新生成。已有内容不会自动备份，建议先复制留存。',
                confirmText: '清空并重写',
                cancelText: '取消',
                warning: '该操作会覆盖本节现有正文',
            });
            if (!confirmed) return;
        }

        if (action === 'rewrite') {
            const selection = this.getSelection();
            if (!selection) {
                new Notice('请先在正文里选中要改写的片段', 4000);
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
        this.setAiStatus(action === 'rewrite' ? 'AI 正在改写选区…' : 'AI 正在写作…');
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
                    this.setAiStatus(`AI 正在改写选区… ${countUnitWords(streamed)} 字`);
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
                    showWarningNotice(gate.reasons.join('；'), { title: '改写未应用', timeout: 8000 });
                    this.setAiStatus('改写未通过修订闸门，正文未改动');
                } else if (current.slice(selection.start, selection.end) !== selection.originalText) {
                    showWarningNotice('正文已改动，改写结果未应用；请重新选中后再试', { timeout: 6000 });
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
            this.setAiStatus(`完成：${countUnitWords(streamed)} 字，已自动保存`);
            await this.flushSave();
            this.renderToolbar();
        } catch (e) {
            const name = (e as { name?: string })?.name;
            this.editorEl.value = originalBody;
            // 生成前手写的内容可能还没到自动保存时间；取消/失败时也要落盘
            this.dirty = true;
            void this.flushSave();
            if (name === 'AbortError') {
                this.setAiStatus('已取消生成，正文未改动');
            } else {
                const message = e instanceof Error ? e.message : String(e);
                log.warn('[单元写作] 生成失败:', message);
                this.setAiStatus(`生成失败：${message}`);
                showErrorNotice(message, { title: '生成失败', timeout: 8000 });
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
            new Notice('正文太短，先写够 100 字再检查', 4000);
            return;
        }
        const heavy = this.deps.plugin.engineRegistry.getOrNull(ENGINE_NAMES.HEAVY_TASK_WORKER_MANAGER);
        if (!heavy) {
            new Notice('质量引擎未初始化，请重启插件后再试', 6000);
            return;
        }
        this.qualityEl.empty();
        this.qualityEl.createDiv({ cls: 'nw-unit-quality-loading', text: '正在做六维质检…' });
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
            head.createSpan({ cls: `nw-unit-quality-result ${report.passed ? 'nw-is-pass' : 'nw-is-fail'}`, text: report.passed ? '通过' : '未通过' });
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
                issues.createDiv({ cls: 'nw-unit-quality-issues-title', text: '主要问题' });
                for (const issue of report.issues.slice(0, 6)) {
                    issues.createDiv({ cls: 'nw-unit-quality-issue', text: `· ${issue}` });
                }
            } else {
                this.qualityEl.createDiv({ cls: 'nw-unit-quality-empty', text: '未发现明显问题' });
            }

            const path = await saveUnitQualityReport(
                this.deps.app,
                this.ctx.project,
                this.ctx.unitPath,
                this.ctx.unitName,
                report,
            );
            this.qualityEl.createDiv({ cls: 'nw-unit-quality-saved', text: `已保存：${path}` });
            this.setAiStatus(`${report.passed ? '质检通过' : '质检未通过'} · ${report.overallScore} 分`);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            showErrorNotice(message, { title: '质量检查失败', timeout: 8000 });
            if (!this.qualityEl) return;
            this.qualityEl.empty();
            this.qualityEl.createDiv({
                cls: 'nw-unit-error-detail',
                text: `质量检查失败：${message}`,
            });
        }
    }

    /** 单元结算：出场确认 + status=settled；失败给可见原因。 */
    private async settleCurrentUnit(): Promise<void> {
        if (!this.ctx) return;
        const body = this.getBody();
        if (countUnitWords(body) < 50) {
            new Notice('正文太短，先写够 50 字再结算', 5000);
            return;
        }
        const saved = await this.flushSave({ markWritten: true });
        if (!saved) return;
        const settlement = this.deps.plugin.engineRegistry.getOrNull(ENGINE_NAMES.SETTLEMENT_ENGINE);
        if (!settlement) {
            new Notice('结算引擎未初始化，请重启插件后再试', 6000);
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
            showSuccessNotice(`${this.ctx.unitName} 已结算（更新 ${result.updated} 个实体）`, { timeout: 5000 });
            this.setAiStatus(`已结算：${result.reportPath}`);
            this.updateHeaderMeta();
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: '单元结算失败', timeout: 8000 });
        }
    }

    private openHumanizeReport(): void {
        const body = this.getBody();
        if (!body.trim()) {
            new Notice('正文还是空的', 3000);
            return;
        }
        new HumanizeReportModal(this.deps.app, {
            bodyText: body,
            onApply: async (nextText: string) => {
                this.setBody(nextText);
                await this.flushSave();
                showSuccessNotice('已应用自然段重排', { timeout: 3000 });
            },
        }).open();
    }

    private async completeUnit(): Promise<void> {
        if (!this.ctx) return;
        if (countUnitWords(this.getBody()) < 50) {
            new Notice('正文还太短，先写够 50 字再标记完成', 5000);
            return;
        }
        const saved = await this.flushSave({ markWritten: true });
        if (!saved) return;
        showSuccessNotice(`${this.ctx.unitName} 已标记为已写`, { timeout: 4000 });

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
