/**
 * fact-index-manager.ts — 事实索引 + 待确认队列
 * 对应 spec: story-quality-closed-loop-optimization Task 11。
 *
 * 核心访问控制约束（AC-7）：
 * AI 提取的事实（正文生成 / co-writer 接受）必须先经用户确认才写正式库；
 * 未确认事实绝不进入正式世界观 / 人物库——只有 confirm 才调用 writer.writeFact。
 *
 * 设计：
 * - 注入式 FactStoragePort（落盘，vault 无关可测）+ FactWriter（写正式库）
 * - 纯逻辑队列管理，零 AI、零 Obsidian 依赖
 */

import { createLogger } from '../shared/logger';

const log = createLogger('FactIndexManager');

/** 事实类别 */
export type FactCategory = 'character' | 'world' | 'plot';

/** 事实状态 */
export type FactStatus = 'pending' | 'confirmed' | 'ignored';

/** 待确认事实 */
export interface PendingFact {
    id: string;
    category: FactCategory;
    name: string;
    content: string;
    source: string;
    chapter?: number;
    sceneNum?: number;
    createdAt: number;
    status: FactStatus;
}

/** 已确认事实 */
export interface ConfirmedFact {
    id: string;
    category: FactCategory;
    name: string;
    content: string;
    source: string;
    confirmedAt: number;
}

/** 落盘数据结构 */
export interface PersistedFactIndex {
    version: number;
    pending: PendingFact[];
    confirmed: ConfirmedFact[];
    updatedAt: number;
}

/** 落盘端口（vault 无关，可注入 mock） */
export interface FactStoragePort {
    load(): Promise<PersistedFactIndex | null>;
    save(data: PersistedFactIndex): Promise<void>;
}

/** 写正式库端口（确认时调用；世界观 / 人物库写入由调用方实现） */
export interface FactWriter {
    writeFact(fact: PendingFact): Promise<void>;
}

export const FACT_INDEX_VERSION = 1;

export class FactIndexManager {
    private pending: PendingFact[] = [];
    private confirmed: ConfirmedFact[] = [];
    private loaded = false;

    constructor(
        private readonly storage: FactStoragePort,
        private readonly writer: FactWriter,
    ) {}

    /** 启动时从落盘恢复（幂等） */
    async load(): Promise<void> {
        if (this.loaded) return;
        try {
            const data = await this.storage.load();
            if (data) {
                this.pending = Array.isArray(data.pending) ? data.pending : [];
                this.confirmed = Array.isArray(data.confirmed) ? data.confirmed : [];
            }
        } catch (e) {
            log.warn('[FactIndexManager] 事实索引加载失败，使用空队列:', e);
        }
        this.loaded = true;
    }

    /**
     * 程序性提取正文中的新增实体事实（[[人名]] → character / 《地名》 → world / 【剧情节点】 → plot）
     *
     * @param body - 正文
     * @param source - 来源
     * @returns 结果数组
     */
    extractNewFacts(body: string, source: string = 'body-generation'): PendingFact[] {
        if (!body || body.trim() === '') return [];

        const facts: PendingFact[] = [];
        const seen = new Set<string>();
        const push = (category: FactCategory, name: string) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            const id = `${category}:${trimmed}`;
            if (seen.has(id)) return;
            seen.add(id);
            facts.push({
                id,
                category,
                name: trimmed,
                content: trimmed,
                source,
                createdAt: Date.now(),
                status: 'pending',
            });
        };

        for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) push('character', m[1]);
        for (const m of body.matchAll(/《([^》]+)》/g)) push('world', m[1]);
        for (const m of body.matchAll(/【([^】]+)】/g)) push('plot', m[1]);

        return facts;
    }

    /**
     * 入队待确认事实并落盘（不写正式库）
     *
     * @param facts - 事实
     */
    async enqueue(facts: PendingFact[]): Promise<void> {
        if (facts.length === 0) return;
        this.pending.push(...facts);
        await this.persist();
    }

    listPending(): PendingFact[] {
        return [...this.pending];
    }

    listConfirmed(): ConfirmedFact[] {
        return [...this.confirmed];
    }

    /**
     * 确认事实：写正式库 + 移入 confirmed + 落盘
     *
     * @param id - 标识
     * @returns 是否成功
     */
    async confirm(id: string): Promise<boolean> {
        const idx = this.pending.findIndex((f) => f.id === id);
        if (idx < 0) return false;

        const fact = this.pending[idx];
        // 写库失败抛异常，fact 留在 pending 可重试
        await this.writer.writeFact(fact);

        this.pending.splice(idx, 1);
        this.confirmed.push({
            id: fact.id,
            category: fact.category,
            name: fact.name,
            content: fact.content,
            source: fact.source,
            confirmedAt: Date.now(),
        });
        await this.persist();
        return true;
    }

    /**
     * 忽略事实：从队列移除并落盘（不写正式库）
     *
     * @param id - 标识
     * @returns 是否成功
     */
    async ignore(id: string): Promise<boolean> {
        const idx = this.pending.findIndex((f) => f.id === id);
        if (idx < 0) return false;

        this.pending.splice(idx, 1);
        await this.persist();
        return true;
    }

    private async persist(): Promise<void> {
        try {
            await this.storage.save({
                version: FACT_INDEX_VERSION,
                pending: this.pending,
                confirmed: this.confirmed,
                updatedAt: Date.now(),
            });
        } catch (e) {
            log.warn('[FactIndexManager] 事实索引落盘失败（内存态仍可用）:', e);
        }
    }
}
