/**
 * B3：结构化约束块（纯模型 + 组装）
 */

import { describe, expect, it } from 'vitest';
import {
    constraintBlockId, normalizeConstraintBlocks, renderConstraintBlocks,
} from '@/shared/constraint-block-model';
import { ConstraintBlockService } from '@/services/constraint-block-service';

describe('约束块模型', () => {
    it('同文本 ID 稳定、去重', () => {
        const a = constraintBlockId('fact', '林玄的年龄是「18」');
        const b = constraintBlockId('fact', '  林玄的年龄是「18」 ');
        expect(a).toBe(b);
        const blocks = normalizeConstraintBlocks([
            { kind: 'fact', text: 'x', anchorIds: ['a'], source: '人物卡' },
            { kind: 'fact', text: 'x', anchorIds: ['b'], source: '人物卡' },
            { kind: 'fact', text: '  ', anchorIds: [], source: '人物卡' },
        ]);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].anchorIds).toEqual(['a']);
    });

    it('渲染带编号与归因', () => {
        const blocks = normalizeConstraintBlocks([
            { kind: 'fact', text: '甲约束', anchorIds: ['CHR-1'], source: '人物卡' },
            { kind: 'voice', text: '乙约束', anchorIds: ['CHR-2'], source: '人物卡' },
        ]);
        const rendered = renderConstraintBlocks(blocks);
        expect(rendered.section).toContain('[C1]');
        expect(rendered.section).toContain('[C2]');
        expect(rendered.attribution).toHaveLength(2);
    });

    it('超长按上限截断但保留至少一条', () => {
        const blocks = normalizeConstraintBlocks([
            { kind: 'fact', text: '长'.repeat(50), anchorIds: [], source: '人物卡' },
            { kind: 'fact', text: '长'.repeat(50), anchorIds: [], source: '人物卡' },
        ]);
        const rendered = renderConstraintBlocks(blocks, 10);
        expect(rendered.attribution).toHaveLength(1);
    });
});

describe('ConstraintBlockService', () => {
    const make = (files: Record<string, string>) => new ConstraintBlockService({
        resolveEntity: async (name) => (name === '林玄'
            ? { id: 'CHR-0001', name: '林玄', voiceSamples: ['老子不去'], speechTraits: ['爱用老子'], hardFacts: { 当前境界: '练气三层' } }
            : null),
        readText: async (path) => files[path] ?? '',
        findBySuffix: async (project, suffix) => {
            const hit = Object.keys(files).find(path => path.startsWith(project) && path.endsWith(`${suffix}.md`));
            return hit ?? null;
        },
    });

    it('场景人物生成事实与口吻约束', async () => {
        const files = {
            '长篇小说/甲/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md': '## 场景1\n- 在场人物：林玄\n',
        };
        const service = make(files);
        const result = await service.assemble('长篇小说/甲', '第1章');
        expect(result.sceneNames).toEqual(['林玄']);
        expect(result.blocks.some(b => b.kind === 'fact')).toBe(true);
        expect(result.blocks.some(b => b.kind === 'voice')).toBe(true);
        expect(result.section.length).toBeGreaterThan(0);
    });
});
