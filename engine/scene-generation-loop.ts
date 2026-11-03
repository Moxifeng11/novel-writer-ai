/**
 * scene-generation-loop.ts — 场景级生成闭环编排
 * 对应 spec: story-quality-closed-loop-optimization Task 5。
 *
 * 职责：把 sceneExpand 产出的场景规划文本拆分为场景块，逐场景生成正文，
 * 每场景生成后运行 BeatVerifier + ConflictDetector 场景级校验（Task 3/4 复用）。
 *
 * 复用而非重写：
 * - 场景块格式与 engine/scene-expander.ts 的 SCENE_EXPAND_SYSTEM_PROMPT /
 *   validateSceneExpansion 同源（## 场景N：/ ## sceneN: 分隔 + 字段行）
 * - 正文生成通过注入的 generateSceneBody 回调完成（真实链路由调用方接
 *   KnowledgeInjector + AIEngine.callAI，测试链路 mock）
 *
 * 失败隔离：单场景失败计入 failedScenes，已完成场景保留，后续场景继续（TR-5.2）。
 * 场景间修正：onSceneComplete 返回 string 作为下一场景 directive，返回 false 停止（TR-5.3 引擎层钩子）。
 * 场景间存在叙事依赖（上一场景结尾），故必须串行，不做并行。
 */

import { BeatVerifier } from './beat-verifier';
import type { BeatVerifyResult } from './beat-verifier';
import { ConflictDetector } from './conflict-detector';
import type { Conflict } from './conflict-detector';
import type { ChapterStateSnapshot, StoryBeat } from './story-state-types';
import type { GenerationCheckpoint } from './generation-checkpoint';
import { SCENE_HEADING_SOURCE } from './scene-expander';
import { parseSceneCardFields } from '@/shared/scene-card';

/** 单个场景任务（从 sceneExpand 规划文本解析） */
export interface SceneTask {
    num: number;
    name: string;
    pov?: string;
    time?: string;
    location?: string;
    objective: string;
    entryState?: string;
    conflict: string;
    turn?: string;
    exitState?: string;
    emotionArc: string;
    sensoryHook: string;
    memoryTrigger: string;
    bodyReaction: string;
    subtext: string;
    relationshipShift?: string;
    keyScene?: string;
    dialogueFunction?: string;
    cliffhanger: string;
    craftNotes?: string;
    characters?: string;
    rawBlock: string;
}

/** 已完成场景（含场景级校验产物） */
export interface SceneLoopItem {
    task: SceneTask;
    body: string;
    beatVerify: BeatVerifyResult;
    conflicts: Conflict[];
}

/** 失败场景 */
export interface SceneFailure {
    task: SceneTask;
    error: string;
}

/**
 * SceneLoopResult 类型定义。
 */
export interface SceneLoopResult {
    scenes: SceneLoopItem[];
    failedScenes: SceneFailure[];
    completedAll: boolean;
    aborted: boolean;
}

/**
 * SceneLoopOptions 类型定义。
 */
export interface SceneLoopOptions {
    expansionText: string;
    snapshot: ChapterStateSnapshot;
    beats: StoryBeat[];
    /** 正文生成回调（注入式）：prevEnding 为上一成功场景正文结尾，directive 为用户修正方向 */
    generateSceneBody: (
        task: SceneTask,
        prevEnding: string,
        directive?: string
    ) => Promise<{ content: string; error?: string | null }>;
    /** 场景完成钩子：返回 false 停止后续；返回 string 作为下一场景修正指令 */
    onSceneComplete?: (index: number, item: SceneLoopItem) => Promise<boolean | string | void>;
    signal?: AbortSignal;
    /**
     * 断点恢复（TR-7.2 / Task 10 恢复面板）：sceneNum → 断点快照。
     * finishReason='scene_done' 且 content 非空的场景直接复用已确认正文，
     * 不调 generateSceneBody（失败/空断点照常重新生成）。
     */
    resumeCheckpoints?: Map<number, GenerationCheckpoint>;
}

/** 场景标题正则（与 scene-expander.ts 的 SCENE_HEADING_SOURCE 同源，兼容 ### sceneN:） */
const SCENE_HEADER_RE = new RegExp(SCENE_HEADING_SOURCE, 'im');

/** 解析单个字段行（与 validateSceneExpansion 的 fieldRegex 同源格式） */
/**
 * 中文数字解析（与 scene-expander 保持一致的容错：失败时按序号兜底）
 *
 * @param raw - 原始
  * @returns 数值结果 或 null
 */
function parseChineseNum(raw: string): number | null {
    const map: Record<string, number> = {
        零: 0, 〇: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100,
    };
    if (raw.length === 1) return map[raw] ?? null;
    if (raw === '十') return 10;
    const m = raw.match(/^(十)?([一二三四五六七八九])?$/);
    if (!m) return null;
    return (m[1] ? 10 : 0) + (m[2] ? map[m[2]] : 0);
}

/**
 * 把 sceneExpand 规划文本拆分为结构化场景块（TR-5.1）。
 * 无场景格式时返回空数组，不抛异常。
 * @param content - 内容
 * @returns 结果数组
 */
export function parseSceneBlocks(content: string): SceneTask[] {
    if (typeof content !== 'string' || content.trim() === '') return [];

    const lines = content.split(/\r?\n/);
    const blocks: Array<{ num: number; name: string; lines: string[] }> = [];
    let current: { num: number; name: string; lines: string[] } | null = null;

    for (const line of lines) {
        const header = line.match(SCENE_HEADER_RE);
        if (header) {
            const num = header[1] !== undefined
                ? (parseChineseNum(header[1]) ?? blocks.length + 1)
                : parseInt(header[2], 10);
            current = { num, name: (header[3] || '').trim(), lines: [] };
            blocks.push(current);
        } else if (current) {
            current.lines.push(line);
        }
    }

    return blocks.map((b) => {
        const rawBlock = b.lines.join('\n');
        const card = parseSceneCardFields(rawBlock, { num: b.num, name: b.name });
        return {
            ...card,
            objective: card.objective || '',
            conflict: card.conflict || '',
            emotionArc: card.emotionArc || '',
            sensoryHook: card.sensoryHook || '',
            memoryTrigger: card.memoryTrigger || '',
            bodyReaction: card.bodyReaction || '',
            subtext: card.subtext || '',
            cliffhanger: card.cliffhanger || '',
            rawBlock,
        };
    });
}

/** 上一场景结尾注入长度（衔接上下文用，避免整段重注入） */
const PREV_ENDING_SLICE = 400;

/**
 * SceneGenerationLoop 类。
 */
export class SceneGenerationLoop {
    private verifier = new BeatVerifier();
    private detector = new ConflictDetector();

    /**
     * 执行。
     * @param options - 配置项
      * @returns SceneLoopResult 实例
     */
    async run(options: SceneLoopOptions): Promise<SceneLoopResult> {
        const tasks = parseSceneBlocks(options.expansionText);
        const result: SceneLoopResult = { scenes: [], failedScenes: [], completedAll: true, aborted: false };

        let prevEnding = options.snapshot?.previousEnding?.mustContinue || '';
        let directive: string | undefined = undefined;

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            if (options.signal?.aborted) {
                result.aborted = true;
                result.completedAll = false;
                break;
            }

            try {
                // 断点恢复：已确认完成的场景直接复用正文，不调 generateSceneBody（TR-7.2 resume）
                const resumeCp = options.resumeCheckpoints?.get(task.num);
                const resumable = Boolean(resumeCp
                    && resumeCp.finishReason === 'scene_done'
                    && (resumeCp.content || '').trim() !== '');

                let body: string;
                let genError: string | null | undefined;
                if (resumable) {
                    body = resumeCp!.content;
                } else {
                    const response = await options.generateSceneBody(task, prevEnding, directive);
                    body = response?.content || '';
                    genError = response?.error;
                }

                if (!body || genError) {
                    result.failedScenes.push({ task, error: genError || '生成内容为空' });
                    result.completedAll = false;
                    continue; // 失败场景不更新 prevEnding，后续场景继续（失败隔离）
                }

                const item: SceneLoopItem = {
                    task,
                    body,
                    beatVerify: this.verifier.verify(body, options.beats || []),
                    conflicts: this.detector.detect(options.snapshot, body),
                };
                result.scenes.push(item);
                prevEnding = body.slice(-PREV_ENDING_SLICE);
                directive = undefined; // 修正指令仅作用于紧随的场景

                if (options.onSceneComplete) {
                    const feedback = await options.onSceneComplete(i, item);
                    if (feedback === false) {
                        result.aborted = true;
                        result.completedAll = false;
                        break; // 用户要求停止（TR-5.3）
                    }
                    if (typeof feedback === 'string' && feedback.trim() !== '') {
                        directive = feedback.trim();
                    }
                }
            } catch (e) {
                if (options.signal?.aborted) {
                    result.aborted = true;
                    result.completedAll = false;
                    break;
                }
                const msg = e instanceof Error ? e.message : String(e);
                result.failedScenes.push({ task, error: msg });
                result.completedAll = false;
            }
        }

        return result;
    }
}
