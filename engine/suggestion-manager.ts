/**
 * suggestion-manager.ts — 建议管理器
 *
 * 管理分析建议的增删改查、状态流转、批量操作和统计。
 * 支持状态机：pending → adopted/rejected/modified，以及重置回 pending。
 */

import type {
    AnalysisSuggestion,
    SuggestionType,
    SuggestionStatus,
} from './types/analysis-suggestion';

export class SuggestionManager {
    private suggestions: Map<string, AnalysisSuggestion>;

    constructor(initialSuggestions?: AnalysisSuggestion[]) {
        this.suggestions = new Map();
        if (initialSuggestions && initialSuggestions.length > 0) {
            for (const suggestion of initialSuggestions) {
                this.suggestions.set(suggestion.id, suggestion);
            }
        }
    }

    // ============================================================
    // 查询方法
    // ============================================================

    /**
     * 获取待处理的建议列表
     * @param type 可选，按类型过滤
     */
    getPendingSuggestions(type?: SuggestionType): AnalysisSuggestion[] {
        return this.getAllSuggestions(type).filter(s => s.status === 'pending');
    }

    /**
     * 获取所有建议
     * @param type 可选，按类型过滤
     */
    getAllSuggestions(type?: SuggestionType): AnalysisSuggestion[] {
        const all = Array.from(this.suggestions.values());
        if (type) {
            return all.filter(s => s.type === type);
        }
        return all;
    }

    /**
     * 根据 ID 获取单个建议
     * @param id 建议 ID
     */
    getSuggestionById(id: string): AnalysisSuggestion | undefined {
        return this.suggestions.get(id);
    }

    /**
     * 按状态获取建议列表
     * @param status 建议状态
     */
    getSuggestionsByStatus(status: SuggestionStatus): AnalysisSuggestion[] {
        return Array.from(this.suggestions.values()).filter(s => s.status === status);
    }

    // ============================================================
    // 操作方法
    // ============================================================

    /**
     * 采纳建议
     * @param suggestionId 建议 ID
     * @param modifiedPayload 可选，修改后的 payload（如有则状态变为 modified）
     * @returns 是否成功
     */
    adopt(suggestionId: string, modifiedPayload?: Record<string, any>): boolean {
        const suggestion = this.suggestions.get(suggestionId);
        if (!suggestion) return false;

        const targetStatus: SuggestionStatus = modifiedPayload ? 'modified' : 'adopted';
        if (!this.canTransition(suggestion.status, targetStatus)) {
            return false;
        }

        const updated: AnalysisSuggestion = {
            ...suggestion,
            status: targetStatus,
            adoptedAt: Date.now(),
        };

        if (modifiedPayload) {
            updated.originalPayload = suggestion.payload;
            updated.payload = modifiedPayload;
        }

        this.suggestions.set(suggestionId, updated);
        return true;
    }

    /**
     * 拒绝建议
     * @param suggestionId 建议 ID
     * @returns 是否成功
     */
    reject(suggestionId: string): boolean {
        const suggestion = this.suggestions.get(suggestionId);
        if (!suggestion) return false;

        if (!this.canTransition(suggestion.status, 'rejected')) {
            return false;
        }

        this.suggestions.set(suggestionId, {
            ...suggestion,
            status: 'rejected',
        });
        return true;
    }

    /**
     * 添加一条新建议
     * @param suggestion 建议数据（不含 id、createdAt，status 可选）
     * @returns 新建议的 ID
     */
    addSuggestion(
        suggestion: Omit<AnalysisSuggestion, 'id' | 'createdAt' | 'status'> & { status?: SuggestionStatus }
    ): string {
        const id = this.generateId();
        const newSuggestion: AnalysisSuggestion = {
            ...suggestion,
            id,
            createdAt: Date.now(),
            status: suggestion.status ?? 'pending',
        };
        this.suggestions.set(id, newSuggestion);
        return id;
    }

    /**
     * 移除一条建议
     * @param suggestionId 建议 ID
     * @returns 是否成功
     */
    removeSuggestion(suggestionId: string): boolean {
        return this.suggestions.delete(suggestionId);
    }

    // ============================================================
    // 批量操作
    // ============================================================

    /**
     * 批量采纳符合条件的建议
     * @param filter 过滤条件：类型和/或最低置信度
     * @returns 成功采纳的数量
     */
    batchAdopt(filter: { type?: SuggestionType; minConfidence?: number }): number {
        const candidates = this.getPendingSuggestions(filter.type).filter(
            s => filter.minConfidence === undefined || s.confidence >= filter.minConfidence
        );

        let count = 0;
        for (const suggestion of candidates) {
            if (this.adopt(suggestion.id)) {
                count++;
            }
        }
        return count;
    }

    /**
     * 批量拒绝符合条件的建议
     * @param filter 过滤条件：类型和/或最高置信度
     * @returns 成功拒绝的数量
     */
    batchReject(filter: { type?: SuggestionType; maxConfidence?: number }): number {
        const candidates = this.getPendingSuggestions(filter.type).filter(
            s => filter.maxConfidence === undefined || s.confidence <= filter.maxConfidence
        );

        let count = 0;
        for (const suggestion of candidates) {
            if (this.reject(suggestion.id)) {
                count++;
            }
        }
        return count;
    }

    // ============================================================
    // 状态统计
    // ============================================================

    /**
     * 获取建议状态统计
     */
    getStats(): { total: number; pending: number; adopted: number; rejected: number; modified: number } {
        const stats = {
            total: this.suggestions.size,
            pending: 0,
            adopted: 0,
            rejected: 0,
            modified: 0,
        };

        for (const suggestion of this.suggestions.values()) {
            stats[suggestion.status]++;
        }

        return stats;
    }

    // ============================================================
    // 序列化
    // ============================================================

    /**
     * 序列化为 JSON 数组
     */
    toJSON(): AnalysisSuggestion[] {
        return Array.from(this.suggestions.values());
    }

    /**
     * 从 JSON 数据加载建议
     * @param data 建议数据数组
     */
    fromJSON(data: AnalysisSuggestion[]): void {
        this.suggestions.clear();
        if (data && Array.isArray(data)) {
            for (const suggestion of data) {
                if (suggestion.id) {
                    this.suggestions.set(suggestion.id, suggestion);
                }
            }
        }
    }

    // ============================================================
    // 工具方法
    // ============================================================

    /**
     * 生成唯一 ID（时间戳 + 随机数）
     */
    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * 检查状态转移是否合法
     *
     * 合法转移：
     * - pending → adopted
     * - pending → rejected
     * - pending → modified
     * - modified → adopted
     * - rejected → pending
     * - adopted → pending
     *
     * @param from 源状态
     * @param to 目标状态
     */
    private canTransition(from: SuggestionStatus, to: SuggestionStatus): boolean {
        const validTransitions: Record<SuggestionStatus, SuggestionStatus[]> = {
            pending: ['adopted', 'rejected', 'modified'],
            adopted: ['pending'],
            rejected: ['pending'],
            modified: ['adopted', 'pending'],
        };

        const allowed = validTransitions[from];
        return allowed ? allowed.includes(to) : false;
    }
}
