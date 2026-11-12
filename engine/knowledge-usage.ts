/**
 * knowledge-usage.ts — 知识引用使用统计（G2-3b）
 *
 * 只读 metadataCache，不读正文：扫描项目下「步骤结果/**」与「正文/**」，
 * 取 frontmatter.rag_sources（由 G2-3a 写入），汇总命中率与常用书目。
 *
 * 不放进 services：services 不允许反向依赖 engine 的类型；
 * 这里只需要 App 的最小能力，UI 直接调用，按需扫描（打开统计页时一次）。
 */

import {
    normalizeRagSources,
    summarizeRagUsage,
    type RagSource,
    type RagUsageRecord,
    type RagUsageSummary,
} from '@/shared/rag-sources';
import { listFolderFiles, type VaultTreePort } from '@/shared/vault-tree';

/**
 * KnowledgeUsageAppLike 类型定义。
 */
export interface KnowledgeUsageAppLike {
    /** 只需要目录索引：按项目目录遍历，不调用 getFiles() 扫全库 */
    vault: VaultTreePort;
    /** 可选回退读取（metadataCache 未索引时用）：真实 App 的 vault.cachedRead */
    cachedRead?: (file: { path: string }) => Promise<string>;
    metadataCache: {
        getFileCache(file: { path: string }): { frontmatter?: Record<string, unknown> } | null;
    };
}

/**
 * 从文件名推断展示标签：第1章_大纲摘要.md → 大纲摘要；第1章_正文.md → 正文
 *
 * @param fileName - 文件名
 * @returns 文本结果
 */
export function labelOfStepFile(fileName: string): string {
    const match = fileName.match(/^第\d+章(?:_[^_/]+)?_([^_/]+)\.md$/);
    if (match) return match[1];
    return fileName.replace(/\.md$/, '');
}

/**
 * metadataCache 未命中时的 frontmatter 回退解析（DSH-20261113-25 ②）。
 *
 * 本仓 frontmatter 由 JSON.stringify 写入，JSON.parse 是可靠回退；
 * 解析失败返回 null（调用方按「无法判定」跳过，不计入分母）。
 *
 * @param app - 应用实例
 * @param file - 文件（须有 path）
 * @returns frontmatter 或 null
 *
 * @example
 * ```ts
 * const fm = await readFrontmatterFallback(app, { path: '项目/第1章_正文.md' });
 * const sources = fm?.['rag_sources'];
 * ```
 */
export async function readFrontmatterFallback(
    app: KnowledgeUsageAppLike,
    file: { path: string; name?: string },
): Promise<Record<string, unknown> | null> {
    if (typeof app.cachedRead !== 'function') return null;
    try {
        const raw = await app.cachedRead(file);
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!match) return {};
        return JSON.parse(match[1]) as Record<string, unknown>;
    } catch {
        // silent-ok: 回退解析失败即「无法判定」，调用方按缺失跳过、不写盘，不会用空值覆盖
        return null;
    }
}

/**
 * 扫描项目内所有承载 rag_sources 的文件（步骤结果 + 正文）。
 *
 * metadataCache 未索引时回退读取解析（DSH-20261113-25 ②）——否则刚写入的
 * 文件会被当成「无 frontmatter」丢弃，命中率出现假阴性。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param options - 配置项
 * @returns 用量汇总
 *
 * @example
 * ```ts
 * const summary = await collectKnowledgeUsage(app, '长篇小说/赤潮', { recentLimit: 5 });
 * console.log(summary.hitRate);
 * ```
 */
export async function collectKnowledgeUsage(
    app: KnowledgeUsageAppLike,
    project: string,
    options: { recentLimit?: number } = {},
): Promise<RagUsageSummary> {
    if (!project) return summarizeRagUsage([], options);
    // 只走本项目目录树（G6-4）：整库 getFiles() 在几百章项目上会随其它笔记线性变慢
    const files = listFolderFiles<{ path: string; name: string; stat?: { mtime: number } }>(
        app.vault,
        project,
        { recursive: true },
    )
        .filter(file => file.path.includes('/步骤结果/')
            || file.path.includes('/正文/')
            || file.path.includes('/03-正文/'))
        // 最近的排前面，recent 才有意义
        .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0))
        // 防御：统计页按需打开，不为极端项目卡死
        .slice(0, 800);

    const records: RagUsageRecord[] = [];
    for (const file of files) {
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!frontmatter) {
            // DSH-20261113-25 ②：getFileCache 为 null 是「文件尚未被索引」（刚写入/
            // 冷启动/索引重建），≠「无 frontmatter」——回退读取解析一次，避免
            // 命中率假阴性（刚结算完看统计显示 0%）。
            const fallback = await readFrontmatterFallback(app, file);
            if (!fallback) continue;
            const sources: RagSource[] = normalizeRagSources(fallback['rag_sources']);
            records.push({ path: file.path, label: labelOfStepFile(file.name), sources });
            continue;
        }
        const sources: RagSource[] = normalizeRagSources(frontmatter['rag_sources']);
        records.push({ path: file.path, label: labelOfStepFile(file.name), sources });
    }
    return summarizeRagUsage(records, options);
}
