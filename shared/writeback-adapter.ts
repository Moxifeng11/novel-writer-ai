/**
 * writeback-adapter.ts — 解析结果 → 结构化回写指令（纯函数）
 *
 * 旧解析器输出「类型 + 名字 + 字段」的松散结构；本适配器负责：
 * 名字 → ID 精确解析（多义/未命中标记，不猜）、动作归一、字段透传。
 * 解析器本身暂不改动，先在校验层收口。
 */

import type { EntityType } from './project-index-model';
import type { WritebackCommand, WritebackOp } from './writeback-command-model';

/** 解析器输出的松散指令 */
export interface ParsedWritebackInput {
    /** 原始动作标记（如 UPDATE_CHARACTER / NEW_FORESHADOW / RELATION） */
    marker: string;
    /** 目标名称（人物名/地点名/伏笔名） */
    name: string;
    /** 字段 */
    fields: Record<string, string | number | string[]>;
    /** 原始行 */
    raw?: string;
}

/** 名称解析结果 */
export interface ResolvedTarget {
    id: string | null;
    /** 候选 ID（多义时） */
    candidates?: string[];
}

/** 适配结果 */
export interface WritebackAdapterResult {
    commands: WritebackCommand[];
    /** 名字未能解析/多义的原始指令 */
    unresolved: Array<{ input: ParsedWritebackInput; reason: string; candidates?: string[] }>;
}

/** 标记 → 动作 */
const MARKER_TO_OP: Array<{ pattern: RegExp; op: WritebackOp; type?: EntityType }> = [
    { pattern: /^NEW_CHARACTER/i, op: 'new_entity', type: 'character' },
    { pattern: /^NEW_LOCATION/i, op: 'new_entity', type: 'location' },
    { pattern: /^NEW_FACTION/i, op: 'new_entity', type: 'faction' },
    { pattern: /^NEW_ITEM/i, op: 'new_entity', type: 'item' },
    { pattern: /^NEW_FORESHADOW/i, op: 'new_entity', type: 'foreshadow' },
    { pattern: /^NEW_TIMELINE/i, op: 'new_entity', type: 'timeline' },
    { pattern: /^UPDATE_CHARACTER/i, op: 'update_entity' },
    { pattern: /^UPDATE_FACTION/i, op: 'update_entity' },
    { pattern: /^UPDATE_LOCATION/i, op: 'update_entity' },
    { pattern: /^UPDATE_ITEM/i, op: 'update_entity' },
    { pattern: /^RELATION/i, op: 'relation', type: 'relation' },
    { pattern: /^GROWTH/i, op: 'growth', type: 'character' },
    { pattern: /^EMOTION/i, op: 'emotion', type: 'character' },
    { pattern: /^UPDATE_FORESHADOW|^FORESHADOW/i, op: 'foreshadow' },
    { pattern: /^UPDATE_TIMELINE|^TIMELINE/i, op: 'timeline' },
];

/**
 * 解析动作标记。
 *
 * @param marker - 标记
 * @returns 动作与类型；未识别返回 null
 */
export function resolveMarker(marker: string): { op: WritebackOp; type?: EntityType } | null {
    const value = String(marker ?? '').trim();
    for (const rule of MARKER_TO_OP) {
        if (rule.pattern.test(value)) return { op: rule.op, ...(rule.type ? { type: rule.type } : {}) };
    }
    return null;
}

/**
 * 把解析器输出转换为结构化指令。
 *
 * @param inputs - 松散指令
 * @param resolve - 名称 → 目标（调用方用索引 resolveEntity 实现）
 * @returns 适配结果
 */
export function adaptWritebackInputs(
    inputs: readonly ParsedWritebackInput[],
    resolve: (name: string, type?: EntityType) => ResolvedTarget,
): WritebackAdapterResult {
    const commands: WritebackCommand[] = [];
    const unresolved: WritebackAdapterResult['unresolved'] = [];

    for (const input of inputs) {
        const resolvedMarker = resolveMarker(input.marker);
        if (!resolvedMarker) {
            unresolved.push({ input, reason: `未识别的标记：${input.marker}` });
            continue;
        }
        const { op, type } = resolvedMarker;
        if (op === 'new_entity') {
            commands.push({
                op,
                ...(type ? { targetType: type } : {}),
                fields: { 名称: input.name, ...input.fields },
                ...(input.raw ? { raw: input.raw } : {}),
            });
            continue;
        }
        const target = resolve(input.name, type);
        if (target.candidates && target.candidates.length > 1) {
            unresolved.push({ input, reason: `多义名称：${input.name}`, candidates: target.candidates });
            continue;
        }
        if (!target.id) {
            unresolved.push({ input, reason: `未找到实体：${input.name}` });
            continue;
        }
        commands.push({
            op,
            targetId: target.id,
            ...(type ? { targetType: type } : {}),
            fields: input.fields,
            ...(input.raw ? { raw: input.raw } : {}),
        });
    }

    return { commands, unresolved };
}

/**
 * 适配结果摘要。
 *
 * @param result - 适配结果
 * @returns 文本
 */
export function describeAdapterResult(result: WritebackAdapterResult): string {
    const parts = [`已结构化 ${result.commands.length} 条`];
    if (result.unresolved.length > 0) parts.push(`未解析 ${result.unresolved.length} 条`);
    return parts.join('，');
}
