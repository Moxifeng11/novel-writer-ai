/**
 * scene-body-generator.ts — 场景正文生成回调组装器
 * 对应 spec: story-quality-closed-loop-optimization Task 10 剩余遗留项
 * （generateSceneBody 完整业务接线——组装 KnowledgeInjector/AIEngine）。
 *
 * 职责：把 Task 6 的分层上下文注入（injectForSceneBody）与 AIEngine.callAI
 * 组装成 SceneGenerationLoop 所需的 `generateSceneBody` 回调（注入式）。
 *
 * 设计：
 * - projectPath / model / snapshot / beats 为循环内固定项，经 deps 闭包捕获；
 * - sceneObjective / previousSceneEnding / directive 逐场景变化，在回调内动态组装。
 * - 注入 injectForSceneBody / callAI 为函数依赖（而非类实例），测试可 mock。
 *
 * 组装顺序：场景任务卡（8 要素）→ 上一场景结尾 → 修正方向 → 分层约束上下文，
 * 最后要求直接输出正文（不输出标题/解释）。
 */

import type { SceneTask } from './scene-generation-loop';
import type { ChapterStateSnapshot, StoryBeat } from './story-state-types';
import type { InjectionContext, LayeredInjectionOptions } from './knowledge-injector';
import type { APIResponse } from './ai-engine';
import {
    BodyFormatContract, DEFAULT_BODY_FORMAT, describeBodyFormat,
} from '../shared/body-format';
import { getModelContextWindow } from '../shared/token-estimator';
import { buildCraftSystemBlock } from './craft-constraints';

/** 知识注入段可占模型窗口的比例：其余留给任务卡、正文与输出 */
const KNOWLEDGE_BUDGET_RATIO = 0.3;
const MIN_KNOWLEDGE_BUDGET_TOKENS = 512;

/** generateSceneBody 回调（与 SceneLoopOptions.generateSceneBody 签名一致） */
export type GenerateSceneBody = (
    task: SceneTask,
    prevEnding: string,
    directive?: string,
) => Promise<{ content: string; error?: string | null }>;

/** 组装依赖（注入式，测试可 mock） */
export interface SceneBodyGeneratorDeps {
    projectPath: string;
    model: string;
    /** Task 6 分层上下文注入（故事约束层） */
    injectForSceneBody: (context: InjectionContext, options: LayeredInjectionOptions) => Promise<string>;
    /**
     * 分层注入（优先使用）：必须层进 system、按需层进 user。
     * 旧字符串接口保留给测试/旧接线，存在本字段时不再调用它。
     */
    injectForSceneBodyLayers?: (
        context: InjectionContext,
        options: LayeredInjectionOptions,
    ) => Promise<{ system: string; user: string }>;
    /** AI 引擎调用 */
    callAI: (systemPrompt: string, userPrompt: string, model: string) => Promise<APIResponse>;
    snapshot?: ChapterStateSnapshot;
    beats?: StoryBeat[];
    /** 正文格式契约；不传则用默认契约 */
    bodyFormat?: BodyFormatContract;
}

/** 场景正文生成的系统提示 */
export function buildSceneBodySystemPrompt(bodyFormat: BodyFormatContract = DEFAULT_BODY_FORMAT): string {
    return `你是专业的小说作家，负责根据场景任务卡撰写小说正文。

【写作要求】
1. 严格围绕场景目标推进，不偏离任务卡设定的冲突与情绪弧线
2. 保持上一场景结尾的叙事衔接，不重复已写内容
3. 遵循注入的世界观、人物状态与禁止事项，不自创矛盾设定
4. 从 entry_state 开始，写到 exit_state 停止；不要在场景中途解决下一场景的问题
5. 只写视角人物能感知到的信息；不进入其他人物内心
6. 结尾落到任务卡指定的钩子或余韵，为下一场景留悬念

${describeBodyFormat(bodyFormat)}

${buildCraftSystemBlock()}`;
}

/**
 * 创建 generateSceneBody 回调（组装 KnowledgeInjector + AIEngine）。
 * 注入/调用失败时返回 error（不抛未捕获异常），由 SceneGenerationLoop 失败隔离。
 */
export function createSceneBodyGenerator(deps: SceneBodyGeneratorDeps): GenerateSceneBody {
    const knowledgeBudgetTokens = Math.max(
        MIN_KNOWLEDGE_BUDGET_TOKENS,
        Math.floor(getModelContextWindow(deps.model) * KNOWLEDGE_BUDGET_RATIO),
    );

    return async (task, prevEnding, directive) => {
        try {
            const injectionContext: InjectionContext = {
                projectPath: deps.projectPath,
                sceneObjective: task.objective,
                previousSceneEnding: prevEnding,
            };
            const injectionOptions: LayeredInjectionOptions = {
                snapshot: deps.snapshot,
                beats: deps.beats,
                sceneObjective: task.objective,
                previousSceneEnding: prevEnding,
                maxInputTokens: knowledgeBudgetTokens,
                modelId: deps.model,
            };

            let systemPrompt = buildSceneBodySystemPrompt(deps.bodyFormat);
            let injectionUser: string;
            if (deps.injectForSceneBodyLayers) {
                // 必须层（任务卡/禁止事项）进 system，避免被 user 尾部截断丢掉
                const layers = await deps.injectForSceneBodyLayers(injectionContext, injectionOptions);
                injectionUser = layers.user;
                if (layers.system) systemPrompt = `${systemPrompt}\n\n${layers.system}`;
            } else {
                injectionUser = await deps.injectForSceneBody(injectionContext, injectionOptions);
            }

            const userPrompt = buildUserPrompt(task, prevEnding, directive, injectionUser);
            const response = await deps.callAI(systemPrompt, userPrompt, deps.model);

            if (response.error) {
                return { content: response.content, error: response.error };
            }
            return { content: response.content, error: null };
        } catch (e) {
            return { content: '', error: e instanceof Error ? e.message : String(e) };
        }
    };
}

/** 组装 user prompt：任务卡 8 要素 → 上一场景结尾 → 修正方向 → 分层约束上下文 */
export function buildUserPrompt(
    task: SceneTask,
    prevEnding: string,
    directive: string | undefined,
    injection: string,
): string {
    const lines: string[] = [];
    lines.push('请根据以下场景任务卡撰写小说正文。');
    lines.push('');
    lines.push('【场景任务卡】');
    lines.push(`场景 ${task.num}${task.name ? `：${task.name}` : ''}`);
    if (task.pov) lines.push(`- POV：${task.pov}`);
    if (task.time) lines.push(`- 时间：${task.time}`);
    if (task.location) lines.push(`- 地点：${task.location}`);
    if (task.objective) lines.push(`- 场景目标：${task.objective}`);
    if (task.entryState) lines.push(`- 入场状态：${task.entryState}`);
    if (task.conflict) lines.push(`- 冲突：${task.conflict}`);
    if (task.turn) lines.push(`- 场景转折：${task.turn}`);
    if (task.exitState) lines.push(`- 离场状态：${task.exitState}`);
    if (task.emotionArc) lines.push(`- 情绪弧线：${task.emotionArc}`);
    if (task.sensoryHook) lines.push(`- 感官钩子：${task.sensoryHook}`);
    if (task.memoryTrigger) lines.push(`- 记忆触发：${task.memoryTrigger}`);
    if (task.bodyReaction) lines.push(`- 身体反应：${task.bodyReaction}`);
    if (task.subtext) lines.push(`- 潜台词：${task.subtext}`);
    if (task.relationshipShift) lines.push(`- 关系变化：${task.relationshipShift}`);
    if (task.characters) lines.push(`- 出场人物：${task.characters}`);
    if (task.keyScene) lines.push(`- 关键场景：${task.keyScene}`);
    if (task.dialogueFunction) lines.push(`- 对话功能：${task.dialogueFunction}`);
    if (task.craftNotes) lines.push(`- 工艺备注：${task.craftNotes}`);
    if (task.cliffhanger) lines.push(`- 结尾钩子：${task.cliffhanger}`);

    if (prevEnding) {
        lines.push('');
        lines.push('【上一场景结尾（衔接上下文）】');
        lines.push(prevEnding);
    }

    if (directive && directive.trim() !== '') {
        lines.push('');
        lines.push('【用户修正方向】');
        lines.push(directive.trim());
    }

    if (injection && injection.trim() !== '') {
        lines.push('');
        lines.push(injection);
    }

    lines.push('');
    lines.push('请直接输出本场景正文，不要添加标题、标注或解释。');
    return lines.join('\n');
}
