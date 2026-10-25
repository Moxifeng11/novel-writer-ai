/**
 * Rev 186 / T7：关联索引回写（只动标记块、幂等、不误删用户内容）
 */
import { describe, it, expect } from 'vitest';
import {
    LINKAGE_BEGIN,
    LINKAGE_END,
    upsertLinkageBlock,
    buildForeshadowIndexBlock,
    buildTimelineIndexBlock,
} from '../../../engine/story-linkage-writer';
import type { LinkageForeshadow, LinkageTimelineEvent } from '../../../engine/story-linkage';

const foreshadows: LinkageForeshadow[] = [
    {
        name: '残玉', importance: '高', buryChapter: '第1章', plannedRaw: '第6-8章',
        range: { start: 6, end: 8, raw: '第6-8章' }, state: 'due',
        relatedChars: ['沈砚'], relatedMainline: '青云宗',
        settingRefs: ['沈砚'], planningRef: '残玉第一次异动',
    },
    {
        name: '旧剑', importance: '中', buryChapter: '第1章', plannedRaw: '第3章',
        range: { start: 3, end: 3, raw: '第3章' }, state: 'overdue',
        relatedChars: [], relatedMainline: '', settingRefs: [], planningRef: '',
    },
];

const timeline: LinkageTimelineEvent[] = [
    {
        time: '第三年春', chapter: '第6章', eventName: '山门试炼',
        state: 'in-chapter', involved: ['沈砚'], settingRefs: ['沈砚'],
    },
];

describe('buildForeshadowIndexBlock', () => {
    const block = buildForeshadowIndexBlock(foreshadows, ['伏笔库有 5 条重复记录'], '2026-10-24 10:00', 6);

    it('包含到期/逾期分组与关联列', () => {
        expect(block).toContain('### 本章到期（1）');
        expect(block).toContain('### 逾期未回收（1）');
        expect(block).toContain('| 伏笔 | 重要度 | 埋设章节 | 计划回收 | 关联设定 | 规划定位 |');
        expect(block).toContain('| 残玉 | 高 | 第1章 | 第6-8章 | 沈砚 | 残玉第一次异动 |');
        expect(block).toContain('参照章：第6章');
    });

    it('空分组显示「无」，告警进入数据质量提示', () => {
        const empty = buildForeshadowIndexBlock([], [], '2026-10-24 10:00', 6);
        expect(empty).toContain('### 本章到期（0）');
        expect(empty).toContain('### 数据质量提示');
        expect(empty).toContain('### 数据质量提示\n\n无');
        expect(block).toContain('- 伏笔库有 5 条重复记录');
    });

    it('表格单元格里的竖线被转义，不破坏表结构', () => {
        const withPipe: LinkageForeshadow = { ...foreshadows[0], name: '残|玉' };
        const text = buildForeshadowIndexBlock([withPipe], [], '2026-10-24 10:00', 6);
        expect(text).toContain('残\\|玉');
    });
});

describe('buildTimelineIndexBlock', () => {
    it('去重后的事件按表格输出，状态中文化', () => {
        const block = buildTimelineIndexBlock(timeline, [], '2026-10-24 10:00');
        expect(block).toContain('事件 1 条（已去重）');
        expect(block).toContain('| 第三年春 | 第6章 | 山门试炼 | 本章 | 沈砚 |');
    });

    it('无事件时给出明确提示', () => {
        expect(buildTimelineIndexBlock([], [], '2026-10-24 10:00')).toContain('无时间线事件');
    });
});

describe('upsertLinkageBlock', () => {
    const block = buildForeshadowIndexBlock(foreshadows, [], '2026-10-24 10:00', 6);

    it('首次回写追加到文末，并保留用户原表格', () => {
        const original = '# 伏笔库\n\n## 未回收伏笔\n\n| # | 伏笔名称 |\n| --- | --- |\n| 1 | 残玉 |\n';
        const once = upsertLinkageBlock(original, block);

        expect(once).toContain('| 1 | 残玉 |');
        expect(once).toContain(LINKAGE_BEGIN);
        expect(once).toContain(LINKAGE_END);
    });

    it('重复回写字节级一致（幂等）', () => {
        const original = '# 伏笔库\n\n| 1 | 残玉 |\n';
        const once = upsertLinkageBlock(original, block);
        const twice = upsertLinkageBlock(once, block);

        expect(twice).toBe(once);
        expect(once.split(LINKAGE_BEGIN)).toHaveLength(2);
    });

    it('残缺标记（只有 BEGIN）不删除用户内容，按无标记追加', () => {
        const partial = `# 用户内容\n${LINKAGE_BEGIN}\n残留片段`;
        const result = upsertLinkageBlock(partial, block);

        expect(result).toContain('# 用户内容');
        expect(result).toContain('残留片段');
        expect(result).toContain(LINKAGE_END);
    });

    it('空文件回写得到纯自动块', () => {
        const result = upsertLinkageBlock('', block);
        expect(result.startsWith(LINKAGE_BEGIN)).toBe(true);
        expect(result.trimEnd().endsWith(LINKAGE_END)).toBe(true);
    });
});
