/**
 * fact-nodes-injection.test.ts — 事实库接入生成 prompt（DSH-20261114-01）
 *
 * audit §四-1 断链修复的回归锁：事实此前只被一致性审核消费，写作 prompt 从未
 * 拿到「主体·谓词=值」硬事实。本文件锁三层：
 *   1. factNodesForInjection 纯函数：过滤（ignored/过期）、按来源章分组、空库安全
 *   2. buildStoryContext 双通道透传：context.data.fact_nodes 与显式 options.factNodes
 *      → 图节点与 bundle 文本都含事实；都不传时零回归
 *   3. ContextManager.gatherFactNodes 三态：missing 静默空数组 / ok 转换 / read-failed
 *      进 partialFailures（不静默）
 */

import { describe, expect, it } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    createFactStore,
    loadFactStore,
    mergeFactStore,
    serializeFactStore,
} from '../../../../engine/consistency/fact-store';
import { factNodesForInjection, type FactMetadata } from '../../../../engine/context/knowledge-fact-nodes';
import { buildStoryContext } from '../../../../engine/context/story-context-service';
import { ContextManager } from '../../../../engine/context-manager';
import { pjFactStoreFile } from '../../../../shared/paths';
import type { GatheredContext } from '../../../../engine/context/context-types';
import type { DecomposeEntry } from '../../../../engine/consistency/knowledge-decompose';

/** 造一条拆解事实（FactMetadata 形状，与事实库落盘一致） */
function fact(over: Partial<FactMetadata> = {}): FactMetadata {
    return {
        type: 'age',
        subject: '宁缺',
        predicate: '年龄',
        value: '十七',
        numeric: 17,
        unit: '岁',
        validFrom: 3,
        validTo: null,
        confidence: 0.9,
        quote: '宁缺今年十七岁',
        chapter: 3,
        ...over,
    };
}

/** 造事实库条目对应的 DecomposeEntry（toContextNodes 入参形状，用于对照） */
function entryOf(f: FactMetadata): DecomposeEntry {
    return {
        type: f.type,
        subject: f.subject,
        predicate: f.predicate,
        value: f.value,
        numeric: f.numeric,
        unit: f.unit,
        validFrom: f.validFrom,
        validTo: f.validTo,
        confidence: f.confidence,
        quote: f.quote,
    };
}

/** 最小 GatheredContext（buildStoryContext 只读 project/data，其余容错） */
function gathered(data: Record<string, unknown>): GatheredContext {
    return {
        project: '长篇小说/测试书',
        gatheredAt: new Date().toISOString(),
        data: data as GatheredContext['data'],
        issues: [],
    };
}

describe('factNodesForInjection · 过滤与分组', () => {
    it('正常转换：节点 id 用事实自身章节，文本含三元组与引文', () => {
        const nodes = factNodesForInjection([fact()], 5);
        expect(nodes).toHaveLength(1);
        expect(nodes[0].id).toBe('fact:3:宁缺:年龄');
        expect(nodes[0].text).toContain('宁缺·年龄=十七');
        expect(nodes[0].text).toContain('第3章起');
        expect(nodes[0].text).toContain('宁缺今年十七岁');
        expect(nodes[0].metadata?.fact).toBeTruthy();
    });

    it('ignored 事实不进生成', () => {
        const nodes = factNodesForInjection([fact({ ignored: true })], 5);
        expect(nodes).toHaveLength(0);
    });

    it('过期事实（validTo < 当前章）不进生成；validTo=null 与未过期保留', () => {
        const nodes = factNodesForInjection([
            fact({ subject: '过期者', validTo: 2 }),   // 2 < 5 → 过滤
            fact({ subject: '长期者', validTo: null }), // 永久 → 保留
            fact({ subject: '在期者', validTo: 9, chapter: 4, validFrom: 4 }), // 9 >= 5 → 保留
        ], 5);
        expect(nodes.map(n => n.id)).toEqual(['fact:3:长期者:年龄', 'fact:4:在期者:年龄']);
    });

    it('chapterNum=0（全局 gather）不做过期判定', () => {
        const nodes = factNodesForInjection([fact({ validTo: 2 })], 0);
        expect(nodes).toHaveLength(1);
    });

    it('按来源章分组：两章事实各自成节点、id 互不串', () => {
        const nodes = factNodesForInjection([
            fact({ chapter: 3, subject: '宁缺', predicate: '境界', value: '不惑' }),
            fact({ chapter: 7, subject: '宁缺', predicate: '境界', value: '知命' }),
        ], 10);
        expect(nodes.map(n => n.id).sort()).toEqual(['fact:3:宁缺:境界', 'fact:7:宁缺:境界'].sort());
        // 知命（第 7 章起）文本里不能混入第 3 章的范围标注
        const newer = nodes.find(n => n.id === 'fact:7:宁缺:境界');
        expect(newer?.text).toContain('第7章起');
    });

    it('空事实库 → 空数组（零注入零报错）', () => {
        expect(factNodesForInjection([], 3)).toEqual([]);
    });
});

describe('buildStoryContext · fact_nodes 双通道透传', () => {
    const facts = [fact()];

    it('context.data.fact_nodes 通道：图与 bundle 文本都含事实（gather 自动携带的路径）', () => {
        const result = buildStoryContext({
            context: gathered({ fact_nodes: factNodesForInjection(facts, 3) }),
            chapterName: '第3章',
            chapterNum: 3,
            mode: 'one-click',
            tier: 'cloud',
        });
        expect([...result.graph.nodes.keys()].some(id => id.startsWith('fact:'))).toBe(true);
        expect(result.bundle.formattedFull).toContain('宁缺·年龄=十七');
        // 关键锁：一键 prompt 的 storyContextPack = formattedCrossLink——
        // character 类事实不在既有四段（场景/伏笔/时间线/情绪）里，必须在
        // 「硬事实→关联实体」段出现，否则接线在最后一公里再断一次（audit 教训）。
        expect(result.bundle.formattedCrossLink).toContain('宁缺·年龄=十七');
        expect(result.bundle.formattedCrossLink).toContain('■ 硬事实→关联实体');
    });

    it('options.factNodes 显式通道：优先于 data，效果等价', () => {
        const nodes = factNodesForInjection(facts, 3);
        const viaOption = buildStoryContext({
            context: gathered({}),
            chapterName: '第3章',
            chapterNum: 3,
            mode: 'one-click',
            tier: 'cloud',
            factNodes: nodes,
        });
        expect(viaOption.bundle.formattedFull).toContain('宁缺·年龄=十七');
    });

    it('协同模式（co-write/local）同样能装配事实', () => {
        const result = buildStoryContext({
            context: gathered({ fact_nodes: factNodesForInjection(facts, 3) }),
            chapterName: '第3章',
            chapterNum: 3,
            mode: 'co-write',
            tier: 'local',
        });
        expect(result.bundle.formattedFull).toContain('宁缺·年龄=十七');
    });

    it('零回归：两处都不传时图里没有 fact 节点，bundle 正常产出', () => {
        const result = buildStoryContext({
            context: gathered({}),
            chapterName: '第3章',
            chapterNum: 3,
            mode: 'one-click',
            tier: 'cloud',
        });
        expect([...result.graph.nodes.keys()].some(id => id.startsWith('fact:'))).toBe(false);
        expect(result.bundle.formattedFull.length).toBeGreaterThan(0);
    });
});

describe('ContextManager.gatherFactNodes · 三态', () => {
    const PROJECT = '长篇小说/测试书';
    const PATH = pjFactStoreFile(PROJECT);

    function makeManager(fs: MockFileSystem): ContextManager {
        return new ContextManager({
            capabilities: { app: {} as never, settings: {} },
            fs,
        } as never);
    }

    it('missing：没有事实库文件 → 空数组、不报错、不进 partialFailures', async () => {
        const cm = makeManager(new MockFileSystem());
        const data = await cm.gatherFactNodes(PROJECT, 3);
        expect(data.fact_nodes).toEqual([]);
        expect((cm as unknown as { _partialFailures: string[] })._partialFailures).toHaveLength(0);
    });

    it('ok：事实库落盘 → 转换成图节点（与 loadFactStore/审核侧同一份事实）', async () => {
        const fs = new MockFileSystem();
        const store = createFactStore();
        mergeFactStore(store, 3, [entryOf(fact())]);
        await fs.write(PATH, serializeFactStore(store));

        const cm = makeManager(fs);
        const data = await cm.gatherFactNodes(PROJECT, 5);
        expect(data.fact_nodes).toHaveLength(1);
        expect(data.fact_nodes?.[0].id).toBe('fact:3:宁缺:年龄');
        // 审核侧读到的还是同一份文件（双消费同源，accept ④）
        const auditView = await loadFactStore(fs, PATH);
        expect(auditView.status).toBe('ok');
        expect(auditView.store.facts).toHaveLength(1);
    });

    it('read-failed：JSON 损坏 → 空数组但进 partialFailures（不静默冒充）', async () => {
        const fs = new MockFileSystem();
        await fs.write(PATH, '{broken');
        const cm = makeManager(fs);
        const data = await cm.gatherFactNodes(PROJECT, 3);
        expect(data.fact_nodes).toEqual([]);
        expect((cm as unknown as { _partialFailures: string[] })._partialFailures)
            .toContain('事实库（文件损坏）');
    });
});
