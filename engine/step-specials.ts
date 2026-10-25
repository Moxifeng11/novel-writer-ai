/**
 * step-specials.ts — 步骤流水线特例
 *
 * 从 step-runner.ts 拆分而来：characterSoul / emotionPlan / sceneExpand 三个
 * 不经过通用 callAI 流程的步骤。编排保持原顺序，宿主只注入引擎、回调与保存能力。
 */

import type { App } from 'obsidian';
import type { AIEngine } from './ai-engine';
import { generateEmotionPlan, validateEmotionPlan } from './emotion-planner';
import { generateSceneExpansion, validateSceneExpansion } from './scene-expander';
import { NOTICE_CRITICAL } from '../shared/thresholds';
import { createLogger } from '../shared/logger';
import type { StepRunCtx } from './step-definitions';

const log = createLogger('StepSpecials');

export interface StepSpecialsHost {
    aiEngine: AIEngine;
    app: App;
    showError(message: string, duration?: number): void;
    showSuccess(message: string, duration?: number): void;
    showNotice(message: string, duration?: number): void;
    hideProgress(): void;
    saveStepResult(
        stepKey: string,
        content: string,
        chapDir: string,
        chapterName: string,
        volume: string
    ): Promise<boolean>;
    /** 本步实际模型的窗口/输出上限（sceneExpand 的 prompt 预算闸门） */
    resolveStepBudgetLimits(model: string): { maxContext: number; maxOutput: number };
    /** 情绪规划知识注入（宿主内部完成画像读取、强度判断与失败降级） */
    injectEmotionPlanKnowledge(ctx: StepRunCtx): Promise<string>;
    /** Scene 展开知识注入（宿主内部完成画像读取、强度判断与失败降级） */
    injectSceneExpandKnowledge(ctx: StepRunCtx): Promise<string>;
}

/** 恢复发送按钮的 UI 动作（由 StepRunner 提供的闭包） */
export type RestoreButtons = () => void;

export async function runCharacterSoulStep(
    host: StepSpecialsHost,
    ctx: StepRunCtx,
    restoreButtons: RestoreButtons
): Promise<void> {
    ctx.setIsLoading(false);
    host.hideProgress();
    restoreButtons();

    const coresData = (ctx.vars.characterCores || '').trim();
    if (!coresData) {
        // 未拿到角色灵魂层时不能写空文件并标记完成，否则流程会卡在后续规划
        log.warn('[StepRunner] characterSoul 缺少角色灵魂层数据，跳过写入');
        host.showError('❌ 未找到角色灵魂层数据：请先在「实体生成」中完善角色核心，或跳过此步骤');
        await ctx.renderInContainer(ctx.tabContent);
        return;
    }

    ctx.stepResults['characterSoul'] = coresData;
    const saved = await host.saveStepResult('characterSoul', coresData, ctx.chapDir, ctx.chapterName, ctx.volume);
    if (saved) {
        ctx.stepCompleted.add('characterSoul');
        if (ctx.onStepComplete) {
            try {
                await ctx.onStepComplete('characterSoul', coresData);
            } catch (e) {
                log.warn('[StepRunner] onStepComplete 回调异常:', e);
            }
        }
        host.showSuccess('🫀 角色灵魂提取完成');
    } else {
        log.warn('[StepRunner] characterSoul 文件写入失败，stepCompleted 未标记');
        host.showError('❌ 角色灵魂提取保存失败，请重试');
    }
    await ctx.renderInContainer(ctx.tabContent);
}

export async function runEmotionPlanStep(
    host: StepSpecialsHost,
    ctx: StepRunCtx,
    stepModel: string,
    restoreButtons: RestoreButtons
): Promise<void> {
    const emotionKnowledgeInjection = await host.injectEmotionPlanKnowledge(ctx);

    const varsWithInjection = { ...ctx.vars };
    if (emotionKnowledgeInjection) {
        varsWithInjection.emotionKnowledge = emotionKnowledgeInjection;
    }

    const emoContent = await generateEmotionPlan(host.aiEngine, host.app, varsWithInjection, stepModel);
    const validation = validateEmotionPlan(emoContent);
    if (!validation.valid) {
        host.showNotice(`⚠️ 情绪规划校验异常：${validation.errors.join('；')}`, NOTICE_CRITICAL);
    }
    ctx.stepResults['emotionPlan'] = emoContent;
    const saved = await host.saveStepResult('emotionPlan', emoContent, ctx.chapDir, ctx.chapterName, ctx.volume);
    ctx.vars.emotionPlan = emoContent;
    ctx.setIsLoading(false);
    host.hideProgress();
    restoreButtons();
    if (saved) {
        ctx.stepCompleted.add('emotionPlan');
        if (ctx.onStepComplete) {
            try {
                await ctx.onStepComplete('emotionPlan', emoContent);
            } catch (e) {
                log.warn('[StepRunner] onStepComplete 回调异常:', e);
            }
        }
        host.showSuccess('🎭 情绪规划完成');
    } else {
        log.warn('[StepRunner] emotionPlan 文件写入失败，stepCompleted 未标记');
        host.showError('❌ 情绪规划保存失败，请重试');
    }
    await ctx.renderInContainer(ctx.tabContent);
}

export async function runSceneExpandStep(
    host: StepSpecialsHost,
    ctx: StepRunCtx,
    stepModel: string,
    restoreButtons: RestoreButtons
): Promise<void> {
    const sceneKnowledgeInjection = await host.injectSceneExpandKnowledge(ctx);

    const varsWithInjection = { ...ctx.vars };
    if (sceneKnowledgeInjection) {
        varsWithInjection.sceneKnowledge = sceneKnowledgeInjection;
    }

    // B6：sceneExpand 此前直接 return，完全绕过 prompt 预算闸门；
    // 这里按本步实际模型传入窗口，知识注入作为可丢弃的增强层。
    const sceneContent = await generateSceneExpansion(
        host.aiEngine,
        varsWithInjection,
        stepModel,
        undefined,
        host.resolveStepBudgetLimits(stepModel),
    );
    const validation = validateSceneExpansion(sceneContent);
    if (!validation.valid) {
        host.showNotice(`⚠️ Scene展开校验异常：${validation.errors.join('；')}`, NOTICE_CRITICAL);
    }
    ctx.stepResults['sceneExpand'] = sceneContent;
    const saved = await host.saveStepResult('sceneExpand', sceneContent, ctx.chapDir, ctx.chapterName, ctx.volume);
    ctx.vars.sceneExpansion = sceneContent;
    ctx.setIsLoading(false);
    host.hideProgress();
    restoreButtons();
    if (saved) {
        ctx.stepCompleted.add('sceneExpand');
        if (ctx.onStepComplete) {
            try {
                await ctx.onStepComplete('sceneExpand', sceneContent);
            } catch (e) {
                log.warn('[StepRunner] onStepComplete 回调异常:', e);
            }
        }
        host.showSuccess('🎬 Scene展开完成');
    } else {
        log.warn('[StepRunner] sceneExpand 文件写入失败，stepCompleted 未标记');
        host.showError('❌ Scene展开保存失败，请重试');
    }
    await ctx.renderInContainer(ctx.tabContent);
}
