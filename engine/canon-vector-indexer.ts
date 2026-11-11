/**
 * canon-vector-indexer.ts — 把同人考据来源写入 RAG 向量库（P2）
 *
 * 目标：考据检索到的原著资料不应只停留在「设定弹窗里看一眼」——
 * 它们要能被创作时的 RAG 检索召回，否则「同人设定补充」无法真正影响正文生成。
 *
 * 设计要点：
 * - **按项目聚合**：每个项目一个虚拟书 `canon:<projectPath>`，重复索引时整体替换
 *   （`replaceBookSamples`），避免同一批来源反复叠加导致索引膨胀。
 * - **只索引可作依据的来源**：`official` / `official-wiki` / `reference`；
 *   `derivative`（同人/改编/外传）与 `unknown` 一律跳过——与 FAN-2 的分级口径一致。
 * - **嵌入不可用时优雅降级**：返回 `{ indexed: 0, reason }` 由调用方提示，不抛错。
 *   考据本身（来源缓存 + prompt 注入）不依赖向量库，不能因为向量化失败而失效。
 */
import type { KnowledgeVectorStore, KnowledgeVectorSample } from './knowledge-vector-store';
import type { CanonSource } from '@/shared/canon-source';
import { isAuthoritativeSource, isReferenceSource } from '@/shared/canon-source';
import { createLogger } from '@/shared/logger';

const log = createLogger('CanonVectorIndexer');

/** canon 虚拟书的 bookId 前缀（检索侧据此识别） */
export const CANON_BOOK_PREFIX = 'canon:';

/** canon 样本使用的维度名（与拆解维度区分，便于遥测与展示） */
export const CANON_DIMENSION = 'canon';

/**
 * 项目对应的 canon 虚拟书 id。
 *
 * @param projectPath - 项目路径
 * @returns 形如 `canon:长篇小说/书A`
 *
 * @example
 * canonBookIdFor('长篇小说/书A') // => 'canon:长篇小说/书A'
 */
export function canonBookIdFor(projectPath: string): string {
    const normalized = String(projectPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return `${CANON_BOOK_PREFIX}${normalized || 'default'}`;
}

/**
 * 判断 bookId 是否为 canon 虚拟书。
 *
 * @param bookId - 书籍 id
 * @returns 布尔值
 */
export function isCanonBookId(bookId: string): boolean {
    return String(bookId || '').startsWith(CANON_BOOK_PREFIX);
}

/**
 * 从 canon bookId 反解项目路径。
 *
 * @param bookId - 书籍 id
 * @returns 项目路径；非 canon 书返回空串
 */
export function projectPathFromCanonBookId(bookId: string): string {
    return isCanonBookId(bookId) ? bookId.slice(CANON_BOOK_PREFIX.length) : '';
}

/** 索引结果 */
export interface CanonIndexOutcome {
    /** 实际写入的样本数 */
    indexed: number;
    /** 因分级不合格而跳过的来源数 */
    skipped: number;
    /** 未写入的原因（嵌入不可用等）；成功时为空 */
    reason?: string;
}

/**
 * 该来源是否允许作为设定依据写入向量库。
 *
 * @param source - 考据来源
 * @returns 布尔值
 */
export function isIndexableCanonSource(source: CanonSource): boolean {
    if (!source.excerpt.trim()) return false;
    return isAuthoritativeSource(source.tier) || isReferenceSource(source.tier);
}

/**
 * 把考据来源写入 RAG 向量库（按项目整体替换）。
 *
 * @param store - 知识向量库（不可用时返回原因）
 * @param projectPath - 项目路径
 * @param workName - 原作名（用于 bookName 展示与 citation）
 * @param sources - 考据来源
 * @returns 索引结果
 *
 * @example
 * const outcome = await indexCanonSources(store, '长篇小说/书A', '凡人修仙传', sources);
 * // outcome.indexed === 3
 */
export async function indexCanonSources(
    store: KnowledgeVectorStore | null | undefined,
    projectPath: string,
    workName: string,
    sources: CanonSource[],
): Promise<CanonIndexOutcome> {
    if (!store) return { indexed: 0, skipped: 0, reason: '知识向量库未初始化' };
    if (!projectPath.trim()) return { indexed: 0, skipped: 0, reason: '缺少项目路径' };

    const usable = sources.filter(isIndexableCanonSource);
    const skipped = sources.length - usable.length;
    if (usable.length === 0) {
        return { indexed: 0, skipped, reason: '没有可索引的来源（需官方或百科/wiki 二手资料）' };
    }

    const bookId = canonBookIdFor(projectPath);
    const bookName = `${workName || '原著'}（考据）`;
    const samples: Array<Omit<KnowledgeVectorSample, 'id' | 'bookId' | 'bookName' | 'vector'> & { vector?: number[] }> =
        usable.map((source, index) => ({
            dimension: CANON_DIMENSION,
            // position 用于邻块扩展与稳定排序；canon 每条来源独立成块，不做邻块拼接
            position: index,
            category: source.tier,
            // 摘录前带标题与等级：模型看到 citation 时能判断资料可信度
            sample: `《${source.title}》[${source.tier}]\n${source.excerpt.trim()}`,
        }));

    try {
        await store.replaceBookSamples(bookId, bookName, samples);
        return { indexed: samples.length, skipped };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn('[CanonVectorIndexer] 写入向量库失败:', message);
        return { indexed: 0, skipped, reason: `向量化失败：${message}` };
    }
}
