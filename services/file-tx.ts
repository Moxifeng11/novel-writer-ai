/**
 * file-tx.ts — 文件事务服务（暂存 → 写入 → 提交 → 清理；中断可回滚）
 *
 * 借鉴催更姬 infrastructure/persistence 的事务语义。用于「一次操作写多个文件」
 * 的场景（版本保存、批量重命名、索引重建等），避免写一半留下不一致状态。
 *
 * 日志位置：`<项目>/04-项目总控/事务/<txId>.json`。插件启动时调用 recover()
 * 把上次中断的 staged 事务回滚掉。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjTxDir } from '@/shared/paths';
import {
    createJournal,
    describeJournal,
    FILE_TX_VERSION,
    markCommitted,
    needsRollback,
    parseJournalFile,
    rollbackPlan,
    type FileTxJournal,
    type FileTxJournalFile,
    type FileTxOp,
} from '@/shared/file-tx-model';

const log = createLogger('FileTx');

/** 待写入的变更（before 由服务读取，调用方只需给目标内容） */
export interface FileTxWrite {
    path: string;
    content: string;
}

/**
 * 文件事务服务。
 */
export class FileTxService {
    private readonly app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 原子写入多个文件：失败时自动回滚已写入的部分。
     *
     * @param project - 项目路径（决定日志目录）
     * @param writes - 目标文件与内容
     * @returns 事务日志（已提交）
     */
    async run(project: string, writes: readonly FileTxWrite[]): Promise<FileTxJournal> {
        const ops: FileTxOp[] = [];
        for (const write of writes) {
            ops.push({ path: write.path, content: write.content, before: await this.readBefore(write.path) });
        }
        let journal = createJournal(ops);
        await this.writeJournal(project, journal);
        try {
            for (const op of journal.ops) {
                await this.writeFile(op.path, op.content);
            }
            journal = markCommitted(journal);
            await this.writeJournal(project, journal);
            await this.removeJournal(project, journal);
            return journal;
        } catch (error) {
            log.error('文件事务失败，开始回滚:', describeJournal(journal), error);
            await this.rollback(journal);
            await this.removeJournal(project, journal);
            throw error;
        }
    }

    /**
     * 启动恢复：把上次中断（staged）的事务回滚掉。
     *
     * @param project - 项目路径
     * @returns 回滚的事务数
     */
    async recover(project: string): Promise<number> {
        const folder = this.app.vault.getAbstractFileByPath(pjTxDir(project));
        if (!(folder instanceof TFolder)) return 0;
        let recovered = 0;
        for (const child of [...folder.children]) {
            if (!(child instanceof TFile)) continue;
            const journal = parseJournalFile(await this.app.vault.read(child));
            if (!journal) continue;
            if (needsRollback(journal)) {
                log.warn('回滚中断事务:', describeJournal(journal));
                await this.rollback(journal);
                recovered += 1;
            }
            await this.app.vault.delete(child);
        }
        return recovered;
    }

    /** 读取文件原内容（不存在返回 null） */
    private async readBefore(path: string): Promise<string | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        return this.app.vault.read(file);
    }

    /** 写单个文件（不存在则创建） */
    private async writeFile(path: string, content: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
            return;
        }
        await this.ensureParent(path);
        await this.app.vault.create(path, content);
    }

    /** 确保父目录存在 */
    private async ensureParent(path: string): Promise<void> {
        const parts = path.split('/');
        parts.pop();
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current);
            }
        }
    }

    /** 按日志回滚 */
    private async rollback(journal: FileTxJournal): Promise<void> {
        for (const step of rollbackPlan(journal)) {
            const file = this.app.vault.getAbstractFileByPath(step.path);
            if (step.content === null) {
                if (file instanceof TFile) await this.app.vault.delete(file);
                continue;
            }
            if (file instanceof TFile) {
                await this.app.vault.modify(file, step.content);
            } else {
                await this.ensureParent(step.path);
                await this.app.vault.create(step.path, step.content);
            }
        }
    }

    /** 写事务日志 */
    private async writeJournal(project: string, journal: FileTxJournal): Promise<void> {
        const path = `${pjTxDir(project)}/${journal.id}.json`;
        const payload: FileTxJournalFile = { version: FILE_TX_VERSION, journal };
        await this.writeFile(path, JSON.stringify(payload, null, 2) + '\n');
    }

    /** 删除事务日志（失败不阻断：下次 recover 会当 staged 回滚） */
    private async removeJournal(project: string, journal: FileTxJournal): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(`${pjTxDir(project)}/${journal.id}.json`);
        if (file instanceof TFile) await this.app.vault.delete(file);
    }
}
