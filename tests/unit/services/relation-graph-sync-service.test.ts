/**
 * C4：关系 → 设定图派生同步
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { DERIVED_EDGE_PREFIX, RelationGraphSyncService } from '@/services/relation-graph-sync-service';
import type { MemoryGraph } from '@/domains/memory/model';

const PROJECT = '长篇小说/甲';
const REL_FILE = `${PROJECT}/01-世界架构/关系状态.md`;

const REL_CONTENT = ['# 关系状态', '', '## 林玄 ↔ 苏婉', '', '- trust: 60', '- attraction: 40', '- fear: 0', '- resentment: 5', '- dependence: 20', '- status: 互相试探', '- last_updated_chapter: 第1章', ''].join('\n');

const make = (seed: Record<string, string> = {}, manualEdges: MemoryGraph['edges'] = []) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const [path, content] of Object.entries(seed)) vault._seedFile(path, content);
    // adapter.read 供关系状态读取使用
    (vault as unknown as { adapter: { read(p: string): Promise<string> } }).adapter = {
        read: async (p: string) => (seed[p] as string) ?? '',
    } as never;
    let saved: MemoryGraph | null = null;
    const service = new RelationGraphSyncService(app, {
        readRelationFile: async () => seed[REL_FILE] ?? '',
        parseRelations: (content) => {
            const server = /## (.+?) ↔ (.+?)\n([\s\S]*?)(?=\n## |$)/g;
            const out: Array<{ charA: string; charB: string; status?: string }> = [];
            let m2: RegExpExecArray | null;
            while ((m2 = server.exec(content)) !== null) {
                out.push({ charA: m2[1].trim(), charB: m2[2].trim(), status: m2[3].match(/status:\s*(.+)/)?.[1]?.trim() });
            }
            return out;
        },
        resolve: async (name) => (name === '林玄' ? { id: 'character:人物/CHR-0001.md' } : name === '苏婉' ? { id: 'character:人物/CHR-0002.md' } : null),
        loadGraph: async () => ({ version: 1, updatedAt: 0, edges: manualEdges }),
        saveGraph: async (graph) => { saved = graph; return graph; },
    });
    return { service, getSaved: () => saved };
};

describe('RelationGraphSyncService', () => {
    it('关系状态派生成设定图边', async () => {
        const { service } = make({ [REL_FILE]: REL_CONTENT });
        const plan = await service.plan(PROJECT);
        expect(plan.edges).toHaveLength(1);
        expect(plan.edges[0].id.startsWith(DERIVED_EDGE_PREFIX)).toBe(true);
        expect(plan.edges[0].from).toContain('CHR-0001');
        expect(plan.edges[0].label).toBe('互相试探');
    });

    it('dry-run 不保存', async () => {
        const { service, getSaved } = make({ [REL_FILE]: REL_CONTENT });
        const result = await service.sync(PROJECT, true);
        expect(result.dryRun).toBe(true);
        expect(result.derived).toBe(1);
        expect(getSaved()).toBeNull();
    });

    it('同步时保留手工边、替换派生边', async () => {
        const manual = [{ id: 'manual-1', from: 'character:a', to: 'character:b', type: 'ally' as const, label: '盟友' }];
        const { service, getSaved } = make({ [REL_FILE]: REL_CONTENT }, manual);
        const result = await service.sync(PROJECT, false);
        expect(result.keptManual).toBe(1);
        expect(result.derived).toBe(1);
        const saved = getSaved();
        expect(saved?.edges).toHaveLength(2);
        expect(saved?.edges.filter(e => e.id === 'manual-1')).toHaveLength(1);
    });

    it('实体解析失败时跳过并告警', async () => {
        const content = REL_CONTENT.replace('苏婉', '路人甲');
        const { service } = make({ [REL_FILE]: content });
        const plan = await service.plan(PROJECT);
        expect(plan.edges).toHaveLength(0);
        expect(plan.skipped).toBe(1);
        expect(plan.warnings.length).toBeGreaterThan(0);
    });

    it('没有关系文件时安全返回', async () => {
        const { service } = make({});
        const result = await service.sync(PROJECT, false);
        expect(result.derived).toBe(0);
        expect(result.warnings).toEqual([]);
    });
});
