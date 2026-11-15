/**
 * relation-graph-sync-service.ts — 关系四通道收口（C4）
 *
 * 现状：关系数值在 `01-世界架构/关系状态.md`（RelationshipEngine 维护），
 * 设定图 `设定图/关系.json` 又存一份边，frontmatter 链接与章节涉及数组各自再存。
 *
 * 本服务把「关系状态」定为权威，把设定图关系边改为**派生**：
 *  - 派生边统一以 `rel:` 前缀标记，重建时只替换这些边，手工边保留；
 *  - 名称 → 卡片 id 由注入的解析器完成（插件侧用项目索引 resolve）；
 *  - 写回走注入的 saveGraph（插件侧用 MemoryGraphService.save，自带历史快照）。
 */

import { App } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type { MemoryEdge, MemoryGraph } from '@/domains/memory/model';
import { MEMORY_EDGE_LABELS } from '@/domains/memory/model';

const log = createLogger('RelationGraphSync');

/** 派生边 id 前缀 */
export const DERIVED_EDGE_PREFIX = 'rel:';

/** 解析出的实体引用 */
export interface ResolvedEntity {
    /** 设定图卡片 id（如 `character:路径`） */
    id: string;
}

/** 关系对（最小形状，避免 services 依赖 engine） */
export interface RelationPairInput {
    charA: string;
    charB: string;
    status?: string;
}

/** 同步依赖 */
export interface RelationGraphSyncDeps {
    /** 读取关系状态文件原文（不存在返回空串） */
    readRelationFile(): Promise<string>;
    /** 解析关系状态原文（插件侧注入 engine 的解析器） */
    parseRelations(content: string): RelationPairInput[];
    /** 按名称解析实体（找不到返回 null） */
    resolve(name: string): Promise<ResolvedEntity | null>;
    /** 读取现有设定图 */
    loadGraph(): Promise<MemoryGraph>;
    /** 保存设定图 */
    saveGraph(graph: MemoryGraph): Promise<unknown>;
}

/** 同步结果 */
export interface RelationGraphSyncResult {
    /** 是否只预览 */
    dryRun: boolean;
    /** 派生边数量 */
    derived: number;
    /** 保留的手工边数量 */
    keptManual: number;
    /** 未能解析实体而跳过的关系数 */
    skipped: number;
    /** 本次移除的过期派生边数 */
    removed: number;
    /** 告警（解析失败等） */
    warnings: string[];
}

/**
 * 关系 → 设定图派生同步服务。
 */
export class RelationGraphSyncService {
    /**
     * @param app - Obsidian 应用
     * @param deps - 注入依赖
     */
    constructor(
        private readonly app: App,
        private readonly deps: RelationGraphSyncDeps,
    ) {}

    /**
     * 由关系状态派生设定图边。
     *
     * @param project - 项目路径
     * @returns 派生边与告警
     */
    async plan(project: string): Promise<{ edges: MemoryEdge[]; skipped: number; warnings: string[] }> {
        void project;
        const warnings: string[] = [];
        let content = '';
        try {
            content = await this.deps.readRelationFile();
        } catch (error) {
            warnings.push(`关系状态读取失败：${String(error)}`);
            return { edges: [], skipped: 0, warnings };
        }
        if (!content.trim()) return { edges: [], skipped: 0, warnings };
        const pairs = this.deps.parseRelations(content);
        const edges: MemoryEdge[] = [];
        let skipped = 0;
        for (const pair of pairs) {
            const [a, b] = await Promise.all([this.deps.resolve(pair.charA), this.deps.resolve(pair.charB)]);
            if (!a || !b || a.id === b.id) {
                skipped++;
                if (skipped <= 5) warnings.push(`未能解析关系实体：${pair.charA} ↔ ${pair.charB}`);
                continue;
            }
            edges.push({
                id: `${DERIVED_EDGE_PREFIX}${a.id}->${b.id}`,
                from: a.id,
                to: b.id,
                type: 'custom',
                label: pair.status || MEMORY_EDGE_LABELS.custom,
            });
        }
        return { edges, skipped, warnings };
    }

    /**
     * 同步派生边到设定图（保留手工边）。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 同步结果
     */
    async sync(project: string, dryRun = true): Promise<RelationGraphSyncResult> {
        const { edges, skipped, warnings } = await this.plan(project);
        const graph = await this.deps.loadGraph();
        const manual = graph.edges.filter(edge => !String(edge.id).startsWith(DERIVED_EDGE_PREFIX));
        const removed = graph.edges.length - manual.length;
        const next: MemoryGraph = {
            version: graph.version,
            updatedAt: Date.now(),
            edges: [...manual, ...edges],
        };
        if (!dryRun) {
            await this.deps.saveGraph(next);
            log.info(`关系图同步：派生 ${edges.length}，手工 ${manual.length}，移除派生 ${removed}`);
        }
        return { dryRun, derived: edges.length, keptManual: manual.length, skipped, removed, warnings };
    }
}
