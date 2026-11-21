/**
 * 向量增强器在拆解器侧的最小契约。
 *
 * 拆解器只需要「探测可用性 / 批量取向量 / 算余弦相似度 / 找相似对」四件事，
 * 不依赖宿主实现细节，便于在浏览器、Worker 与测试里替换。
 */
export interface VectorEnhancerPort {
    /**
     * 探测向量能力是否可用。
     * @returns 可用时为 true
     */
    isAvailable(): Promise<boolean>;

    /**
     * 批量取向量。
     * @param texts - 待编码文本
     * @returns 与输入等长的向量数组
     */
    embedTexts(texts: string[]): Promise<number[][]>;

    /**
     * 计算两个向量的余弦相似度。
     * @param a - 向量 A
     * @param b - 向量 B
     * @returns 相似度（-1 到 1）
     */
    cosineSimilarity(a: number[], b: number[]): number;

    /**
     * 找出两组条目中的相似对。
     * @param textsA - A 组条目
     * @param textsB - B 组条目
     * @param threshold - 相似度阈值
     * @param topPerA - 每个 A 条目最多保留的匹配数
     * @param textExtractorA - 从 A 条目取文本
     * @param textExtractorB - 从 B 条目取文本
     * @returns 相似对列表
     */
    findSimilarPairs<A = string, B = string>(
        textsA: A[],
        textsB: B[],
        threshold?: number,
        topPerA?: number,
        textExtractorA?: (item: A) => string,
        textExtractorB?: (item: B) => string
    ): Promise<Array<{ itemA: A; itemB: B; score: number }>>;
}
