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
import { StepRunnerCallbacks, NOOP_CALLBACKS } from './step-runner-callbacks';
import { FileSystemPort, ObsidianFileSystem } from '@/shared/file-system-port';
import { TemplateService } from './template-service';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { NOTICE_ERROR } from '@/shared/thresholds';
import {
    DEAI_CHECK_SYSTEM_PROMPT,
    DEAI_CHECK_USER_TEMPLATE,
    DEAI_REWRITE_SYSTEM_PROMPT,
    DEAI_REWRITE_USER_TEMPLATE,
    SELF_CHECK_PROMPTS,
} from './prompt-templates';
import { RulesService } from '@/services/rules-service';
import { BODY_CHANGE_INVALIDATED_STEPS } from './step-definitions';
import { createLogger } from '@/shared/logger';


import { projectIdFromPath } from '@/shared/project-catalog';
const log = createLogger('StepModalController');
/**
 * 步骤弹窗依赖列表结构定义。
 */
export interface StepModalDeps {
    getAIEngine: () => AIEngine;
    getPlugin: () => any;
    saveStepResult: (stepKey: string, content: string, chapDir: string, chapterName: string, volume: string) => Promise<boolean>;
    callbacks: StepRunnerCallbacks;
    fs?: FileSystemPort;
    /** A7: 正文被改写后的统一失效传播（优先于手动 delete，保证 stepLevels/staleSteps 同步） */
    invalidateSteps?: (stepKeys: string[]) => void;
}

/**
 * 步骤弹窗控制器。
 */
export class StepModalController {
    private app: import('obsidian').App;
    private deps: StepModalDeps;
    private fs: FileSystemPort | null = null;
    private templateService: TemplateService | null = null;

    constructor(app: import('obsidian').App, deps: StepModalDeps) {
        this.app = app;
        this.deps = deps;
    }

    /** 单次调用任务工厂：把人味约束模式（样文优先/旧配额）从设置透传进去 */
    private createTasks(): LongNovelSingleCallTasks {
        const plugin = this.deps.getPlugin();
        const mode = (): 'exemplar' | 'quota' => (
            plugin?.settings?.humanVoiceMode === 'quota' ? 'quota' : 'exemplar'
        );
        return new LongNovelSingleCallTasks(this.deps.getAIEngine(), mode);
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
     * @param stepResults - 步骤结果列表
     * @param renderInContainer - 渲染容器
     * @param tabContent - 页签内容
     * @param setIsLoading - 加载状态设置函数
     * @param chapDir - 章节目录
     * @param chapterName - 章节名
     * @param volume - 卷
     * @param stepCompleted - 步骤完成状态
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
                system: DEAI_REWRITE_SYSTEM_PROMPT.replace('${writingRules}', await RulesService.getInstance(this.deps.getPlugin().app).getWritingRules(projectIdFromPath(chapDir))),
                user: DEAI_REWRITE_USER_TEMPLATE,
            }),
        ]);

        const deaiCheckSystemPrompt = deaiCheckTemplate.system;
        const deaiCheckUserPrompt = deaiCheckTemplate.user.replace('${bodyText}', bodyText);
        const deaiRewriteSystemPrompt = deaiRewriteTemplate.system;
        const deaiRewriteUserTemplate = deaiRewriteTemplate.user;

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
        panel.createEl('p', { text: '可在下方编辑提示词后点击执行，非黑盒。自定义模板：prompts/deaiCheck-system.md', cls: 'novel-writer-fw-step-hint' });

        const sectionSys = panel.createDiv({ cls: 'novel-writer-fw-deai-section' });
        sectionSys.createEl('label', { text: '检测系统提示词', cls: 'novel-writer-fw-step-label' });
        const detectSysTA = sectionSys.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h120'
        }) as HTMLTextAreaElement;
        detectSysTA.value = deaiCheckSystemPrompt;

        const sectionUser = panel.createDiv({ cls: 'novel-writer-fw-deai-section' });
        sectionUser.createEl('label', { text: '检测用户提示词（正文）', cls: 'novel-writer-fw-step-label' });
        const detectUserTA = sectionUser.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h200'
        }) as HTMLTextAreaElement;
        detectUserTA.value = DEAI_CHECK_USER_TEMPLATE.replace('${bodyText}', bodyText);

        const rewriteSection = panel.createDiv({ cls: 'novel-writer-fw-deai-section nw-u-d-none' });
        rewriteSection.createEl('label', { text: '改写系统提示词', cls: 'novel-writer-fw-step-label' });
        const rewriteSysTA = rewriteSection.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h120'
        }) as HTMLTextAreaElement;
        rewriteSysTA.value = deaiRewriteSystemPrompt;

        const rewriteUserSection = rewriteSection.createDiv({ cls: 'novel-writer-fw-step-section nw-is-spaced' });
        rewriteUserSection.createEl('label', { text: '改写用户提示词', cls: 'novel-writer-fw-step-label' });
        const rewriteUserTA = rewriteUserSection.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h120'
        }) as HTMLTextAreaElement;

        const resultSection = panel.createDiv({ cls: 'novel-writer-fw-deai-section nw-u-d-none' });
        resultSection.createEl('h4', { text: '📊 检测报告' });
        const reportEl = resultSection.createDiv({ cls: 'novel-writer-fw-deai-text' });

        resultSection.createEl('h4', { text: '📄 原文 vs ✨ 改写版', cls: 'novel-writer-fw-step-section-title' });
        const compareRow = resultSection.createDiv({ cls: 'novel-writer-fw-deai-compare' });
        const origCol = compareRow.createDiv({ cls: 'novel-writer-fw-deai-col' });
        origCol.createEl('h4', { text: '原文' });
        const origTextEl = origCol.createDiv({ cls: 'novel-writer-fw-deai-col-text' });

        const rewriteCol = compareRow.createDiv({ cls: 'novel-writer-fw-deai-col' });
        rewriteCol.createEl('h4', { text: '改写版（可编辑）' });
        const rewriteResultTA = rewriteCol.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h260 nw-is-pre'
        }) as HTMLTextAreaElement;

        const btnRow = panel.createDiv({ cls: 'novel-writer-fw-deai-btn-row' });

        const detectBtn = btnRow.createEl('button', {
            text: '🔍 执行AI痕迹检测',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary'
        });

        const rewriteBtn = btnRow.createEl('button', {
            text: '✍️ 执行改写',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary nw-u-d-none'
        });

        const acceptBtn = btnRow.createEl('button', {
            text: '✅ 接受改写',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-success nw-u-d-none'
        });
        const rejectBtn = btnRow.createEl('button', {
            text: '❌ 保留原文',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-danger nw-u-d-none'
        });

        detectBtn.setText('✨ 单次完成消痕');
        detectBtn.onclick = async () => {
            detectBtn.disabled = true;
            detectBtn.setText('⏳ 单次消痕中...');
            try {
                const tasks = this.createTasks();
                const writingRules = await RulesService.getInstance(this.deps.getPlugin().app).getWritingRules(projectIdFromPath(chapDir));
                const result = await tasks.deai(bodyText, { writingRules });

                reportEl.setText([
                    result.ok ? '✅ 单次消痕完成' : '❌ 单次消痕失败',
                    `网络调用 ${result.networkCalls} 次 · 耗时 ${result.durationMs}ms`,
                    ...result.violations.map(v => `${v.ruleId}: ${v.message}`),
                ].join('\n'));
                resultSection.removeClass('nw-u-d-none');
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

                detectBtn.addClass('nw-u-d-none');
                rewriteBtn.addClass('nw-u-d-none');
                acceptBtn.removeClass('nw-u-d-none');
                rejectBtn.removeClass('nw-u-d-none');
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

                rewriteBtn.addClass('nw-u-d-none');
                acceptBtn.removeClass('nw-u-d-none');
                rejectBtn.removeClass('nw-u-d-none');
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
     * @param tabContent - 页签内容
      * @returns HTMLElement } 实例
     */
    createStepOverlay(tabContent: HTMLElement): { overlay: HTMLElement; panel: HTMLElement } {
        const workspace = tabContent.closest('.novel-writer-fw-content') as HTMLElement || tabContent;
        const computed = getComputedStyle(workspace);
        if (computed.position === 'static') workspace.addClass('novel-writer-fw-step-overlay-host');

        const existing = workspace.querySelector('.novel-writer-fw-step-overlay');
        if (existing) existing.remove();

        const overlay = workspace.createDiv({ cls: 'novel-writer-fw-step-overlay' });
        overlay.createDiv({ cls: 'novel-writer-fw-step-overlay-backdrop' });
        const panel = overlay.createDiv({ cls: 'novel-writer-fw-step-overlay-panel' });

        const closeBtn = panel.createEl('button', {
            text: '✕',
            cls: 'novel-writer-fw-step-overlay-close',
        });
        closeBtn.addEventListener('click', () => { overlay.remove(); });

        const backdrop = overlay.querySelector('.novel-writer-fw-step-overlay-backdrop') as HTMLElement;
        if (backdrop) {
            backdrop.addEventListener('click', () => { overlay.remove(); });
        }

        return { overlay, panel };
    }

    /**
     * 自动迭代精修 — 两阶段非黑盒弹窗
     * @param stepResults - 步骤结果列表
     * @param vars - 变量表
     * @param chapterNum - 章号
     * @param buildTemplateVars - 模板变量构建函数
     * @param renderInContainer - 渲染容器
     * @param tabContent - 页签内容
     * @param setIsLoading - 加载状态设置函数
     * @param chapDir - 章节目录
     * @param chapterName - 章节名
     * @param volume - 卷
     * @param stepCompleted - 步骤完成状态
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
        panel.createEl('p', { text: '可编辑提示词后点击执行，结果可人工审阅修改', cls: 'novel-writer-fw-step-hint' });

        const sectionSys = panel.createDiv({ cls: 'novel-writer-fw-step-field' });
        sectionSys.createEl('label', { text: '审查系统提示词', cls: 'novel-writer-fw-step-label' });
        const sysTA = sectionSys.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h140'
        }) as HTMLTextAreaElement;
        sysTA.value = SELF_CHECK_PROMPTS.systemPrompt;

        const sectionUser = panel.createDiv({ cls: 'novel-writer-fw-step-field' });
        sectionUser.createEl('label', { text: '审查用户提示词', cls: 'novel-writer-fw-step-label' });
        const userTA = sectionUser.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h200'
        }) as HTMLTextAreaElement;
        userTA.value = `【上下文】\n${contextPrompt}\n\n【第${chapNum}章正文】\n${bodyText}`;

        const resultSection = panel.createDiv({ cls: 'novel-writer-fw-step-section nw-u-d-none' });
        const summaryEl = resultSection.createDiv({ cls: 'novel-writer-fw-refine-summary' });
        const resultBodyTA = resultSection.createEl('textarea', {
            cls: 'novel-writer-fw-step-textarea nw-is-h260 nw-is-pre novel-writer-fw-step-refine-result'
        }) as HTMLTextAreaElement;

        const btnRow = panel.createDiv({ cls: 'novel-writer-fw-refine-btn-row' });

        const execBtn = btnRow.createEl('button', {
            text: '🔁 执行迭代精修',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-primary'
        });

        const acceptBtn = btnRow.createEl('button', {
            text: '✅ 接受最终版',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-success nw-u-d-none'
        });

        const rejectBtn = btnRow.createEl('button', {
            text: '❌ 使用初版',
            cls: 'novel-writer-fw-btn novel-writer-fw-btn-danger nw-u-d-none'
        });

        execBtn.onclick = async () => {
            execBtn.disabled = true;
            const maxRounds = Math.max(0, Math.min(5, this.deps.getPlugin()?.settings?.refineRounds ?? 3));
            execBtn.setText(maxRounds > 1 ? `⏳ 迭代精修中（最多 ${maxRounds} 轮）...` : '⏳ 单次精修中...');
            try {
                const tasks = this.createTasks();
                // v4.22 真迭代：多轮改写 + 每轮打分（AI 味/人味相似度/保真），只接受更优版本。
                // 旧实现只调一次，refineRounds 是死配置，且没有任何「变好了」的判定。
                const { createHumannessScorer } = await import('@/ui/services/humanness-scorer');
                const { runIterativeRefine, formatRefineRounds } = await import('@/shared/iterative-refine');
                const scorer = await createHumannessScorer(this.deps.getPlugin().app);
                const roundLines: string[] = [];
                const iterative = await runIterativeRefine({
                    original: bodyText,
                    rounds: Math.max(1, maxRounds),
                    refine: async (current) => {
                        const r = await tasks.refine(current, contextPrompt, { chapNum });
                        const content = r.ok ? (r.value?.polished || r.raw || '') : '';
                        return { content, networkCalls: r.networkCalls || 1 };
                    },
                    score: (candidate, original) => scorer.score(candidate, original),
                    onRound: (record) => {
                        const line = `R${record.round}: 综合 ${(record.composite * 100).toFixed(1)}`
                            + `（AI味 ${record.antiAI} · 人味 ${record.humanSim.toFixed(2)}）`
                            + (record.accepted ? ' ✅接受' : ` ⛔${record.rejectedReason}`);
                        roundLines.push(line);
                        summaryEl.empty();
                        summaryEl.createEl('p', { text: `迭代进度（${roundLines.length}/${maxRounds}）${scorer.hasBaseline() ? '' : '（无本地样文基线，仅按 AI 味+保真评分）'}` });
                        const list = summaryEl.createEl('ul', { cls: 'novel-writer-fw-refine-diff-list' });
                        for (const item of roundLines) list.createEl('li', { text: item });
                    },
                });

                // 对话补修（实测驱动的定向迭代）：模型不会自己数「对话占比」，
                // 六组真实对照（original/v1-quota/v2-exemplar/v3-weak/v4-dialogue/v5-scene）
                // 的对话占比都停在 9%–17%（真人长篇约 26%），而写的比例要求被无视。
                // 这里改成「先测占比 → 只把 3 处叙述转成对话」的定向一轮，最多 1 次调用。
                let best = iterative.best;
                const beforeDialogue = scorer.dialogueRatio(best);
                if (beforeDialogue < 0.25 && maxRounds > 0) {
                    const repair = await tasks.refine(best, contextPrompt, {
                        chapNum,
                        extraInstruction: '只做一件事：把本章里「叙述者在解释」的段落改成人物对话——谁问、谁答、谁打断、谁不接话，'
                            + '目标是把对话占比提到三成以上（人工写作的常态）。叙述只保留动作与位置；情节、人物、字数不变。',
                    });
                    const repaired = repair.ok ? (repair.value?.polished || '').trim() : '';
                    if (repaired) {
                        const afterScore = scorer.score(repaired, bodyText);
                        const afterDialogue = scorer.dialogueRatio(repaired);
                        const accepted = afterScore.fidelityOk && afterDialogue > beforeDialogue;
                        roundLines.push(
                            `对话补修：${(beforeDialogue * 100).toFixed(1)}% → ${(afterDialogue * 100).toFixed(1)}%`
                            + (accepted ? ' ✅接受' : ' ⛔未采纳'),
                        );
                        if (accepted) best = repaired;
                    }
                }

                // 统一成旧代码期望的 result 形状
                const result = {
                    ok: true,
                    value: {
                        issues: roundLines,
                        polished: best,
                    },
                    raw: best,
                    networkCalls: iterative.totalNetworkCalls,
                    durationMs: 0,
                    violations: [] as Array<{ ruleId: string; message: string }>,
                };
                summaryEl.empty();
                // 迭代调度本身不会「失败」（改写抛错时保留 best 并标记 stoppedReason），
                // 这里只需处理「一轮都没产出内容」的情况。
                if (!result.value.polished.trim()) {
                    summaryEl.createEl('p', { text: `迭代精修未产出可用正文（停止原因：${iterative.stoppedReason}）` });
                    execBtn.disabled = false;
                    execBtn.setText('🔁 重试迭代精修');
                    return;
                }
                const value = result.value;
                summaryEl.createEl('p', {
                    text: `迭代精修完成（${iterative.rounds.length} 轮 / 网络调用 ${iterative.totalNetworkCalls} 次；`
                        + `结果=${iterative.improved ? '接受改进版' : '保留原稿'}；停止=${iterative.stoppedReason}）`,
                });
                summaryEl.createEl('p', { text: formatRefineRounds(iterative.rounds) });
                if (value?.issues?.length) {
                    const ul = summaryEl.createEl('ul', { cls: 'novel-writer-fw-refine-diff-list' });
                    for (const issue of value.issues) ul.createEl('li', { text: issue });
                }
                resultBodyTA.value = value?.polished || result.raw;
                resultSection.removeClass('nw-u-d-none');
                execBtn.addClass('nw-u-d-none');
                acceptBtn.removeClass('nw-u-d-none');
                rejectBtn.removeClass('nw-u-d-none');
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

    /**
     * showRoundSelectModal 方法。
     * @param result - 结果
     * @param stepResults - 参数值
     * @param renderInContainer - 参数值
     * @param tabContent - 参数值
     * @param chapDir - 参数值
     * @param chapterName - 章节名
     * @param volume - 卷
     * @param stepCompleted - 参数值
     */
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
    }
}
