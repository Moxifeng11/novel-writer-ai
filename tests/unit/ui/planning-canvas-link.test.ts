/**
 * 正文 ↔ 规划画布链接测试（2026-11-16）
 */
import { describe, expect, it } from 'vitest';
import { buildChapterEventNode } from '../../../ui/planning/canvas-link';
import type { PlanningNode } from '../../../domains/planning/model';

function node(chapterNum?: number): PlanningNode {
    return {
        id: `n${chapterNum ?? 0}`,
        title: '已有',
        summary: '',
        kind: 'event',
        status: 'idea',
        parentId: null,
        position: { x: 0, y: 0 },
        chapterNum,
    };
}

describe('buildChapterEventNode', () => {
    it('按章节构造事件节点并带上 chapterNum', () => {
        const created = buildChapterEventNode([], 3, '初入山门', '主角上山', { x: 10, y: 20 });
        expect(created).not.toBeNull();
        expect(created?.chapterNum).toBe(3);
        expect(created?.title).toBe('初入山门');
        expect(created?.status).toBe('selected');
        expect(created?.position).toEqual({ x: 10, y: 20 });
    });

    it('同一章不重复建节点', () => {
        expect(buildChapterEventNode([node(3)], 3, 'x', '', { x: 0, y: 0 })).toBeNull();
    });

    it('其它章节可以新增', () => {
        const created = buildChapterEventNode([node(3)], 4, 'x', '', { x: 0, y: 0 });
        expect(created?.chapterNum).toBe(4);
    });

    it('章节号非法返回 null', () => {
        expect(buildChapterEventNode([], 0, 'x', '', { x: 0, y: 0 })).toBeNull();
        expect(buildChapterEventNode([], Number.NaN, 'x', '', { x: 0, y: 0 })).toBeNull();
    });

    it('标题为空时回退为第N章', () => {
        const created = buildChapterEventNode([], 7, '   ', '', { x: 0, y: 0 });
        expect(created?.title).toBe('第7章');
    });

    it('摘要被截断', () => {
        const created = buildChapterEventNode([], 1, 't', 'x'.repeat(900), { x: 0, y: 0 });
        expect(created?.summary.length).toBe(500);
    });

    it('坐标取整', () => {
        const created = buildChapterEventNode([], 1, 't', '', { x: 10.6, y: 20.2 });
        expect(created?.position).toEqual({ x: 11, y: 20 });
    });
});
