/**
 * scene-card.ts — 场景卡纯数据层
 *
 * 场景规划输出、场景编辑器、逐场景正文生成共用同一套字段名，
 * 避免「编辑器存了 location，生成器只读 objective」这类字段丢失。
 */

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
    cliffhanger: 'cliffhanger',
    craft_notes: 'craftNotes',
    characters: 'characters',
} as const;

export type SceneCardFieldKey = keyof typeof SCENE_CARD_FIELD_MAP;

/** 解析 `field: value` / `field：value`；容忍 Markdown 加粗 */
export function parseSceneField(block: string, field: string): string {
    const m = block.match(new RegExp(`^\\s*\\*?\\*?${field}\\s*[：:]\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : '';
}

/** 从一段场景 Markdown 中解析全部场景卡字段（缺失返回空串） */
export function parseSceneCardFields(
    block: string,
    base: Pick<SceneCardFields, 'num' | 'name'>,
): SceneCardFields {
    const result = {
        num: base.num,
        name: base.name,
    } as SceneCardFields;

    for (const [markdownKey, objectKey] of Object.entries(SCENE_CARD_FIELD_MAP)) {
        (result as unknown as Record<string, string>)[objectKey] = parseSceneField(block, markdownKey);
    }
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
    };
}

/**
 * 生成紧凑场景卡，放入正文 prompt。
 * 只保留写作时必须遵守的字段，避免把整段 Scene 展开再注入一遍。
 */
export function formatSceneCardDigest(
    scenes: SceneCardFields[],
    options: { maxScenes?: number; maxChars?: number } = {},
): string {
    const maxScenes = Math.max(1, options.maxScenes ?? 12);
    const maxChars = Math.max(200, options.maxChars ?? 3000);
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
        ].filter(Boolean);
        if (parts.length === 0) continue;
        lines.push(`场景${scene.num}${scene.name ? `「${scene.name}」` : ''}：${parts.join(' | ')}`);
        if (lines.join('\n').length >= maxChars) break;
    }

    if (lines.length === 0) return '';
    return `【场景卡（硬约束）】\n${lines.join('\n')}`;
}
