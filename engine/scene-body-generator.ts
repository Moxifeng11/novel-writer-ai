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
    /** AI 引擎调用 */
    callAI: (systemPrompt: string, userPrompt: string, model: string) => Promise<APIResponse>;
    snapshot?: ChapterStateSnapshot;
    beats?: StoryBeat[];
}

/** 场景正文生成的系统提示 */
const SCENE_BODY_SYSTEM_PROMPT = `你是专业的小说作家，负责根据场景任务卡撰写小说正文。

【写作要求】
1. 严格围绕场景目标推进，不偏离任务卡设定的冲突与情绪弧线
2. 保持上一场景结尾的叙事衔接，不重复已写内容
3. 遵循注入的世界观、人物状态与禁止事项，不自创矛盾设定
4. 结尾落到任务卡指定的钩子或余韵，为下一场景留悬念
5. 番茄小说分段格式：短句单句成段，对话单独成段

【输出格式】
直接输出本场景正文，不要添加标题、标注或任何解释。`;

/**
 * 创建 generateSceneBody 回调（组装 KnowledgeInjector + AIEngine）。
 * 注入/调用失败时返回 error（不抛未捕获异常），由 SceneGenerationLoop 失败隔离。
 */
export function createSceneBodyGenerator(deps: SceneBodyGeneratorDeps): GenerateSceneBody {
    return async (task, prevEnding, directive) => {
        try {
            const injection = await deps.injectForSceneBody(
                {
                    projectPath: deps.projectPath,
                    sceneObjective: task.objective,
                    previousSceneEnding: prevEnding,
                },
                {
                    snapshot: deps.snapshot,
                    beats: deps.beats,
                    sceneObjective: task.objective,
                    previousSceneEnding: prevEnding,
                },
            );

            const userPrompt = buildUserPrompt(task, prevEnding, directive, injection);
            const response = await deps.callAI(SCENE_BODY_SYSTEM_PROMPT, userPrompt, deps.model);

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
    if (task.objective) lines.push(`- 场景目标：${task.objective}`);
    if (task.emotionArc) lines.push(`- 情绪弧线：${task.emotionArc}`);
    if (task.conflict) lines.push(`- 冲突：${task.conflict}`);
    if (task.sensoryHook) lines.push(`- 感官钩子：${task.sensoryHook}`);
    if (task.memoryTrigger) lines.push(`- 记忆触发：${task.memoryTrigger}`);
    if (task.bodyReaction) lines.push(`- 身体反应：${task.bodyReaction}`);
    if (task.subtext) lines.push(`- 潜台词：${task.subtext}`);
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
