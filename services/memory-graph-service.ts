/**
 * memory-graph-service.ts — 设定实体图服务（卡派生自项目索引 + 关系边独立存储）
 *
 * 非破坏策略：Markdown 仍是卡片正文真源；本服务只维护
 * `<项目>/04-项目总控/设定图/关系.json`（边 + 更新时间），
 * 卡片从 ProjectIndexService 的索引派生（名称/类型/路径）。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjMemoryGraphFile } from '@/shared/paths';
import {
    buildCard,
    emptyGraph,
    MEMORY_GRAPH_VERSION,
    pruneEdges,
    type MemoryCard,
    type MemoryEdge,
    type MemoryEntityType,
    type MemoryGraph,
} from '@/domains/memory/model';
import type { ProjectIndexEntry } from '@/shared/project-index-model';
import type { ProjectIndexService } from './project-index-service';
import type { FileTxService } from './file-tx';

const log = createLogger('MemoryGraph');

/** 索引类别 → 实体类型（只映射设定类条目） */
const KIND_TO_TYPE: Partial<Record<ProjectIndexEntry['kind'], MemoryEntityType>> = {
    character: 'character',
    location: 'location',
    faction: 'faction',
    item: 'item',
    setting: 'setting',
};

/**
 * 设定实体图服务。
 */
export class MemoryGraphService {
    private readonly app: App;
    private readonly indexService: ProjectIndexService;
    private readonly fileTx: FileTxService;

    constructor(app: App, indexService: ProjectIndexService, fileTx: FileTxService) {
        this.app = app;
        this.indexService = indexService;
        this.fileTx = fileTx;
    }

    /**
     * 读取设定图与派生卡片。
     *
     * @param project - 项目路径
     * @returns 卡片 + 图（边已按现有卡片清理孤儿边）
     */
    async load(project: string): Promise<{ cards: MemoryCard[]; graph: MemoryGraph }> {
        const index = await this.indexService.ensure(project);
        const cards: MemoryCard[] = [];
        for (const entry of index.entries) {
            const type = KIND_TO_TYPE[entry.kind];
            if (!type) continue;
            cards.push(buildCard({ path: entry.path, name: entry.name }, type, await this.readSummary(entry.path)));
        }
        const saved = await this.readGraph(project);
        const { graph, removed } = pruneEdges(saved, cards);
        if (removed > 0) log.info(`清理了 ${removed} 条孤儿关系（卡片已不存在）`);
        return { cards, graph };
    }

    /**
     * 保存关系边（原子写入）。
     *
     * @param project - 项目路径
     * @param graph - 设定图
     * @returns 保存后的图
     */
    async save(project: string, graph: MemoryGraph): Promise<MemoryGraph> {
        const next: MemoryGraph = { ...graph, version: MEMORY_GRAPH_VERSION, updatedAt: Date.now() };
        await this.fileTx.run(project, [{
            path: pjMemoryGraphFile(project),
            content: JSON.stringify(next, null, 2) + '\n',
        }]);
        return next;
    }

    /**
     * 直接加边并保存（校验由调用方先用 validateEdge 做）。
     *
     * @param project - 项目路径
     * @param graph - 当前图
     * @param edge - 新边
     * @returns 保存后的图
     */
    async appendEdge(project: string, graph: MemoryGraph, edge: MemoryEdge): Promise<MemoryGraph> {
        return this.save(project, { ...graph, edges: [...graph.edges, edge] });
    }

    /** 读取已落盘的设定图；缺失或损坏返回空图 */
    private async readGraph(project: string): Promise<MemoryGraph> {
        const file = this.app.vault.getAbstractFileByPath(pjMemoryGraphFile(project));
        if (!(file instanceof TFile)) return emptyGraph();
        try {
            const parsed = JSON.parse(await this.app.vault.read(file)) as Partial<MemoryGraph>;
            if (parsed?.version !== MEMORY_GRAPH_VERSION || !Array.isArray(parsed.edges)) return emptyGraph();
            return {
                version: MEMORY_GRAPH_VERSION,
                updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
                edges: parsed.edges,
            };
        } catch (error) {
            // silent-ok: 关系文件损坏等价于「还没有关系」，重建即可，不阻断写作
            log.warn('设定图解析失败，按空图处理:', error);
            return emptyGraph();
        }
    }

    /** 读卡片摘要（frontmatter 的「简介/一句话」或首个非空行） */
    private async readSummary(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            const text = await this.app.vault.read(file);
            const match = text.match(/^简介[:：]\s*(.+)$/m) ?? text.match(/^一句话[:：]\s*(.+)$/m);
            if (match) return match[1].trim();
            const body = text.replace(/^---[\s\S]*?---/, '').split('\n')
                .map(line => line.trim())
                .find(line => line.length > 0 && !line.startsWith('#'));
            return (body ?? '').slice(0, 80);
        } catch (error) {
            // silent-ok: 摘要只用于检索展示，读取失败降级为空，不影响关系图
            log.warn('读取卡片摘要失败:', path, error);
            return '';
        }
    }
}
