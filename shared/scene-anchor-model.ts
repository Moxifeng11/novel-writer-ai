/**
 * scene-anchor-model.ts — 场景锚点构建（纯函数）
 *
 * 从「Scene 展开」文本解析当前场景卡，提取在场要素名称，
 * 再经索引精确解析为 ID，生成上下文覆盖要求（供 ContextSession 迭代装配）。
 */

import type { CoverageRequirement } from './context-session-model';
import type { ContextKind } from './context-session-model';
import { resolveEntity, type ProjectIndexEntry } from './project-index-model';

/** 场景卡（从 Scene 展开文本解析） */
export interface SceneAnchor {
    /** 场景序号（1 起） */
    index: number;
    /** 场景标题 */
    title: string;
    /** 场景正文 */
    body: string;
    /** 提取出的要素名称（去重） */
    names: string[];
}

/** 场景卡字段键（中英文都兼容） */
const FIELD_KEYS = [
    '在场人物', '在场', '人物', '涉及人物',
    '地点', '场景地点', '发生地点',
    '冲突', '目标', '情绪', '钩子',
];

/**
 * 从 Scene 展开文本解析场景卡。
 *
 * @param text - Scene 展开全文
 * @returns 场景卡数组
 */
export function parseSceneAnchors(text: string): SceneAnchor[] {
    const source = String(text ?? '').replace(/\r\n/g, '\n');
    const blocks = source.split(/^##\s*场景\s*(\d+)\s*[：:]\s*(.*)$/m);
    // split 带捕获组：结构为 [前言, 序号1, 标题1, 正文1, 序号2, ...]
    const anchors: SceneAnchor[] = [];
    for (let i = 1; i + 2 < blocks.length; i += 3) {
        const index = Number(blocks[i]);
        const title = String(blocks[i + 1] ?? '').trim();
        const body = String(blocks[i + 2] ?? '').trim();
        if (!index || !body) continue;
        anchors.push({ index, title, body, names: extractNames(body) });
    }
    return anchors;
}

/**
 * 从场景正文提取要素名称（按字段键 + 中文书名号/括号）。
 *
 * @param body - 场景正文
 * @returns 名称数组（去重）
 */
export function extractNames(body: string): string[] {
    const names = new Set<string>();
    for (const line of String(body ?? '').split('\n')) {
        const match = line.match(/^\s*[-*]?\s*([^：:]{1,12})[：:]\s*(.+)$/);
        if (!match) continue;
        const key = match[1].trim();
        if (!FIELD_KEYS.some(item => key.includes(item))) continue;
        const value = match[2];
        for (const name of value.split(/[、，,;；/／|]+/)) {
            const cleaned = name.replace(/[《》【】\[\]（）()]/g, '').trim();
            if (cleaned && cleaned.length <= 12) names.add(cleaned);
        }
    }
    return [...names];
}

/**
 * 名称 → ID（精确解析；多义/未命中不计入，避免误注入）。
 *
 * @param entries - 项目索引条目
 * @param names - 名称
 * @returns 解析结果
 */
export function resolveAnchorIds(
    entries: readonly ProjectIndexEntry[],
    names: readonly string[],
): { ids: string[]; unresolved: string[]; ambiguous: string[] } {
    const index = { version: 2 as const, project: '', updatedAt: 0, entries: [...entries] };
    const ids: string[] = [];
    const unresolved: string[] = [];
    const ambiguous: string[] = [];
    for (const name of names) {
        const result = resolveEntity(index, name);
        if (result.match?.id) {
            if (!ids.includes(result.match.id)) ids.push(result.match.id);
        } else if (result.candidates && result.candidates.length > 0) {
            ambiguous.push(name);
        } else {
            unresolved.push(name);
        }
    }
    return { ids, unresolved, ambiguous };
}

/**
 * 构建上下文覆盖要求（实体 + 关系）。
 *
 * @param scene - 场景锚点
 * @param resolved - 解析出的 ID
 * @param entries - 索引条目（用于找关系卡）
 * @returns 覆盖要求
 */
export function buildSceneRequirements(
    scene: SceneAnchor,
    resolved: { ids: string[] },
    entries: readonly ProjectIndexEntry[],
): CoverageRequirement[] {
    const requirements: CoverageRequirement[] = [];
    if (resolved.ids.length > 0) {
        requirements.push({ kind: 'entity' as ContextKind, ids: [...resolved.ids] });
    }
    // 关系卡：路径里同时包含两个在场 ID 的关系文件
    const relationIds = entries
        .filter(entry => entry.type === 'relation' && typeof entry.id === 'string')
        .filter(entry => resolved.ids.filter(id => entry.path.includes(id)).length >= 2)
        .map(entry => entry.id as string);
    if (relationIds.length > 0) {
        requirements.push({ kind: 'relation' as ContextKind, ids: relationIds });
    }
    void scene;
    return requirements;
}

/**
 * 场景锚点摘要（日志/调试）。
 *
 * @param scene - 场景锚点
 * @returns 文本
 */
export function describeSceneAnchor(scene: SceneAnchor): string {
    return `场景${scene.index}「${scene.title}」：在场名称 ${scene.names.length} 个（${scene.names.slice(0, 6).join('、')}）`;
}
