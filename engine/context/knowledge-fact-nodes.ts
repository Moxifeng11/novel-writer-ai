/**
 * knowledge-fact-nodes.ts — 把拆解事实变成 StoryContextGraph 节点
 *
 * 定位（2026-11-13 架构校准）：**不保留独立事实库**。拆解产物直接成为图节点，
 * 与人物/物品/地点/时间线/伏笔节点同住一张图，共用 `nameIndex` 与 `links`。
 * 这样写作注入与一致性审核看到的是**同一份事实**，不存在"双来源谁优先"的歧义。
 *
 * 权威序（红线）：正文 > 图 > 章节摘要。
 * 图可被人工修正，摘要只是 LLM 派生数据。
 */

import type { DecomposeEntry, DecomposeType } from '@/engine/consistency/knowledge-decompose';
import type { StoryContextKind, StoryContextNode } from './story-context-types';

/** 拆解类型 → 图节点类型（9 → 6，不新增 kind） */
export const FACT_TYPE_TO_KIND: Record<DecomposeType, StoryContextKind> = {
    age: 'character',
    ability: 'character',
    knowledge: 'character',
    memory: 'character',
    relationship: 'character',
    location: 'location',
    possession: 'item',
    timeline: 'timeline',
    'world-rule': 'setting',
};

/** 类型权重（用于 priority：规则与时间线更该被注入） */
const TYPE_WEIGHT: Record<DecomposeType, number> = {
    'world-rule': 1,
    timeline: 0.95,
    location: 0.85,
    possession: 0.8,
    relationship: 0.75,
    ability: 0.7,
    age: 0.7,
    memory: 0.65,
    knowledge: 0.6,
};

/** 图节点里承载事实的 metadata 结构 */
export interface FactMetadata {
    /** 拆解类型 */
    type: DecomposeType;
    /** 主体 */
    subject: string;
    /** 谓词 */
    predicate: string;
    /** 值（原样） */
    value: string;
    /** 数值 */
    numeric?: number;
    /** 单位 */
    unit?: string;
    /** 生效章节 */
    validFrom: number;
    /** 失效章节 */
    validTo: number | null;
    /** 置信度 */
    confidence: number;
    /** 原文引文 */
    quote: string;
    /** 来源章节 */
    chapter: number;
    /** 是否被人工忽略（保留但排除出第二意见） */
    ignored?: boolean;
    /** 是否描述当前状态（false = 回溯/回忆；缺省视为 true） */
    isCurrentState?: boolean;
    /** 事件锚：该事实属于哪个事件/状态 */
    event?: string;
    /** 子维度：同一主体的不同侧面 */
    slot?: string;
}

/**
 * 构造事实节点 id（稳定、可去重）。
 *
 * @param chapter - 章节号
 * @param subject - 主体
 * @param predicate - 谓词
 * @returns 节点 id
 */
export function factNodeId(chapter: number, subject: string, predicate: string): string {
    return `fact:${chapter}:${subject}:${predicate}`;
}

/**
 * 估算 token（与图现有口径一致：按字符数 / 2 向上取整）。
 *
 * @param text - 文本
 * @returns 估算 token 数
 */
export function estimateTokens(text: string): number {
    return Math.max(1, Math.ceil([...(text ?? '')].length / 2));
}

/**
 * 把拆解条目转成图节点。
 *
 * @param entries - 拆解条目
 * @param chapter - 章节号
 * @param chapterName - 章节名（用于标题与溯源）
 * @param options - 可选：本章出场人物（核心事实标 required）、正文路径
 * @returns 图节点列表
 */
export function toContextNodes(
    entries: readonly DecomposeEntry[],
    chapter: number,
    chapterName = '',
    options: { involved?: readonly string[]; sourcePath?: string } = {},
): StoryContextNode[] {
    const involved = new Set((options.involved ?? []).map(n => n.trim()).filter(Boolean));
    const nodes: StoryContextNode[] = [];
    for (const entry of entries) {
        const kind = FACT_TYPE_TO_KIND[entry.type];
        if (!kind) continue;
        const id = factNodeId(chapter, entry.subject, entry.predicate);
        const text = formatFactText(entry, chapter);
        const compact = `「${entry.subject}·${entry.predicate}=${entry.value}」`;
        const meta: FactMetadata = {
            type: entry.type,
            subject: entry.subject,
            predicate: entry.predicate,
            value: entry.value,
            numeric: entry.numeric,
            unit: entry.unit,
            validFrom: entry.validFrom,
            validTo: entry.validTo,
            confidence: entry.confidence,
            quote: entry.quote,
            chapter,
        };
        nodes.push({
            id,
            kind,
            title: `${entry.subject}·${entry.predicate}`,
            text,
            compactText: compact,
            priority: Number((entry.confidence * TYPE_WEIGHT[entry.type]).toFixed(3)),
            required: involved.has(entry.subject),
            tokens: estimateTokens(text),
            compactTokens: estimateTokens(compact),
            links: [],
            sourcePath: options.sourcePath,
            metadata: { fact: meta, chapterName },
        });
    }
    return nodes;
}

/**
 * 格式化事实文本（供预算装配与人类阅读）。
 *
 * @param entry - 拆解条目
 * @param chapter - 章节号
 * @returns 文本
 */
export function formatFactText(entry: DecomposeEntry, chapter: number): string {
    const range = entry.validTo === null ? `第${chapter}章起` : `第${chapter}–${entry.validTo}章`;
    return `${entry.subject}·${entry.predicate}=${entry.value}（${range}；原文「${truncate(entry.quote, 40)}」）`;
}

/**
 * 截断文本。
 *
 * @param text - 文本
 * @param max - 最大长度
 * @returns 截断结果
 */
export function truncate(text: string, max: number): string {
    const chars = [...(text ?? '')];
    return chars.length <= max ? (text ?? '') : chars.slice(0, max).join('') + '…';
}

/**
 * 从图节点还原事实（供一致性审核与视图使用）。
 *
 * @param node - 图节点
 * @returns 事实 metadata；非事实节点返回 null
 */
export function readFact(node: StoryContextNode): FactMetadata | null {
    const fact = node?.metadata?.fact;
    if (!fact || typeof fact !== 'object') return null;
    const raw = fact as Partial<FactMetadata>;
    if (!raw.subject || !raw.predicate || raw.value === undefined) return null;
    return {
        type: (raw.type ?? 'knowledge') as DecomposeType,
        subject: raw.subject,
        predicate: raw.predicate,
        value: String(raw.value),
        numeric: raw.numeric,
        unit: raw.unit,
        validFrom: raw.validFrom ?? 0,
        validTo: raw.validTo ?? null,
        confidence: raw.confidence ?? 0,
        quote: raw.quote ?? '',
        chapter: raw.chapter ?? 0,
    };
}

/**
 * 从一组图节点里取出全部事实。
 *
 * @param nodes - 图节点
 * @returns 事实列表
 */
export function readAllFacts(nodes: Iterable<StoryContextNode>): FactMetadata[] {
    const out: FactMetadata[] = [];
    for (const node of nodes) {
        const fact = readFact(node);
        if (fact) out.push(fact);
    }
    return out;
}

/**
 * 事实库 → 生成注入用图节点（DSH-20261114-01）。
 *
 * 与 `toContextNodes` 的区别：`toContextNodes` 服务「拆解当时」（单章条目），
 * 本函数服务「写作时注入」——事实库里躺着**全书历史**的事实，因此：
 *   1. 过滤 `ignored`（人工忽略的不进生成）；
 *   2. 过滤已失效事实（`validTo !== null && validTo < chapterNum`——
 *      「宁缺十七岁」在第 30 章过期后不应继续指导正文）；
 *   3. **按事实自身的章节分组**再调 `toContextNodes`——节点的稳定 id 与
 *      「第 N 章起」范围文本必须用事实来源章，不能用当前章。
 *
 * @param facts - 事实库条目（FactMetadata 与 DecomposeEntry 结构兼容）
 * @param chapterNum - 当前章号（过期判定基准；0 = 全局 gather，不判过期）
 * @param options - 可选：项目名（仅 traceability）
 * @returns 图节点列表（空事实库 → 空数组）
 */
export function factNodesForInjection(
    facts: readonly FactMetadata[],
    chapterNum: number,
    options: { projectName?: string } = {},
): StoryContextNode[] {
    const valid = facts.filter(fact => {
        if (fact.ignored) return false;
        if (chapterNum > 0 && fact.validTo !== null && fact.validTo < chapterNum) return false;
        return true;
    });
    const byChapter = new Map<number, FactMetadata[]>();
    for (const fact of valid) {
        const chapter = Number(fact.chapter) || 0;
        const list = byChapter.get(chapter);
        if (list) list.push(fact);
        else byChapter.set(chapter, [fact]);
    }
    const nodes: StoryContextNode[] = [];
    for (const [chapter, group] of byChapter) {
        const chapterName = options.projectName ? `${options.projectName}·第${chapter}章` : `第${chapter}章`;
        // FactMetadata 是 DecomposeEntry 的超集（type/subject/predicate/value/validFrom/
        // validTo/confidence/quote 全有），结构类型直接兼容
        nodes.push(...toContextNodes(group, chapter, chapterName));
    }
    return nodes;
}

/**
 * 为事实节点建立与同名实体节点的链接（复用图的 links 机制）。
 *
 * 规则：主体名命中图节点 title/nameIndex，且不是自己 → 连一条 `same-entity` 边。
 *
 * @param factNodes - 事实节点（原地修改 links）
 * @param entityNodes - 图中既有实体节点
 * @returns 建立的链接数
 */
export function linkFactsToEntities(
    factNodes: StoryContextNode[],
    entityNodes: readonly StoryContextNode[],
): number {
    const byName = new Map<string, string[]>();
    for (const node of entityNodes) {
        const name = (node.title ?? '').trim();
        if (!name) continue;
        const list = byName.get(name);
        if (list) list.push(node.id);
        else byName.set(name, [node.id]);
    }
    let linked = 0;
    for (const fact of factNodes) {
        const meta = readFact(fact);
        if (!meta) continue;
        const targets = byName.get(meta.subject) ?? [];
        for (const targetId of targets) {
            if (targetId === fact.id) continue;
            fact.links.push({ targetId, reason: 'alias', weight: 1 });
            linked += 1;
        }
    }
    return linked;
}
