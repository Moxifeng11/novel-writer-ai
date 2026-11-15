/**
 * assertion-batch-model.ts — 一致性断言分批加载（纯函数）
 *
 * 用户要求：一致性约束**不设条数上限**（限制条数会漏信息 → OOC）。
 * 因此只按 token 预算分批，并做覆盖核对；缺哪条补哪条，绝不截断丢弃。
 */

/** 断言条目（与一致性模块的断言结构解耦的最小形状） */
export interface BatchAssertion {
    /** 断言 ID */
    id: string;
    /** 涉及实体 ID（可多个） */
    entityIds: string[];
    /** 断言正文（一句话） */
    text: string;
    /** 严重度（high 优先注入） */
    severity?: 'high' | 'medium' | 'low';
    /** 来源章节号（可选） */
    chapter?: number;
}

/** 分批结果 */
export interface AssertionBatches {
    /** 批次（每批 token 不超预算） */
    batches: BatchAssertion[][];
    /** 断言总数 */
    total: number;
    /** 是否有断言因单条超预算被单独成批（不丢弃） */
    oversized: number;
}

/**
 * 按实体筛选断言（精确 ID，命中即全取，不设条数）。
 *
 * @param assertions - 全部断言
 * @param entityIds - 在场实体 ID
 * @returns 涉及任一在场实体的全部断言
 */
export function selectAssertionsForEntities(
    assertions: readonly BatchAssertion[],
    entityIds: readonly string[],
): BatchAssertion[] {
    const ids = new Set(entityIds);
    return assertions.filter(assertion => assertion.entityIds.some(id => ids.has(id)));
}

/**
 * 按 token 预算分批（不按条数截断）。
 *
 * @param assertions - 断言
 * @param options - 每批 token 预算（默认 2000）
 * @returns 分批结果
 */
export function batchAssertions(
    assertions: readonly BatchAssertion[],
    options: { maxTokensPerBatch?: number } = {},
): AssertionBatches {
    const maxTokens = Math.max(200, Math.floor(options.maxTokensPerBatch ?? 2000));
    const batches: BatchAssertion[][] = [];
    let current: BatchAssertion[] = [];
    let currentTokens = 0;
    let oversized = 0;

    for (const assertion of assertions) {
        const tokens = estimateAssertionTokens(assertion);
        if (tokens > maxTokens) {
            // 单条超预算：独占一批，绝不丢弃
            if (current.length > 0) {
                batches.push(current);
                current = [];
                currentTokens = 0;
            }
            batches.push([assertion]);
            oversized += 1;
            continue;
        }
        if (currentTokens + tokens > maxTokens && current.length > 0) {
            batches.push(current);
            current = [];
            currentTokens = 0;
        }
        current.push(assertion);
        currentTokens += tokens;
    }
    if (current.length > 0) batches.push(current);
    return { batches, total: assertions.length, oversized };
}

/**
 * 估算断言 token（中文≈1.5 字/token，保守取 2 字/token）。
 *
 * @param assertion - 断言
 * @returns 估算 token
 */
export function estimateAssertionTokens(assertion: BatchAssertion): number {
    return Math.max(8, Math.ceil((assertion.text.length + assertion.id.length + 20) / 2));
}

/**
 * 覆盖核对：必需断言是否全部加载。
 *
 * @param required - 必需断言 ID
 * @param loaded - 已加载断言 ID
 * @returns 缺失 ID
 */
export function verifyAssertionCoverage(
    required: readonly string[],
    loaded: readonly string[],
): string[] {
    const loadedSet = new Set(loaded);
    return required.filter(id => !loadedSet.has(id));
}

/**
 * 高风险优先排序（不删除任何条目，只调整注入顺序）。
 *
 * @param assertions - 断言
 * @returns 排序后的断言（high → medium → low → 无）
 */
export function sortBySeverity(assertions: readonly BatchAssertion[]): BatchAssertion[] {
    const rank = (severity?: BatchAssertion['severity']): number =>
        severity === 'high' ? 0 : severity === 'medium' ? 1 : severity === 'low' ? 2 : 3;
    return [...assertions].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/**
 * 渲染约束清单（ID + 一句话 + 来源，不截断）。
 *
 * @param assertions - 断言
 * @returns 文本
 */
export function renderAssertionConstraints(assertions: readonly BatchAssertion[]): string {
    if (assertions.length === 0) return '';
    return assertions
        .map(assertion => `- [${assertion.id}]${assertion.severity === 'high' ? '⚠️' : ''} ${assertion.text}${assertion.chapter ? `（第${assertion.chapter}章）` : ''}`)
        .join('\n');
}
