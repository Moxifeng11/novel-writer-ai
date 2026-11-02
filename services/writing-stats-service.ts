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
} from '../shared/writing-stats';
import { createLogger } from '../shared/logger';

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
            for (const file of files) {
                existing.add(file.path);
                const snapshot = this.data.files[file.path];
                const mtime = file.stat?.mtime ?? 0;
                if (snapshot && mtime > 0 && snapshot.mtime === mtime) {
                    continue; // 未变化：跳过
                }
                const count = await this.resolveCount(file);
                if (count === null) continue;
                recordFileWords(this.data, file.path, projectOfFile(file.path), count, mtime, this.now());
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
        if (this.persistTimer) return;
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persistNow();
        }, 1500);
    }

    private async persistNow(): Promise<void> {
        this.dirty = false;
        try {
            const dir = this.deps.ledgerPath.slice(0, this.deps.ledgerPath.lastIndexOf('/'));
            if (dir && !(await this.deps.app.vault.adapter.exists(dir))) {
                await this.deps.app.vault.adapter.mkdir(dir);
            }
            await this.deps.app.vault.adapter.write(this.deps.ledgerPath, JSON.stringify(this.data));
        } catch (e) {
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
