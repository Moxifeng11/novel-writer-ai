/**
 * M2：设定图卡片类型解析（frontmatter.type 优先）
 */

import { describe, expect, it } from 'vitest';
import { cardTypeOf } from '@/services/memory-graph-service';
import type { ProjectIndexEntry } from '@/shared/project-index-model';

const entry = (over: Partial<ProjectIndexEntry>): ProjectIndexEntry => ({
    path: 'p/a.md', name: 'a', kind: 'other', size: 1, mtime: 1, ...over,
});

describe('cardTypeOf', () => {
    it('frontmatter.type 优先于路径类别', () => {
        expect(cardTypeOf(entry({ type: 'character', kind: 'setting' }))).toBe('character');
        expect(cardTypeOf(entry({ type: 'foreshadow', kind: 'timeline' }))).toBeNull();
    });

    it('世界观归入设定卡', () => {
        expect(cardTypeOf(entry({ type: 'worldview' }))).toBe('setting');
    });

    it('无 type 时按路径类别兜底', () => {
        expect(cardTypeOf(entry({ kind: 'character' }))).toBe('character');
        expect(cardTypeOf(entry({ kind: 'timeline' }))).toBeNull();
    });

    it('关系状态.md 这类路径误判不再生成设定卡', () => {
        // 旧实现：01-世界架构/** 一律 setting；新实现 type=relation → null
        expect(cardTypeOf(entry({ path: 'p/01-世界架构/关系状态.md', kind: 'setting', type: 'relation' }))).toBeNull();
    });
});
