/**
 * 大纲 → 画布桥接测试（2026-11-16）
 */
import { describe, expect, it } from 'vitest';
import {
    buildNodesFromOutline,
    describeChapterSummary,
    describeChapterTitle,
} from '../../../ui/planning/outline-bridge';
import type { PlanningNode } from '../../../domains/planning/model';

function existingNode(chapterNum: number, y = 0): PlanningNode {
    return {
        id: `n${chapterNum}`,
        title: `第${chapterNum}章`,
        summary: '',
        kind: 'event',
        status: 'idea',
        parentId: null,
        position: { x: 0, y },
        chapterNum,
    };
}

describe('buildNodesFromOutline', () => {
    it('每章生成一个事件节点并带章节号', () => {
        const { nodes } = buildNodesFromOutline([
            { chapterNum: 1, volumeLabel: '第1卷', conflict: '开局' },
            { chapterNum: 2, volumeLabel: '第1卷', conflict: '冲突' },
        ], []);
        expect(nodes).toHaveLength(2);
        expect(nodes.map(node => node.chapterNum)).toEqual([1, 2]);
        expect(nodes.every(node => node.kind === 'event' && node.status === 'idea')).toBe(true);
    });

    it('已存在的章节跳过并计数', () => {
        const { nodes, skipped } = buildNodesFromOutline(
            [{ chapterNum: 1 }, { chapterNum: 2 }],
            [existingNode(1)],
        );
        expect(nodes).toHaveLength(1);
        expect(nodes[0].chapterNum).toBe(2);
        expect(skipped).toBe(1);
    });

    it('不同卷分列布局', () => {
        const { nodes } = buildNodesFromOutline([
            { chapterNum: 1, volumeLabel: '第1卷' },
            { chapterNum: 2, volumeLabel: '第2卷' },
        ], []);
        expect(nodes[0].position.x).not.toBe(nodes[1].position.x);
    });

    it('避开已有节点的 y 区间', () => {
        const { nodes } = buildNodesFromOutline([{ chapterNum: 5 }], [existingNode(1, 500)]);
        expect(nodes[0].position.y).toBeGreaterThan(500);
    });

    it('非法章节号忽略', () => {
        const { nodes } = buildNodesFromOutline([{ chapterNum: 0 }, { chapterNum: Number.NaN }], []);
        expect(nodes).toHaveLength(0);
    });
});

describe('describeChapterTitle / describeChapterSummary', () => {
    it('优先首场景名', () => {
        expect(describeChapterTitle({ chapterNum: 3, scenes: [{ name: '初入山门' }] })).toBe('第3章 · 初入山门');
    });

    it('无场景名时用冲突', () => {
        expect(describeChapterTitle({ chapterNum: 3, conflict: '宗门试炼' })).toBe('第3章 · 宗门试炼');
    });

    it('都没有时只有章号', () => {
        expect(describeChapterTitle({ chapterNum: 3 })).toBe('第3章');
    });

    it('摘要串联场景目标', () => {
        expect(describeChapterSummary({
            chapterNum: 1,
            scenes: [{ objective: '拿到钥匙' }, { objective: '离开山门' }],
        })).toBe('拿到钥匙；离开山门');
    });

    it('无场景目标时回退冲突', () => {
        expect(describeChapterSummary({ chapterNum: 1, conflict: '对峙' })).toBe('对峙');
    });

    it('摘要截断到 200 字', () => {
        const long = 'x'.repeat(300);
        expect(describeChapterSummary({ chapterNum: 1, scenes: [{ objective: long }] }).length).toBe(200);
    });
});
