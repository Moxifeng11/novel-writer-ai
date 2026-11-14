/**
 * timeline-events-format 单测（audit §四-6 回归锁）
 *
 * 锁住：时间线事件的结构化字段（涉及人物/地点/类型）必须随事件注入，
 * 不能只留 time/chapter/event/impact 四列。
 */

import { describe, expect, it } from 'vitest';
import { formatTimelineEvents } from '@/shared/timeline-events-format';
import type { TimelineEventLike } from '@/shared/timeline-events-format';

/** 造事件 */
function event(over: Partial<TimelineEventLike> = {}): TimelineEventLike {
    return {
        time: '第三日',
        chapter: '第3章',
        event: '宁缺入长安',
        impact: '身份暴露风险',
        ...over,
    };
}

describe('formatTimelineEvents · 基础四列', () => {
    it('无结构化字段时输出四列', () => {
        expect(formatTimelineEvents([event()])).toBe('- 第三日 | 第3章 | 宁缺入长安 | 身份暴露风险');
    });

    it('空数组输出空串', () => {
        expect(formatTimelineEvents([])).toBe('');
    });

    it('undefined 输出空串', () => {
        expect(formatTimelineEvents(undefined)).toBe('');
    });
});

describe('formatTimelineEvents · 结构化字段（§四-6 修复）', () => {
    it('**涉及人物随事件注入**', () => {
        const text = formatTimelineEvents([event({ involvedEntities: ['宁缺', '桑桑'] })]);
        expect(text).toContain('涉及人物：宁缺、桑桑');
    });

    it('**地点随事件注入**', () => {
        expect(formatTimelineEvents([event({ location: '长安' })])).toContain('地点：长安');
    });

    it('**类型随事件注入**', () => {
        expect(formatTimelineEvents([event({ type: '转折' })])).toContain('类型：转折');
    });

    it('多字段按固定顺序拼接', () => {
        const text = formatTimelineEvents([event({
            involvedEntities: ['宁缺'],
            location: '长安',
            type: '转折',
        })]);
        expect(text).toBe('- 第三日 | 第3章 | 宁缺入长安 | 身份暴露风险（涉及人物：宁缺；地点：长安；类型：转折）');
    });

    it('空数组字段不产生空括号（负例）', () => {
        const text = formatTimelineEvents([event({ involvedEntities: [] })]);
        expect(text).not.toContain('（');
    });
});

describe('formatTimelineEvents · 压缩文本优先', () => {
    it('有压缩文本时直接返回（不重复拼装）', () => {
        expect(formatTimelineEvents([event()], '- 压缩后的一行')).toBe('- 压缩后的一行');
    });

    it('压缩文本为空白时回退到事件拼装', () => {
        expect(formatTimelineEvents([event()], '   ')).toContain('宁缺入长安');
    });
});
