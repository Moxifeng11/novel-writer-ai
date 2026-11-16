/**
 * scene-outline-format.ts — 场景细纲的纯文本编解码（2026-11-16）
 *
 * 从 scene-outline-controller 的 saveScenes / parseScenes 抽出：
 *  - serializeScenes：场景数组 → Scene展开.md 文本
 *  - renumberScenes / shiftSceneNumbers：跨章复制时的序号重排
 *
 * 抽出的原因：
 *  1. 跨章复制要「解析目标章 + 追加 + 重排序号」，不能依赖控制器的实例状态；
 *  2. 编码格式必须与控制器完全一致，抽成纯函数才能穷举单测防漂移。
 *
 * 注意：格式变更会影响已有项目文件的解析，本文件只做等价抽取。
 */
import type { ExtendedSceneData } from '@/shared/types';

/** 冲突类型 → 中文（写文件用） */
const CONFLICT_TYPE_LABELS: Record<string, string> = {
    internal: '内在冲突',
    external: '外在冲突',
    interpersonal: '人际冲突',
};

/** 爽点类型 → 中文（写文件用） */
const PLEASURE_TYPE_LABELS: Record<string, string> = {
    face_slap: '打脸',
    level_up: '升级',
    reveal: '揭秘',
    gain: '收获',
};

/** 状态 → 中文（写文件用） */
const STATUS_LABELS: Record<string, string> = {
    not_started: '未开始',
    in_progress: '进行中',
    completed: '已完成',
};

/**
 * 序列化单个场景为 markdown 段落。
 *
 * @param scene - 场景数据
 * @param isLast - 是否为最后一个场景（最后一个才写 cliffhanger）
 * @returns 段落文本（以换行结尾）
 * @example
 * serializeScene(scene, true);
 */
export function serializeScene(scene: ExtendedSceneData, isLast: boolean): string {
    let output = `## 场景${scene.index}：${scene.name || '(未命名)'}\n`;
    if (scene.pov) output += `pov: ${scene.pov}\n`;
    if (scene.time) output += `time: ${scene.time}\n`;
    if (scene.location) output += `location: ${scene.location}\n`;
    if (scene.entryState) output += `entry_state: ${scene.entryState}\n`;
    output += `objective: ${scene.objective}\n`;
    output += `conflict: ${scene.conflict}\n`;
    if (scene.turn) output += `turn: ${scene.turn}\n`;
    if (scene.exitState) output += `exit_state: ${scene.exitState}\n`;
    output += `emotion_arc: ${scene.emotionArc}\n`;
    output += `sensory_hook: ${scene.sensoryHook}\n`;
    output += `memory_trigger: ${scene.memoryTrigger}\n`;
    output += `body_reaction: ${scene.bodyReaction}\n`;
    output += `subtext: ${scene.subtext}\n`;
    output += `relationship_shift: ${scene.relationshipShift}\n`;
    output += `key_scene: ${scene.keyScene || (scene.isKeyScene ? '⭐ 名场面' : '否')}\n`;
    output += `dialogue_function: ${scene.dialogueFunction}\n`;
    if (scene.craftNotes) output += `craft_notes: ${scene.craftNotes}\n`;
    if (scene.characters) output += `characters: ${scene.characters}\n`;
    if (scene.timelinePosition) output += `timeline: ${scene.timelinePosition}\n`;
    if (scene.conflictType) {
        output += `conflict_type: ${CONFLICT_TYPE_LABELS[scene.conflictType] || scene.conflictType}\n`;
    }
    if (scene.pleasureType) {
        output += `pleasure_type: ${PLEASURE_TYPE_LABELS[scene.pleasureType] || scene.pleasureType}\n`;
    }
    if (scene.infoIncrement) output += `info_increment: ${scene.infoIncrement}\n`;
    if (scene.foreshadowPlant) output += `foreshadow_plant: ${scene.foreshadowPlant}\n`;
    if (scene.foreshadowRecover) output += `foreshadow_recover: ${scene.foreshadowRecover}\n`;
    if (scene.wordCountEstimate > 0) output += `word_count: ${scene.wordCountEstimate}\n`;
    if (scene.status && scene.status !== 'not_started') {
        output += `status: ${STATUS_LABELS[scene.status] || scene.status}\n`;
    }
    if (isLast) output += `cliffhanger: ${scene.cliffhanger}\n`;
    output += '\n';
    return output;
}

/**
 * 序列化整章场景列表。
 *
 * @param scenes - 场景数组
 * @returns Scene展开.md 文本
 * @example
 * serializeScenes(scenes);
 */
export function serializeScenes(scenes: readonly ExtendedSceneData[]): string {
    return scenes
        .map((scene, index) => serializeScene(scene, index === scenes.length - 1))
        .join('');
}

/**
 * 重排场景序号（跨章复制时目标章要接着自己的序号往后排）。
 *
 * @param scenes - 场景数组
 * @param startIndex - 起始序号（不含）
 * @returns 新数组（不改入参）
 * @example
 * renumberScenes(copied, 3); // 序号从 4 开始
 */
export function renumberScenes(
    scenes: readonly ExtendedSceneData[],
    startIndex: number,
): ExtendedSceneData[] {
    return scenes.map((scene, index) => ({ ...scene, index: startIndex + index + 1 }));
}

/**
 * 追加场景到已有内容末尾。
 *
 * 目标章已有场景时，复制过去的场景序号接着排；目标为空则从 1 开始。
 * 原最后一个场景的 cliffhanger 会被保留（因为它在原位置仍是「原最后」），
 * 新追加的场景按自身顺序重建 cliffhanger 归属。
 *
 * @param existingContent - 目标章现有文本（可为空）
 * @param existingCount - 目标章已有场景数
 * @param scenes - 要追加的场景
 * @returns 追加后的完整文本
 * @example
 * appendScenesToContent('', 0, copied);
 */
export function appendScenesToContent(
    existingContent: string,
    existingCount: number,
    scenes: readonly ExtendedSceneData[],
): string {
    if (scenes.length === 0) return existingContent;
    const renumbered = renumberScenes(scenes, existingCount);
    const base = existingContent.trimEnd();
    const prefix = base ? `${base}\n\n` : '';
    return prefix + serializeScenes(renumbered);
}
