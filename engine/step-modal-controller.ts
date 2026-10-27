/**
 * step-modal-controller.ts — 步骤弹窗控制器
 *
 * 职责：消痕改写弹窗、迭代精修弹窗、逐轮选择弹窗、浮层创建、样式注入。
 *
 * 从 step-runner.ts 拆分而来，原代码约 550 行。
 */

import { TFile } from 'obsidian';
import { AIEngine } from './ai-engine';
import { LongNovelSingleCallTasks } from './harness/long-novel-tasks';
import { injectDeaiModalStyles as _injectDeai, injectRefineModalStyles as _injectRefine, injectRoundSelectStyles as _injectRound } from '../ui/full-writer/step-modal-styles';
import { StepRunnerCallbacks, NOOP_CALLBACKS } from './step-runner-callbacks';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import { TemplateService } from '../services/template-service';
import { ENGINE_NAMES } from './engine-registry';
import { NOTICE_ERROR } from '../shared/thresholds';
import {
    DEAI_CHECK_SYSTEM_PROMPT,
    DEAI_CHECK_USER_TEMPLATE,
    DEAI_REWRITE_SYSTEM_PROMPT,
    DEAI_REWRITE_USER_TEMPLATE,
    SELF_CHECK_PROMPTS,
} from './prompt-templates';
import { RulesService } from '../services/rules-service';
import { BODY_CHANGE_INVALIDATED_STEPS } from './step-definitions';
import { createLogger } from '../shared/logger';


const log = createLogger('StepModalController');
export interface StepModalDeps {
    getAIEngine: () => AIEngine;
    getPlugin: () => any;
    saveStepResult: (stepKey: string, content: string, chapDir: string, chapterName: string, volume: string) => Promise<boolean>;
    callbacks: StepRunnerCallbacks;
    fs?: FileSystemPort;
    /** A7: 正文被改写后的统一失效传播（优先于手动 delete，保证 stepLevels/staleSteps 同步） */
    invalidateSteps?: (stepKeys: string[]) => void;
}

export class StepModalController {
    private app: import('obsidian').App;
    private deps: StepModalDeps;
    private fs: FileSystemPort | null = null;
    private templateService: TemplateService | null = null;

    constructor(app: import('obsidian').App, deps: StepModalDeps) {
        this.app = app;
        this.deps = deps;
    }

    /** 获取 FileSystemPort 实例（懒加载，优先使用 deps.fs） */
    private getFS(): FileSystemPort {
        if (this.deps.fs) return this.deps.fs;
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** A7: 消痕/迭代接受后正文已变，统一失效下游；无注入时退回旧行为 */
    private invalidateAfterBodyChange(stepCompleted?: Set<string>): void {
        const keys = [...BODY_CHANGE_INVALIDATED_STEPS];
        if (this.deps.invalidateSteps) {
            this.deps.invalidateSteps(keys);
            return;
        }
        for (const key of keys) stepCompleted?.delete(key);
    }

    /** 获取 TemplateService 实例（通过 EngineRegistry 获取共享实例） */
    private getTemplateService(): TemplateService {
        if (!this.templateService) {
            const plugin = this.deps.getPlugin();
            this.templateService = plugin.engineRegistry.get(ENGINE_NAMES.TEMPLATE_SERVICE) as TemplateService;
        }
        return this.templateService!;
    }

    /**
     * 执行 AI 消痕改写（两阶段弹窗）
     */
    async executeDeaiRewrite(
        stepResults: Record<string, string>,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        setIsLoading: (loading: boolean) => void,
        chapDir: string,
        chapterName: string,
        volume: string,
        stepCompleted: Set<string>,
    ): Promise<void> {
        const bodyText = stepResults['bodyGeneration'];
        if (!bodyText) {
            this.deps.callbacks.showError('没有正文可改写');
            return;
        }

        // 加载自定义 DEAI 模板（优先）或使用硬编码默认值
        const templateService = this.getTemplateService();
        const [deaiCheckTemplate, deaiRewriteTemplate] = await Promise.all([
            templateService.getCustomPrompt('deaiCheck', {
                system: DEAI_CHECK_SYSTEM_PROMPT,
                user: DEAI_CHECK_USER_TEMPLATE,
            }),
            templateService.getCustomPrompt('deaiRewrite', {
                system: DEAI_REWRITE_SYSTEM_PROMPT.replace('${writingRules}', await RulesService.getInstance(this.deps.getPlugin().app).getWritingRules()),
                user: DEAI_REWRITE_USER_TEMPLATE,
            }),
        ]);

        const deaiCheckSystemPrompt = deaiCheckTemplate.system;
        const deaiCheckUserPrompt = deaiCheckTemplate.user.replace('${bodyText}', bodyText);
        const deaiRewriteSystemPrompt = deaiRewriteTemplate.system;
        const deaiRewriteUserTemplate = deaiRewriteTemplate.user;

        this.injectDeaiModalStyles();
        this.showDeaiTwoPhaseModal(
            bodyText, stepResults, renderInContainer, tabContent, setIsLoading, chapDir, chapterName, volume, stepCompleted,
            deaiCheckSystemPrompt, deaiRewriteSystemPrompt, deaiRewriteUserTemplate
        );
    }

    /**
     * 消痕两阶段弹窗：提示词预览 → 执行 → 结果编辑
     */
    private showDeaiTwoPhaseModal(
        bodyText: string,
        stepResults: Record<string, string>,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        setIsLoading: (loading: boolean) => void,
        chapDir: string,
        chapterName: string,
        volume: string,
        stepCompleted: Set<string>,
        deaiCheckSystemPrompt: string,
        deaiRewriteSystemPrompt: string,
        deaiRewriteUserTemplate: string,
    ): void {
        const { overlay, panel } = this.createStepOverlay(tabContent);
        panel.createEl('h3', { text: '🧹 AI消痕改写 — 提示词预览' });
        panel.createEl('p', { text: '可在下方编辑提示词后点击执行，非黑盒。自定义模板：prompts/deaiCheck-system.md', attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:12px;' } });

        const sectionSys = panel.createDiv({ cls: 'novel-writer-fw-deai-section' });
        sectionSys.createEl('label', { text: '检测系统提示词', attr: { style: 'font-weight:600;font-size:13px;display:block;margin-bottom:4px;' } });
        const detectSysTA = sectionSys.createEl('textarea', {
            attr: { style: 'width:100%;height:120px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;' }
        }) as HTMLTextAreaElement;
        detectSysTA.value = deaiCheckSystemPrompt;

        const sectionUser = panel.createDiv({ cls: 'novel-writer-fw-deai-section', attr: { style: 'margin-top:10px;' } });
        sectionUser.createEl('label', { text: '检测用户提示词（正文）', attr: { style: 'font-weight:600;font-size:13px;display:block;margin-bottom:4px;' } });
        const detectUserTA = sectionUser.createEl('textarea', {
            attr: { style: 'width:100%;height:200px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;' }
        }) as HTMLTextAreaElement;
        detectUserTA.value = DEAI_CHECK_USER_TEMPLATE.replace('${bodyText}', bodyText);

        const rewriteSection = panel.createDiv({ cls: 'novel-writer-fw-deai-section', attr: { style: 'margin-top:10px;display:none;' } });
        rewriteSection.createEl('label', { text: '改写系统提示词', attr: { style: 'font-weight:600;font-size:13px;display:block;margin-bottom:4px;' } });
        const rewriteSysTA = rewriteSection.createEl('textarea', {
            attr: { style: 'width:100%;height:120px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;' }
        }) as HTMLTextAreaElement;
        rewriteSysTA.value = deaiRewriteSystemPrompt;

        const rewriteUserSection = rewriteSection.createDiv({ attr: { style: 'margin-top:6px;' } });
        rewriteUserSection.createEl('label', { text: '改写用户提示词', attr: { style: 'font-weight:600;font-size:13px;display:block;margin-bottom:4px;' } });
        const rewriteUserTA = rewriteUserSection.createEl('textarea', {
            attr: { style: 'width:100%;height:120px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;' }
        }) as HTMLTextAreaElement;

        const resultSection = panel.createDiv({ cls: 'novel-writer-fw-deai-section', attr: { style: 'margin-top:10px;display:none;' } });
        resultSection.createEl('h4', { text: '📊 检测报告' });
        const reportEl = resultSection.createDiv({ cls: 'novel-writer-fw-deai-text' });

        resultSection.createEl('h4', { text: '📄 原文 vs ✨ 改写版', attr: { style: 'margin-top:10px;' } });
        const compareRow = resultSection.createDiv({ cls: 'novel-writer-fw-deai-compare' });
        const origCol = compareRow.createDiv({ cls: 'novel-writer-fw-deai-col' });
        origCol.createEl('h4', { text: '原文' });
        const origTextEl = origCol.createDiv({ cls: 'novel-writer-fw-deai-col-text' });

        const rewriteCol = compareRow.createDiv({ cls: 'novel-writer-fw-deai-col' });
        rewriteCol.createEl('h4', { text: '改写版（可编辑）' });
        const rewriteResultTA = rewriteCol.createEl('textarea', {
            attr: { style: 'width:100%;height:260px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;white-space:pre-wrap;' }
        }) as HTMLTextAreaElement;

        const btnRow = panel.createDiv({ cls: 'novel-writer-fw-deai-btn-row' });

        const detectBtn = btnRow.createEl('button', {
            text: '🔍 执行AI痕迹检测',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary'
        });

        const rewriteBtn = btnRow.createEl('button', {
            text: '✍️ 执行改写',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary',
            attr: { style: 'display:none;' }
        });

        const acceptBtn = btnRow.createEl('button', {
            text: '✅ 接受改写',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-success',
            attr: { style: 'display:none;' }
        });
        const rejectBtn = btnRow.createEl('button', {
            text: '❌ 保留原文',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-danger',
            attr: { style: 'display:none;' }
        });

        detectBtn.setText('✨ 单次完成消痕');
        detectBtn.onclick = async () => {
            detectBtn.disabled = true;
            detectBtn.setText('⏳ 单次消痕中...');
            try {
                const tasks = new LongNovelSingleCallTasks(this.deps.getAIEngine());
                const writingRules = await RulesService.getInstance(this.deps.getPlugin().app).getWritingRules();
                const result = await tasks.deai(bodyText, { writingRules });

                reportEl.setText([
                    result.ok ? '✅ 单次消痕完成' : '❌ 单次消痕失败',
                    `网络调用 ${result.networkCalls} 次 · 耗时 ${result.durationMs}ms`,
                    ...result.violations.map(v => `${v.ruleId}: ${v.message}`),
                ].join('\n'));
                resultSection.style.display = 'block';
                origTextEl.setText(bodyText);

                if (!result.ok) {
                    detectBtn.disabled = false;
                    detectBtn.setText('✨ 重试单次消痕');
                    return;
                }

                const value = result.value;
                rewriteUserTA.value = value?.issues?.length
                    ? value.issues.map(issue => `- ${issue}`).join('\n')
                    : '自检未发现明显 AI 痕迹';
                rewriteResultTA.value = value?.rewritten || result.raw;

                detectBtn.style.display = 'none';
                rewriteBtn.style.display = 'none';
                acceptBtn.style.display = '';
                rejectBtn.style.display = '';
            } catch (e) {
                this.deps.callbacks.showError(`消痕异常: ${(e as Error).message}`);
                detectBtn.disabled = false;
                detectBtn.setText('✨ 单次完成消痕');
            }
        };

        void rewriteBtn;
        rewriteBtn.onclick = async () => {
            rewriteBtn.disabled = true;
            rewriteBtn.setText('⏳ 改写中...');
            try {
                const rewriteResult = await this.deps.getAIEngine().callAI(
                    rewriteSysTA.value,
                    rewriteUserTA.value,
                    this.deps.getPlugin().settings.proModel,
                    0.8,
                    this.deps.getPlugin().settings.maxOutput
                );
                if (rewriteResult.error) { this.deps.callbacks.showError(`改写失败: ${rewriteResult.error}`); rewriteBtn.disabled = false; rewriteBtn.setText('✍️ 执行改写'); return; }

                rewriteResultTA.value = rewriteResult.content;
                origTextEl.setText(bodyText.slice(0, 2500) + (bodyText.length > 2500 ? '\n\n...（内容过长，已截断）' : ''));
                compareRow.scrollIntoView({ behavior: 'smooth' });

                rewriteBtn.style.display = 'none';
                acceptBtn.style.display = '';
                rejectBtn.style.display = '';
            } catch (e) {
                this.deps.callbacks.showError(`改写异常: ${(e as Error).message}`);
                rewriteBtn.disabled = false;
                rewriteBtn.setText('✍️ 执行改写');
            }
        };

        acceptBtn.onclick = async () => {
            const finalText = rewriteResultTA.value;
            if (!finalText.trim()) { this.deps.callbacks.showError('改写内容不能为空'); return; }
            try {
                log.warn('[StepModalController] AI消痕接受: chapDir=', chapDir, 'len=', finalText.length);
                stepResults['bodyGeneration'] = finalText;
                await this.deps.saveStepResult('bodyGeneration', finalText, chapDir, chapterName, volume);
                this.invalidateAfterBodyChange(stepCompleted);
                this.deps.callbacks.showSuccess('已接受改写版本，后续步骤已重置');
                overlay.remove();
                await renderInContainer(tabContent);
            } catch (e) {
                log.error('[StepModalController] 接受消痕改写失败:', e);
                this.deps.callbacks.showNotice('❌ 接受消痕改写失败：' + (e instanceof Error ? e.message : String(e)), NOTICE_ERROR);
                this.deps.callbacks.showError('保存失败，请重试');
            }
        };

        rejectBtn.onclick = async () => {
            this.deps.callbacks.showSuccess('已保留原文');
            overlay.remove();
            await renderInContainer(tabContent);
        };
    }

    /**
     * 创建浮层覆盖（不替换工作台内容）
     */
    createStepOverlay(tabContent: HTMLElement): { overlay: HTMLElement; panel: HTMLElement } {
        const workspace = tabContent.closest('.novel-writer-fw-content') as HTMLElement || tabContent;
        const computed = getComputedStyle(workspace);
        if (computed.position === 'static') workspace.style.position = 'relative';

        const existing = workspace.querySelector('.novel-writer-fw-step-overlay');
        if (existing) existing.remove();

        const overlay = workspace.createDiv({ cls: 'novel-writer-fw-step-overlay' });
        overlay.createDiv({ cls: 'novel-writer-fw-step-overlay-backdrop' });
        const panel = overlay.createDiv({ cls: 'novel-writer-fw-step-overlay-panel' });

        const closeBtn = panel.createEl('button', {
            text: '✕',
            attr: { style: 'position:absolute;top:8px;right:12px;width:28px;height:28px;border:none;background:transparent;font-size:16px;color:var(--text-muted);cursor:pointer;border-radius:4px;display:flex;align-items:center;justify-content:center;z-index:2;' }
        });
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--background-modifier-hover)'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; });
        closeBtn.addEventListener('click', () => { overlay.remove(); });

        const backdrop = overlay.querySelector('.novel-writer-fw-step-overlay-backdrop') as HTMLElement;
        if (backdrop) {
            backdrop.addEventListener('click', () => { overlay.remove(); });
        }

        return { overlay, panel };
    }

    /**
     * 自动迭代精修 — 两阶段非黑盒弹窗
     */
    async executeIterativeRefine(
        stepResults: Record<string, string>,
        vars: Record<string, string>,
        chapterNum: number,
        buildTemplateVars: () => Promise<Record<string, string>>,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        setIsLoading: (loading: boolean) => void,
        chapDir?: string,
        chapterName?: string,
        volume?: string,
        stepCompleted?: Set<string>,
    ): Promise<void> {
        const bodyText = stepResults['bodyGeneration'];
        if (!bodyText) {
            this.deps.callbacks.showError('没有正文可迭代');
            return;
        }

        const v = await buildTemplateVars();
        const contextParts: string[] = [];
        if (v['allChars']) contextParts.push(`【人物状态】\n${v['allChars']}`);
        if (v['outlineContent']) contextParts.push(`【大纲】\n${v['outlineContent']}`);
        if (v['infoPlan']) contextParts.push(`【信息规划】\n${v['infoPlan']}`);
        if (v['allFactions']) contextParts.push(`【势力】\n${v['allFactions']}`);
        if (v['allLocs']) contextParts.push(`【地点】\n${v['allLocs']}`);
        const contextPrompt = contextParts.join('\n\n');

        this.injectRefineModalStyles();
        this.showRefineTwoPhaseModal(
            bodyText, contextPrompt, v['chapNum'] || String(chapterNum || 1),
            stepResults, renderInContainer, tabContent, setIsLoading,
            chapDir, chapterName, volume, stepCompleted
        );
    }

    private showRefineTwoPhaseModal(
        bodyText: string,
        contextPrompt: string,
        chapNum: string,
        stepResults: Record<string, string>,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        setIsLoading: (loading: boolean) => void,
        chapDir?: string,
        chapterName?: string,
        volume?: string,
        stepCompleted?: Set<string>,
    ): void {
        const { overlay, panel } = this.createStepOverlay(tabContent);
        panel.createEl('h3', { text: '🔁 自动迭代精修 — 提示词预览' });
        panel.createEl('p', { text: '可编辑提示词后点击执行，结果可人工审阅修改', attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:12px;' } });

        const sectionSys = panel.createDiv({ attr: { style: 'margin-bottom:10px;' } });
        sectionSys.createEl('label', { text: '审查系统提示词', attr: { style: 'font-weight:600;font-size:13px;display:block;margin-bottom:4px;' } });
        const sysTA = sectionSys.createEl('textarea', {
            attr: { style: 'width:100%;height:140px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;' }
        }) as HTMLTextAreaElement;
        sysTA.value = SELF_CHECK_PROMPTS.systemPrompt;

        const sectionUser = panel.createDiv({ attr: { style: 'margin-bottom:10px;' } });
        sectionUser.createEl('label', { text: '审查用户提示词', attr: { style: 'font-weight:600;font-size:13px;display:block;margin-bottom:4px;' } });
        const userTA = sectionUser.createEl('textarea', {
            attr: { style: 'width:100%;height:200px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;' }
        }) as HTMLTextAreaElement;
        userTA.value = `【上下文】\n${contextPrompt}\n\n【第${chapNum}章正文】\n${bodyText}`;

        const resultSection = panel.createDiv({ attr: { style: 'margin-top:10px;display:none;' } });
        const summaryEl = resultSection.createDiv({ cls: 'novel-writer-fw-refine-summary' });
        const resultBodyTA = resultSection.createEl('textarea', {
            attr: { style: 'width:100%;height:260px;font-size:12px;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);resize:vertical;white-space:pre-wrap;margin-top:8px;' }
        }) as HTMLTextAreaElement;

        const btnRow = panel.createDiv({ cls: 'novel-writer-fw-refine-btn-row' });

        const execBtn = btnRow.createEl('button', {
            text: '🔁 执行迭代精修',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary'
        });

        const acceptBtn = btnRow.createEl('button', {
            text: '✅ 接受最终版',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-success',
            attr: { style: 'display:none;' }
        });

        const rejectBtn = btnRow.createEl('button', {
            text: '❌ 使用初版',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-danger',
            attr: { style: 'display:none;' }
        });

        execBtn.onclick = async () => {
            execBtn.disabled = true;
            execBtn.setText('⏳ 单次精修中...');
            try {
                const tasks = new LongNovelSingleCallTasks(this.deps.getAIEngine());
                const result = await tasks.refine(bodyText, contextPrompt, {
                    chapNum,
                });
                summaryEl.empty();
                if (!result.ok) {
                    summaryEl.createEl('p', { text: `单次精修失败：${result.error}` });
                    if (result.violations.length > 0) {
                        const ul = summaryEl.createEl('ul');
                        for (const v of result.violations) ul.createEl('li', { text: `${v.ruleId}: ${v.message}` });
                    }
                    execBtn.disabled = false;
                    execBtn.setText('🔁 重试单次精修');
                    return;
                }
                const value = result.value;
                summaryEl.createEl('p', { text: `单次精修完成（网络调用 ${result.networkCalls} 次，耗时 ${result.durationMs}ms）` });
                if (value?.issues?.length) {
                    const ul = summaryEl.createEl('ul', { cls: 'novel-writer-fw-refine-diff-list' });
                    for (const issue of value.issues) ul.createEl('li', { text: issue });
                }
                resultBodyTA.value = value?.polished || result.raw;
                resultSection.style.display = 'block';
                execBtn.style.display = 'none';
                acceptBtn.style.display = '';
                rejectBtn.style.display = '';
            } catch (e) {
                this.deps.callbacks.showError(`单次精修失败: ${(e as Error).message}`);
                execBtn.disabled = false;
                execBtn.setText('🔁 执行单次精修');
            }
        };

        acceptBtn.onclick = async () => {
            const finalBody = resultBodyTA.value;
            if (!finalBody.trim()) { this.deps.callbacks.showError('内容不能为空'); return; }
            try {
                log.warn('[StepModalController] 迭代精修接受: chapDir=', chapDir, 'len=', finalBody.length);
                stepResults['bodyGeneration'] = finalBody;
                await this.deps.saveStepResult('bodyGeneration', finalBody, chapDir ?? '', chapterName ?? '', volume ?? '');
                this.invalidateAfterBodyChange(stepCompleted);
                this.deps.callbacks.showSuccess('已接受精修版本，后续步骤已重置');
                overlay.remove();
                await renderInContainer(tabContent);
            } catch (e) {
                log.error('[StepModalController] 接受精修失败:', e);
                this.deps.callbacks.showNotice('❌ 接受精修失败：' + (e instanceof Error ? e.message : String(e)), NOTICE_ERROR);
                this.deps.callbacks.showError('保存失败，请重试');
            }
        };

        rejectBtn.onclick = async () => {
            this.deps.callbacks.showSuccess('已保留初版');
            overlay.remove();
            await renderInContainer(tabContent);
        };
    }

    showRoundSelectModal(
        result: { finalBody: string; rounds: number; diffs: string[]; roundBodies: string[] },
        stepResults: Record<string, string>,
        renderInContainer: (container: HTMLElement) => Promise<void>,
        tabContent: HTMLElement,
        chapDir?: string,
        chapterName?: string,
        volume?: string,
        stepCompleted?: Set<string>,
    ): void {
        const { overlay, panel } = this.createStepOverlay(tabContent);
        panel.createEl('h3', { text: '📋 逐轮选择迭代版本' });
        panel.createEl('p', { text: '选择要使用的迭代版本：' });

        const labels = ['📝 初版（第0轮）'];
        for (let i = 0; i < result.rounds; i++) {
            labels.push(`🔧 第${i + 1}轮修复版`);
        }

        for (let i = 0; i < labels.length; i++) {
            const roundCard = panel.createDiv({ cls: 'novel-writer-fw-round-card' });
            const header = roundCard.createDiv({ cls: 'novel-writer-fw-round-header' });
            header.createSpan({ text: labels[i], cls: 'novel-writer-fw-round-label' });
            if (i > 0 && i - 1 < result.diffs.length) {
                header.createSpan({ text: result.diffs[i - 1], cls: 'novel-writer-fw-round-diff' });
            }

            const preview = roundCard.createDiv({ cls: 'novel-writer-fw-round-preview' });
            const body = result.roundBodies[i] || '';
            preview.setText(body.slice(0, 500) + (body.length > 500 ? '\n...' : ''));

            const useBtn = roundCard.createEl('button', {
                text: '使用此版本',
                cls: 'novel-writer-fw-btn novel-writer-fw-btn-success'
            });
            const idx = i;
            useBtn.onclick = async () => {
                try {
                    stepResults['bodyGeneration'] = result.roundBodies[idx];
                    await this.deps.saveStepResult('bodyGeneration', result.roundBodies[idx], chapDir ?? '', chapterName ?? '', volume ?? '');
                    this.invalidateAfterBodyChange(stepCompleted);
                    this.deps.callbacks.showSuccess(`已使用${labels[idx]}，后续步骤已重置`);
                    overlay.remove();
                    await renderInContainer(tabContent);
                } catch (e) {
                    log.error('[StepModalController] 选择迭代版本失败:', e);
                    this.deps.callbacks.showNotice('❌ 选择迭代版本失败：' + (e instanceof Error ? e.message : String(e)), NOTICE_ERROR);
                    this.deps.callbacks.showError('选择版本失败，请重试');
                }
            };
        }

        this.injectRoundSelectStyles();
    }

    // ============================================================
    // 模态框样式注入
    // ============================================================
    injectDeaiModalStyles(): void {
        _injectDeai();
    }

    injectRefineModalStyles(): void {
        _injectRefine();
    }

    injectRoundSelectStyles(): void {
        _injectRound();
    }
}
