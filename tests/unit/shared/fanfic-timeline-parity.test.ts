/**
 * 同人时间线：面板（template-validator）与 prompt（fanfic-rules）必须同源。
 *
 * 旧实现两套解析器：
 * - prompt 侧 `parseFanficTimeline` 保留原始单元格，只过滤占位后 join；
 * - 面板侧 `parseMarkdownTable` 先 `filter(c => c.length > 0)` 再按列名映射，
 *   中间有空单元格时后续列整体左移，面板会把「章节参考」显示在「涉及人物」下。
 */
import { describe, it, expect } from 'vitest';
import { parseFanficTimeline, parseFanficTimelineRows } from '../../../shared/fanfic-rules';
import {
    loadFanficRules,
    parseCanonTimelineTable,
    parseFanTimelineTable,
    parseTimelineBoardTable,
} from '../../../shared/template-validator';

const CANON_WITH_GAP = `## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---|---|---|---|---|
| 星历 301 年 | 星门崩裂 |  | 第 12 章 | 主角提前入学 |

## 故事背景时间线（你的同人）
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|---|---|---|---|
| 入学第一周 | 被观测系盯上 |  | 林澈 |
`;

describe('同人时间线：面板与 prompt 同源', () => {
    it('原作时间线中间空单元格不导致后续列左移', () => {
        const rows = parseCanonTimelineTable(CANON_WITH_GAP);
        expect(rows).toHaveLength(1);
        expect(rows[0]['时间节点']).toBe('星历 301 年');
        expect(rows[0]['原作事件']).toBe('星门崩裂');
        expect(rows[0]['涉及人物']).toBe('');
        expect(rows[0]['章节参考']).toBe('第 12 章');
        expect(rows[0]['你的同人如何切入']).toBe('主角提前入学');
    });

    it('同人时间线中间空单元格不导致后续列左移', () => {
        const rows = parseFanTimelineTable(CANON_WITH_GAP);
        expect(rows).toHaveLength(1);
        expect(rows[0]['你的时间节点']).toBe('入学第一周');
        expect(rows[0]['你的事件']).toBe('被观测系盯上');
        expect(rows[0]['对应原作时间']).toBe('');
        expect(rows[0]['涉及人物']).toBe('林澈');
    });

    it('原始行解析保留空单元格，列位置与文件一致', () => {
        const rows = parseFanficTimelineRows(CANON_WITH_GAP, '原作剧情时间线');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(['星历 301 年', '星门崩裂', '', '第 12 章', '主角提前入学']);
    });

    it('prompt 文本与面板行数一致（同一份数据，只是渲染方式不同）', () => {
        const rows = parseFanficTimelineRows(CANON_WITH_GAP, '原作剧情时间线');
        const lines = parseFanficTimeline(CANON_WITH_GAP, '原作剧情时间线');
        expect(lines).toEqual(['星历 301 年｜星门崩裂｜第 12 章｜主角提前入学']);
        expect(lines).toHaveLength(rows.length);
    });

    it('原创纪元时间轴的空单元格同样不能错列', () => {
        const content = `## 纪元 / 时间轴
| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |
|---|---|---|---|---|---|---|
| 1 | 星门崩裂 | 星历 301 年 |  | 林澈 | 第 12 章 | 转折 |
`;
        const rows = parseTimelineBoardTable(content);
        expect(rows).toHaveLength(1);
        expect(rows[0]['时间']).toBe('星历 301 年');
        expect(rows[0]['地点']).toBe('');
        expect(rows[0]['涉及人物']).toBe('林澈');
        expect(rows[0]['章节']).toBe('第 12 章');
    });

    it('面板规则解析覆盖续行，与 prompt 读取同一份文本', () => {
        const content = `## 创作规则
- **必须遵守的原作规则**：主线事件不变
  不得复活已死角色
- **允许改编的范围**：支线人物关系
- **禁止触及的红线**：主要角色死亡
`;
        const rules = loadFanficRules(content);
        expect(rules.mustFollow).toEqual(['主线事件不变', '不得复活已死角色']);
        expect(rules.adaptScope).toBe('支线人物关系');
        expect(rules.redlines).toEqual(['主要角色死亡']);
    });
});
