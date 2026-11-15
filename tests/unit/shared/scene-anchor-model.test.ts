/**
 * M5：场景锚点解析与覆盖要求测试
 */

import { describe, expect, it } from 'vitest';
import {
    buildSceneRequirements, describeSceneAnchor, extractNames, parseSceneAnchors, resolveAnchorIds,
} from '@/shared/scene-anchor-model';
import type { ProjectIndexEntry } from '@/shared/project-index-model';

const SCENE_TEXT = `## 场景1：山门初见

- 在场人物：林玄、苏婉
- 地点：青云宗山门
- 冲突：守门弟子阻拦
- 情绪：紧张

## 场景2：夜谈

- 在场人物：林玄
- 地点：后山
- 钩子：断剑异动
`;

const entry = (over: Partial<ProjectIndexEntry>): ProjectIndexEntry => ({
    path: 'p/a.md', name: 'a', kind: 'other', size: 1, mtime: 1, ...over,
});

describe('parseSceneAnchors', () => {
    it('按 ## 场景N 切块', () => {
        const anchors = parseSceneAnchors(SCENE_TEXT);
        expect(anchors).toHaveLength(2);
        expect(anchors[0].index).toBe(1);
        expect(anchors[0].title).toBe('山门初见');
        expect(anchors[1].index).toBe(2);
    });

    it('无场景标题返回空', () => {
        expect(parseSceneAnchors('普通正文')).toEqual([]);
    });
});

describe('extractNames', () => {
    it('从在场人物/地点字段提取名称', () => {
        const names = extractNames('- 在场人物：林玄、苏婉\n- 地点：青云宗山门');
        expect(names).toContain('林玄');
        expect(names).toContain('苏婉');
        expect(names).toContain('青云宗山门');
    });

    it('忽略无关行', () => {
        expect(extractNames('- 随便一句没有字段名')).toEqual([]);
    });
});

describe('resolveAnchorIds', () => {
    const entries = [
        entry({ path: 'p/人物/CHR-0001_林玄.md', name: 'CHR-0001_林玄', type: 'character', id: 'CHR-0001', aliases: ['林玄'] }),
        entry({ path: 'p/人物/CHR-0002_苏婉.md', name: 'CHR-0002_苏婉', type: 'character', id: 'CHR-0002', aliases: ['苏婉'] }),
    ];

    it('精确别名解析为 ID', () => {
        const result = resolveAnchorIds(entries, ['林玄', '苏婉']);
        expect(result.ids).toEqual(['CHR-0001', 'CHR-0002']);
        expect(result.unresolved).toEqual([]);
    });

    it('未命中进 unresolved（不猜）', () => {
        const result = resolveAnchorIds(entries, ['路人甲']);
        expect(result.ids).toEqual([]);
        expect(result.unresolved).toEqual(['路人甲']);
    });

    it('多义进 ambiguous', () => {
        const dup = [
            entry({ path: 'p/a/同名.md', name: '同名', type: 'character', id: 'CHR-0010' }),
            entry({ path: 'p/b/同名.md', name: '同名', type: 'character', id: 'CHR-0011' }),
        ];
        expect(resolveAnchorIds(dup, ['同名']).ambiguous).toEqual(['同名']);
    });
});

describe('buildSceneRequirements', () => {
    const entries = [
        entry({ path: 'p/人物/CHR-0001_林玄.md', name: '林玄', type: 'character', id: 'CHR-0001', aliases: ['林玄'] }),
        entry({ path: 'p/人物/CHR-0002_苏婉.md', name: '苏婉', type: 'character', id: 'CHR-0002', aliases: ['苏婉'] }),
        entry({ path: 'p/关系/REL-0001_CHR-0001_CHR-0002.md', name: 'REL-0001', type: 'relation', id: 'REL-0001' }),
        entry({ path: 'p/关系/REL-0002_CHR-0001_CHR-0009.md', name: 'REL-0002', type: 'relation', id: 'REL-0002' }),
    ];

    it('实体要求包含在场 ID', () => {
        const scene = parseSceneAnchors(SCENE_TEXT)[0];
        const requirements = buildSceneRequirements(scene, { ids: ['CHR-0001', 'CHR-0002'] }, entries);
        const entity = requirements.find(item => item.kind === 'entity');
        expect(entity?.ids).toEqual(['CHR-0001', 'CHR-0002']);
    });

    it('只取两端都在场的关系卡', () => {
        const scene = parseSceneAnchors(SCENE_TEXT)[0];
        const requirements = buildSceneRequirements(scene, { ids: ['CHR-0001', 'CHR-0002'] }, entries);
        const relation = requirements.find(item => item.kind === 'relation');
        expect(relation?.ids).toEqual(['REL-0001']);
    });

    it('摘要文本', () => {
        const scene = parseSceneAnchors(SCENE_TEXT)[0];
        expect(describeSceneAnchor(scene)).toContain('场景1');
    });
});
