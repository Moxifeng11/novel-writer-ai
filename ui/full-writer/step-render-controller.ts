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
import { App } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { StepRunner, ALL_FULL_STEPS, FullStep } from '../../engine/step-runner';
import { downstreamStepsAfterPlanningChange } from '../../engine/planning-step-advance';
import { BODY_CHANGE_INVALIDATED_STEPS } from '../../engine/step-definitions';
import { assessContextReadiness } from '../../engine/context-readiness';
import type { GatheredContext } from '../../engine/context-manager';
import { ChapterStateManager } from '../states/chapter-state-manager';
import {
    getStreamlinedPhases,
    getPhaseStatusDescriptor,
    isPhaseClickable,
    mapStreamlinedPhaseToStepIndex,
    StreamlinedPhase,
} from './streamlined-nav-presenter';
import { showError, showSuccess, showWarning } from '../../utils/helpers';
import { SceneOutlineController } from './scene-outline-controller';
import { openSceneConfirmWizard } from '../scene-confirm-modal';
import { AnalysisReportPanel } from '../components/analysis-report-panel';
import { createLogger } from '../../shared/logger';


const log = createLogger('StepRenderController');
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
}

export class StepRenderController {
    private deps: StepRenderDeps;

    constructor(deps: StepRenderDeps) {
        this.deps = deps;
    }

    renderStepNav(workspace: HTMLElement): void {
        const d = this.deps;
        const cs = d.chapterState;
        const nav = workspace.createDiv({ cls: 'novel-writer-fw-step-nav' });
        nav.createEl('h4', { text: '阶段导航', cls: 'novel-writer-fw-nav-title' });

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
                sub.createSpan({ text: icon, cls: 'novel-writer-fw-substep-icon' });
                sub.createSpan({ text: def?.label || stepKey, cls: 'novel-writer-fw-substep-label' });
                if (def?.required) sub.createSpan({ text: '必做', cls: 'novel-writer-fw-substep-mark' });
                sub.setAttr('title', stale ? '已过期，需重新执行' : done ? '已完成' : partial ? '部分完成' : '未执行');
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
            if (item.required) row.createSpan({ text: '必做', cls: 'novel-writer-fw-context-input-badge' });
            row.createSpan({ text: item.detail, cls: 'novel-writer-fw-context-input-detail' });
            row.setAttr('title', item.required ? '本章必做输入，缺失会影响写作质量' : '可选输入，缺失不阻塞流程');
        }

        const actions = area.createDiv({ cls: 'novel-writer-fw-context-actions' });
        const reloadBtn = actions.createEl('button', { text: '🔄 重新加载上下文', cls: 'novel-writer-fw-btn' });
        reloadBtn.onclick = async () => {
            reloadBtn.disabled = true;
            reloadBtn.setText('⏳ 重新加载中...');
            try {
                await d.reloadContext();
            } finally {
                reloadBtn.disabled = false;
                reloadBtn.setText('🔄 重新加载上下文');
            }
        };

        area.createEl('p', {
            text: '清单反映本次加载结果；缺失必做项时，请先补齐项目设定/大纲/上章内容，再重新加载。',
            cls: 'novel-writer-fw-context-hint',
        });
    }

    renderAutoStep(area: HTMLElement, step: FullStep): void {
        const d = this.deps;
        const cs = d.chapterState;
        area.createEl('h3', { text: step.label });
        if (step.index === 0) {
            this.renderContextInputs(area);
        } else if (step.auto && step.index > 0) {
            if (cs.stepCompleted.has('settlement')) {
                area.createEl('p', { text: '✅ 章节结算已完成。', cls: 'novel-writer-fw-success-text' });
                // v1.3.0: 添加「重新结算」按钮，允许用户在补跑分析报告后重新触发
                const reBtn = area.createEl('button', {
                    text: '🔄 重新结算', cls: 'novel-writer-fw-btn'
                });
                reBtn.style.marginTop = '8px';
                reBtn.onclick = () => {
                    cs.stepCompleted.delete('settlement');
                    d.stepRunner.executeSettlement(
                        d.getProject(), d.getChapDir(), d.getChapterName(),
                        cs.stepResults, cs.stepCompleted, d.getVars(),
                        d.plugin,
                        (c) => d.renderInContainer(c),
                        d.getTabContent(),
                    );
                };
                // v3.4.9: 结算完成后渲染润色编辑器
                d.renderPolishEditor(area);
            } else {
                area.createEl('p', { text: '触发自动结算...' });
                d.stepRunner.executeSettlement(
                    d.getProject(), d.getChapDir(), d.getChapterName(),
                    cs.stepResults, cs.stepCompleted, d.getVars(),
                    d.plugin,
                    (c) => d.renderInContainer(c),
                    d.getTabContent(),
                );
            }
        }
    }

    /**
     * 规划步骤变更后失效已生成的正文与下游；正文未生成时不动，避免把空正文标成待重做。
     */
    private invalidateBodyAfterPlanningChange(cs: ChapterStateManager, stepKey: string): void {
        const hasBody = cs.stepCompleted.has('bodyGeneration')
            || Boolean((cs.stepResults['bodyGeneration'] || '').trim());
        const downstream = downstreamStepsAfterPlanningChange(stepKey, hasBody);
        if (downstream.length > 0) cs.invalidateSteps(downstream);
    }

    renderResultArea(area: HTMLElement, stepKey: string): void {
        const d = this.deps;
        const cs = d.chapterState;
        // v3.4.8 SOURCE: 仅当本会话AI生成 或 磁盘恢复的已完成步骤 才显示"上次结果"
        // 模板骨架（无 source 字段且未达到 complete 阈值）不进入此分支
        const showResult = cs.stepResults[stepKey] && (
            cs.generatedThisSession.has(stepKey) ||
            cs.stepCompleted.has(stepKey)
        );

        // sceneExpand 步骤特殊处理：显示场景细纲编辑器
        if (stepKey === 'sceneExpand' && showResult) {
            this.renderSceneExpandResult(area);
            return;
        }

        if (showResult) {
            const resultContainer = area.createDiv({ cls: 'novel-writer-fw-result-section' });
            const titleRow = resultContainer.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' } });
            titleRow.createEl('h4', { text: '📄 现有内容/上次结果（可直接编辑）', cls: 'novel-writer-fw-result-title', attr: { style: 'margin:0;' } });
            const saveBtn = titleRow.createEl('button', {
                text: '💾 保存',
                attr: { style: 'padding:2px 10px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);' }
            });
            const resultCard = resultContainer.createDiv({ cls: 'novel-writer-fw-result-card' });
            const textarea = resultCard.createEl('textarea', {
                attr: { style: 'width:100%;min-height:180px;font-size:12px;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;white-space:pre-wrap;' }
            }) as HTMLTextAreaElement;
            textarea.value = cs.stepResults[stepKey];

            saveBtn.onclick = async () => {
                const newContent = textarea.value;
                if (!newContent.trim()) { showError('内容不能为空'); return; }
                try {
                    log.warn('[小说工坊] 💾保存按钮: stepKey=', stepKey, 'chapDir=', d.getChapDir(), 'chapterName=', d.getChapterName(), 'len=', newContent.length);
                    await d.stepRunner.saveStepResult(stepKey, newContent, d.getChapDir(), d.getChapterName(), d.getVolume());
                    // A4: 手动保存不等于完成，仍由内容结构决定 level；
                    // 只保存不推进，避免「敲几个字就变已完成」。
                    cs.updateStepState(stepKey, newContent);
                    // v3.4.8: fix/finalFix 步骤保存时同步覆写正文文件
                    if (stepKey === 'fix' || stepKey === 'finalFix') {
                        cs.stepResults['bodyGeneration'] = newContent;
                        cs.updateStepState('bodyGeneration', newContent);
                        await d.stepRunner.writeFixToBody(newContent, d.getChapDir(), d.getChapterName(), d.getVolume());
                    }
                    // 正文或修正变更 → 统一失效后续步骤（completed / levels / stale 同步）
                    if (stepKey === 'bodyGeneration' || stepKey === 'fix' || stepKey === 'finalFix') {
                        cs.invalidateSteps([...BODY_CHANGE_INVALIDATED_STEPS]);
                    }
                    // 规划变更 → 已生成正文与下游失效
                    this.invalidateBodyAfterPlanningChange(cs, stepKey);
                    const missing = cs.stepMissing[stepKey] || [];
                    if (missing.length > 0) {
                        showWarning(`${stepKey} 已保存，但未达到完成标准，缺少：${missing.join('、')}`);
                    } else {
                        showSuccess(`${stepKey} 已保存`);
                    }
                    // v3.4.9 P0-4: 保存后重新渲染当前步骤区，以便"继续下一步"按钮即时出现
                    await d.renderInContainer(d.getTabContent());
                } catch (e) {
                    showError(`保存失败: ${(e as Error).message}`);
                }
            };

            // analysisReport：按需运行 v6.0 结构化增强分析（实体/伏笔/时间线/情绪）
            if (stepKey === 'analysisReport') {
                const extra = resultContainer.createDiv({ attr: { style: 'margin-top:10px;' } });
                const btn = extra.createEl('button', {
                    text: '📊 结构化增强分析',
                    attr: {
                        style: 'padding:4px 12px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--background-secondary);'
                    }
                });
                const host = extra.createDiv();
                btn.onclick = async () => {
                    const bodyText = cs.stepResults['bodyGeneration'] || '';
                    if (!bodyText.trim()) {
                        showError('无正文内容，无法执行结构化分析');
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
                        );
                        const applyBtn = host.createEl('button', {
                            text: '✅ 应用报告变更',
                            attr: { style: 'margin-top:8px;padding:4px 12px;font-size:12px;cursor:pointer;' }
                        });
                        applyBtn.onclick = async () => {
                            const result = await panel.applyChanges();
                            if (result.success) {
                                showSuccess(`已应用 ${result.applied.length} 项变更` + (result.pending.length > 0 ? `，${result.pending.length} 项待手动处理` : ''));
                            } else {
                                showError(result.details);
                            }
                        };
                    } catch (e) {
                        showError(`结构化分析失败: ${(e as Error).message}`);
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
            text: '🎬 场景细纲编辑器',
            cls: 'novel-writer-fw-result-title',
            attr: { style: 'margin:0;' }
        });

        const btnGroup = titleRow.createDiv({ attr: { style: 'display: flex; gap: 6px;' } });

        const rawEditBtn = btnGroup.createEl('button', {
            text: '📝 纯文本编辑',
            attr: {
                style: 'padding:2px 10px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--background-secondary);'
            }
        });

        const sceneGenBtn = btnGroup.createEl('button', {
            text: '🎬 逐场景生成',
            attr: {
                style: 'padding:2px 10px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);'
            }
        });
        sceneGenBtn.onclick = async () => {
            const expansionText = cs.stepResults['sceneExpand'] || '';
            if (!expansionText.trim()) { showError('请先生成 Scene展开 内容'); return; }
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
                showError(`打开逐场景生成失败: ${(e as Error).message}`);
            }
        };

        const saveBtn = btnGroup.createEl('button', {
            text: '💾 保存',
            attr: {
                style: 'padding:2px 10px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);'
            }
        });

        const editorContainer = resultContainer.createDiv({
            cls: 'novel-writer-fw-result-card',
            attr: { style: 'padding: 0; overflow: hidden;' }
        });

        const sceneEditorWrap = editorContainer.createDiv({
            attr: { style: 'height: 500px; display: flex; flex-direction: column;' }
        });

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
                showSuccess('场景细纲已自动保存');
            }
        });

        sceneController.render(sceneEditorWrap);

        let rawMode = false;
        let rawTextarea: HTMLTextAreaElement | null = null;

        rawEditBtn.onclick = () => {
            rawMode = !rawMode;
            if (rawMode) {
                sceneEditorWrap.style.display = 'none';
                rawEditBtn.setText('🎬 场景编辑器');
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
                sceneEditorWrap.style.display = 'flex';
                rawEditBtn.setText('📝 纯文本编辑');
                if (rawTextarea && rawTextarea.parentElement) {
                    rawTextarea.parentElement.remove();
                }
                sceneController.render(sceneEditorWrap);
            }
        };

        saveBtn.onclick = async () => {
            try {
                // 纯文本模式保存的是编辑框内容，不能走场景编辑器（否则改动不会落盘）
                const saved = rawMode && rawTextarea
                    ? await sceneController.saveRawContent(rawTextarea.value)
                    : await sceneController.saveScenes();
                if (!saved) {
                    showError('保存未执行：内容为空、未解析到场景或内容未变更，原文件保持不变');
                    return;
                }
                cs.updateStepState('sceneExpand', sceneController.getSavedContent());
                this.invalidateBodyAfterPlanningChange(cs, 'sceneExpand');
                const missing = cs.stepMissing['sceneExpand'] || [];
                if (missing.length > 0) {
                    showWarning(`Scene展开 已保存，但未达到完成标准，缺少：${missing.join('、')}`);
                } else {
                    showSuccess('Scene展开 已保存');
                }
                await d.renderInContainer(d.getTabContent());
            } catch (e) {
                showError(`保存失败: ${(e as Error).message}`);
            }
        };
    }
}
