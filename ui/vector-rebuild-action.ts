/**
 * vector-rebuild-action.ts — 「重向量化全部」UI 动作
 *
 * 与 knowledge-rebuild-action（只重扫向量文件）不同：这里会真正调用 embedding
 * 按当前向量提供商重算已有样本，用于切换 embedding 模型后修复被模型治理跳过的旧向量。
 * 设置页与 mini 设置共用本入口，避免两份接线漂移。
 */

import { App, Notice } from 'obsidian';
import { OperationConfirmModal } from './components/progress';
import { createFingerprintEmbedding } from './fingerprint-embedding';
import { StyleFingerprintLibrary } from '../engine/style-fingerprint-library';
import {
    rebuildAllVectors,
    type VectorRebuildFingerprintTarget,
    type VectorRebuildReport,
    type VectorRebuildSectionReport,
} from '../services/vector-rebuild-service';
import { createLogger } from '../shared/logger';


const log = createLogger('VectorRebuildAction');

function formatSection(label: string, section: VectorRebuildSectionReport): string {
    const bits = [`${section.rebuilt}/${section.total}`];
    if (section.skipped.length > 0) bits.push(`跳过 ${section.skipped.length}`);
    if (section.failed.length > 0) bits.push(`失败 ${section.failed.length}`);
    return `${label} ${bits.join('，')}`;
}

function notifyReport(report: VectorRebuildReport, v2?: { rebuilt: string[]; failed: string[] }): void {
    const summary = `${formatSection('知识库', report.books)}；${formatSection('指纹', report.fingerprints)}`;
    // B5：V2 向量缺失时相关性排序会永久回退全量，重建报告必须显式列出 V2
    const v2Summary = v2
        ? `；V2 指纹 ${v2.rebuilt.length}/${v2.rebuilt.length + v2.failed.length}${v2.failed.length > 0 ? `（失败 ${v2.failed.length}）` : ''}`
        : '';
    const failed = [...report.books.failed, ...report.fingerprints.failed];
    if (failed.length === 0 && (v2?.failed.length ?? 0) === 0) {
        new Notice(`✅ 重向量化完成：${summary}${v2Summary}`, 8000);
        return;
    }
    log.warn('[VectorRebuild] 失败明细:', failed, v2?.failed);
    const preview = failed.slice(0, 3).map(f => `${f.name}（${f.reason}）`).join('；');
    const v2Preview = v2 && v2.failed.length > 0 ? `\nV2 失败：${v2.failed.slice(0, 3).join('、')}` : '';
    new Notice(`⚠️ 重向量化完成：${summary}${v2Summary}\n失败：${preview}${failed.length > 3 ? ' …' : ''}${v2Preview}`, 12000);
}

/** 重算知识库与指纹的全部向量：带确认弹窗与结果汇总 */
export async function rebuildAllVectorsWithConfirm(app: App, plugin: unknown): Promise<void> {
    const p = plugin as any;
    const manager = p?.knowledgeBaseManager;
    const scheduler = p?.deconstructionScheduler;
    if (!manager || typeof manager.listBooks !== 'function') {
        new Notice('⚠️ 知识库未初始化，无法重向量化');
        return;
    }
    if (!scheduler || typeof scheduler.revectorizeBook !== 'function') {
        new Notice('⚠️ 拆解调度器未初始化，无法重向量化知识库');
        return;
    }

    const confirmed = await OperationConfirmModal.confirm(app, {
        title: '重向量化全部',
        description: '按当前向量提供商重算知识库与指纹的向量。不会调用 AI、不会重新拆解、不会重新提取指纹；切换 embedding 模型后用它修复旧向量。书与指纹越多耗时越长。',
        confirmText: '开始重向量化',
        cancelText: '取消',
    });
    if (!confirmed) return;

    const settings = p.settings;
    const activeProject = typeof p.getActiveProject === 'function' ? p.getActiveProject() : null;
    const globalStore = createFingerprintEmbedding(app, 'global', settings).vectorStore;
    const projectStore = activeProject
        ? createFingerprintEmbedding(app, 'project', settings, activeProject).vectorStore
        : null;

    new Notice('⏳ 正在重向量化，请勿关闭 Obsidian…', 5000);
    try {
        const library = new StyleFingerprintLibrary(app, activeProject || undefined);
        const report = await rebuildAllVectors({
            listBooks: async () => {
                const books = await manager.listBooks();
                return books.map((book: { id: string; name: string }) => ({
                    bookId: book.id,
                    bookName: book.name,
                }));
            },
            revectorizeBook: (bookId, bookName) => scheduler.revectorizeBook(bookId, bookName),
            listFingerprints: async () => {
                const targets: VectorRebuildFingerprintTarget[] = [];
                const toTarget = (fp: any, scope: 'global' | 'project'): VectorRebuildFingerprintTarget => ({
                    id: fp.id,
                    name: fp.name,
                    samples: Array.isArray(fp.samples) ? fp.samples : [],
                    scope,
                });
                // 模板指纹的向量存在全局目录（与 createFingerprintEmbedding 的映射一致）
                for (const fp of await library.loadTemplate()) targets.push(toTarget(fp, 'global'));
                for (const fp of await library.loadGlobal()) targets.push(toTarget(fp, 'global'));
                if (activeProject) {
                    for (const fp of await library.loadProject()) targets.push(toTarget(fp, 'project'));
                }
                return targets;
            },
            revectorizeFingerprint: async (target) => {
                const store = target.scope === 'global' ? globalStore : projectStore;
                if (!store) throw new Error('未打开项目，无法写入项目指纹向量');
                // add 是追加语义：先删再写，避免同一样本被重复 embedding
                await store.delete(target.id);
                await store.add(target.id, target.samples);
            },
        }, progress => {
            log.info(`[VectorRebuild] ${progress.phase} ${progress.current}/${progress.total} ${progress.name}`);
        });

        // B5：LocalVectorStore 重建的是 V1 指纹向量；V2 12 维向量缺失时
        // 相关性排序会永久回退全量（上限 3 失效），必须一并重建。
        let v2Report: { rebuilt: string[]; failed: string[] } | undefined;
        try {
            v2Report = await library.rebuildAllV2StyleVectors((current, total, fingerprintId) => {
                log.info(`[VectorRebuild] V2 ${current}/${total} ${fingerprintId}`);
            });
        } catch (e) {
            log.warn('[VectorRebuild] V2 向量重建失败（不影响 V1 结果）:', e);
        }

        notifyReport(report, v2Report);
    } catch (e) {
        log.error('重向量化失败:', e);
        new Notice('❌ 重向量化失败，请查看开发者控制台');
    }
}
