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
 * 扫描项目内所有承载 rag_sources 的文件（步骤结果 + 正文）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param options - 配置项
  * @returns RagUsageSummary 实例
 */
export function collectKnowledgeUsage(
    app: KnowledgeUsageAppLike,
    project: string,
    options: { recentLimit?: number } = {},
): RagUsageSummary {
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
        if (!frontmatter) continue;
        const sources: RagSource[] = normalizeRagSources(frontmatter['rag_sources']);
        records.push({ path: file.path, label: labelOfStepFile(file.name), sources });
    }
    return summarizeRagUsage(records, options);
}
