/**
 * context-session-service.ts — 迭代式上下文装配（索引 → 分批加载 → 覆盖检查）
 *
 * 与 `shared/context-session-model.ts` 配合：模型负责会话状态与预算，
 * 本服务负责「按 ID 从索引/文件取内容」并驱动补充循环。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type { ProjectIndexService } from './project-index-service';
import {
    addBatch,
    checkCoverage,
    contextKey,
    createContextSession,
    pendingRequests,
    type ContextItem,
    type ContextKind,
    type ContextSession,
    type CoverageReport,
    type CoverageRequirement,
} from '@/shared/context-session-model';

const log = createLogger('ContextSession');

/** 单条上下文最大字符数（超出截断但显式标注） */
const MAX_ITEM_CHARS = 6000;

/** 装配结果 */
export interface ContextAssemblyResult {
    /** 会话（含批次与预算） */
    session: ContextSession;
    /** 覆盖报告 */
    coverage: CoverageReport;
    /** 仍未加载的类别与 ID */
    pending: Array<{ kind: ContextKind; ids: string[] }>;
    /** 是否因预算无法继续 */
    budgetExhausted: boolean;
}

/**
 * 上下文装配服务。
 */
export class ContextSessionService {
    /**
     * @param app - Obsidian 应用
     * @param indexService - 项目索引服务
     */
    constructor(
        private readonly app: App,
        private readonly indexService: ProjectIndexService,
    ) {}

    /**
     * 创建会话（场景锚）。
     *
     * @param init - 场景、锚点、预算
     * @returns 会话
     */
    create(init: { sceneId?: string; anchorIds?: string[]; chapterSegment?: string; maxTokens?: number }): ContextSession {
        return createContextSession(init);
    }

    /**
     * 按类别与 ID 加载一批上下文。
     *
     * @param project - 项目路径
     * @param session - 会话
     * @param request - 类别与 ID
     * @param reason - 批次原因
     * @returns 新会话
     */
    async loadBatch(
        project: string,
        session: ContextSession,
        request: { kind: ContextKind; ids: string[] },
        reason: 'anchor' | 'coverage-gap' | 'model-request',
    ): Promise<ContextSession> {
        const items = await this.readItems(project, request.kind, request.ids);
        if (items.length === 0) return session;
        return addBatch(session, { reason, items });
    }

    /**
     * 迭代装配直到覆盖齐 / 无进展 / 预算耗尽。
     *
     * @param project - 项目路径
     * @param session - 会话
     * @param requirements - 覆盖要求
     * @param maxRounds - 最大补充轮数（默认 6）
     * @returns 装配结果
     */
    async assemble(
        project: string,
        session: ContextSession,
        requirements: readonly CoverageRequirement[],
        maxRounds = 6,
    ): Promise<ContextAssemblyResult> {
        let current = session;
        let coverage = checkCoverage(current, requirements);
        for (let round = 0; round < maxRounds && coverage.missing.length > 0; round++) {
            const pending = pendingRequests(coverage);
            const before = Object.keys(current.loaded).length;
            for (const request of pending) {
                current = await this.loadBatch(project, current, request, 'coverage-gap');
            }
            coverage = checkCoverage(current, requirements);
            if (Object.keys(current.loaded).length === before) break; // 无进展，避免死循环
        }
        const pending = pendingRequests(coverage);
        return {
            session: current,
            coverage,
            pending,
            budgetExhausted: current.unloaded.length > 0,
        };
    }

    /**
     * 按 ID 读取内容（索引取元信息 + 文件取正文）。
     *
     * @param project - 项目路径
     * @param kind - 类别
     * @param ids - ID 列表
     * @returns 上下文条目
     */
    async readItems(project: string, kind: ContextKind, ids: readonly string[]): Promise<ContextItem[]> {
        if (ids.length === 0) return [];
        const entries = await this.indexService.query(project, { ids: [...ids], limit: ids.length });
        const byId = new Map(entries.map(entry => [entry.id ?? '', entry]));
        const items: ContextItem[] = [];
        for (const id of ids) {
            const entry = byId.get(id);
            if (!entry) continue;
            const text = await this.readText(entry.path, entry.summary ?? '');
            items.push({
                kind,
                id,
                title: entry.name,
                text: `${entry.path}\n${text}`,
                tokens: Math.ceil(text.length / 2),
            });
        }
        return items;
    }

    /** 读文件正文（超长截断但显式标注） */
    private async readText(path: string, fallback: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return fallback;
        try {
            const content = await this.app.vault.read(file);
            if (content.length <= MAX_ITEM_CHARS) return content;
            return `${content.slice(0, MAX_ITEM_CHARS)}\n……（已截断：原文 ${content.length} 字符，需完整内容请单独读取）`;
        } catch (error) { // silent-ok: 单条读取失败回落到索引摘要，不阻断装配
            log.warn('上下文条目读取失败:', path, error);
            return fallback;
        }
    }
}
