/**
 * writeback-review-service.ts — 结算回写审查（适配 + 校验，不写盘）
 *
 * 把解析器输出 → 名称解析为 ID（索引）→ 结构化指令 → 字段/范围校验 → 审查报告。
 * 先以「只审查不改变写入」的方式接入结算，确认无回归后再让写入走校验结果。
 */

import type { ProjectIndexService } from './project-index-service';
import type { ParsedWritebackInput, ResolvedTarget } from '@/shared/writeback-adapter';
import { adaptWritebackInputs, describeAdapterResult } from '@/shared/writeback-adapter';
import { renderWritebackReview, validateWritebackCommands, type WritebackValidation } from '@/shared/writeback-command-model';
import { resolveEntity, type EntityType } from '@/shared/project-index-model';
import type { WritebackAdapterResult } from '@/shared/writeback-adapter';

/** 审查结果 */
export interface WritebackReviewResult {
    /** 适配结果 */
    adapter: WritebackAdapterResult;
    /** 校验结果 */
    validation: WritebackValidation;
    /** 审查文本（日志/待确认） */
    review: string;
    /** 摘要 */
    summary: string;
}

/**
 * 回写审查服务。
 */
export class WritebackReviewService {
    /**
     * @param indexService - 项目索引服务
     */
    constructor(private readonly indexService: ProjectIndexService) {}

    /**
     * 审查一批解析器输出（不写盘）。
     *
     * @param project - 项目路径
     * @param inputs - 解析器输出
     * @returns 审查结果
     */
    async review(project: string, inputs: readonly ParsedWritebackInput[]): Promise<WritebackReviewResult> {
        const index = await this.indexService.ensure(project);
        const resolve = (name: string, type?: EntityType): ResolvedTarget => {
            const result = resolveEntity(index, name);
            if (result.match?.id) {
                if (type && result.match.type && result.match.type !== type) {
                    return { id: null };
                }
                return { id: result.match.id };
            }
            if (result.candidates && result.candidates.length > 1) {
                return { id: null, candidates: result.candidates.map(candidate => candidate.id ?? candidate.path) };
            }
            return { id: null };
        };

        const adapter = adaptWritebackInputs(inputs, resolve);
        const knownIds = index.entries
            .filter(entry => typeof entry.id === 'string')
            .map(entry => entry.id as string);
        const validation = validateWritebackCommands(adapter.commands, knownIds);
        const reviewParts = [
            renderWritebackReview(validation),
            adapter.unresolved.length > 0
                ? `【名称未解析】${adapter.unresolved.map(item => `${item.input.name}（${item.reason}）`).join('；')}`
                : '',
        ].filter(Boolean);

        return {
            adapter,
            validation,
            review: reviewParts.join('\n'),
            summary: `${describeAdapterResult(adapter)}；合法 ${validation.accepted.length}，待确认 ${validation.unresolved.length}，冲突 ${validation.conflicts.length}，被拒 ${validation.rejected.length}`,
        };
    }
}
