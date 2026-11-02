/**
 * cache/file-cache.ts — 文件级缓存（L2 缓存）
 *
 * 特性：
 * - 将昂贵计算结果序列化到 .cache 目录
 * - 基于源文件 mtime 的缓存失效
 * - 基于 TTL 的缓存失效
 * - 手动失效
 * - 文件损坏自动恢复
 * - 零外部依赖
 */

import type { FileSystemPort } from './file-system-port';
import { createLogger } from './logger';


const log = createLogger('FileCache');
// ============================================================
// 一、类型定义
// ============================================================

/**
 * 文件缓存条目。
 */
export interface FileCacheEntry<T> {
    /**
     * 仅内存持有；index.json 只落元数据（value 单独写在 key 文件里）。
     * 旧版本写入的 index 可能仍带 value，读取时忽略即可。
     */
    value?: T;
    createdAt: number;
    accessedAt: number;
    sourceMtime?: number;
    sourcePath?: string;
    size: number;
}

/**
 * 文件缓存选项。
 */
export interface FileCacheOptions {
    cacheDir?: string;
    ttlMs?: number;
    maxFiles?: number;
    slowWarnThresholdMs?: number;
}

const DEFAULT_OPTIONS: Required<FileCacheOptions> = {
    cacheDir: '.cache',
    ttlMs: 24 * 60 * 60 * 1000,
    maxFiles: 1000,
    slowWarnThresholdMs: 500,
};

interface HeapEntry {
    key: string;
    accessedAt: number;
}

// ============================================================
// 二、文件缓存实现
// ============================================================

/**
 * 文件缓存（按修改时间失效）。
 */
export class FileCache {
    private fs: FileSystemPort;
    private options: Required<FileCacheOptions>;
    private index: Map<string, FileCacheEntry<unknown>> = new Map();
    private indexLoaded = false;
    private writeQueue = new Map<string, Promise<void>>();
    private heap: HeapEntry[] = [];
    private heapPos: Map<string, number> = new Map();

    constructor(fs: FileSystemPort, options: FileCacheOptions = {}) {
        this.fs = fs;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    // ── 公共 API ──────────────────────────────────────────────

    async get<T>(key: string): Promise<T | null> {
        await this.ensureIndexLoaded();

        const entry = this.index.get(key);
        if (!entry) return null;

        if (this.isExpired(entry)) {
            await this.delete(key);
            return null;
        }

        try {
            const filePath = this.keyToPath(key);
            const content = await this.fs.read(filePath);
            const parsed = JSON.parse(content) as T;

            entry.accessedAt = Date.now();
            this.heapUpdateAccessedAt(key, entry.accessedAt);
            this.persistIndex();

            return parsed;
        } catch (e) {
            log.warn(`[FileCache] 缓存文件损坏，已删除: ${key}`, e instanceof Error ? e.message : String(e));
            await this.delete(key);
            return null;
        }
    }

    async set<T>(key: string, value: T, options?: { sourcePath?: string; sourceMtime?: number }): Promise<void> {
        await this.ensureIndexLoaded();

        const startTime = Date.now();
        const content = JSON.stringify(value);
        const size = content.length;

        const entry: FileCacheEntry<T> = {
            createdAt: Date.now(),
            accessedAt: Date.now(),
            sourcePath: options?.sourcePath,
            sourceMtime: options?.sourceMtime,
            size,
        };

        this.index.set(key, entry as FileCacheEntry<unknown>);
        this.heapInsert(key, entry.accessedAt);

        const writePromise = this.doWrite(key, content);
        this.writeQueue.set(key, writePromise);

        writePromise.finally(() => {
            this.writeQueue.delete(key);
            const duration = Date.now() - startTime;
            if (duration > this.options.slowWarnThresholdMs) {
                log.warn(`[FileCache] 慢写入警告: ${key} (${duration}ms)`);
            }
        });

        this.evictIfNeeded();
        this.persistIndex();
    }

    /**
     * 删除缓存项。
     *
     * @param key - 键
     * @returns 是否删除
     */
    async delete(key: string): Promise<boolean> {
        await this.ensureIndexLoaded();

        const existed = this.index.has(key);
        if (!existed) return false;

        this.index.delete(key);
        this.heapRemove(key);

        try {
            const filePath = this.keyToPath(key);
            await this.fs.delete(filePath);
        } catch {
        }

        this.persistIndex();
        return true;
    }

    /**
     * 是否存在。
     *
     * @param key - 键
     * @returns 布尔值
     */
    async has(key: string): Promise<boolean> {
        await this.ensureIndexLoaded();

        const entry = this.index.get(key);
        if (!entry) return false;

        if (this.isExpired(entry)) {
            await this.delete(key);
            return false;
        }

        return true;
    }

    /**
     * 清空缓存。
     */
    async clear(): Promise<void> {
        const keys = Array.from(this.index.keys());
        for (const key of keys) {
            try {
                const filePath = this.keyToPath(key);
                await this.fs.delete(filePath);
            } catch {
            }
        }
        this.index.clear();
        this.heap = [];
        this.heapPos.clear();
        this.persistIndex();
    }

    async deleteByPrefix(prefix: string): Promise<number> {
        await this.ensureIndexLoaded();

        let count = 0;
        const keysToDelete: string[] = [];

        for (const key of this.index.keys()) {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            await this.delete(key);
            count++;
        }

        return count;
    }

    invalidateBySourcePath(sourcePath: string): number {
        let count = 0;
        for (const [key, entry] of this.index) {
            if (entry.sourcePath === sourcePath) {
                this.index.delete(key);
                this.heapRemove(key);
                count++;
            }
        }
        if (count > 0) {
            this.persistIndex();
        }
        return count;
    }

    async pruneExpired(): Promise<number> {
        await this.ensureIndexLoaded();

        let count = 0;
        const keysToDelete: string[] = [];

        for (const [key, entry] of this.index) {
            if (this.isExpired(entry)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            await this.delete(key);
            count++;
        }

        return count;
    }

    get size(): number {
        return this.index.size;
    }

    get totalSizeBytes(): number {
        let total = 0;
        for (const entry of this.index.values()) {
            total += entry.size;
        }
        return total;
    }

    keys(): string[] {
        return Array.from(this.index.keys());
    }

    // ── 内部方法 ──────────────────────────────────────────────

    private async ensureIndexLoaded(): Promise<void> {
        if (this.indexLoaded) return;
        await this.loadIndex();
        this.indexLoaded = true;
    }

    private async loadIndex(): Promise<void> {
        try {
            const indexPath = `${this.options.cacheDir}/index.json`;
            const content = await this.fs.read(indexPath);
            const data = JSON.parse(content) as Array<[string, FileCacheEntry<unknown>]>;
            this.index = new Map(data);
            this.rebuildHeap();
        } catch {
            this.index = new Map();
            this.heap = [];
            this.heapPos.clear();
        }
    }

    private persistIndex(): void {
        // index 只存元数据：value 已单独写在 keyToPath 里。
        // 把 value 一起序列化会让每次 get()/set() 都重写整份缓存内容（写放大数百倍）。
        const data = Array.from(this.index.entries()).map(([k, e]) => [k, {
            createdAt: e.createdAt,
            accessedAt: e.accessedAt,
            sourcePath: e.sourcePath,
            sourceMtime: e.sourceMtime,
            size: e.size,
        }]);
        const indexPath = `${this.options.cacheDir}/index.json`;
        this.fs.mkdir(this.options.cacheDir).then(() => {
            return this.fs.write(indexPath, JSON.stringify(data));
        }).catch(() => {
        });
    }

    private async doWrite(key: string, content: string): Promise<void> {
        const filePath = this.keyToPath(key);
        await this.fs.mkdir(this.options.cacheDir);
        await this.fs.write(filePath, content);
    }

    private keyToPath(key: string): string {
        const safeKey = key.replace(/[^a-zA-Z0-9_\-:]/g, '_');
        return `${this.options.cacheDir}/${safeKey}.json`;
    }

    private isExpired(entry: FileCacheEntry<unknown>): boolean {
        const now = Date.now();
        if (this.options.ttlMs > 0 && now - entry.createdAt > this.options.ttlMs) {
            return true;
        }
        return false;
    }

    private evictIfNeeded(): void {
        if (this.index.size <= this.options.maxFiles) return;

        const toRemove = Math.ceil((this.index.size - this.options.maxFiles) * 1.1);
        for (let i = 0; i < toRemove && this.heap.length > 0; i++) {
            const oldest = this.heapExtractMin();
            if (oldest) {
                this.index.delete(oldest.key);
                this.fs.delete(this.keyToPath(oldest.key)).catch(() => {});
            }
        }
    }

    // ── 最小堆操作 ─────────────────────────────────────────────

    private rebuildHeap(): void {
        this.heap = [];
        this.heapPos.clear();
        for (const [key, entry] of this.index) {
            this.heap.push({ key, accessedAt: entry.accessedAt });
            this.heapPos.set(key, this.heap.length - 1);
        }
        for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
            this.siftDown(i);
        }
    }

    private heapInsert(key: string, accessedAt: number): void {
        this.heap.push({ key, accessedAt });
        const idx = this.heap.length - 1;
        this.heapPos.set(key, idx);
        this.siftUp(idx);
    }

    private heapExtractMin(): HeapEntry | null {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        this.heapPos.delete(min.key);
        const last = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.heapPos.set(last.key, 0);
            this.siftDown(0);
        }
        return min;
    }

    private heapRemove(key: string): void {
        const idx = this.heapPos.get(key);
        if (idx === undefined) return;
        this.heapPos.delete(key);
        if (idx === this.heap.length - 1) {
            this.heap.pop();
            return;
        }
        const last = this.heap.pop()!;
        this.heap[idx] = last;
        this.heapPos.set(last.key, idx);
        if (this.heap.length > 0) {
            this.siftDown(idx);
            this.siftUp(idx);
        }
    }

    private heapUpdateAccessedAt(key: string, newAccessedAt: number): void {
        const idx = this.heapPos.get(key);
        if (idx === undefined) return;
        const old = this.heap[idx].accessedAt;
        this.heap[idx].accessedAt = newAccessedAt;
        if (newAccessedAt > old) {
            this.siftDown(idx);
        } else if (newAccessedAt < old) {
            this.siftUp(idx);
        }
    }

    private siftUp(i: number): void {
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (this.heap[parent].accessedAt <= this.heap[i].accessedAt) break;
            this.swap(i, parent);
            i = parent;
        }
    }

    private siftDown(i: number): void {
        const n = this.heap.length;
        while (true) {
            let smallest = i;
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            if (left < n && this.heap[left].accessedAt < this.heap[smallest].accessedAt) {
                smallest = left;
            }
            if (right < n && this.heap[right].accessedAt < this.heap[smallest].accessedAt) {
                smallest = right;
            }
            if (smallest === i) break;
            this.swap(i, smallest);
            i = smallest;
        }
    }

    private swap(a: number, b: number): void {
        const tmp = this.heap[a];
        this.heap[a] = this.heap[b];
        this.heap[b] = tmp;
        this.heapPos.set(this.heap[a].key, a);
        this.heapPos.set(this.heap[b].key, b);
    }

    async flush(): Promise<void> {
        await Promise.all(this.writeQueue.values());
    }
}
