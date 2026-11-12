/**
 * kb-view-logic.ts — 知识库视图的数据整形（纯逻辑，阶段 D2）
 *
 * 从 `ui/views/knowledge-base-view.ts`（1200+ 行）抽出：链路状态输入、未分类计数、
 * 任务计数、标签删除。此前这些逻辑内联在视图里、零覆盖；改错一个条件就会让
 * 链路横幅误报或「未分类」数量漂移而无人察觉。
 *
 * 约定：不 import obsidian、不碰 DOM、不读全局状态。
 */

/** 书籍最小结构（知识库列表项） */
export interface KbBookLike {
    breakdownStatus?: string;
    vectorStatus?: string;
    genreChannel?: string;
    primaryGenre?: string;
}

/** 知识流链路输入（与 shared/link-status-compute 的 KnowledgeFlowInput 结构兼容） */
export interface KnowledgeFlowInputLike {
    bookTotal: number;
    breakdownCompleted: number;
    vectorDone: number;
    vectorFailed: number;
    embeddingReady: boolean;
    storeLoadedBooks: number;
    storeReady: boolean;
    /** 已加载书里不在知识库索引的数量（孤儿向量，DSH-20261112-17 环节级呈现） */
    orphanCount?: number;
    degradations?: string[];
}

/** 知识流输入的采集参数（来自运行时的向量库/嵌入状态） */
export interface KnowledgeFlowCollectOptions {
    embeddingReady: boolean;
    storeLoadedBooks: number;
    storeReady: boolean;
    /** 已加载书里不在知识库索引的数量（孤儿向量，来自索引↔向量库对账） */
    orphanCount?: number;
    degradations?: string[];
}

/**
 * 由书籍列表与运行时状态构造知识流链路输入。
 *
 * 拆解完成数按 `breakdownStatus === 'completed'`，向量就绪/失败按 `vectorStatus`；
 * 这两个状态字符串来自任务调度器的写入口径，抽成单点避免 UI 各写一套。
 *
 * @param books - 书籍列表
 * @param options - 嵌入/向量库运行时状态
 * @returns 链路输入
 */
export function buildKnowledgeFlowInput(
    books: readonly KbBookLike[],
    options: KnowledgeFlowCollectOptions,
): KnowledgeFlowInputLike {
    return {
        bookTotal: books.length,
        breakdownCompleted: books.filter(book => book.breakdownStatus === 'completed').length,
        vectorDone: books.filter(book => book.vectorStatus === 'done').length,
        vectorFailed: books.filter(book => book.vectorStatus === 'failed').length,
        embeddingReady: options.embeddingReady,
        storeLoadedBooks: options.storeLoadedBooks,
        storeReady: options.storeReady,
        orphanCount: options.orphanCount,
        degradations: options.degradations,
    };
}

/**
 * 统计指定频道下没有主题材的书籍数（「未分类」入口）。
 *
 * `channel === 'all'` 时不限频道。
 *
 * @param books - 书籍列表
 * @param channel - 频道筛选
 * @returns 未分类数量
 */
export function countUncategorizedBooks(
    books: readonly KbBookLike[],
    channel: string,
): number {
    return books.filter(book =>
        (channel === 'all' || book.genreChannel === channel) && !book.primaryGenre,
    ).length;
}

/**
 * 汇总拆解任务状态数量（一键取消的确认文案用）。
 *
 * @param tasks - 任务列表
 * @returns 运行中/等待中数量
 */
export function summarizeTaskCounts(
    tasks: ReadonlyArray<{ status: string }>,
): { running: number; pending: number } {
    let running = 0;
    let pending = 0;
    for (const task of tasks) {
        if (task.status === 'running') running += 1;
        else if (task.status === 'pending') pending += 1;
    }
    return { running, pending };
}

/**
 * 删除指定下标的标签（不改原数组；越界返回原样副本）。
 *
 * @param tags - 标签列表
 * @param index - 要删除的下标
 * @returns 新数组
 */
export function removeTagAt(tags: readonly string[], index: number): string[] {
    if (!Number.isInteger(index) || index < 0 || index >= tags.length) return [...tags];
    return tags.filter((_, i) => i !== index);
}
