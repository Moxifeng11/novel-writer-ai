/**
 * four-check-store.ts — 「本章四项校验」结果持久化
 *
 * 与 `质量面板/校验历史.json`（质量面板服务，按条追加、保留 200 条）分开存放：
 * 四项校验是「每章一份快照」，按章覆盖即可，不需要历史序列；结构不同硬塞进
 * 校验历史会让面板读取逻辑分叉。落点为
 * `<项目>/04-项目总控/质量面板/四项校验.json`：
 *
 * ```json
 * { "version": 1, "chapters": { "第3章": { ...FourCheckReport } } }
 * ```
 *
 * 写入方：engine/step-runner.ts 正文保存后（与 QualityGate 同一时点）。
 * 读取方：质量面板（ui/quality-loop-modal.ts）展示「四项校验」软视图。
 * 所有写入失败只 warn，不影响正文生成 —— 与「不阻断流程」的定位一致。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { isProjectDirectory } from '@/shared/project-catalog';
import type { FourCheckReport } from '@/shared/chapter-four-checks-model';

const log = createLogger('FourCheckStore');

/** 磁盘结构版本 */
const STORE_VERSION = 1;

/** 每章保留一份，章数上限（防止超长篇无限增长） */
const MAX_CHAPTERS = 500;

/** 磁盘结构 */
interface FourCheckStoreFile {
    version: number;
    chapters: Record<string, FourCheckReport>;
}

/**
 * 四项校验结果存储。
 */
export class FourCheckStore {
    /**
     * @param app - Obsidian 应用
     */
    constructor(private readonly app: App) {}

    /**
     * 写入（覆盖）一章的四项校验结果。
     *
     * @param project - 项目路径
     * @param report - 聚合报告（chapterName 作为 key）
     * @returns 写入后的章数
     */
    async record(project: string, report: FourCheckReport): Promise<number> {
        const normalized = String(project || '').trim();
        if (!normalized || !isProjectDirectory(this.app, normalized)) {
            throw new Error(`项目不存在或不是作品目录：${normalized || '(空)'}`);
        }
        const store = await this.load(normalized);
        store.chapters[report.chapterName] = report;
        const keys = Object.keys(store.chapters);
        if (keys.length > MAX_CHAPTERS) {
            // 保留最近写入的 MAX_CHAPTERS 章（按 checkedAt 淘汰最旧的）
            const kept = keys
                .sort((a, b) => (store.chapters[b]?.checkedAt || 0) - (store.chapters[a]?.checkedAt || 0))
                .slice(0, MAX_CHAPTERS);
            const next: Record<string, FourCheckReport> = {};
            for (const key of kept) next[key] = store.chapters[key];
            store.chapters = next;
        }
        await this.writeText(this.storePath(normalized), JSON.stringify(store, null, 2));
        return Object.keys(store.chapters).length;
    }

    /**
     * 读取全部章节的四项校验结果（按章名自然序）。
     *
     * @param project - 项目路径
     * @returns 章名 → 报告
     */
    async view(project: string): Promise<Record<string, FourCheckReport>> {
        const normalized = String(project || '').trim();
        if (!normalized || !isProjectDirectory(this.app, normalized)) return {};
        const store = await this.load(normalized);
        const sorted: Record<string, FourCheckReport> = {};
        for (const key of Object.keys(store.chapters).sort(compareChapterName)) {
            sorted[key] = store.chapters[key];
        }
        return sorted;
    }

    /** 读取磁盘结构（损坏/缺失时降级为空） */
    private async load(project: string): Promise<FourCheckStoreFile> {
        const empty: FourCheckStoreFile = { version: STORE_VERSION, chapters: {} };
        const path = this.storePath(project);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return empty;
        try {
            const parsed = JSON.parse(await this.app.vault.read(file)) as Partial<FourCheckStoreFile>;
            const chapters = parsed && typeof parsed.chapters === 'object' && parsed.chapters
                ? parsed.chapters
                : {};
            return { version: STORE_VERSION, chapters };
        } catch (error) { // silent-ok: 结果文件损坏时按空处理并记 warn，下次写入自愈
            log.warn('四项校验结果读取失败，按空处理：', error);
            return empty;
        }
    }

    /** 写文件（自动建目录） */
    private async writeText(path: string, content: string): Promise<void> {
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
            await this.app.vault.createFolder(dir).catch(() => undefined); // silent-ok: 已存在时忽略
        }
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) await this.app.vault.modify(existing, content);
        else await this.app.vault.create(path, content);
    }

    /** 结果文件路径 */
    private storePath(project: string): string {
        return `${project}/04-项目总控/质量面板/四项校验.json`;
    }
}

/**
 * 章名自然序：解析「第N章」数字，解析不到时按字符串比较。
 *
 * @param a - 章名 A
 * @param b - 章名 B
 * @returns 负数/0/正数（排序用）
 */
export function compareChapterName(a: string, b: string): number {
    const num = (name: string): number => {
        const m = name.match(/第([0-9一二三四五六七八九十百千]+)章/);
        if (!m) return Number.NaN;
        const raw = m[1];
        if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
        return chineseNumber(raw);
    };
    const na = num(a);
    const nb = num(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b, 'zh-Hans-CN');
}

/** 中文数字转阿拉伯数字（仅覆盖 1–9999，章号足够） */
function chineseNumber(raw: string): number {
    const digits: Record<string, number> = {
        零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    };
    const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
    let total = 0;
    let current = 0;
    for (const ch of raw) {
        if (ch in digits) {
            current = digits[ch];
        } else if (ch in units) {
            const unit = units[ch];
            total += (current === 0 ? 1 : current) * unit;
            current = 0;
        } else {
            return Number.NaN;
        }
    }
    return total + current;
}
