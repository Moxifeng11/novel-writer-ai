/**
 * writeback-audit-service.ts — 回写审查记录（可观测、可回退）
 *
 * M12 第一阶段：只记录不改变写入行为。把「合法/待确认/冲突/被拒」落盘，
 * 供事后核对与切换「只写合法指令」时对比。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjControlDir } from '@/shared/paths';
import type { WritebackReviewResult } from './writeback-review-service';

const log = createLogger('WritebackAudit');

/** 审查记录条目 */
export interface WritebackAuditEntry {
    /** 时间戳 */
    at: number;
    /** 章节名 */
    chapter: string;
    /** 摘要 */
    summary: string;
    /** 审查明细（截断保护） */
    review: string;
    /** 各类计数 */
    counts: { accepted: number; unresolved: number; conflicts: number; rejected: number };
}

/** 记录文件最多保留条数 */
const MAX_ENTRIES = 200;

/**
 * 回写审查记录服务。
 */
export class WritebackAuditService {
    /**
     * @param app - Obsidian 应用
     */
    constructor(private readonly app: App) {}

    /**
     * 记录一次审查结果。
     *
     * @param project - 项目路径
     * @param chapter - 章节名
     * @param result - 审查结果
     * @returns 完成 Promise
     */
    async record(project: string, chapter: string, result: WritebackReviewResult): Promise<void> {
        const path = this.filePath(project);
        const entry: WritebackAuditEntry = {
            at: Date.now(),
            chapter,
            summary: result.summary,
            review: result.review.slice(0, 4000),
            counts: {
                accepted: result.validation.accepted.length,
                unresolved: result.validation.unresolved.length,
                conflicts: result.validation.conflicts.length,
                rejected: result.validation.rejected.length,
            },
        };
        try {
            const entries = await this.load(project);
            const next = [...entries, entry].slice(-MAX_ENTRIES);
            const payload = `${JSON.stringify(next, null, 2)}\n`;
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) await this.app.vault.modify(existing, payload);
            else await this.app.vault.create(path, payload);
        } catch (error) { // silent-ok: 审查记录是旁路观测数据，落盘失败不影响结算
            log.warn('回写审查记录写入失败:', error);
        }
    }

    /**
     * 读取审查记录。
     *
     * @param project - 项目路径
     * @returns 记录
     */
    async load(project: string): Promise<WritebackAuditEntry[]> {
        const target = this.app.vault.getAbstractFileByPath(this.filePath(project));
        if (!(target instanceof TFile)) return [];
        try {
            const parsed = JSON.parse(await this.app.vault.read(target));
            return Array.isArray(parsed) ? (parsed as WritebackAuditEntry[]) : [];
        } catch { // silent-ok: 记录损坏等价于无记录
            return [];
        }
    }

    /** 记录文件路径 */
    private filePath(project: string): string {
        return `${pjControlDir(project)}/一致性审核/回写审查.json`;
    }
}
