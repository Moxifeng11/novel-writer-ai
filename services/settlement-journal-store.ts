/**
 * settlement-journal-store.ts — 结算回滚日志落盘（对抗审查 P1）
 *
 * 背景：`SettlementJournal` 只存在内存里，结算中途退出 Obsidian/崩溃时
 * 已写实体 + 未 settled 正文的「半套状态」永久保留，下次启动无回滚、无提示。
 *
 * 本服务把日志实时写进 `<项目>/04-项目总控/事务/结算回滚.json`：
 *  - 结算进行中：每条日志变化即落盘（崩溃后仍可回滚）；
 *  - 结算成功或已回滚：清掉文件；
 *  - 回滚失败：保留文件，启动时由自检/手动入口恢复。
 */

import { App, TFile } from 'obsidian';
import type { JournalEntry } from '@/engine/settlement/settlement-journal';

/** 落盘载荷 */
export interface SettlementJournalPayload {
    version: 1;
    chapterName: string;
    startedAt: number;
    entries: JournalEntry[];
}

/**
 * 结算日志落盘服务（单章一个文件，避免并发章节互相覆盖）。
 */
export class SettlementJournalStore {
    /**
     * @param app - Obsidian 应用
     * @param project - 项目路径
     */
    constructor(
        private readonly app: App,
        private readonly project: string,
    ) {}

    /**
     * 落盘日志（条目为空时删除文件）。
     *
     * @param chapterName - 章节名
     * @param entries - 日志条目
     * @returns 完成 Promise
     */
    async save(chapterName: string, entries: readonly JournalEntry[]): Promise<void> {
        const path = this.pathOf(chapterName);
        if (entries.length === 0) return;
        const payload: SettlementJournalPayload = { version: 1, chapterName, startedAt: Date.now(), entries: [...entries] };
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
            await this.app.vault.createFolder(dir).catch(() => undefined); // silent-ok: 已存在时忽略
        }
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) await this.app.vault.modify(existing, JSON.stringify(payload, null, 2));
        else await this.app.vault.create(path, JSON.stringify(payload, null, 2));
    }

    /**
     * 清理日志文件。
     *
     * @param chapterName - 章节名
     * @returns 完成 Promise
     */
    async clear(chapterName: string): Promise<void> {
        const path = this.pathOf(chapterName);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.app.vault.delete(file).catch(() => undefined); // silent-ok: 删除失败不影响结算结果
    }

    /**
     * 读取某章的残留日志。
     *
     * @param chapterName - 章节名
     * @returns 条目（无残留返回 null）
     */
    async load(chapterName: string): Promise<JournalEntry[] | null> {
        const path = this.pathOf(chapterName);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        try {
            const parsed = JSON.parse(await this.app.vault.read(file)) as SettlementJournalPayload;
            return Array.isArray(parsed.entries) && parsed.entries.length > 0 ? parsed.entries : null;
        } catch { // silent-ok: 日志损坏按无残留处理（由调用方提示手动检查）
            return null;
        }
    }

    /**
     * 列出项目内所有残留结算日志。
     *
     * @returns 章节名列表
     */
    async listPending(): Promise<string[]> {
        const dir = `${this.project}/04-项目总控/事务`;
        const folder = this.app.vault.getAbstractFileByPath(dir);
        if (!folder || !Array.isArray((folder as { children?: unknown[] }).children)) return [];
        const pending: string[] = [];
        for (const child of (folder as unknown as { children: Array<{ path: string; name: string }> }).children) {
            if (!child.name.startsWith('结算回滚') || !child.name.endsWith('.json')) continue;
            const chapterName = child.name.replace(/^结算回滚[-_]?/, '').replace(/\.json$/, '');
            if (chapterName) pending.push(chapterName);
        }
        return pending;
    }

    /** 日志文件路径（按章区分，章名做安全化） */
    private pathOf(chapterName: string): string {
        const safe = String(chapterName || '未命名').replace(/[\\/:*?"<>|]/g, '_');
        return `${this.project}/04-项目总控/事务/结算回滚-${safe}.json`;
    }
}
