/**
 * writing-stats-service.ts — 每日/周/月字数产出台账
 *
 * 只做三件事：
 *   1. 扫描正文文件，取 `word_count`（缺失时按正文字符数兜底）
 *   2. 与上次快照比对，把「增长」记到文件 mtime 当天
 *   3. 把台账落到插件数据目录（不进 vault，避免污染用户笔记与同步）
 *
 * 刻意不做定时全量轮询：由 main.ts 在 vault 事件上调用 `handleFileChange`，
 * 打开统计/宠物时再触发一次增量 `scan()`，长篇几百章也只有 mtime 变化的文件会读盘。
 */

import {
    buildReport,
    createEmptyWritingStats,
    normalizeWritingStats,
    pruneMissingFiles,
    recordFileWords,
    type StatsReport,
    type WritingStatsData,
} from '@/shared/writing-stats';
import { createLogger } from '@/shared/logger';

const log = createLogger('WritingStats');

/**
 * 统计文件的最小结构。
 */
export interface StatsFileLike {
    path: string;
    stat?: { mtime: number };
}

/**
 * 统计所需 app 的最小结构。
 */
export interface WritingStatsAppLike {
    vault: {
        adapter: {
            exists(path: string): Promise<boolean>;
            read(path: string): Promise<string>;
            write(path: string, data: string): Promise<void>;
            mkdir(path: string): Promise<void>;
            /** 原子写与损坏留档用；旧版 Obsidian/测试替身可缺省 */
            rename?(oldPath: string, newPath: string): Promise<void>;
            remove?(path: string): Promise<void>;
        };
    };
    metadataCache: {
        getFileCache(file: StatsFileLike): { frontmatter?: Record<string, unknown> } | null;
    };
}

/**
 * 统计服务依赖。
 */
export interface WritingStatsServiceDeps {
    app: WritingStatsAppLike;
    /** 台账文件完整路径（插件目录下，如 .obsidian/plugins/novel-writer-ai/data/writing-stats.json） */
    ledgerPath: string;
    /** 判断是否正文文件（由调用方注入 shared/body-path 的判定，避免 services 反向依赖 ui） */
    isBodyPath: (path: string) => boolean;
    /**
     * 正文文件清单（G6-4，必填）：由 engine 层注入 `listChapterBodyFiles`，
     * 只走三个内容根目录。服务层刻意不持有「列全库」的能力，
     * 避免热路径再退回 vault.getFiles()。
     */
    listBodyFiles: () => StatsFileLike[];
    /** 台账变化回调（状态栏 / 宠物刷新用） */
    onUpdated?: (data: WritingStatsData) => void;
    now?: () => number;
}

/**
 * 正文字符数兜底：去掉 frontmatter 后统计非空白字符（与 word_count 口径接近）
 *
 * @param content - 内容
 * @returns 数值结果
 */
export function countBodyChars(content: string): number {
    const body = String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    return body.replace(/\s/g, '').length;
}

/**
 * 文件路径 → 项目路径（类别/项目名）；短篇/剧本同为两级
 *
 * @param filePath - 文件路径
 * @returns 文本结果
 */
export function projectOfFile(filePath: string): string {
    const parts = String(filePath || '').split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : (parts[0] || '');
}

/**
 * 写作统计服务。
 */
export class WritingStatsService {
    private deps: WritingStatsServiceDeps;
    private data: WritingStatsData = createEmptyWritingStats();
    private loaded = false;
    private scanning = false;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;
    /** 每次排程 +1：写盘期间又有新变更时，不能把 dirty 清掉（否则新数据永远不落盘） */
    private persistVersion = 0;
    private readonly now: () => number;

    constructor(deps: WritingStatsServiceDeps) {
        this.deps = deps;
        this.now = deps.now ?? (() => Date.now());
    }

    /** 读台账（失败按空台账继续，不阻塞插件启动） */
    async load(): Promise<void> {
        if (this.loaded) return;
        try {
            if (await this.deps.app.vault.adapter.exists(this.deps.ledgerPath)) {
                const raw = await this.deps.app.vault.adapter.read(this.deps.ledgerPath);
                this.data = normalizeWritingStats(JSON.parse(raw));
            }
        } catch (e) {
            log.warn('[WritingStats] 台账读取失败，按空台账继续:', e);
            // D3-11：损坏台账先留档再重置，否则下一次 persist 会把历史日产出永久覆盖
            await this.archiveCorruptLedger();
            this.data = createEmptyWritingStats();
        }
        this.loaded = true;
    }

    /**
     * 增量扫描：只对 mtime 变化的文件读内容（word_count 在 frontmatter 里，多数情况不读盘）。
     * 并发保护：同时在跑的第二次调用直接返回。
     */
    async scan(): Promise<void> {
        if (this.scanning) return;
        await this.load();
        this.scanning = true;
        try {
            const files = this.deps.listBodyFiles().filter(file => this.deps.isBodyPath(file.path));
            const existing = new Set<string>();
            const changed: StatsFileLike[] = [];
            for (const file of files) {
                existing.add(file.path);
                const snapshot = this.data.files[file.path];
                const mtime = file.stat?.mtime ?? 0;
                if (snapshot && mtime > 0 && snapshot.mtime === mtime) {
                    continue; // 未变化：跳过
                }
                changed.push(file);
            }
            // 首次扫描/批量改动可能涉及数百章：并发读正文（上限 6），
            // 避免逐文件串行 await 把打开统计页拖成数秒。
            const CONCURRENCY = 6;
            for (let i = 0; i < changed.length; i += CONCURRENCY) {
                const batch = changed.slice(i, i + CONCURRENCY);
                const counts = await Promise.all(batch.map(file => this.resolveCountForScan(file)));
                for (let j = 0; j < batch.length; j++) {
                    const count = counts[j];
                    if (count === null) continue;
                    const file = batch[j];
                    recordFileWords(this.data, file.path, projectOfFile(file.path), count, file.stat?.mtime ?? 0, this.now());
                }
            }
            pruneMissingFiles(this.data, existing);
            this.schedulePersist();
            this.emit();
        } catch (e) {
            log.warn('[WritingStats] 扫描失败:', e);
        } finally {
            this.scanning = false;
        }
    }

    /**
     * 单个文件变更（vault modify/create 事件）
     *
     * @param file - 文件
     */
    async handleFileChange(file: StatsFileLike): Promise<void> {
        if (!this.deps.isBodyPath(file.path)) return;
        await this.load();
        // 事件路径必须读正文本身：此刻 metadataCache 可能仍是上一版 frontmatter，
        // 用旧 word_count 记账后 mtime 被标记为已处理，scan() 会永久跳过这个错误值。
        const count = await this.resolveCountFromContent(file);
        if (count === null) return;
        const { delta } = recordFileWords(
            this.data,
            file.path,
            projectOfFile(file.path),
            count,
            file.stat?.mtime ?? 0,
            this.now(),
        );
        if (delta > 0) {
            this.schedulePersist();
            this.emit();
        }
    }

    /**
     * 文件删除：只清快照，历史日产出保持不变
     *
     * @param path - 路径
     */
    handleFileDelete(path: string): void {
        if (!this.data.files[path]) return;
        delete this.data.files[path];
        this.schedulePersist();
    }

    /**
     * 获取数据。
      * @returns WritingStatsData 实例
     */
    getData(): WritingStatsData {
        return this.data;
    }

    /**
     * 运行期替换更新回调（main 在拿到实例后订阅，刷新状态栏与宠物）
     *
     * @param listener - 监听器
     */
    setOnUpdated(listener: ((data: WritingStatsData) => void) | undefined): void {
        this.deps.onUpdated = listener;
    }

    /**
     * 项目改名/移动后迁移台账键（D3-11）。
     *
     * 旧实现改名后旧项目快照被 prune、新路径按首次出现整书重计，
     * 导致「统计虚高 + 归属错误」。这里把 projects 键合并、files 路径前缀改写。
     *
     * @param oldProject - 旧项目路径（两级，如 长篇小说/书A）
     * @param newProject - 新项目路径
     * @returns 是否发生了迁移
     */
    async migrateProjectPath(oldProject: string, newProject: string): Promise<boolean> {
        if (!oldProject || !newProject || oldProject === newProject) return false;
        await this.load();

        let changed = false;
        const oldDays = this.data.projects[oldProject];
        if (oldDays) {
            const merged: Record<string, number> = { ...(this.data.projects[newProject] ?? {}) };
            for (const [date, words] of Object.entries(oldDays)) {
                merged[date] = (merged[date] ?? 0) + words;
            }
            this.data.projects[newProject] = merged;
            delete this.data.projects[oldProject];
            changed = true;
        }

        for (const [path, snapshot] of Object.entries(this.data.files)) {
            const inProject = path.startsWith(`${oldProject}/`);
            if (!inProject && snapshot.project !== oldProject) continue;
            if (inProject) {
                const nextPath = `${newProject}/${path.slice(oldProject.length + 1)}`;
                this.data.files[nextPath] = { ...snapshot, project: newProject };
                delete this.data.files[path];
            } else {
                this.data.files[path] = { ...snapshot, project: newProject };
            }
            changed = true;
        }

        if (changed) {
            this.dirty = true;
            this.persistVersion++;
            await this.persistNow();
            this.emit();
        }
        return changed;
    }

    /**
     * 获取报告。
      * @returns StatsReport 实例
     */
    getReport(): StatsReport {
        return buildReport(this.data, this.now());
    }

    /**
     * 今日字数（状态栏/宠物最高频读取，短路到 days 表）
     *
     * @returns 数值结果
     */
    getTodayWords(): number {
        return this.getReport().global.today;
    }

    /**
     * 释放。
     */
    dispose(): void {
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        if (this.dirty) void this.persistNow();
    }

    /** 扫描用：正文优先，读不到时退回 frontmatter 的 word_count */
    private async resolveCountForScan(file: StatsFileLike): Promise<number | null> {
        try {
            const content = await this.readFile(file);
            if (content && content.trim()) return countBodyChars(content);
        } catch {
            // 正文读取失败，走 frontmatter 兜底
        }
        return this.resolveCount(file);
    }

    private async resolveCount(file: StatsFileLike): Promise<number | null> {
        const cache = this.deps.app.metadataCache.getFileCache(file);
        const raw = cache?.frontmatter?.['word_count'];
        if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return Math.round(raw);
        if (typeof raw === 'string' && raw.trim() !== '') {
            const parsed = Number(raw);
            if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
        }
        // frontmatter 里没有（旧章/手工文件）：读一次正文兜底
        try {
            const path = file.path;
            const content = await this.readFile(file);
            if (content === null) return null;
            return countBodyChars(content);
        } catch (e) {
            log.warn('[WritingStats] 读取正文失败:', e);
            return null;
        }
    }

    /** 只按正文内容计数（事件路径用，避免陈旧分词元数据） */
    private async resolveCountFromContent(file: StatsFileLike): Promise<number | null> {
        try {
            const content = await this.readFile(file);
            if (content === null) return null;
            return countBodyChars(content);
        } catch (e) {
            log.warn('[WritingStats] 读取正文失败:', e);
            return null;
        }
    }

    private async readFile(file: StatsFileLike): Promise<string | null> {
        const vault = this.deps.app.vault as unknown as {
            read?(file: StatsFileLike): Promise<string>;
            adapter: { read(path: string): Promise<string> };
        };
        if (typeof vault.read === 'function') {
            return vault.read(file);
        }
        return vault.adapter.read(file.path);
    }

    private schedulePersist(): void {
        this.dirty = true;
        this.persistVersion++;
        if (this.persistTimer) return;
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persistNow();
        }, 1500);
    }

    /**
     * 把损坏台账改名为 `.corrupt-<ts>.bak` 留档（D3-11）。
     */
    private async archiveCorruptLedger(): Promise<void> {
        const adapter = this.deps.app.vault.adapter;
        try {
            if (typeof adapter.rename !== 'function') return;
            if (!(await adapter.exists(this.deps.ledgerPath))) return;
            await adapter.rename(this.deps.ledgerPath, `${this.deps.ledgerPath}.corrupt-${Date.now()}.bak`);
        } catch {
            // 归档失败不阻断启动；至少不会静默删除原文件
        }
    }

    private async persistNow(): Promise<void> {
        const version = this.persistVersion;
        const adapter = this.deps.app.vault.adapter;
        try {
            const dir = this.deps.ledgerPath.slice(0, this.deps.ledgerPath.lastIndexOf('/'));
            if (dir && !(await adapter.exists(dir))) {
                await adapter.mkdir(dir);
            }
            const json = JSON.stringify(this.data);
            // 目标已存在时不能走 rename：Obsidian 的 adapter.rename 在**目标存在**时抛
            // `Destination file already exists!`，导致「第一次写成功、此后每次统计都丢」
            // （生产日志实测：RunningStats 台账连续报该错，只打 warn 就再也存不进去）。
            const targetExists = await adapter.exists(this.deps.ledgerPath);
            if (typeof adapter.rename === 'function' && !targetExists) {
                // D3-11：目标不存在时用 tmp + rename，崩溃/断电不会留下半写 JSON
                const tmpPath = `${this.deps.ledgerPath}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                try {
                    // write-entry-allow: 字数台账是 JSON，位于插件数据目录。
                    await adapter.write(tmpPath, json);
                    await adapter.rename(tmpPath, this.deps.ledgerPath);
                } catch (e) {
                    try { await adapter.remove?.(tmpPath); } catch { /* 临时文件不存在时忽略 */ }
                    throw e;
                }
            } else {
                // write-entry-allow: 字数台账是 JSON，位于插件数据目录。
                await adapter.write(this.deps.ledgerPath, json);
            }
            // 写成功后只清掉本次版本；写盘期间的新变更保持 dirty，等下一轮
            if (this.persistVersion === version) this.dirty = false;
        } catch (e) {
            // 写失败必须保留 dirty：否则本次统计永久丢失、且 dispose 也不会再重试
            this.dirty = true;
            log.warn('[WritingStats] 台账写入失败:', e);
        }
    }

    private emit(): void {
        try {
            this.deps.onUpdated?.(this.data);
        } catch (e) {
            log.warn('[WritingStats] onUpdated 回调失败:', e);
        }
    }
}
