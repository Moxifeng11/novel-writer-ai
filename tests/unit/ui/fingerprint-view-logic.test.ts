/**
 * 阶段 D1：指纹视图筛选与生效状态（纯逻辑）
 *
 * 从 `ui/views/writing-fingerprint-view.ts` 抽出。这些判断此前内联在视图里，
 * 没有任何测试能覆盖——改一个 `includes` 就可能让搜索失效而无人察觉。
 *
 * 锁两件用户可感知的事：
 * 1. **搜索能搜到**：名称/来源/标签三处任一命中；大小写不敏感；空搜索返回全部
 * 2. **生效状态对**：全局指纹看项目覆盖优先，非全局看自身
 */

import { describe, expect, it } from 'vitest';
import {
    filterFingerprints,
    filterFingerprintsByQuery,
    filterFingerprintsByTag,
    collectFingerprintTags,
    resolveEffectiveEnabled,
    withEffectiveEnabled,
} from '../../../ui/views/fingerprint-view-logic';
import type { StyleFingerprint } from '../../../engine/style-fingerprint-library';

/** 构造指纹 */
function fp(partial: Partial<StyleFingerprint> & { id: string }): StyleFingerprint {
    return {
        name: partial.name ?? `指纹-${partial.id}`,
        source: partial.source ?? '章节提取',
        scope: partial.scope ?? 'project',
        enabled: partial.enabled ?? true,
        tags: partial.tags ?? [],
        stats: {
            avgSentenceLength: 20,
            avgParagraphLength: 100,
            dialogueRatio: 0.3,
            descriptionRatio: 0.4,
            wordCount: 10000,
        },
        features: {
            sentenceRhythm: '短句',
            wordPreference: '常用词',
            narrativeStyle: '第三人称',
            rhetoric: '比喻',
            dialogueStyle: '简短',
            paragraphStructure: '单段成意',
            overallTone: '冷峻',
        },
        samples: [],
        extractedAt: 1,
        ...partial,
    } as StyleFingerprint;
}

describe('D1-1：搜索过滤', () => {
    const list = [
        fp({ id: 'a', name: '冷峻笔法', source: '遮天', tags: ['男频', '仙侠'] }),
        fp({ id: 'b', name: '疏朗叙述', source: '诡秘之主', tags: ['西幻'] }),
        fp({ id: 'c', name: '快速节奏', source: '斗破苍穹', tags: ['男频'] }),
    ];

    it('按名称命中', () => {
        expect(filterFingerprintsByQuery(list, '冷峻').map(f => f.id)).toEqual(['a']);
    });

    it('按来源命中', () => {
        expect(filterFingerprintsByQuery(list, '诡秘').map(f => f.id)).toEqual(['b']);
    });

    it('按标签命中', () => {
        expect(filterFingerprintsByQuery(list, '男频').map(f => f.id)).toEqual(['a', 'c']);
    });

    it('大小写不敏感', () => {
        const withLatin = [fp({ id: 'x', name: 'Fast Pacing', tags: [] })];
        expect(filterFingerprintsByQuery(withLatin, 'fast').map(f => f.id)).toEqual(['x']);
        expect(filterFingerprintsByQuery(withLatin, 'FAST').map(f => f.id)).toEqual(['x']);
    });

    it('空搜索返回全部（不是空列表）', () => {
        expect(filterFingerprintsByQuery(list, '')).toHaveLength(3);
        expect(filterFingerprintsByQuery(list, '   ')).toHaveLength(3);
    });

    it('搜不到返回空', () => {
        expect(filterFingerprintsByQuery(list, '不存在的词')).toEqual([]);
    });

    it('不修改原列表', () => {
        const original = [...list];
        filterFingerprintsByQuery(list, '冷峻');
        expect(list).toEqual(original);
    });
});

describe('D1-2：标签过滤', () => {
    const list = [
        fp({ id: 'a', tags: ['男频', '仙侠'] }),
        fp({ id: 'b', tags: ['西幻'] }),
        fp({ id: 'c', tags: ['男频'] }),
    ];

    it('按标签精确匹配', () => {
        expect(filterFingerprintsByTag(list, '男频').map(f => f.id)).toEqual(['a', 'c']);
    });

    it('null 标签返回全部', () => {
        expect(filterFingerprintsByTag(list, null)).toHaveLength(3);
    });

    it('不存在的标签返回空', () => {
        expect(filterFingerprintsByTag(list, '不存在')).toEqual([]);
    });
});

describe('D1-3：组合过滤（先搜索再标签）', () => {
    const list = [
        fp({ id: 'a', name: '冷峻笔法', tags: ['男频', '仙侠'] }),
        fp({ id: 'b', name: '冷峻叙述', tags: ['西幻'] }),
        fp({ id: 'c', name: '疏朗叙述', tags: ['男频'] }),
    ];

    it('两个条件同时生效（取交集）', () => {
        const result = filterFingerprints(list, { searchQuery: '冷峻', selectedTag: '男频' });
        expect(result.map(f => f.id)).toEqual(['a']);
    });

    it('只有搜索词时等价于按词过滤', () => {
        const result = filterFingerprints(list, { searchQuery: '叙述', selectedTag: null });
        expect(result.map(f => f.id)).toEqual(['b', 'c']);
    });

    it('只有标签时等价于按标签过滤', () => {
        const result = filterFingerprints(list, { searchQuery: '', selectedTag: '男频' });
        expect(result.map(f => f.id)).toEqual(['a', 'c']);
    });

    it('无条件时返回全部', () => {
        const result = filterFingerprints(list, { searchQuery: '', selectedTag: null });
        expect(result).toHaveLength(3);
    });
});

describe('D1-4：标签收集', () => {
    it('去重并排序', () => {
        const list = [
            fp({ id: 'a', tags: ['乙', '甲'] }),
            fp({ id: 'b', tags: ['甲', '丙'] }),
        ];
        const tags = collectFingerprintTags(list);
        expect(tags).toHaveLength(3);
        expect(new Set(tags).size).toBe(3);
        // 排序稳定（不依赖输入顺序）
        expect(tags).toEqual([...tags].sort());
    });

    it('无标签时返回空数组', () => {
        expect(collectFingerprintTags([fp({ id: 'a', tags: [] })])).toEqual([]);
    });

    it('tags 缺失时不抛错（旧数据兼容）', () => {
        const legacy = { ...fp({ id: 'a' }), tags: undefined } as unknown as StyleFingerprint;
        expect(collectFingerprintTags([legacy])).toEqual([]);
    });
});

describe('D1-5：生效状态（全局指纹项目覆盖优先）', () => {
    it('项目指纹看自身 enabled', () => {
        expect(resolveEffectiveEnabled(fp({ id: 'p', scope: 'project', enabled: true }), new Map())).toBe(true);
        expect(resolveEffectiveEnabled(fp({ id: 'p', scope: 'project', enabled: false }), new Map())).toBe(false);
    });

    it('全局指纹无覆盖时回落到自身 enabled', () => {
        expect(resolveEffectiveEnabled(fp({ id: 'g', scope: 'global', enabled: true }), new Map())).toBe(true);
        expect(resolveEffectiveEnabled(fp({ id: 'g', scope: 'global', enabled: false }), new Map())).toBe(false);
    });

    it('全局指纹有项目覆盖时以覆盖为准（即使自身是 false）', () => {
        const state = new Map([['g', true]]);
        expect(resolveEffectiveEnabled(fp({ id: 'g', scope: 'global', enabled: false }), state)).toBe(true);
    });

    it('项目覆盖为 false 时压住自身的 true', () => {
        const state = new Map([['g', false]]);
        expect(resolveEffectiveEnabled(fp({ id: 'g', scope: 'global', enabled: true }), state)).toBe(false);
    });

    it('模板层不参与判定（返回自身值，调用方不应据此注入）', () => {
        expect(resolveEffectiveEnabled(fp({ id: 't', scope: 'template', enabled: true }), new Map())).toBe(true);
    });
});

describe('D1-6：渲染投影不改动库内对象', () => {
    it('有覆盖时产生新对象，无覆盖时复用原对象', () => {
        const global = fp({ id: 'g', scope: 'global', enabled: false });
        const project = fp({ id: 'p', scope: 'project', enabled: true });
        const state = new Map([['g', true]]);
        const projected = withEffectiveEnabled([global, project], state);

        expect(projected[0].enabled).toBe(true);      // 覆盖生效
        expect(global.enabled).toBe(false);            // 原对象未被改动
        expect(projected[1]).toBe(project);            // 无变化时复用原对象
    });
});
