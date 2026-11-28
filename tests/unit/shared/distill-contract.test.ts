/**
 * distill-contract — 蒸馏回流契约（2026-11-28，云笔 18 项提取里的 11 项）
 *
 * 关键设计：不与既有协议行（CR/CI/BT/NE）重复机制；
 * 安全阀——只有解析到 C 或 EL 才剥离正文（防误摘散文里 `W|`/`K|` 开头的行）。
 */
import { describe, expect, it } from 'vitest';
import {
    parseDistillLines,
    splitDistillLines,
    validateDistillLines,
    collectBackfillItems,
    renderDistillChecklist,
    DISTILL_LINES_INSTRUCTION,
    EVENT_LINE_MAX_CHARS,
} from '../../../shared/distill-contract';

const FULL_BLOCK = [
    '他把剑收回鞘里，转身走进雨里。',
    '',
    'C|第5章 雨夜|主角击杀追杀者并夺回剑谱|有人在山门外等他|山门开启，来人是师兄|我这把剑不认第二个人',
    'EL|夺回剑谱后发现有内应，追杀者其实是师兄派来',
    'T|公元-2-4-15|公元-2-4-16|正常',
    'CF|剑谱下落|推进|藏剑阁已空',
    'M|章尾|82|杀意未消与犹疑并存',
    'K|师兄|你杀错人了',
    'G|青云门|内部分裂浮出水面',
    'L|山门外|新增埋伏点',
    'W|把信息揭晓放在动作之后，读者才会跟着角色一起发现',
    'PH|他在山门外看见一个不该出现的人',
    'OP|师兄把剑谱放在桌上，说了一句他听不懂的话',
].join('\n');

describe('parseDistillLines — 归组与容错', () => {
    it('11 类行全部归组', () => {
        const r = parseDistillLines(FULL_BLOCK);
        expect(r.lines.C).toHaveLength(1);
        expect(r.lines.EL).toHaveLength(1);
        expect(r.lines.T).toHaveLength(1);
        expect(r.lines.CF).toHaveLength(1);
        expect(r.lines.M).toHaveLength(1);
        expect(r.lines.K).toHaveLength(1);
        expect(r.lines.G).toHaveLength(1);
        expect(r.lines.L).toHaveLength(1);
        expect(r.lines.W).toHaveLength(1);
        expect(r.lines.PH).toHaveLength(1);
        expect(r.lines.OP).toHaveLength(1);
        expect(r.warnings).toEqual([]);
    });

    it('C 行按字段语义拆开（标题/摘要/钩子/承接/台词）', () => {
        const c = parseDistillLines(FULL_BLOCK).lines.C[0];
        expect(c.fields).toHaveLength(5);
        expect(c.fields[0]).toBe('第5章 雨夜');
        expect(c.fields[2]).toContain('山门外等他');
    });

    it('竖线两侧空格容错', () => {
        const r = parseDistillLines('C | 第1章 | 摘要 | 钩子 | 承接 | 台词');
        expect(r.lines.C[0].fields[1]).toBe('摘要');
    });

    it('协议行（CR/CI/BT/NE）不算未知 tag、不告警', () => {
        const r = parseDistillLines('CI|霜寒剑|损坏|1\nCR|张三|李四|反目|夺剑');
        expect(r.lines.C).toHaveLength(0);
        expect(r.warnings.some((w) => w.includes('未知蒸馏行'))).toBe(false);
    });

    it('未知 tag 告警并计入 otherLineCount', () => {
        const r = parseDistillLines('ZZ|乱写|两字段');
        expect(r.warnings.some((w) => w.includes('未知蒸馏行 tag'))).toBe(true);
        expect(r.otherLineCount).toBe(1);
    });

    it('字段数不符时告警但保留（按缺失补空）', () => {
        const r = parseDistillLines('C|只有标题|只有摘要');
        expect(r.lines.C[0].fields).toHaveLength(5);
        expect(r.lines.C[0].fields[4]).toBe('');
        expect(r.warnings.some((w) => w.includes('字段数'))).toBe(true);
    });

    it('缺 C/EL 时给出提示', () => {
        const r = parseDistillLines('M|章尾|50|焦躁');
        expect(r.warnings.some((w) => w.includes('缺少 C'))).toBe(true);
        expect(r.warnings.some((w) => w.includes('缺少 EL'))).toBe(true);
    });
});

describe('splitDistillLines — 安全阀', () => {
    it('有 C/EL 才剥离，正文保留', () => {
        const r = splitDistillLines(FULL_BLOCK);
        expect(r.stripped).toBe(true);
        expect(r.body).toContain('他把剑收回鞘里');
        expect(r.body).not.toContain('C|第5章');
        expect(r.body).not.toContain('EL|');
    });

    it('无 C/EL 时不剥离（散文里以 W|/K| 开头的行不被误摘）', () => {
        const prose = '他写下两行：\nW|这一行是正文里的排版\nK|这一行也是正文';
        const r = splitDistillLines(prose);
        expect(r.stripped).toBe(false);
        expect(r.body).toBe(prose);
    });

    it('协议行留在正文（由 protocol-lines 负责剥）', () => {
        const mixed = 'C|第1章|摘要|钩子|承接|台词\nCI|霜寒剑|损坏|1';
        const r = splitDistillLines(mixed);
        expect(r.stripped).toBe(true);
        expect(r.body).toContain('CI|霜寒剑');
    });
});

describe('validateDistillLines — 语义校验', () => {
    it('完整块无错误', () => {
        const v = validateDistillLines(parseDistillLines(FULL_BLOCK));
        expect(v.errors).toEqual([]);
    });

    it('缺 C/EL → 硬错误', () => {
        const v = validateDistillLines(parseDistillLines('M|章尾|50|焦躁'));
        expect(v.errors.some((e) => e.includes('缺少 C'))).toBe(true);
        expect(v.errors.some((e) => e.includes('缺少 EL'))).toBe(true);
    });

    it('EL 超长 → 硬错误（云笔规定 ≤30 字）', () => {
        const long = '事'.repeat(EVENT_LINE_MAX_CHARS + 1);
        const v = validateDistillLines(parseDistillLines(`C|a|b|c|d|e\nEL|${long}`));
        expect(v.errors.some((e) => e.includes('超长'))).toBe(true);
    });

    it('T 行日期不可解析 → 告警（不阻断）', () => {
        const v = validateDistillLines(parseDistillLines(`C|a|b|c|d|e\nEL|事件\nT|三日后|四日后|正常`));
        expect(v.warnings.some((w) => w.includes('起始日期不可解析'))).toBe(true);
    });

    it('M 强度越界 → 告警', () => {
        const v = validateDistillLines(parseDistillLines(`C|a|b|c|d|e\nEL|事件\nM|章尾|180|过载`));
        expect(v.warnings.some((w) => w.includes('强度应为 0-100'))).toBe(true);
    });

    it('CF 状态不在白名单 → 告警', () => {
        const v = validateDistillLines(parseDistillLines(`C|a|b|c|d|e\nEL|事件\nCF|剑谱|随便写|备注`));
        expect(v.warnings.some((w) => w.includes('CF 行状态'))).toBe(true);
    });
});

describe('collectBackfillItems — 双向补写', () => {
    it('PH 指向上一章、OP 指向下一章', () => {
        const items = collectBackfillItems(parseDistillLines(FULL_BLOCK), 5);
        expect(items).toEqual([
            { targetChapter: 4, field: '章尾悬念', text: '他在山门外看见一个不该出现的人', source: 'PH' },
            { targetChapter: 6, field: '章首承接', text: '师兄把剑谱放在桌上，说了一句他听不懂的话', source: 'OP' },
        ]);
    });

    it('无 PH/OP 时不产生条目', () => {
        expect(collectBackfillItems(parseDistillLines('C|a|b|c|d|e\nEL|事件'), 3)).toEqual([]);
    });
});

describe('renderDistillChecklist — 待确认清单', () => {
    it('含待确认声明与分组内容', () => {
        const parsed = parseDistillLines(FULL_BLOCK);
        const text = renderDistillChecklist(parsed, validateDistillLines(parsed), '第5章 雨夜');
        expect(text).toContain('# 第5章 雨夜 蒸馏回流待确认');
        expect(text).toContain('本文件只是待确认清单');
        expect(text).toContain('章节摘要（C）');
        expect(text).toContain('事件线（EL）');
        expect(text).toContain('时间跨度（T）');
        expect(text).toContain('双向补写待确认');
        expect(text).toContain('第4章「章尾悬念」');
        expect(text).toContain('第6章「章首承接」');
    });

    it('硬错误进「必须修正」区', () => {
        const parsed = parseDistillLines('M|章尾|50|焦躁');
        const text = renderDistillChecklist(parsed, validateDistillLines(parsed), '第1章');
        expect(text).toContain('硬错误（必须修正）');
    });
});

describe('DISTILL_LINES_INSTRUCTION', () => {
    it('只描述协议行之外的 11 类，并说明 CR/CI/BT/NE 另走协议行', () => {
        for (const tag of ['C|', 'EL|', 'T|', 'CF|', 'M|', 'K|', 'G|', 'L|', 'W|', 'OP|', 'PH|']) {
            expect(DISTILL_LINES_INSTRUCTION).toContain(tag);
        }
        expect(DISTILL_LINES_INSTRUCTION).toContain('CR / CI / BT / NE');
        expect(DISTILL_LINES_INSTRUCTION).toContain('不要编造');
    });
});
