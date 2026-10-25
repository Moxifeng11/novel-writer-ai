/**
 * 同人时间线窗口：本地 8K 预算下不能永远只注入「前 8 行」。
 *
 * - 同人时间线（本书进度）越靠后越接近当前章 → 取最近 8 行；
 * - 原作时间线（canon）用同人时间线最新一条的「对应原作时间」定位锚点，
 *   取锚点附近的连续 8 行；没有锚点保持「前 8 行」向后兼容；
 * - 发生截断时补一行说明，避免模型把「没注入」误读成「时间线到此结束」。
 */
import { describe, it, expect } from 'vitest';
import {
    formatFanficRulesForPrompt,
    parseFanficRules,
    FANFIC_MAX_INJECTED_TIMELINE_ROWS,
} from '../../../shared/fanfic-rules';

function buildContent(canonRows: string[], fanRows: string[]): string {
    return `## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---|---|---|---|---|
${canonRows.join('\n')}

## 故事背景时间线（你的同人）
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|---|---|---|---|
${fanRows.join('\n')}
`;
}

function canonRow(index: number): string {
    return `| 星历 ${index} 年 | 事件${index} | 人物${index} | 原作第 ${index} 章 | 切入${index} |`;
}

function fanRow(index: number, ref: string): string {
    return `| 第${index}周 | 同人事件${index} | ${ref} | 林澈 |`;
}

function format(canonRows: string[], fanRows: string[]): string {
    return formatFanficRulesForPrompt(parseFanficRules(buildContent(canonRows, fanRows), '设定.md'));
}

describe('同人时间线注入窗口', () => {
    it('同人时间线超过上限时注入最近 8 行，而不是最前面 8 行', () => {
        const fan = Array.from({ length: 12 }, (_, index) => fanRow(index, '星历 0 年'));
        const text = format([canonRow(0)], fan);

        expect(text).toContain('第11周');
        expect(text).not.toContain('第0周');
        expect(text).toContain('（同人时间线共 12 行，以上为最近 8 行）');
    });

    it('原作时间线按同人进度锚点取连续窗口', () => {
        const canon = Array.from({ length: 12 }, (_, index) => canonRow(index));
        const text = format(canon, [fanRow(1, '星历 9 年')]);

        expect(text).toContain('星历 9 年');
        expect(text).toContain('星历 11 年');
        expect(text).not.toContain('星历 3 年');
        expect(text).toContain('（原作时间线共 12 行，以上为第 5–12 行）');
    });

    it('找不到锚点时保持原来的前 8 行（向后兼容）', () => {
        const canon = Array.from({ length: 12 }, (_, index) => canonRow(index));
        const text = format(canon, [fanRow(1, '某个不存在的纪元')]);

        expect(text).toContain('星历 0 年');
        expect(text).not.toContain('星历 11 年');
        expect(text).toContain('（原作时间线共 12 行，以上为第 1–8 行）');
    });

    it('锚点落在末尾时窗口夹紧，不越界且仍为 8 行', () => {
        const canon = Array.from({ length: 12 }, (_, index) => canonRow(index));
        const text = format(canon, [fanRow(1, '星历 11 年')]);

        const canonLines = text
            .split('\n')
            .filter((line) => line.startsWith('- 星历'));
        expect(canonLines).toHaveLength(FANFIC_MAX_INJECTED_TIMELINE_ROWS);
        expect(canonLines[0]).toContain('星历 4 年');
        expect(canonLines[canonLines.length - 1]).toContain('星历 11 年');
    });

    it('锚点为占位「（待补充）」时不参与匹配', () => {
        const canon = Array.from({ length: 12 }, (_, index) => canonRow(index));
        const text = format(canon, [fanRow(1, '（待补充）')]);

        expect(text).toContain('星历 0 年');
        expect(text).not.toContain('星历 11 年');
    });

    it('两张时间线都不超过上限时不出现截断说明', () => {
        const text = format([canonRow(0), canonRow(1)], [fanRow(0, '星历 0 年'), fanRow(1, '星历 1 年')]);

        expect(text).not.toContain('（原作时间线共');
        expect(text).not.toContain('（同人时间线共');
    });
});
