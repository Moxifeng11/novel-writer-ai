/**
 * retrieval-plan.ts - retrieval planning and citation contracts.
 */
import type { CreationMode } from '../../shared/creation-mode';

export type RetrievalQueryType = 'structured' | 'semantic' | 'keyword' | 'external';

export interface RetrievalQuery {
    type: RetrievalQueryType;
    query: string;
    scope: string;
    topK: number;
    filters?: Record<string, string | number | boolean>;
}

export interface RetrievalPlan {
    id: string;
    projectId: string;
    mode: CreationMode;
    taskId: string;
    queries: RetrievalQuery[];
    maxFragments: number;
    minScore: number;
}

export interface RetrievalPlanInput {
    projectId: string;
    mode: CreationMode;
    taskId: string;
    queries: RetrievalQuery[];
    maxFragments?: number;
    minScore?: number;
}

export interface RagCitation {
    sourceId: string;
    title: string;
    uri?: string;
    snippet: string;
    score: number;
    kind: 'vault' | 'knowledge' | 'external';
    verified: boolean;
    retrievedAt: number;
}

export interface CitationInput {
    sourceId: string;
    title: string;
    snippet: string;
    score: number;
    kind: RagCitation['kind'];
    uri?: string;
    /** external 来源只有真实抓取时才应是 true；模型推断必须 false */
    verified?: boolean;
    retrievedAt?: number;
}

export function createRetrievalPlan(input: RetrievalPlanInput): RetrievalPlan {
    if (input.queries.length === 0) throw new Error('RetrievalPlan: 至少需要一个查询');
    for (const query of input.queries) {
        if (!query.query.trim()) throw new Error('RetrievalPlan: query 不能为空');
        if (query.topK <= 0 || !Number.isFinite(query.topK)) {
            throw new Error('RetrievalPlan: topK 必须为正数');
        }
    }
    let hash = 2166136261;
    const payload = input.queries.map(query => `${query.type}|${query.query}|${query.scope}|${query.topK}`).join(';');
    for (let i = 0; i < payload.length; i++) {
        hash ^= payload.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return {
        id: `rp_${hash.toString(16).padStart(8, '0')}`,
        projectId: input.projectId,
        mode: input.mode,
        taskId: input.taskId,
        queries: input.queries,
        maxFragments: Math.max(1, input.maxFragments ?? 12),
        minScore: Math.max(0, Math.min(1, input.minScore ?? 0.2)),
    };
}

export function createCitation(input: CitationInput): RagCitation {
    const external = input.kind === 'external';
    return {
        sourceId: input.sourceId,
        title: input.title || '无标题',
        uri: input.uri,
        snippet: String(input.snippet || '').slice(0, 600),
        score: Math.max(0, Math.min(1, input.score)),
        kind: input.kind,
        verified: input.verified === true,
        retrievedAt: input.retrievedAt ?? Date.now(),
    };
}

/** 模型推断/未核实来源不得作为事实依据。 */
export function isCitationUsable(citation: RagCitation): boolean {
    if (!citation.verified) return false;
    if (citation.kind === 'external' && !citation.uri) return false;
    return citation.score > 0;
}

export function formatCitations(citations: RagCitation[]): string {
    if (citations.length === 0) return '（未找到可靠证据）';
    return citations.map((citation, index) => {
        const label = `[R${index + 1}] ${citation.title}`;
        const status = citation.verified ? '已验证' : '未经实时核实';
        const uri = citation.uri ? ` · ${citation.uri}` : '';
        return `${label} · ${status}${uri}\n${citation.snippet}`;
    }).join('\n\n');
}