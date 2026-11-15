/**
 * memory-graph-service.ts — 设定实体图服务（卡派生自项目索引 + 关系边独立存储）
 *
 * 非破坏策略：Markdown 仍是卡片正文真源；本服务只维护
 * `<项目>/04-项目总控/设定图/关系.json`（边 + 更新时间），
 * 卡片从 ProjectIndexService 的索引派生（名称/类型/路径）。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjMemoryGraphFile, pjMemoryHistoryDir } from '@/shared/paths';
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
import {
    createHistorySnapshot,
    expiredSnapshotIds,
    parseHistorySnapshot,
    snapshotToGraph,
    type MemoryHistorySnapshot,
} from '@/domains/memory/history';
import { applyMemoryPatch, validateMemoryPatch } from '@/domains/memory/patch';

const log = createLogger('MemoryGraph');

/** 索引类别 → 实体类型（entry.type 缺失时的兜底） */
const KIND_TO_TYPE: Partial<Record<ProjectIndexEntry['kind'], MemoryEntityType>> = {
    character: 'character',
    location: 'location',
    faction: 'faction',
    item: 'item',
    setting: 'setting',
};

/** 要素类型 → 设定图卡片类型（只收设定类） */
const ENTITY_TO_CARD: Partial<Record<NonNullable<ProjectIndexEntry['type']>, MemoryEntityType>> = {
    character: 'character',
    location: 'location',
    faction: 'faction',
    item: 'item',
    setting: 'setting',
    worldview: 'setting',
};

/**
 * 解析条目应生成的卡片类型（frontmatter.type 优先，路径类别兜底）。
 *
 * @param entry - 索引条目
 * @returns 卡片类型；非设定类返回 null
 */
export function cardTypeOf(entry: ProjectIndexEntry): MemoryEntityType | null {
    if (entry.type) return ENTITY_TO_CARD[entry.type] ?? null;
    return KIND_TO_TYPE[entry.kind] ?? null;
}

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
            const type = cardTypeOf(entry);
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
     * @param reason - 变更原因（写入历史快照，便于追溯）
     * @returns 保存后的图
     */
    async save(project: string, graph: MemoryGraph, reason = '保存设定图'): Promise<MemoryGraph> {
        const next: MemoryGraph = { ...graph, version: MEMORY_GRAPH_VERSION, updatedAt: Date.now() };
        // 先留历史快照（当前磁盘上的旧状态），再写新状态
        const current = await this.readGraph(project);
        const snapshot = createHistorySnapshot(current, reason);
        await this.writeHistory(project, snapshot);
        await this.fileTx.run(project, [{
            path: pjMemoryGraphFile(project),
            content: JSON.stringify(next, null, 2) + '\n',
        }]);
        return next;
    }

    /**
     * 列出历史快照（按时间倒序）。
     *
     * @param project - 项目路径
     * @param limit - 最多返回条数（默认 20）
     * @returns 快照
     */
    async listHistory(project: string, limit = 20): Promise<MemoryHistorySnapshot[]> {
        const folder = this.app.vault.getAbstractFileByPath(pjMemoryHistoryDir(project));
        if (!folder || !('children' in folder)) return [];
        const snapshots: MemoryHistorySnapshot[] = [];
        for (const child of [...(folder as { children: Array<{ path: string }> }).children]) {
            const file = this.app.vault.getAbstractFileByPath(child.path);
            if (!file || !('stat' in file)) continue;
            try {
                const snapshot = parseHistorySnapshot(await this.app.vault.read(file as never));
                if (snapshot) snapshots.push(snapshot);
            } catch (error) {
                // silent-ok: 单个历史文件损坏跳过，不影响其它快照与当前设定图
                log.warn('历史快照读取失败:', child.path, error);
            }
        }
        return snapshots.sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, limit));
    }

    /**
     * 恢复某个历史快照为当前关系（恢复本身也留一条历史）。
     *
     * @param project - 项目路径
     * @param snapshotId - 快照 id
     * @returns 恢复后的图
     */
    async restoreHistory(project: string, snapshotId: string): Promise<MemoryGraph | null> {
        const snapshots = await this.listHistory(project, 200);
        const target = snapshots.find(snapshot => snapshot.id === snapshotId);
        if (!target) return null;
        return this.save(project, snapshotToGraph(target), `恢复到 ${new Date(target.createdAt).toLocaleString()} 的快照`);
    }

    /**
     * 局部替换设定卡内容（patch 语义：唯一匹配；newText 为空即删除该段）。
     *
     * @param cardPath - 卡片 vault 路径
     * @param patch - { oldText, newText }
     * @returns 结果
     */
    async patchCard(cardPath: string, patch: unknown): Promise<{ changed: boolean; error?: string }> {
        const invalid = validateMemoryPatch(patch);
        if (invalid) return { changed: false, error: invalid };
        const { oldText, newText } = patch as { oldText: string; newText: string };
        const file = this.app.vault.getAbstractFileByPath(cardPath);
        if (!file || !('stat' in file)) return { changed: false, error: '设定卡不存在' };
        const current = await this.app.vault.read(file as never);
        const result = applyMemoryPatch(current, oldText, newText);
        if (!result.changed) return { changed: false, error: result.error };
        await this.app.vault.modify(file as never, result.content);
        log.info('设定卡已局部替换:', cardPath);
        return { changed: true };
    }

    /** 写历史快照并清理超限旧快照 */
    private async writeHistory(project: string, snapshot: MemoryHistorySnapshot): Promise<void> {
        await this.fileTx.run(project, [{
            path: `${pjMemoryHistoryDir(project)}/${snapshot.id}.json`,
            content: JSON.stringify(snapshot, null, 2) + '\n',
        }]);
        const all = await this.listHistory(project, 500);
        const expired = expiredSnapshotIds(all);
        for (const id of expired) {
            const file = this.app.vault.getAbstractFileByPath(`${pjMemoryHistoryDir(project)}/${id}.json`);
            if (file && 'stat' in file) await this.app.vault.delete(file as never);
        }
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
