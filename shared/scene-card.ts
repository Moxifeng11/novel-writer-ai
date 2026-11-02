/**
 * scene-card.ts — 场景卡纯数据层
 *
 * 场景规划输出、场景编辑器、逐场景正文生成共用同一套字段名，
 * 避免「编辑器存了 location，生成器只读 objective」这类字段丢失。
 */

import { activeContextQuotas } from './context-budget-policy';

export interface SceneCardFields {
    num: number;
    name: string;
    pov?: string;
    time?: string;
    location?: string;
    objective?: string;
    entryState?: string;
    conflict?: string;
    turn?: string;
    exitState?: string;
    emotionArc?: string;
    sensoryHook?: string;
    memoryTrigger?: string;
    bodyReaction?: string;
    subtext?: string;
    relationshipShift?: string;
    keyScene?: string;
    dialogueFunction?: string;
    cliffhanger?: string;
    craftNotes?: string;
    characters?: string;
    /**
     * 本场对话骨架：6–10 条「谁 → 谁｜台词或说话意图｜完成什么」。
     * 由 Scene 展开产出、正文生成逐条用上——对话密度来自数据，不靠提示词数比例
     * （实测：写「对话占比≥40%」模型只做到 11%）。
     */
    dialogueBeats?: string[];
}

/** 场景文件里的 snake_case 字段 ↔ 内存 camelCase 字段 */
export const SCENE_CARD_FIELD_MAP = {
    pov: 'pov',
    time: 'time',
    location: 'location',
    objective: 'objective',
    entry_state: 'entryState',
    conflict: 'conflict',
    turn: 'turn',
    exit_state: 'exitState',
    emotion_arc: 'emotionArc',
    sensory_hook: 'sensoryHook',
    memory_trigger: 'memoryTrigger',
    body_reaction: 'bodyReaction',
    subtext: 'subtext',
    relationship_shift: 'relationshipShift',
    key_scene: 'keyScene',
    dialogue_function: 'dialogueFunction',
    dialogue_beats: 'dialogueBeats',
    cliffhanger: 'cliffhanger',
    craft_notes: 'craftNotes',
    characters: 'characters',
} as const;

export type SceneCardFieldKey = keyof typeof SCENE_CARD_FIELD_MAP;

/**
 * 解析 `field: value` / `field：value`；容忍 Markdown 加粗
 *
 * @param block - 文本块
 * @param field - 字段
 * @returns 文本结果
 */
export function parseSceneField(block: string, field: string): string {
    const m = block.match(new RegExp(`^\\s*\\*?\\*?${field}\\s*[：:]\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : '';
}

/**
 * 解析对话骨架（多行字段）。
 * 兼容 `dialogue_beats:` / `对话骨架：`，取其后连续以 `-` 开头的行，直到空行或下一个字段。
 * @param block - 文本块
 * @returns 结果数组
 */
export function parseDialogueBeats(block: string): string[] {
    const lines = String(block || '').split(/\r?\n/);
    const headRe = new RegExp('^\\s*\\*?\\*(?:dialogue_beats|对话骨架)\\s*[：:]');
    const start = lines.findIndex((line) => headRe.test(line));
    if (start < 0) return [];
    const beats: string[] = [];
    const inline = lines[start].replace(headRe, "").trim();
    if (inline && !inline.startsWith("-")) beats.push(inline);
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (beats.length > 0) break;
            continue;
        }
        if (/^[-*•]\s+/.test(line)) {
            beats.push(line.replace(/^[-*•]\s+/, "").trim());
            continue;
        }
        // 遇到下一个字段就停
        if (/^\*?\*?[a-zA-Z_]+\s*[：:]/.test(line)) break;
        if (beats.length > 0) break;
    }
    return beats.filter((beat) => beat.length > 0);
}

export function parseSceneCardFields(
    block: string,
    base: Pick<SceneCardFields, 'num' | 'name'>,
): SceneCardFields {
    const result = {
        num: base.num,
        name: base.name,
    } as SceneCardFields;

    for (const [markdownKey, objectKey] of Object.entries(SCENE_CARD_FIELD_MAP)) {
        if (objectKey === 'dialogueBeats') continue;
        (result as unknown as Record<string, string>)[objectKey] = parseSceneField(block, markdownKey);
    }
    result.dialogueBeats = parseDialogueBeats(block);
    return result;
}

export function emptySceneCard(num: number, name = ''): SceneCardFields {
    return {
        num,
        name,
        pov: '',
        time: '',
        location: '',
        objective: '',
        entryState: '',
        conflict: '',
        turn: '',
        exitState: '',
        emotionArc: '',
        sensoryHook: '',
        memoryTrigger: '',
        bodyReaction: '',
        subtext: '',
        relationshipShift: '',
        keyScene: '',
        dialogueFunction: '',
        cliffhanger: '',
        craftNotes: '',
        characters: '',
        dialogueBeats: [],
    };
}

/**
 * 渲染「本场对话骨架」提示词块。
 * 有骨架时正文必须逐条用上；没有骨架返回空串（调用方跳过注入）。
 * @param scenes - 场景列表
 * @param options - 配置项
 * @returns 文本结果
 */
export function formatDialogueSkeleton(
    scenes: SceneCardFields[],
    options: { maxScenes?: number; maxChars?: number } = {},
): string {
    const maxScenes = Math.max(1, options.maxScenes ?? 12);
    const maxChars = Math.max(400, options.maxChars ?? 4000);
    const lines: string[] = [];
    let beats = 0;
    for (const scene of scenes.slice(0, maxScenes)) {
        const list = (scene.dialogueBeats || []).filter((beat) => beat.trim().length > 0);
        if (list.length === 0) continue;
        lines.push(`场景${scene.num}${scene.name ? `「${scene.name}」` : ''}：`);
        for (const beat of list) {
            lines.push(`- ${beat}`);
            beats++;
        }
        if (lines.join('\n').length >= maxChars) break;
    }
    if (beats === 0) return '';
    return `【本场对话骨架（必须逐条用上：可微调字词，不要删条、不要改成转述）】\n${lines.join('\n')}`;
}

/**
 * 生成紧凑场景卡，放入正文 prompt。
 * 只保留写作时必须遵守的字段，避免把整段 Scene 展开再注入一遍。
 * @param scenes - 场景列表
 * @param options - 配置项
 * @returns 文本结果
 */
export function formatSceneCardDigest(
    scenes: SceneCardFields[],
    options: { maxScenes?: number; maxChars?: number } = {},
): string {
    // v4.22：场数/字数额度随输入预算放大（旧值 12 场 / 3000 字会吞掉多场景章的后半段）
    const quotas = activeContextQuotas();
    const maxScenes = Math.max(1, options.maxScenes ?? quotas.sceneCardMaxCount);
    const maxChars = Math.max(200, options.maxChars ?? Math.round(quotas.sceneCardChars * maxScenes));
    const lines: string[] = [];

    for (const scene of scenes.slice(0, maxScenes)) {
        const parts = [
            scene.pov ? `POV:${scene.pov}` : '',
            scene.time ? `时间:${scene.time}` : '',
            scene.location ? `地点:${scene.location}` : '',
            scene.objective ? `目标:${scene.objective}` : '',
            scene.entryState ? `入场:${scene.entryState}` : '',
            scene.conflict ? `冲突:${scene.conflict}` : '',
            scene.turn ? `转折:${scene.turn}` : '',
            scene.exitState ? `离场:${scene.exitState}` : '',
            // v4.25：感官/身体/情绪弧随卡注入。V3/V4 不注入整段场景展开，
            // 这三个字段是「场景描写硬约束」在节拍/对话主干路径上的唯一来源。
            scene.sensoryHook ? `感官:${scene.sensoryHook}` : '',
            scene.bodyReaction ? `身体:${scene.bodyReaction}` : '',
            scene.emotionArc ? `情绪弧:${scene.emotionArc}` : '',
        ].filter(Boolean);
        if (parts.length === 0) continue;
        lines.push(`场景${scene.num}${scene.name ? `「${scene.name}」` : ''}：${parts.join(' | ')}`);
        if (lines.join('\n').length >= maxChars) break;
    }

    if (lines.length === 0) return '';
    return `【场景卡（硬约束）】\n${lines.join('\n')}`;
}
