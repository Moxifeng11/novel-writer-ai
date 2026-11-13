/**
 * fact-maintenance.ts — 事实库自动维护（按章增量拆解）
 *
 * 目标：事实库不该靠手动跑脚本建立。结算（或手动重建）时对**本章**做一次拆解并入库，
 * 已拆过的章默认跳过，避免重复花钱。
 *
 * 设计约束：
 *  - **按章幂等**：store 中已有该章事实 → 默认跳过（`force` 才重拆）；
 *  - **读失败不写**：事实库损坏时拒绝写入（否则把用户数据覆盖成空）；
 *  - **失败不阻断**：解析失败/模型报错只返回状态，由调用方决定是否告警，
 *    绝不让结算流程因此失败；
 *  - 正文截断到 4000 字符（与拆解 prompt 的既有上限一致）。
 */

import type { FileSystemPort } from '@/shared/file-system-port';
import { pjFactStoreFile } from '@/shared/paths';
import { loadFactStore, mergeFactStore, saveFactStore } from './fact-store';
import { buildDecomposePrompt, parseDecomposeResponse } from './knowledge-decompose';
import type { LlmCaller } from './pairing-llm';

/** 维护结果状态 */
export type FactMaintenanceStatus = 'ok' | 'up-to-date' | 'skipped' | 'failed';

/** 维护结果 */
export interface FactMaintenanceResult {
    /** 状态 */
    status: FactMaintenanceStatus;
    /** 新增条数 */
    added: number;
    /** 更新条数 */
    updated: number;
    /** 说明（供日志/UI 展示） */
    reason?: string;
}

/** 维护依赖 */
export interface FactMaintenanceDeps {
    /** 文件端口 */
    fs: FileSystemPort;
    /** 模型调用器（缺失时跳过拆解） */
    caller?: LlmCaller;
    /** 当前时间（可注入，便于测试） */
    now?: () => Date;
}

/** 单章拆解的正文上限（与知识拆解 prompt 一致） */
export const DECOMPOSE_BODY_LIMIT = 4000;

/**
 * 对本章做增量拆解并入库。
 *
 * @param deps - 依赖
 * @param project - 项目路径
 * @param chapter - 章节信息
 * @param chapter.num - 章节号
 * @param chapter.body - 正文
 * @param options - 选项
 * @param options.force - 强制重拆（默认 false）
 * @returns 结果
 */
export async function maintainChapterFacts(
    deps: FactMaintenanceDeps,
    project: string,
    chapter: { num: number; body: string },
    options: { force?: boolean } = {},
): Promise<FactMaintenanceResult> {
    const num = Number(chapter?.num);
    if (!Number.isFinite(num) || num <= 0) {
        return { status: 'skipped', added: 0, updated: 0, reason: '章节号无效' };
    }
    const body = (chapter.body ?? '').trim();
    if (!body) {
        return { status: 'skipped', added: 0, updated: 0, reason: '本章正文为空' };
    }

    const path = pjFactStoreFile(project);
    const loaded = await loadFactStore(deps.fs, path);
    if (loaded.status === 'read-failed') {
        return { status: 'failed', added: 0, updated: 0, reason: `事实库不可读，拒绝写入（${loaded.error ?? '未知错误'}）` };
    }
    if (!options.force && loaded.store.facts.some(fact => fact.chapter === num)) {
        return { status: 'up-to-date', added: 0, updated: 0, reason: `第 ${num} 章已拆解过` };
    }
    if (!deps.caller) {
        return { status: 'skipped', added: 0, updated: 0, reason: '未提供模型调用器' };
    }

    let content = '';
    try {
        const response = await deps.caller({
            systemPrompt: '你是小说设定抽取器，只输出严格 JSON。',
            userPrompt: buildDecomposePrompt(num, body.slice(0, DECOMPOSE_BODY_LIMIT)),
        });
        if (response?.error) {
            return { status: 'failed', added: 0, updated: 0, reason: `模型调用失败：${response.error}` };
        }
        content = response?.content ?? '';
    } catch (error) {
        return {
            status: 'failed',
            added: 0,
            updated: 0,
            reason: `模型调用异常：${error instanceof Error ? error.message : String(error)}`,
        };
    }

    const parsed = parseDecomposeResponse(content, body);
    if (!parsed) {
        return { status: 'failed', added: 0, updated: 0, reason: '拆解结果无法解析（非严格 JSON）' };
    }
    if (parsed.entries.length === 0) {
        return {
            status: 'ok',
            added: 0,
            updated: 0,
            reason: parsed.rejected > 0 ? `全部 ${parsed.rejected} 条未通过校验` : '本章无可抽取事实',
        };
    }

    const merged = mergeFactStore(loaded.store, num, parsed.entries, deps.now ? deps.now() : new Date());
    const saved = await saveFactStore(deps.fs, path, loaded.store, { readFailed: false });
    if (!saved) {
        return { status: 'failed', added: 0, updated: 0, reason: '事实库写入失败' };
    }
    return {
        status: 'ok',
        added: merged.added,
        updated: merged.updated,
        reason: parsed.rejected > 0 ? `有 ${parsed.rejected} 条未通过校验被丢弃` : undefined,
    };
}

/**
 * 批量维护（重建/补历史用）。
 *
 * @param deps - 依赖
 * @param project - 项目路径
 * @param chapters - 章节列表
 * @param options - 选项（force / 最多处理章数）
 * @returns 汇总
 */
export async function maintainFactsBatch(
    deps: FactMaintenanceDeps,
    project: string,
    chapters: ReadonlyArray<{ num: number; body: string }>,
    options: { force?: boolean; limit?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ processed: number; ok: number; skipped: number; failed: number; added: number; updated: number }> {
    const limit = Math.max(1, options.limit ?? chapters.length);
    const targets = chapters.slice(0, limit);
    const summary = { processed: 0, ok: 0, skipped: 0, failed: 0, added: 0, updated: 0 };
    for (const chapter of targets) {
        const result = await maintainChapterFacts(deps, project, chapter, { force: options.force });
        summary.processed += 1;
        if (result.status === 'ok') summary.ok += 1;
        else if (result.status === 'failed') summary.failed += 1;
        else summary.skipped += 1;
        summary.added += result.added;
        summary.updated += result.updated;
        options.onProgress?.(summary.processed, targets.length);
    }
    return summary;
}
