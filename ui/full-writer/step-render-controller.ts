/**
 * 步骤渲染控制器（D3：从 FullWriterView 外迁）
 *
 * 承载步骤流的三块渲染：
 *   - renderStepNav    左侧步骤导航 + 干预框
 *   - renderAutoStep   自动步骤（上下文加载 / 章节结算）
 *   - renderResultArea 结果区（现有内容/上次结果，可编辑保存）
 *
 * 与既有控制器（SettingLibController 等）一致：通过 deps 中的访问器闭包
 * 读取宿主视图的可变状态，避免直接触碰 FullWriterView 的 private 成员（防 TS2341）。
 * 行为与外迁前逐行等价，不改变写作流程。
 */
import { App, TFile } from 'obsidian';
import { hasMessage, t } from '@/i18n';
import NovelWriterPlugin from '@/main';
import { StepRunner, ALL_FULL_STEPS, FullStep } from '@/engine/step-runner';
import { downstreamStepsAfterPlanningChange } from '@/engine/planning-step-advance';
import { BODY_CHANGE_INVALIDATED_STEPS } from '@/engine/step-definitions';
import { assessContextReadiness } from '@/engine/context-readiness';
import { buildStoryContext, resolveStoryContextTier } from '@/engine/context/story-context-service';
import { STORY_CONTEXT_KIND_LABELS } from '@/engine/context/story-context-graph';
import { isTemplateSkeleton } from '@/engine/step-validator';
import { STEP_FILE_TYPES, getChapterFileName } from '@/engine/chapter-utils';
import { pjBodyFile } from '@/shared/paths';
import { normalizeRagSources, summarizeRagSources, type RagSource } from '@/shared/rag-sources';
import type { GatheredContext } from '@/engine/context-manager';
import { ChapterStateManager } from '@/ui/states/chapter-state-manager';
import { getStreamlinedPhases, getPhaseStatusDescriptor, isPhaseClickable, mapStreamlinedPhaseToStepIndex } from './streamlined-nav-presenter';
import { showError, showSuccess, showWarning } from '@/utils/helpers';
import { SceneOutlineController } from './scene-outline-controller';
import { openSceneConfirmWizard } from '@/ui/scene-confirm-modal';
import { AnalysisReportPanel } from '@/ui/components/analysis-report-panel';
import { createLogger } from '@/shared/logger';
import { STEP_KEYS } from '@/shared/step-keys';


const log = createLogger('StepRenderController');
/**
 * StepRenderDeps 类型定义。
 */
export interface StepRenderDeps {
    app: App;
    plugin: NovelWriterPlugin;
    stepRunner: StepRunner;
    chapterState: ChapterStateManager;
    getProject: () => string;
    getChapDir: () => string;
    getChapterName: () => string;
    getVolume: () => string;
    getVars: () => Record<string, string>;
    getContext: () => GatheredContext | null;
    getChapterNum: () => number;
    /** 重新加载上下文并重渲染（上下文步骤的清单面板用） */
    reloadContext: () => Promise<void>;
    getTabContent: () => HTMLElement;
    renderInContainer: (container: HTMLElement) => Promise<void>;
    renderInterventionBox: (container: HTMLElement) => void;
    renderPolishEditor: (area: HTMLElement) => void | Promise<void>;
    /** 把本步的手动操作错误并入统一错误卡（未提供时沿用 Notice） */
    reportStepError?: (stepKey: string, message: string) => void;
}

/**
 * StepRenderController 类。
 */
export class StepRenderController {
    private deps: StepRenderDeps;
    /** 已自动触发过结算的章节键（失败后不自动重试，避免「失败→重渲染→再失败」死循环） */
    private autoSettlementAttempted = new Set<string>();

    constructor(deps: StepRenderDeps) {
        this.deps = deps;
    }

    /**
     * renderStepNav 方法。
     * @param workspace - 工作区
     */
    renderStepNav(workspace: HTMLElement): void {
        const d = this.deps;
        const cs = d.chapterState;
        const nav = workspace.createDiv({ cls: 'novel-writer-fw-step-nav' });
        nav.createEl('h4', { text: t('fullwriter.sr.navTitle'), cls: 'novel-writer-fw-nav-title' });

        const list = nav.createDiv({ cls: 'novel-writer-fw-step-list novel-writer-fw-streamlined-list' });

        const phases = getStreamlinedPhases();
        for (const phase of phases) {
            const item = list.createDiv({ cls: 'novel-writer-fw-step-item novel-writer-fw-phase-item' });

            if (phase.colorClass) item.addClass(phase.colorClass);

            const status = getPhaseStatusDescriptor(
                phase, cs.currentStepIndex,
                cs.stepCompleted, cs.stepResults,
                cs.staleSteps, cs.stepLevels,
            );
            item.addClass(status.cls);
            if (status.title) item.setAttr('title', status.title);

            item.createSpan({ text: status.icon, cls: 'novel-writer-fw-step-icon' });
            item.createSpan({ text: phase.label, cls: 'novel-writer-fw-step-label' });

            const clickable = isPhaseClickable(phase, cs.currentStepIndex, cs.stepCompleted);
            if (clickable) {
                item.addClass('novel-writer-fw-step-clickable');
                item.onclick = async () => {
                    const targetIndex = mapStreamlinedPhaseToStepIndex(phase.key, cs.stepCompleted);
                    if (targetIndex !== cs.currentStepIndex) {
                        cs.currentStepIndex = targetIndex;
                        await d.renderInContainer(d.getTabContent());
                    }
                };
            }

            // 步骤级状态：阶段只显示必做完成度，具体哪一步做了/跳过了在这里逐项可见
            phase.steps.forEach((stepKey, i) => {
                const stepIndex = phase.stepIndexes[i];
                const def = ALL_FULL_STEPS.find((s) => s.index === stepIndex);
                const level = cs.stepLevels[stepKey];
                const done = cs.stepCompleted.has(stepKey) || level === 'complete';
                const stale = cs.staleSteps.has(stepKey);
                const partial = !done && (level === 'partial' || Boolean(cs.stepResults[stepKey]));
                const icon = stale ? '⚠️' : done ? '✅' : partial ? '◐' : '○';
                const cls = ['novel-writer-fw-substep'];
                if (stepIndex === cs.currentStepIndex) cls.push('novel-writer-fw-substep-active');
                if (def?.required) cls.push('novel-writer-fw-substep-required');
                const sub = list.createDiv({ cls: cls.join(' ') });
                // G6-5：分片刷新按 key 定位并更新完成标记
                sub.setAttr('data-nw-substep', stepKey);
                sub.createSpan({ text: icon, cls: 'novel-writer-fw-substep-icon' });
                sub.createSpan({ text: def?.labelKey && hasMessage(def.labelKey) ? t(def.labelKey) : (def?.label || stepKey), cls: 'novel-writer-fw-substep-label' });
                if (def?.required) sub.createSpan({ text: t('fullwriter.sr.requiredMark'), cls: 'novel-writer-fw-substep-mark' });
                sub.setAttr('title', stale ? t('fullwriter.sr.staleTitle') : done ? t('fullwriter.sr.doneTitle') : partial ? t('fullwriter.sr.partialTitle') : t('fullwriter.sr.notRunTitle'));
                if (clickable) {
                    sub.onclick = async () => {
                        if (stepIndex !== cs.currentStepIndex) {
                            cs.currentStepIndex = stepIndex;
                            await d.renderInContainer(d.getTabContent());
                        }
                    };
                }
            });
        }

        d.renderInterventionBox(nav);
    }

    /**
     * 上下文加载步骤：显示本次实际喂入了什么，并判断对当前章节是否完整（Rev 185）。
     * 旧实现只有一句「✅ 上下文已加载完成」，用户无法核对输入，也看不到缺失。
     */
    private renderContextInputs(area: HTMLElement): void {
        const d = this.deps;
        const readiness = assessContextReadiness(d.getContext(), d.getChapterNum());

        const head = area.createDiv({
            cls: 'novel-writer-fw-context-readiness ' + (readiness.ready ? 'is-ready' : 'is-incomplete'),
        });
        head.createSpan({ text: readiness.ready ? '✅' : '⚠️', cls: 'novel-writer-fw-context-readiness-icon' });
        head.createSpan({ text: readiness.summary, cls: 'novel-writer-fw-context-readiness-text' });

        const list = area.createDiv({ cls: 'novel-writer-fw-context-input-list' });
        for (const item of readiness.items) {
            const row = list.createDiv({
                cls: 'novel-writer-fw-context-input-row'
                    + (item.required ? ' is-required' : '')
                    + (item.ok ? ' is-ok' : ' is-missing'),
            });
            row.createSpan({ text: item.ok ? '✅' : (item.required ? '⚠️' : '○'), cls: 'novel-writer-fw-context-input-icon' });
            row.createSpan({ text: item.label, cls: 'novel-writer-fw-context-input-label' });
            if (item.required) row.createSpan({ text: t('fullwriter.sr.requiredMark'), cls: 'novel-writer-fw-context-input-badge' });
            row.createSpan({ text: item.detail, cls: 'novel-writer-fw-context-input-detail' });
            row.setAttr('title', item.required ? t('fullwriter.sr.requiredInputTip') : t('fullwriter.sr.optionalInputTip'));
        }

        this.renderStoryContextCoverage(area);

        const actions = area.createDiv({ cls: 'novel-writer-fw-context-actions' });
        const reloadBtn = actions.createEl('button', { text: t('fullwriter.sr.reloadBtn'), cls: 'novel-writer-fw-btn' });
        reloadBtn.onclick = async () => {
            reloadBtn.disabled = true;
            reloadBtn.setText(t('fullwriter.sr.reloading'));
            try {
                await d.reloadContext();
            } finally {
                reloadBtn.disabled = false;
                reloadBtn.setText(t('fullwriter.sr.reloadBtn'));
            }
        };

        area.createEl('p', {
            text: t('fullwriter.sr.contextListHint'),
            cls: 'novel-writer-fw-context-hint',
        });
    }

    /**
     * 故事上下文包覆盖度：让用户看到本章实际选中了哪些核心信息、丢了多少。
     * 与 buildTemplateVars 使用同一套图/预算，避免面板与 prompt 两套口径。
     */
    private renderStoryContextCoverage(area: HTMLElement): void {
        const d = this.deps;
        const context = d.getContext();
        if (!context) return;
        try {
            const settings = d.plugin.settings;
            const tier = resolveStoryContextTier(settings, 'one-click');
            const maxInputTokens = Math.max(
                2048,
                (settings.maxContext || 0) - (settings.maxOutput || 0) - 1024,
            );
            const result = buildStoryContext({
                context,
                chapterName: d.getChapterName(),
                chapterNum: d.getChapterNum(),
                volume: d.getVolume(),
                mode: 'one-click',
                tier,
                maxInputTokens,
                modelId: settings.defaultModel,
                sceneExpansionText: d.chapterState.stepResults['sceneExpand'] || '',
                emotionPlanText: d.chapterState.stepResults['emotionPlan'] || '',
                precedingText: context.data.previous_chapter?.ending || '',
            });
            const tm = result.bundle.telemetry;
            const ok = tm.missingRequired.length === 0;
            const row = area.createDiv({
                cls: 'novel-writer-fw-context-input-row is-required ' + (ok ? 'is-ok' : 'is-missing'),
            });
            row.createSpan({ text: ok ? '✅' : '⚠️', cls: 'novel-writer-fw-context-input-icon' });
            row.createSpan({ text: t('fullwriter.sr.contextPack'), cls: 'novel-writer-fw-context-input-label' });
            row.createSpan({ text: t('fullwriter.sr.autoRetrieve'), cls: 'novel-writer-fw-context-input-badge' });
            row.createSpan({
                text: t('fullwriter.sr.packSummary', { tier: tm.tier === 'local' ? t('cowrite.modeLocal') : t('cowrite.modeCloud'), included: tm.included, used: tm.estimatedTokens, budget: tm.budgetTokens, reqIn: tm.requiredIncluded, reqTotal: tm.requiredTotal }),
                cls: 'novel-writer-fw-context-input-detail',
            });
            const kindText = Object.entries(tm.byKind)
                .filter(([, v]) => v.total > 0)
                .map(([kind, v]) => `${STORY_CONTEXT_KIND_LABELS[kind as keyof typeof STORY_CONTEXT_KIND_LABELS]} ${v.included}/${v.total}`)
                .join(' · ');
            const detail = area.createDiv({ cls: 'novel-writer-fw-context-hint' });
            detail.setText(kindText
                + (tm.deduped > 0 ? t('fullwriter.sr.deduped', { count: tm.deduped, pct: Math.round(tm.dedupeRate * 100) }) : '')
                + (tm.dropped > 0 ? t('fullwriter.sr.dropped', { count: tm.dropped }) : ''));
            if (tm.missingRequired.length > 0) {
                detail.setText(t('fullwriter.sr.missingRequired', { fields: tm.missingRequired.slice(0, 5).join('、'), extra: detail.textContent || '' }));
            }
            if (tm.warnings.length > 0) {
                const warn = area.createDiv({ cls: 'novel-writer-fw-context-hint' });
                warn.setText(`⚠️ ${tm.warnings.slice(0, 2).join('；')}`);
            }
        } catch (e) {
            log.warn('[StepRenderController] 故事上下文包覆盖度计算失败:', e);
        }
    }

    /**
     * renderAutoStep 方法。
     * @param area - 区域
     * @param step - 步骤
     */
    renderAutoStep(area: HTMLElement, step: FullStep): void {
        const d = this.deps;
        const cs = d.chapterState;
        area.createEl('h3', { text: step.label });
        if (step.index === 0) {
            this.renderContextInputs(area);
        } else if (step.auto && step.index > 0) {
            if (cs.stepCompleted.has('settlement')) {
                this.autoSettlementAttempted.delete(`${d.getProject()}|${d.getChapDir()}`);
                area.createEl('p', { text: t('fullwriter.sr.settleDone'), cls: 'novel-writer-fw-success-text' });
                // v1.3.0: 添加「重新结算」按钮，允许用户在补跑分析报告后重新触发
                const reBtn = area.createEl('button', {
                    text: t('fullwriter.sr.reSettleBtn'), cls: 'novel-writer-fw-btn'
                });
                reBtn.addClass('nw-mt-8');
                reBtn.onclick = () => {
                    cs.stepCompleted.delete('settlement');
                    void d.stepRunner.executeSettlement(
                        d.getProject(), d.getChapDir(), d.getChapterName(),
                        cs.stepResults, cs.stepCompleted, d.getVars(),
                        d.plugin,
                        (c) => d.renderInContainer(c),
                        d.getTabContent(),
                        { force: true },
                    );
                };
                // v3.4.9: 结算完成后渲染润色编辑器
                void d.renderPolishEditor(area);
            } else {
                // 结算成功后会 add('settlement') 并重渲染；失败时也会重渲染。
                // 若每次渲染都自动触发，失败 → 重渲染 → 再失败会变成无限循环，
                // 所以同一章只自动触发一次，失败后改为显式按钮交给用户重试。
                const chapterKey = `${d.getProject()}|${d.getChapDir()}`;
                if (this.autoSettlementAttempted.has(chapterKey)) {
                    area.createEl('p', {
                        text: t('fullwriter.sr.autoSettleIncomplete'),
                        cls: 'novel-writer-fw-context-hint',
                    });
                    const retryBtn = area.createEl('button', {
                        text: t('fullwriter.sr.reSettleBtn2'), cls: 'novel-writer-fw-btn',
                    });
                    retryBtn.addClass('nw-mt-8');
                    retryBtn.onclick = () => {
                        retryBtn.disabled = true;
                        this.autoSettlementAttempted.add(chapterKey);
                        void d.stepRunner.executeSettlement(
                            d.getProject(), d.getChapDir(), d.getChapterName(),
                            cs.stepResults, cs.stepCompleted, d.getVars(),
                            d.plugin,
                            (c) => d.renderInContainer(c),
                            d.getTabContent(),
                        ).finally(() => { retryBtn.disabled = false; });
                    };
                } else {
                    this.autoSettlementAttempted.add(chapterKey);
                    area.createEl('p', { text: t('fullwriter.sr.triggeringSettle') });
                    void d.stepRunner.executeSettlement(
                        d.getProject(), d.getChapDir(), d.getChapterName(),
                        cs.stepResults, cs.stepCompleted, d.getVars(),
                        d.plugin,
                        (c) => d.renderInContainer(c),
                        d.getTabContent(),
                    );
                }
            }
        }
    }

    /**
     * 规划步骤变更后失效已生成的正文与下游；正文未生成时不动，避免把空正文标成待重做。
     */
    private invalidateBodyAfterPlanningChange(cs: ChapterStateManager, stepKey: string): void {
        const hasBody = cs.stepCompleted.has(STEP_KEYS.BODY_GENERATION)
            || Boolean((cs.stepResults[STEP_KEYS.BODY_GENERATION] || '').trim());
        const downstream = downstreamStepsAfterPlanningChange(stepKey, hasBody);
        if (downstream.length > 0) cs.invalidateSteps(downstream);
    }

    /** 读取本步（含正文）frontmatter 的 rag_sources；文件不存在或无字段返回空 */
    private readRagSources(stepKey: string): RagSource[] {
        const d = this.deps;
        const chapDir = d.getChapDir();
        const chapterName = d.getChapterName();
        if (!chapDir || !chapterName) return [];

        const candidates: string[] = [];
        const type = (STEP_FILE_TYPES as Record<string, string>)[stepKey];
        if (type) candidates.push(`${chapDir}/${getChapterFileName(chapterName, type)}`);
        if (stepKey === STEP_KEYS.BODY_GENERATION) {
            const match = chapDir.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
            if (match) {
                candidates.push(pjBodyFile(match[1], parseInt(match[2], 10), parseInt(match[3], 10)));
            }
        }

        for (const path of candidates) {
            const file = d.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;
            const frontmatter = d.app.metadataCache.getFileCache(file)?.frontmatter;
            const sources = normalizeRagSources(frontmatter?.['rag_sources']);
            if (sources.length > 0) return sources;
        }
        return [];
    }

    /**
     * renderResultArea 方法。
     * @param area - 区域
     * @param stepKey - 步骤键
     */
    renderResultArea(area: HTMLElement, stepKey: string): void {
        const d = this.deps;
        const cs = d.chapterState;
        // v3.4.8 SOURCE: 仅当本会话AI生成 或 磁盘恢复的已完成步骤 才显示"上次结果"
        // 模板骨架（无 source 字段且未达到 complete 阈值）不进入此分支
        const rawResult = cs.stepResults[stepKey] || '';
        const hasResult = rawResult.trim().length > 0;
        const skeleton = hasResult && isTemplateSkeleton(rawResult, stepKey);
        const showResult = hasResult && !skeleton && (
            cs.generatedThisSession.has(stepKey) ||
            cs.stepCompleted.has(stepKey)
        );

        if (hasResult && skeleton && (cs.generatedThisSession.has(stepKey) || cs.stepCompleted.has(stepKey))) {
            area.createDiv({
                text: t('fullwriter.sr.skeletonOnly'),
                cls: 'novel-writer-fw-warning',
            });
        }

        // sceneExpand 步骤特殊处理：显示场景细纲编辑器
        if (stepKey === 'sceneExpand' && showResult) {
            this.renderSceneExpandResult(area);
            return;
        }

        if (showResult) {
            const resultContainer = area.createDiv({ cls: 'novel-writer-fw-result-section' });
            const titleRow = resultContainer.createDiv({ cls: 'nw-result-title-row' });
            const title = cs.stepCompleted.has(stepKey) ? t('fullwriter.sr.resultDone') : t('fullwriter.sr.resultNotMet');
            titleRow.createEl('h4', { text: title, cls: 'novel-writer-fw-result-title' });
            titleRow.createSpan({
                text: t('fullwriter.sr.resultMeta', { count: rawResult.trim().length, state: cs.stepCompleted.has(stepKey) ? t('fullwriter.sr.validated') : t('fullwriter.sr.draftSaved') }),
                cls: 'nw-result-meta',
            });
            const saveBtn = titleRow.createEl('button', {
                text: t('fullwriter.sr.saveChangesBtn'),
                cls: 'nw-result-save-btn',
            });

            // G2-3b：显示本步实际引用的知识库片段（frontmatter.rag_sources）
            const ragSources = this.readRagSources(stepKey);
            if (ragSources.length > 0) {
                const strip = resultContainer.createDiv({
                    cls: 'nw-result-meta',
                    attr: {
                        title: ragSources
                            .map(item => `${item.book}（${item.dimension}） ${item.score}\n${item.excerpt}`)
                            .join('\n\n'),
                    },
                });
                strip.setText(t('fullwriter.sr.knowledgeSources', { sources: summarizeRagSources(ragSources) }));
            }

            // 先给结果预览，编辑原文折叠，避免大段 textarea 把成果挤到看不见。
            const preview = resultContainer.createDiv({ cls: 'nw-result-preview' });
            preview.textContent = rawResult.length > 2400 ? rawResult.slice(0, 2400) + '\n' + t('fullwriter.sr.truncatedPreview') : rawResult;

            const editor = resultContainer.createEl('details', { cls: 'nw-result-editor' });
            editor.createEl('summary', { text: t('fullwriter.sr.expandEdit', { count: rawResult.length }) });
            const textarea = editor.createEl('textarea', {
                cls: 'nw-result-textarea',
            }) as HTMLTextAreaElement;
            textarea.value = rawResult;

            saveBtn.onclick = async () => {
                const newContent = textarea.value;
                if (!newContent.trim()) { showError(t('fullwriter.sr.contentEmpty')); return; }
                try {
                    log.warn('[小说工坊] 💾保存按钮: stepKey=', stepKey, 'chapDir=', d.getChapDir(), 'chapterName=', d.getChapterName(), 'len=', newContent.length);
                    const saved = await d.stepRunner.saveStepResult(stepKey, newContent, d.getChapDir(), d.getChapterName(), d.getVolume());
                    if (!saved) {
                        // saveStepResult 返回 false 表示根本没落盘（chapDir 为空/无文件映射/写盘异常），
                        // 旧实现继续更新内存并提示「已保存」，用户切章后才发现内容丢了。
                        showError(t('fullwriter.sr.saveNoFile', { step: stepKey }));
                        if (d.reportStepError) d.reportStepError(stepKey, t('fullwriter.sr.saveNoFileShort'));
                        return;
                    }
                    // A4: 手动保存不等于完成，仍由内容结构决定 level；
                    // 只保存不推进，避免「敲几个字就变已完成」。
                    cs.updateStepState(stepKey, newContent);
                    // v3.4.8: fix/finalFix 步骤保存时同步覆写正文文件
                    if (stepKey === 'fix' || stepKey === 'finalFix') {
                        cs.stepResults[STEP_KEYS.BODY_GENERATION] = newContent;
                        cs.updateStepState(STEP_KEYS.BODY_GENERATION, newContent);
                        await d.stepRunner.writeFixToBody(newContent, d.getChapDir(), d.getChapterName(), d.getVolume());
                    }
                    // 正文或修正变更 → 统一失效后续步骤（completed / levels / stale 同步）
                    if (stepKey === STEP_KEYS.BODY_GENERATION || stepKey === 'fix' || stepKey === 'finalFix') {
                        cs.invalidateSteps([...BODY_CHANGE_INVALIDATED_STEPS]);
                    }
                    // 规划变更 → 已生成正文与下游失效
                    this.invalidateBodyAfterPlanningChange(cs, stepKey);
                    const missing = cs.stepMissing[stepKey] || [];
                    if (missing.length > 0) {
                        showWarning(t('fullwriter.sr.savedBelowStandard', { step: stepKey, fields: missing.join('、') }));
                    } else {
                        showSuccess(t('fullwriter.sr.savedOk', { step: stepKey }));
                    }
                    // v3.4.9 P0-4: 保存后重新渲染当前步骤区，以便"继续下一步"按钮即时出现
                    await d.renderInContainer(d.getTabContent());
                } catch (e) {
                    const message = t('fullwriter.sr.saveFailedWith', { msg: (e as Error).message });
                    if (d.reportStepError) d.reportStepError(stepKey, message);
                    else showError(message);
                }
            };

            // analysisReport：按需运行 v6.0 结构化增强分析（实体/伏笔/时间线/情绪）
            if (stepKey === STEP_KEYS.ANALYSIS_REPORT) {
                const extra = resultContainer.createDiv({ attr: { style: 'margin-top:10px;' } });
                const btn = extra.createEl('button', {
                    text: t('fullwriter.sr.enhancedAnalysisBtn'),
                    attr: {
                        style: 'padding:4px 12px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--background-secondary);'
                    }
                });
                const host = extra.createDiv();
                btn.onclick = async () => {
                    const bodyText = cs.stepResults[STEP_KEYS.BODY_GENERATION] || '';
                    if (!bodyText.trim()) {
                        showError(t('fullwriter.sr.needBodyForAnalysis'));
                        return;
                    }
                    btn.disabled = true;
                    const numMatch = d.getChapterName().match(/\d+/);
                    const panel = new AnalysisReportPanel(d.app, d.plugin.analysisReportEngine);
                    try {
                        await panel.analyzeAndRender(
                            host,
                            d.getProject(),
                            bodyText,
                            d.getChapterName(),
                            numMatch ? parseInt(numMatch[0], 10) : 0,
                            d.getVolume(),
                            cs.stepResults[STEP_KEYS.ANALYSIS_REPORT] || '',
                        );
                        const applyBtn = host.createEl('button', {
                            text: t('fullwriter.sr.applyChangesBtn'),
                            attr: { style: 'margin-top:8px;padding:4px 12px;font-size:12px;cursor:pointer;' }
                        });
                        applyBtn.onclick = async () => {
                            const result = await panel.applyChanges();
                            if (result.success) {
                                showSuccess(t('fullwriter.sr.changesApplied', { applied: result.applied.length, pending: result.pending.length > 0 ? t('fullwriter.sr.pendingSuffix', { count: result.pending.length }) : '' }));
                            } else {
                                showError(result.details);
                            }
                        };
                    } catch (e) {
                        showError(t('fullwriter.sr.analysisFailed', { msg: (e as Error).message }));
                    } finally {
                        btn.disabled = false;
                    }
                };
            }
        }
    }

    /**
     * 渲染 Scene展开 步骤的结果区：场景细纲编辑器
     */
    private renderSceneExpandResult(area: HTMLElement): void {
        const d = this.deps;
        const cs = d.chapterState;

        const resultContainer = area.createDiv({ cls: 'novel-writer-fw-result-section' });

        const titleRow = resultContainer.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' }
        });
        titleRow.createEl('h4', {
            text: t('fullwriter.sr.sceneEditorBtn'),
            cls: 'novel-writer-fw-result-title',
            attr: { style: 'margin:0;' }
        });

        const btnGroup = titleRow.createDiv({ attr: { style: 'display: flex; gap: 6px;' } });

        const rawEditBtn = btnGroup.createEl('button', {
            text: t('fullwriter.sr.rawEditBtn'),
            attr: {
                style: 'padding:2px 10px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--background-secondary);'
            }
        });

        const sceneGenBtn = btnGroup.createEl('button', {
            text: t('fullwriter.sr.perSceneGenBtn'),
            attr: {
                style: 'padding:2px 10px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);'
            }
        });
        sceneGenBtn.onclick = async () => {
            const expansionText = cs.stepResults['sceneExpand'] || '';
            if (!expansionText.trim()) { showError(t('fullwriter.sr.needSceneExpand')); return; }
            const chapterName = d.getChapterName();
            const chapterNumMatch = chapterName.match(/\d+/);
            const chapterNumber = chapterNumMatch ? parseInt(chapterNumMatch[0]) : 0;
            const chapterPlan = cs.stepResults['outline'] || cs.stepResults['plotDistill'] || '';
            try {
                await openSceneConfirmWizard({
                    plugin: d.plugin,
                    project: d.getProject(),
                    chapterName,
                    chapterNumber,
                    expansionText,
                    chapterPlan,
                    volumeName: d.getVolume(),
                });
            } catch (e) {
                showError(t('fullwriter.sr.perSceneOpenFailed', { msg: (e as Error).message }));
            }
        };

        const saveBtn = btnGroup.createEl('button', {
            text: t('fullwriter.sr.saveBtn'),
            attr: {
                style: 'padding:2px 10px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);'
            }
        });

        const editorContainer = resultContainer.createDiv({
            cls: 'novel-writer-fw-result-card',
            attr: { style: 'padding: 0; overflow: hidden;' }
        });

        const sceneEditorWrap = editorContainer.createDiv({ cls: 'nw-scene-editor-wrap' });

        const sceneController = new SceneOutlineController({
            app: d.app,
            plugin: d.plugin,
            getProject: () => d.getProject(),
            getChapterNum: () => {
                const name = d.getChapterName();
                const match = name.match(/\d+/);
                return match ? parseInt(match[0]) : 0;
            },
            getVolume: () => d.getVolume(),
            getChapDir: () => d.getChapDir(),
            onSceneChange: () => {
                // A7: 自动保存也是规划变更，必须与手动保存走同一条失效传播，
                // 否则下游（质量/分析/结算）仍显示已完成。
                const saved = sceneController.getSavedContent();
                if (saved) {
                    cs.stepResults['sceneExpand'] = saved;
                    cs.updateStepState('sceneExpand', saved);
                }
                this.invalidateBodyAfterPlanningChange(cs, 'sceneExpand');
                showSuccess(t('fullwriter.sr.sceneAutosaved'));
            }
        });

        void sceneController.render(sceneEditorWrap);

        let rawMode = false;
        let rawTextarea: HTMLTextAreaElement | null = null;

        rawEditBtn.onclick = () => {
            rawMode = !rawMode;
            if (rawMode) {
                sceneEditorWrap.addClass('nw-u-d-none');
                rawEditBtn.setText(t('fullwriter.sr.sceneEditorBtn2'));
                const rawContainer = editorContainer.createDiv({
                    attr: { style: 'padding: 8px;' }
                });
                rawTextarea = rawContainer.createEl('textarea', {
                    attr: {
                        style: 'width:100%;min-height:460px;font-size:12px;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;white-space:pre-wrap;'
                    }
                }) as HTMLTextAreaElement;
                rawTextarea.value = cs.stepResults['sceneExpand'] || '';
            } else {
                sceneEditorWrap.removeClass('nw-u-d-none');
                rawEditBtn.setText(t('fullwriter.sr.rawEditBtn'));
                if (rawTextarea && rawTextarea.parentElement) {
                    rawTextarea.parentElement.remove();
                }
                void sceneController.render(sceneEditorWrap);
            }
        };

        saveBtn.onclick = async () => {
            try {
                // 纯文本模式保存的是编辑框内容，不能走场景编辑器（否则改动不会落盘）
                const saved = rawMode && rawTextarea
                    ? await sceneController.saveRawContent(rawTextarea.value)
                    : await sceneController.saveScenes();
                if (!saved) {
                    showError(t('fullwriter.sr.sceneSaveSkipped'));
                    return;
                }
                cs.updateStepState('sceneExpand', sceneController.getSavedContent());
                this.invalidateBodyAfterPlanningChange(cs, 'sceneExpand');
                const missing = cs.stepMissing['sceneExpand'] || [];
                if (missing.length > 0) {
                    showWarning(t('fullwriter.sr.sceneSavedBelowStandard', { fields: missing.join('、') }));
                } else {
                    showSuccess(t('fullwriter.sr.sceneSavedOk'));
                }
                await d.renderInContainer(d.getTabContent());
            } catch (e) {
                showError(t('fullwriter.sr.saveFailedWith', { msg: (e as Error).message }));
            }
        };
    }
}
