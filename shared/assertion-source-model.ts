/**
 * assertion-source-model.ts — 从「断言.json」等磁盘数据构造分批断言（纯函数）
 *
 * 一致性模块落盘结构有多种历史写法（涉及人物/entityIds/entity、text/description/描述、
 * severity/严重度、chapter/章节），这里做**容忍式解析**，供 M6 按在场实体筛选。
 */

import type { BatchAssertion } from './assertion-batch-model';

/** 原始断言条目（任意历史形状） */
type RawAssertion = Record<string, unknown>;

/**
 * 从原始断言数组解析为 BatchAssertion。
 *
 * @param raw - 原始数据（数组或 {assertions:[...]}）
 * @param resolveName - 名称 → ID（可选；用于把「涉及人物」里的名字换成 ID）
 * @returns 断言
 */
export function parseAssertions(
    raw: unknown,
    resolveName?: (name: string) => string | null,
): BatchAssertion[] {
    const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { assertions?: unknown })?.assertions)
            ? (raw as { assertions: RawAssertion[] }).assertions
            : [];
    const result: BatchAssertion[] = [];
    for (const [index, item] of list.entries()) {
        if (!item || typeof item !== 'object') continue;
        const record = item as RawAssertion;
        const id = pickString(record, ['id', 'assertionId', 'assertion_id']) || `AST-${index + 1}`;
        const text = pickString(record, ['text', 'description', '描述', 'content', '断言']);
        if (!text) continue;
        const entityIds = pickEntityIds(record, resolveName);
        const severity = pickSeverity(record);
        const chapter = pickNumber(record, ['chapter', 'chapterNum', '章节']);
        result.push({
            id,
            entityIds,
            text,
            ...(severity ? { severity } : {}),
            ...(chapter !== undefined ? { chapter } : {}),
        });
    }
    return result;
}

/** 取字符串字段 */
function pickString(record: RawAssertion, keys: readonly string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number') return String(value);
    }
    return '';
}

/** 取数字字段 */
function pickNumber(record: RawAssertion, keys: readonly string[]): number | undefined {
    for (const key of keys) {
        const value = Number(record[key]);
        if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    return undefined;
}

/** 取严重度 */
function pickSeverity(record: RawAssertion): BatchAssertion['severity'] | undefined {
    const value = String(record.severity ?? record['严重度'] ?? '').toLowerCase();
    if (value === 'high' || value === '高' || value === 'critical') return 'high';
    if (value === 'medium' || value === '中') return 'medium';
    if (value === 'low' || value === '低') return 'low';
    return undefined;
}

/** 取涉及实体 ID（名称经 resolveName 转 ID；无法解析的丢弃） */
function pickEntityIds(record: RawAssertion, resolveName?: (name: string) => string | null): string[] {
    const raw = record.entityIds ?? record.entity_ids ?? record.entities ?? record['涉及人物'] ?? record['涉及实体'];
    const names: string[] = [];
    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (typeof item === 'string' && item.trim()) names.push(item.trim());
        }
    } else if (typeof raw === 'string' && raw.trim()) {
        names.push(...raw.split(/[、，,;；/|]+/).map(item => item.trim()).filter(Boolean));
    }
    const ids: string[] = [];
    for (const name of names) {
        const looksLikeId = /^[A-Z]{2,4}-\d{1,6}$/.test(name);
        if (looksLikeId) {
            if (!ids.includes(name)) ids.push(name);
            continue;
        }
        const resolved = resolveName?.(name) ?? null;
        if (resolved && !ids.includes(resolved)) ids.push(resolved);
    }
    return ids;
}

/**
 * 解析摘要（日志/调试）。
 *
 * @param assertions - 断言
 * @returns 文本
 */
export function describeAssertions(assertions: readonly BatchAssertion[]): string {
    if (assertions.length === 0) return '无断言';
    const high = assertions.filter(assertion => assertion.severity === 'high').length;
    return `断言 ${assertions.length} 条（高风险 ${high} 条）`;
}
