/**
 * context-session-model.ts — 迭代式上下文装配会话（纯函数）
 *
 * 替代「一次性全量注入」：以场景为锚，分批精确加载事实，
 * 用覆盖检查驱动补充；预算不足时**显式报未加载清单**，绝不静默截断。
 */

/** 可加载的上下文类别 */
export type ContextKind =
    | 'entity'
    | 'relation'
    | 'foreshadow'
    | 'timeline'
    | 'setting'
    | 'worldview'
    | 'assertion'
    | 'scene'
    | 'chapter'
    | 'rag';

/** 单条上下文 */
export interface ContextItem {
    /** 类别 */
    kind: ContextKind;
    /** 稳定 ID（实体/关系/伏笔/事件/断言 ID；rag 用 chunk 标识） */
    id: string;
    /** 展示标题 */
    title: string;
    /** 正文/摘要 */
    text: string;
    /** 估算 token */
    tokens: number;
}

/** 加载批次（审计用） */
export interface ContextBatch {
    /** 批次 id */
    id: string;
    /** 触发原因 */
    reason: 'anchor' | 'coverage-gap' | 'model-request';
    /** 本批条目 */
    ids: string[];
    /** 本批 token */
    tokens: number;
    /** 时间 */
    at: number;
}

/** 覆盖要求（某类别需要哪些 ID） */
export interface CoverageRequirement {
    kind: ContextKind;
    ids: string[];
}

/** 覆盖报告 */
export interface CoverageReport {
    /** 必需条目总数 */
    required: number;
    /** 已加载数 */
    loaded: number;
    /** 缺失的 key（kind:id） */
    missing: string[];
}

/** 上下文会话 */
export interface ContextSession {
    /** 当前场景 ID（无场景时为空） */
    sceneId: string;
    /** 在场实体 ID（锚点） */
    anchorIds: string[];
    /** 本章章段（已注入的锚点文本） */
    chapterSegment: string;
    /** 已加载条目：key = `${kind}:${id}` */
    loaded: Record<string, ContextItem>;
    /** 批次记录 */
    batches: ContextBatch[];
    /** 预算 */
    budget: { usedTokens: number; maxTokens: number };
    /** 因预算未加载的 key */
    unloaded: string[];
}

/**
 * 单条 token 估算（中文≈1.5 字/token，保守取 2 字/token）。
 *
 * @param text - 文本
 * @returns 估算 token 数
 */
export function estimateTokens(text: string): number {
    return Math.ceil(String(text ?? '').length / 2);
}

/**
 * 创建会话。
 *
 * @param init - 场景与预算
 * @returns 会话
 */
export function createContextSession(init: {
    sceneId?: string;
    anchorIds?: string[];
    chapterSegment?: string;
    maxTokens?: number;
}): ContextSession {
    return {
        sceneId: String(init.sceneId ?? ''),
        anchorIds: [...(init.anchorIds ?? [])],
        chapterSegment: String(init.chapterSegment ?? ''),
        loaded: {},
        batches: [],
        budget: { usedTokens: 0, maxTokens: Math.max(500, Math.floor(init.maxTokens ?? 24_000)) },
        unloaded: [],
    };
}

/**
 * 条目标识。
 *
 * @param kind - 类别
 * @param id - ID
 * @returns key
 */
export function contextKey(kind: ContextKind, id: string): string {
    return `${kind}:${id}`;
}

/**
 * 是否已加载。
 *
 * @param session - 会话
 * @param kind - 类别
 * @param id - ID
 * @returns 已加载返回 true
 */
export function hasLoaded(session: ContextSession, kind: ContextKind, id: string): boolean {
    return Boolean(session.loaded[contextKey(kind, id)]);
}

/**
 * 加入一批上下文：去重、记账、超预算显式记录未加载。
 *
 * @param session - 会话
 * @param input - 批次内容
 * @param now - 时间
 * @returns 新会话（不修改入参）
 */
export function addBatch(
    session: ContextSession,
    input: { reason: ContextBatch['reason']; items: ContextItem[] },
    now: number = Date.now(),
): ContextSession {
    const loaded = { ...session.loaded };
    const unloaded = new Set(session.unloaded);
    let used = session.budget.usedTokens;
    const acceptedIds: string[] = [];
    let batchTokens = 0;

    for (const item of input.items) {
        const key = contextKey(item.kind, item.id);
        if (loaded[key]) continue;
        const tokens = Math.max(1, Math.floor(item.tokens || estimateTokens(item.text)));
        if (used + tokens > session.budget.maxTokens) {
            unloaded.add(key);
            continue;
        }
        loaded[key] = item;
        used += tokens;
        batchTokens += tokens;
        acceptedIds.push(item.id);
    }

    return {
        ...session,
        loaded,
        unloaded: [...unloaded],
        budget: { ...session.budget, usedTokens: used },
        batches: acceptedIds.length > 0
            ? [...session.batches, { id: `batch-${session.batches.length + 1}`, reason: input.reason, ids: acceptedIds, tokens: batchTokens, at: now }]
            : session.batches,
    };
}

/**
 * 覆盖检查：哪些必需条目还没加载。
 *
 * @param session - 会话
 * @param requirements - 覆盖要求
 * @returns 覆盖报告
 */
export function checkCoverage(session: ContextSession, requirements: readonly CoverageRequirement[]): CoverageReport {
    let required = 0;
    let loaded = 0;
    const missing: string[] = [];
    for (const requirement of requirements) {
        for (const id of requirement.ids) {
            required += 1;
            const key = contextKey(requirement.kind, id);
            if (session.loaded[key]) loaded += 1;
            else missing.push(key);
        }
    }
    return { required, loaded, missing };
}

/**
 * 由覆盖报告生成下一批请求（缺什么补什么）。
 *
 * @param report - 覆盖报告
 * @returns 按类别分组的缺失 ID
 */
export function pendingRequests(report: CoverageReport): Array<{ kind: ContextKind; ids: string[] }> {
    const grouped = new Map<ContextKind, string[]>();
    for (const key of report.missing) {
        const [kind, ...rest] = key.split(':');
        const id = rest.join(':');
        const list = grouped.get(kind as ContextKind) ?? [];
        list.push(id);
        grouped.set(kind as ContextKind, list);
    }
    return [...grouped.entries()].map(([kind, ids]) => ({ kind, ids }));
}

/** 模型侧 request_context 参数 */
export interface ContextRequest {
    kind: ContextKind;
    ids?: string[];
    filter?: Record<string, unknown>;
    reason: string;
}

/**
 * 校验并规范化 request_context 参数。
 *
 * @param raw - 原始参数
 * @returns 请求或错误
 */
export function parseContextRequest(raw: unknown): { request?: ContextRequest; error?: string } {
    if (!raw || typeof raw !== 'object') return { error: '参数必须是对象' };
    const input = raw as Record<string, unknown>;
    const kind = String(input.kind ?? '').trim() as ContextKind;
    const kinds: ContextKind[] = ['entity', 'relation', 'foreshadow', 'timeline', 'setting', 'worldview', 'assertion', 'scene', 'chapter', 'rag'];
    if (!kinds.includes(kind)) return { error: `kind 必须是：${kinds.join('/')}` };
    const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean) : [];
    const filter = input.filter && typeof input.filter === 'object' ? input.filter as Record<string, unknown> : undefined;
    if (ids.length === 0 && !filter) return { error: '必须提供 ids 或 filter' };
    return { request: { kind, ...(ids.length > 0 ? { ids } : {}), ...(filter ? { filter } : {}), reason: String(input.reason ?? '').trim() || '未说明原因' } };
}

/**
 * 会话摘要（审计/调试用）。
 *
 * @param session - 会话
 * @returns 文本
 */
export function renderSessionSummary(session: ContextSession): string {
    const lines = [
        `场景：${session.sceneId || '（无）'}，锚点 ${session.anchorIds.length} 个`,
        `已加载 ${Object.keys(session.loaded).length} 条，批次 ${session.batches.length} 次，token ${session.budget.usedTokens}/${session.budget.maxTokens}`,
    ];
    if (session.unloaded.length > 0) {
        lines.push(`⚠️ 预算不足未加载 ${session.unloaded.length} 条：${session.unloaded.slice(0, 10).join('、')}${session.unloaded.length > 10 ? ' 等' : ''}`);
    }
    return lines.join('\n');
}
