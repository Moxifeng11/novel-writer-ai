/**
 * settlement-actions.ts — 协同写作结算入口与完稿标记
 *
 * 从 `ui/co-writing-view.ts` 抽出：待结算提醒、标记完稿、完成本章、结算前冲突检测。
 * 文件读写与弹窗通过宿主注入，错误提示文案保持原样。
 */
import { App, Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { ChapterSnapshotBuilder } from '@/engine/chapter-snapshot-builder';
import { ConflictDetector } from '@/engine/conflict-detector';
import { ObsidianFrontmatter } from '@/shared/file-system-port';
import { createLogger } from '@/shared/logger';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { emptyMetrics } from '@/ui/cowrite/cowrite-mappers';
import type { PlotCompletionMetrics } from '@/shared/types';

const log = createLogger('CoWritingView');

/** 结算动作宿主。 */
export interface SettlementActionsHost {
    /** Obsidian App */
    app: App;
    /** 插件实例 */
    plugin: NovelWriterPlugin;
    /** 项目路径 */
    project: string;
    /** 卷名 */
    volume: string;
    /** 章号 */
    chapterNum: number;
    /** 章节名 */
    chapterName: string;
    /** 正文编辑器 */
    rightEditor: HTMLTextAreaElement | null;
    /** 状态栏容器 */
    statusBar: HTMLElement | null;
    /** 当前章正文路径 */
    getBodyPath(): string;
    /** 保存正文 */
    saveBody(showNotice: boolean): Promise<boolean>;
    /** 渲染指标 */
    renderMetrics(metrics: PlotCompletionMetrics): void;
    /** 强制刷新指标（异步 AI 评估） */
    refreshMetrics(force: boolean): Promise<void>;
    /** 当前会话指标 */
    getSessionMetrics(): PlotCompletionMetrics | null;
    /** 完成本章（本模块入口） */
    handleComplete(): Promise<void>;
    /** 打开结算弹窗 */
    openSettlementModal(): void;
}

/**
 * 判断正文 frontmatter 是否应显示「待结算」。
 *
 * @param content - 正文全文
 * @returns 是否待结算
 * @example
 * ```ts
 * shouldShowSettlementBadge('---\nstatus: written\n---\n');
 * ```
 */
export function shouldShowSettlementBadge(content: string): boolean {
    const isSettled = content.includes('status: settled');
    const isWritten = content.includes('status: written') || content.includes('status: 已完稿');
    return isWritten && !isSettled;
}

/**
 * 检查章节是否需要结算，在状态栏显示提醒。
 *
 * @param host - 结算宿主
 * @example
 * ```ts
 * checkSettlementDue(host);
 * ```
 */
export function checkSettlementDue(host: SettlementActionsHost): void {
    if (!host.statusBar || !host.project || !host.chapterName) return;
    try {
        const bodyPath = host.getBodyPath();
        const file = host.app.vault.getAbstractFileByPath(bodyPath);
        if (!(file instanceof TFile)) return;
        // 异步读取 frontmatter，不阻塞UI
        host.app.vault.read(file).then(content => {
            if (shouldShowSettlementBadge(content) && host.statusBar) {
                const badge = host.statusBar.createSpan({ text: ' ⚠️ 待结算' });
                badge.setCssStyles({
                    color: 'var(--text-warning, #f59e0b)',
                    fontWeight: '600',
                    cursor: 'pointer',
                    marginLeft: '8px',
                });
                badge.addEventListener('click', () => {
                    void host.handleComplete();
                });
            }
        }).catch(() => {});
    } catch { /* 静默忽略 */ }
}

/**
 * 标记本章已写。
 *
 * @param host - 结算宿主
 * @example
 * ```ts
 * await markAsWritten(host);
 * ```
 */
export async function markAsWritten(host: SettlementActionsHost): Promise<void> {
    if (!host.project || !host.volume || !host.chapterNum) {
        new Notice('⚠️ 未绑定章节，请先在左侧选择卷/章', 3e3);
        return;
    }
    try {
        // 保存失败时旧实现照样把 status 改成 written 并提示成功，
        // 结算会基于磁盘上的旧正文执行，事实/伏笔被按错误内容更新
        const saved = await host.saveBody(false);
        if (!saved) {
            showErrorNotice('正文未能保存（可能为空或写入失败），未标记为完稿', { timeout: 4000 });
            return;
        }
        const bodyPath = host.getBodyPath();
        const file = host.app.vault.getAbstractFileByPath(bodyPath);
        if (file instanceof TFile) {
            await new ObsidianFrontmatter(host.app).processFrontmatter(file, (fm) => {
                if (fm["status"] !== "settled") {
                    fm["status"] = "written";
                }
            });
            showSuccessNotice('已标记为完稿', { timeout: 3000 });
            host.renderMetrics(host.getSessionMetrics() || emptyMetrics());
            checkSettlementDue(host);
        }
    } catch (e) {
        log.warn('[CoWritingView] 标记完稿失败:', e);
        showErrorNotice('标记完稿失败', { timeout: 4000 });
    }
}

/**
 * 完成本章（触发结算/后续流程）。
 *
 * @param host - 结算宿主
 * @example
 * ```ts
 * await completeChapter(host);
 * ```
 */
export async function completeChapter(host: SettlementActionsHost): Promise<void> {
    // 保存失败仍弹结算：结算读的是磁盘正文，会和编辑器里看到的不一致
    const saved = await host.saveBody(true);
    if (!saved) {
        showErrorNotice('正文未能保存，已取消结算', { timeout: 4000 });
        return;
    }
    await host.refreshMetrics(true);
    await runSettlementConflictCheck(host);
    host.openSettlementModal();
}

/**
 * 结算前冲突检测提示（失败不阻塞结算）。
 *
 * @param host - 结算宿主
 * @example
 * ```ts
 * await runSettlementConflictCheck(host);
 * ```
 */
export async function runSettlementConflictCheck(host: SettlementActionsHost): Promise<void> {
    try {
        const snapshot = new ChapterSnapshotBuilder().buildFromContext(
            host.chapterNum,
            await host.plugin.ctxManager.gatherAll(host.project, host.chapterName || `\u7B2C${host.chapterNum}\u7AE0`),
        );
        const body = host.rightEditor?.value || '';
        if (body.trim().length === 0) return;
        const conflicts = new ConflictDetector().detect(snapshot, body);
        if (conflicts.length > 0) {
            const preview = conflicts.slice(0, 3).map(c => c.message).join('\uFF1B');
            showWarningNotice(`\u7ED3\u7B97\u524D\u68C0\u6D4B\u5230 ${conflicts.length} \u9879\u4E00\u81F4\u6027\u51B2\u7A81\uFF1A${preview}`, { timeout: 8000 });
        }
    } catch (e) {
        log.warn('[CoWritingView] \u7ED3\u7B97\u524D\u51B2\u7A81\u68C0\u6D4B\u5931\u8D25:', e);
    }
}
