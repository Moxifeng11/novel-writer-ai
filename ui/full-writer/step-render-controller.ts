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
import { ChapterStateManager } from '../states/chapter-state-manager';
import {
    getStreamlinedPhases,
    getPhaseStatusDescriptor,
    isPhaseClickable,
    mapStreamlinedPhaseToStepIndex,
    StreamlinedPhase,
} from './streamlined-nav-presenter';
import { showError, showSuccess } from '../../utils/helpers';
import { SceneOutlineController } from './scene-outline-controller';
import { openSceneConfirmWizard } from '../scene-confirm-modal';
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

            if (isPhaseClickable(phase, cs.currentStepIndex, cs.stepCompleted)) {
                item.addClass('novel-writer-fw-step-clickable');
                item.onclick = async () => {
                    const targetIndex = mapStreamlinedPhaseToStepIndex(phase.key, cs.stepCompleted);
                    if (targetIndex !== cs.currentStepIndex) {
                        cs.currentStepIndex = targetIndex;
                        await d.renderInContainer(d.getTabContent());
                    }
                };
            }
        }

        d.renderInterventionBox(nav);
    }

    renderAutoStep(area: HTMLElement, step: FullStep): void {
        const d = this.deps;
        const cs = d.chapterState;
        area.createEl('h3', { text: step.label });
        if (step.index === 0) {
            if (cs.stepCompleted.has('context')) {
                area.createEl('p', { text: '✅ 上下文已加载完成。', cls: 'novel-writer-fw-success-text' });
                area.createEl('p', { text: '已自动跳转到第一步。请从左侧步骤导航选择步骤。' });
            } else {
                area.createDiv({ text: '⏳ 正在加载上下文...', cls: 'novel-writer-fw-loading' });
            }
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
                    // v6.0: 保存后走结构化校验更新状态，不再直接标记完成
                    // v6.x: 用户手动保存视为确认完成，强制标记为 complete
                    cs.updateStepState(stepKey, newContent, true);
                    // v3.4.8: fix/finalFix 步骤保存时同步覆写正文文件
                    if (stepKey === 'fix' || stepKey === 'finalFix') {
                        cs.stepResults['bodyGeneration'] = newContent;
                        cs.updateStepState('bodyGeneration', newContent, true);
                        await d.stepRunner.writeFixToBody(newContent, d.getChapDir(), d.getChapterName(), d.getVolume());
                    }
                    // 正文或修正变更 → 清除后续步骤
                    if (stepKey === 'bodyGeneration' || stepKey === 'fix' || stepKey === 'finalFix') {
                        cs.stepCompleted.delete('selfCheck');
                        cs.stepCompleted.delete('continuityCheck');
                        cs.stepCompleted.delete('qualityControl');
                        cs.stepCompleted.delete('analysisReport');
                        cs.stepCompleted.delete('settlement');
                        delete cs.stepLevels['selfCheck'];
                        delete cs.stepLevels['continuityCheck'];
                        delete cs.stepLevels['qualityControl'];
                        delete cs.stepLevels['analysisReport'];
                        delete cs.stepLevels['settlement'];
                    }
                    showSuccess(`${stepKey} 已保存`);
                    // v3.4.9 P0-4: 保存后重新渲染当前步骤区，以便"继续下一步"按钮即时出现
                    await d.renderInContainer(d.getTabContent());
                } catch (e) {
                    showError(`保存失败: ${(e as Error).message}`);
                }
            };
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
            getProject: () => d.getProject(),
            getChapterNum: () => {
                const name = d.getChapterName();
                const match = name.match(/\d+/);
                return match ? parseInt(match[0]) : 0;
            },
            getVolume: () => d.getVolume(),
            getChapDir: () => d.getChapDir(),
            onSceneChange: () => {
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
                await sceneController.saveScenes();
                const freshContent = cs.stepResults['sceneExpand'] || '';
                cs.updateStepState('sceneExpand', freshContent, true);
                showSuccess('Scene展开 已保存');
                await d.renderInContainer(d.getTabContent());
            } catch (e) {
                showError(`保存失败: ${(e as Error).message}`);
            }
        };
    }
}
