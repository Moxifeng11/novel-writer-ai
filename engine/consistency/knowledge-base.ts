/**
 * knowledge-base.ts — 项目级知识库（C 臂正式接入的第一层）
 *
 * 定位：**所有需要"上下文不崩坏"的功能共用的一份结构化事实库**。
 * 时间线、伏笔、实体状态、设定规则都落在同一份库里，供：
 *  - 一致性审核（跨章比对）
 *  - 写作时的参考检索（RAG：不再凭空猜设定）
 *  - 既有正则功能的"第二意见"（正则拿到候选，知识库提供历史事实）
 *
 * 设计要点：
 *  - **落盘即真相**：拆解结果写进项目内 `04-项目总控/知识库/`，可版本控制、可人工修正。
 *  - **可累积**：同一主体的事实按章节追加，形成"状态随时间变化"的轨迹。
 *  - **检索不依赖向量**：先做零依赖的字段检索（主体/类型/时间窗），
 *    向量检索作为后续可选增强——避免为检索再引入一个必须联网的组件。
 */

import type { DecomposeEntry, DecomposeType } from './knowledge-decompose';

/** 知识库中的一个事实（带来源章节） */
export interface KnowledgeFact extends DecomposeEntry {
    /** 章节号（decompose 的 validFrom 默认等于该章） */
    chapter: number;
}

/** 知识库 */
export interface KnowledgeBase {
    /** 格式版本（用于未来迁移） */
    version: 1;
    /** 项目路径 */
    project: string;
    /** 最后更新时间（ISO） */
    updatedAt: string;
    /** 全部事实 */
    facts: KnowledgeFact[];
}

/**
 * 创建空知识库。
 *
 * @param project - 项目路径
 * @param now - 当前时间
 * @returns 知识库
 */
export function createKnowledgeBase(project: string, now = new Date()): KnowledgeBase {
    return { version: 1, project, updatedAt: now.toISOString(), facts: [] };
}

/**
 * 追加事实（按 id 去重：同一章同一主体的同一谓词只保留一条）。
 *
 * 去重键：`${subject}|${predicate}|${chapter}`——同一章重复拆解不该产生重复事实。
 *
 * @param kb - 知识库
 * @param chapter - 章节号
 * @param entries - 拆解条目
 * @param now - 当前时间
 * @returns 新增条数
 */
export function appendFacts(
    kb: KnowledgeBase,
    chapter: number,
    entries: readonly DecomposeEntry[],
    now = new Date(),
): number {
    const seen = new Set(kb.facts.map(f => factKey(f)));
    let added = 0;
    for (const entry of entries) {
        const fact: KnowledgeFact = { ...entry, chapter };
        const key = factKey(fact);
        if (seen.has(key)) continue;
        seen.add(key);
        kb.facts.push(fact);
        added += 1;
    }
    if (added > 0) kb.updatedAt = now.toISOString();
    return added;
}

/**
 * 事实去重键。
 *
 * @param fact - 事实
 * @returns 键
 */
export function factKey(fact: Pick<KnowledgeFact, 'subject' | 'predicate' | 'chapter'>): string {
    return `${fact.subject}|${fact.predicate}|${fact.chapter}`;
}

/**
 * 检索：按主体 / 类型 / 章节窗口取事实。
 *
 * 这是**零依赖的 RAG 基础**：写作时想查「宁缺在第 20 章时的状态」，
 * 直接按 subject=宁缺 + chapter≤20 取，按章节排序即可。
 *
 * @param kb - 知识库
 * @param query - 查询条件（全部可选，AND 关系）
 * @param query.subject - 主体（精确或包含匹配）
 * @param query.predicate - 谓词（包含匹配）
 * @param query.type - 类型
 * @param query.fromChapter - 起始章节（含）
 * @param query.toChapter - 结束章节（含）
 * @param query.keyword - 关键词（在 subject/value/quote 中搜索）
 * @param query.limit - 最多返回条数（默认 50）
 * @returns 命中的事实（按章节升序）
 */
export function queryFacts(
    kb: KnowledgeBase,
    query: {
        subject?: string;
        predicate?: string;
        type?: DecomposeType;
        fromChapter?: number;
        toChapter?: number;
        keyword?: string;
        limit?: number;
    } = {},
): KnowledgeFact[] {
    const subject = (query.subject ?? '').trim();
    const predicate = (query.predicate ?? '').trim();
    const keyword = (query.keyword ?? '').trim();
    const limit = Math.max(1, query.limit ?? 50);
    const hits = kb.facts.filter(fact => {
        if (subject && !(fact.subject === subject || fact.subject.includes(subject) || subject.includes(fact.subject))) return false;
        if (predicate && !fact.predicate.includes(predicate)) return false;
        if (query.type && fact.type !== query.type) return false;
        if (query.fromChapter !== undefined && fact.chapter < query.fromChapter) return false;
        if (query.toChapter !== undefined && fact.chapter > query.toChapter) return false;
        // 关键词也查主体：写作时想查「渭城」相关设定，主体命中同样有用
        if (keyword && !(fact.value.includes(keyword) || fact.quote.includes(keyword) || fact.subject.includes(keyword))) return false;
        return true;
    });
    return hits.sort((a, b) => a.chapter - b.chapter).slice(0, limit);
}

/**
 * 取某主体在某章时的「有效状态」：章节不晚于该章、且有效区间覆盖该章的事实。
 *
 * 这是实体状态查询的核心——「写到第 30 章时，宁缺的修为/位置/持有物是什么」。
 *
 * @param kb - 知识库
 * @param subject - 主体
 * @param chapter - 章节号
 * @returns 有效事实（同谓词取最晚的一条）
 */
export function stateAt(kb: KnowledgeBase, subject: string, chapter: number): KnowledgeFact[] {
    const candidates = kb.facts.filter(fact => {
        if (fact.subject !== subject) return false;
        if (fact.chapter > chapter) return false;
        const validFrom = fact.validFrom ?? fact.chapter;
        if (validFrom > chapter) return false;
        if (fact.validTo !== null && fact.validTo !== undefined && fact.validTo <= chapter) return false;
        return true;
    });
    // 同谓词取最晚的一条（后来的状态覆盖早先的）
    const byPredicate = new Map<string, KnowledgeFact>();
    for (const fact of candidates.sort((a, b) => a.chapter - b.chapter)) {
        byPredicate.set(fact.predicate, fact);
    }
    return [...byPredicate.values()];
}

/**
 * 统计（用于视图与健康检查）。
 *
 * @param kb - 知识库
 * @returns 统计信息
 */
export function summarizeKnowledgeBase(kb: KnowledgeBase): {
    facts: number;
    subjects: number;
    chapters: { from: number; to: number };
    byType: Record<string, number>;
} {
    const byType: Record<string, number> = {};
    const subjects = new Set<string>();
    let from = Number.POSITIVE_INFINITY;
    let to = 0;
    for (const fact of kb.facts) {
        byType[fact.type] = (byType[fact.type] ?? 0) + 1;
        subjects.add(fact.subject);
        if (fact.chapter < from) from = fact.chapter;
        if (fact.chapter > to) to = fact.chapter;
    }
    return {
        facts: kb.facts.length,
        subjects: subjects.size,
        chapters: { from: Number.isFinite(from) ? from : 0, to },
        byType,
    };
}

/**
 * 反序列化（容忍旧格式/损坏：返回 null 由调用方决定是否重建）。
 *
 * @param text - JSON 文本
 * @returns 知识库或 null
 */
export function parseKnowledgeBase(text: string): KnowledgeBase | null {
    try {
        const parsed = JSON.parse(text) as Partial<KnowledgeBase>;
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Array.isArray(parsed.facts)) return null;
        return {
            version: 1,
            project: typeof parsed.project === 'string' ? parsed.project : '',
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
            facts: parsed.facts.filter((f): f is KnowledgeFact => Boolean(f && typeof f === 'object' && 'subject' in f)),
        };
    } catch {
        return null;
    }
}
