import { describe, expect, it } from 'vitest';
import { computeDelta, createSnapshot, renderDeltaSection, shouldInject } from '@/shared/cowrite-delta-model';

describe('computeDelta', () => {
    it('首次注入全部为新增', () => {
        const delta = computeDelta(null, ['entity:CHR-0001', 'foreshadow:FSH-0001'], 'SC-1');
        expect(delta.sameScene).toBe(false);
        expect(delta.added).toHaveLength(2);
    });

    it('同场景无变化 → 不需要注入', () => {
        const prev = createSnapshot('SC-1', ['entity:CHR-0001']);
        const delta = computeDelta(prev, ['entity:CHR-0001'], 'SC-1');
        expect(delta.added).toEqual([]);
        expect(shouldInject(delta)).toBe(false);
    });

    it('同场景新增条目只补差异', () => {
        const prev = createSnapshot('SC-1', ['entity:CHR-0001']);
        const delta = computeDelta(prev, ['entity:CHR-0001', 'relation:REL-0001'], 'SC-1');
        expect(delta.added).toEqual(['relation:REL-0001']);
        expect(delta.unchanged).toEqual(['entity:CHR-0001']);
        expect(shouldInject(delta)).toBe(true);
    });

    it('切换场景需要重新装配', () => {
        const prev = createSnapshot('SC-1', ['entity:CHR-0001']);
        const delta = computeDelta(prev, ['entity:CHR-0002'], 'SC-2');
        expect(delta.sameScene).toBe(false);
        expect(shouldInject(delta)).toBe(true);
    });

    it('移除条目会被记录', () => {
        const prev = createSnapshot('SC-1', ['entity:CHR-0001', 'entity:CHR-0002']);
        const delta = computeDelta(prev, ['entity:CHR-0001'], 'SC-1');
        expect(delta.removed).toEqual(['entity:CHR-0002']);
    });
});

describe('renderDeltaSection', () => {
    it('只渲染新增，未变化不重复发送', () => {
        const prev = createSnapshot('SC-1', ['entity:CHR-0001']);
        const delta = computeDelta(prev, ['entity:CHR-0001', 'relation:REL-0001'], 'SC-1');
        const text = renderDeltaSection(delta, key => (key.startsWith('relation') ? '师徒关系' : '林玄'));
        expect(text).toContain('本场新增上下文');
        expect(text).toContain('REL-0001');
        expect(text).toContain('不重复发送');
        expect(text).not.toContain('- entity:CHR-0001：');
    });

    it('无需注入返回空串', () => {
        const prev = createSnapshot('SC-1', ['entity:CHR-0001']);
        const delta = computeDelta(prev, ['entity:CHR-0001'], 'SC-1');
        expect(renderDeltaSection(delta, () => 'x')).toBe('');
    });

    it('场景切换有提示', () => {
        const prev = createSnapshot('SC-1', ['entity:CHR-0001']);
        const delta = computeDelta(prev, ['entity:CHR-0002'], 'SC-2');
        expect(renderDeltaSection(delta, () => '苏婉')).toContain('场景已切换');
    });
});
