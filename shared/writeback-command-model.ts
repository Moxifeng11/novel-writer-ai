/**
 * writeback-command-model.ts — 结算回写指令校验（纯函数）
 *
 * 解决旧实现的问题：正则解析、无 schema 校验、按名字匹配实体、无冲突解决。
 * 新模型：结构化指令 + 字段白名单 + 数值范围 + ID 精确匹配 + 冲突记录。
 */

import type { EntityType } from './project-index-model';

/** 回写动作 */
export type WritebackOp =
    | 'update_entity'
    | 'new_entity'
    | 'relation'
    | 'growth'
    | 'emotion'
    | 'foreshadow'
    | 'timeline';

/** 回写指令 */
export interface WritebackCommand {
    /** 动作 */
    op: WritebackOp;
    /** 目标实体/条目 ID（new_entity 可空） */
    targetId?: string;
    /** 目标类型（new_entity 必填） */
    targetType?: EntityType;
    /** 字段（白名单校验） */
    fields: Record<string, string | number | string[]>;
    /** 来源章节 ID */
    sourceChapterId?: string;
    /** 来源场景 ID */
    sourceSceneId?: string;
    /** 原始行（便于回溯） */
    raw?: string;
}

/** 校验结果 */
export interface WritebackValidation {
    /** 合法指令 */
    accepted: WritebackCommand[];
    /** 被拒指令与原因 */
    rejected: Array<{ command: WritebackCommand; reasons: string[] }>;
    /** 冲突（同目标同字段多次写） */
    conflicts: Array<{ targetId: string; field: string; kept: string | number | string[]; dropped: string | number | string[] }>;
    /** 按 ID 未能解析目标的指令（不猜，转待确认） */
    unresolved: WritebackCommand[];
}

/** 关系数值维度 */
export const RELATION_DIMENSIONS = ['trust', 'attraction', 'fear', 'resentment', 'dependence'] as const;

/** 数值范围 */
const DIMENSION_RANGE: Record<string, { min: number; max: number }> = {
    trust: { min: 0, max: 100 },
    attraction: { min: 0, max: 100 },
    fear: { min: 0, max: 100 },
    resentment: { min: 0, max: 100 },
    dependence: { min: 0, max: 100 },
};

/** 各动作允许的字段（未列出的动作允许任意非保留字段） */
const ALLOWED_FIELDS: Partial<Record<WritebackOp, string[]>> = {
    relation: [...RELATION_DIMENSIONS, '关系类型', '关系状态', '最后更新章节'],
    growth: ['成长节点', '当前阶段', '变化'],
    emotion: ['情绪', '情绪强度', '原因'],
    foreshadow: ['状态', '埋设章节', '计划回收', '回收章节', '回收方式'],
    timeline: ['时间', '章节', '地点', '涉及人物', '类型', '状态'],
};

/** 合法伏笔状态 */
const FORESHADOW_STATUS = new Set(['planted', 'progressing', 'resolved', 'abandoned']);

/**
 * 校验回写指令集。
 *
 * @param commands - 指令
 * @param knownIds - 已知实体 ID（用于精确匹配）
 * @returns 校验结果
 */
export function validateWritebackCommands(
    commands: readonly WritebackCommand[],
    knownIds: readonly string[],
): WritebackValidation {
    const known = new Set(knownIds);
    const accepted: WritebackCommand[] = [];
    const rejected: WritebackValidation['rejected'] = [];
    const unresolved: WritebackCommand[] = [];
    const seen = new Map<string, { command: WritebackCommand; field: string }>();

    for (const command of commands) {
        const reasons = validateOne(command, known);
        if (reasons.length > 0) {
            rejected.push({ command, reasons });
            continue;
        }
        if (command.op !== 'new_entity') {
            if (!command.targetId || !known.has(command.targetId)) {
                unresolved.push(command);
                continue;
            }
        }
        accepted.push(command);
        for (const field of Object.keys(command.fields)) {
            const key = `${command.targetId ?? command.targetType ?? ''}|${field}`;
            seen.set(key, { command, field });
        }
    }

    // 冲突：同目标同字段多指令 → 保留最后一条，记录被覆盖值
    const conflicts: WritebackValidation['conflicts'] = [];
    const byKey = new Map<string, WritebackCommand[]>();
    for (const command of accepted) {
        for (const field of Object.keys(command.fields)) {
            const key = `${command.targetId ?? command.targetType ?? ''}|${field}`;
            const list = byKey.get(key) ?? [];
            list.push(command);
            byKey.set(key, list);
        }
    }
    for (const [key, list] of byKey) {
        if (list.length <= 1) continue;
        const [targetId, field] = key.split('|');
        const last = list[list.length - 1];
        const previous = list[list.length - 2];
        conflicts.push({
            targetId,
            field,
            kept: last.fields[field],
            dropped: previous.fields[field],
        });
    }

    return { accepted, rejected, conflicts, unresolved };
}

/** 校验单条指令（返回原因列表） */
function validateOne(command: WritebackCommand, known: Set<string>): string[] {
    const reasons: string[] = [];
    if (!command || typeof command !== 'object') return ['指令不是对象'];
    if (!command.op) reasons.push('缺少 op');
    if (!command.fields || typeof command.fields !== 'object') reasons.push('缺少 fields');
    const allowed = ALLOWED_FIELDS[command.op];
    if (allowed) {
        for (const field of Object.keys(command.fields ?? {})) {
            if (!allowed.includes(field)) reasons.push(`字段不在白名单：${field}`);
        }
    }
    if (command.op === 'new_entity') {
        if (!command.targetType) reasons.push('new_entity 缺少 targetType');
        if (command.targetId && known.has(command.targetId)) reasons.push(`ID 已存在：${command.targetId}`);
    }
    if (command.op === 'relation') {
        for (const dimension of RELATION_DIMENSIONS) {
            const value = command.fields?.[dimension];
            if (value === undefined) continue;
            const numeric = Number(value);
            const range = DIMENSION_RANGE[dimension];
            if (!Number.isFinite(numeric)) reasons.push(`${dimension} 不是数值`);
            else if (numeric < range.min || numeric > range.max) reasons.push(`${dimension} 超出范围 ${range.min}–${range.max}`);
        }
    }
    if (command.op === 'foreshadow') {
        const status = command.fields?.['状态'];
        if (status !== undefined && !FORESHADOW_STATUS.has(String(status))) {
            reasons.push(`伏笔状态非法：${String(status)}（应为 ${[...FORESHADOW_STATUS].join('/')}）`);
        }
    }
    return reasons;
}

/**
 * 生成待确认清单（未解析目标 + 冲突）。
 *
 * @param validation - 校验结果
 * @returns 文本
 */
export function renderWritebackReview(validation: WritebackValidation): string {
    const lines: string[] = [];
    if (validation.unresolved.length > 0) {
        lines.push(`【待确认：目标未解析】${validation.unresolved.length} 条`);
        for (const command of validation.unresolved.slice(0, 10)) {
            lines.push(`- ${command.op} ${command.targetId ?? command.targetType ?? ''}：${command.raw ?? ''}`);
        }
    }
    if (validation.conflicts.length > 0) {
        lines.push(`【冲突：同字段多次写，已保留最后一条】${validation.conflicts.length} 处`);
        for (const conflict of validation.conflicts.slice(0, 10)) {
            lines.push(`- ${conflict.targetId}.${conflict.field}：保留 ${String(conflict.kept)}，丢弃 ${String(conflict.dropped)}`);
        }
    }
    if (validation.rejected.length > 0) {
        lines.push(`【被拒】${validation.rejected.length} 条`);
        for (const item of validation.rejected.slice(0, 10)) {
            lines.push(`- ${item.command.raw ?? item.command.op}：${item.reasons.join('；')}`);
        }
    }
    return lines.join('\n');
}
