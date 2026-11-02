/**
 * prompt-cache.ts — prompt 响应内存 LRU 缓存
 * 对应 spec: p0-api-efficiency-optimization §3.2（P0-3，决策 D-2）。
 *
 * 极简实现：Map 迭代序 + delete-reinsert 实现热度刷新。
 * 无 TTL、无落盘（内存缓存，重启失效属预期；断点持久化归 story-quality Task 7）。
 */

import type { APIResponse } from './ai-engine';

/** 缓存条目（仅存成功响应；result.error 非空由写入方拦截，不入缓存） */
export interface PromptCacheEntry {
    hash: string;
    response: APIResponse;
    createdAt: number;
    model: string;
}

export class PromptCache {
    private entries = new Map<string, PromptCacheEntry>();

    constructor(private readonly maxEntries: number = 64) {}

    /**
     * 命中返回响应；未命中返回 null
     *
     * @param hash - 哈希值
      * @returns APIResponse 或 null
     */
    get(hash: string): APIResponse | null {
        const entry = this.entries.get(hash);
        if (!entry) return null;
        // 刷新热度：移到 Map 尾部（最近使用）
        this.entries.delete(hash);
        this.entries.set(hash, entry);
        return entry.response;
    }

    /**
     * 写入；超过 maxEntries 时淘汰最旧（Map 首个 key）
     *
     * @param hash - 哈希值
     * @param response - 响应
     * @param model - 模型标识
     */
    set(hash: string, response: APIResponse, model: string = ''): void {
        if (this.entries.has(hash)) this.entries.delete(hash);
        this.entries.set(hash, { hash, response, createdAt: Date.now(), model });
        if (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
    }

    clear(): void {
        this.entries.clear();
    }

    get size(): number {
        return this.entries.size;
    }
}

/** 模块级单例：api-client 与 EngineRegistry（registerLazy 返回此实例）共享同一实例 */
let sharedInstance: PromptCache | null = null;

export function getPromptCache(): PromptCache {
    if (!sharedInstance) sharedInstance = new PromptCache();
    return sharedInstance;
}
