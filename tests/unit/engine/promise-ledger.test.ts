import { describe, expect, it } from 'vitest';
import {
    applyPromiseInstruction,
    formatOpenPromisesForPrompt,
    formatPromiseLedger,
    getPromiseWarnings,
    parsePromiseLedger,
} from '../../../engine/promise-ledger';
import {
    applyArcInstruction,
    buildArcRowsFromCharacters,
    formatArcsForPrompt,
    formatCharacterArcTable,
    parseCharacterArcTable,
} from '../../../engine/character-arc';
import { parseReport } from '../../../engine/settlement/report-parser';

describe('promise-ledger — 承诺账本', () => {
    it('解析/格式化固定表', () => {
        const items = parsePromiseLedger(`| # | 承诺/谜团 | 类型 | 提出章 | 提出角色 | 预期兑现 | 状态 | 最近推进章 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | 救父 | 角色承诺 | 第1章 | 林晚 | 第5章 | open | 第1章 | 父亲病重 |
`);
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe('救父');
        expect(items[0].status).toBe('open');
        const md = formatPromiseLedger(items);
        expect(md).toContain('| 1 | 救父 | 角色承诺 |');
    });

    it('OPEN/ADVANCE/RESOLVE/DROP 幂等更新', () => {
        let items = applyPromiseInstruction([], { action: 'open', name: '救父', type: '角色承诺', chapter: '第1章', expected: '第5章' });
        expect(items[0].status).toBe('open');
        items = applyPromiseInstruction(items, { action: 'advance', name: '救父', chapter: '第2章', note: '找到线索' });
        expect(items[0].status).toBe('advanced');
        items = applyPromiseInstruction(items, { action: 'resolve', name: '救父', chapter: '第3章', note: '救出' });
        expect(items[0].status).toBe('resolved');
        // 重复 OPEN 不产生重复行
        items = applyPromiseInstruction(items, { action: 'open', name: '救父' });
        expect(items).toHaveLength(1);
    });

    it('逾期与停滞提醒进入 prompt', () => {
        const items = parsePromiseLedger(`| # | 承诺/谜团 | 类型 | 提出章 | 提出角色 | 预期兑现 | 状态 | 最近推进章 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | 救父 | 角色承诺 | 第1章 | 林晚 | 第3章 | open | 第1章 | |
`);
        expect(getPromiseWarnings(items, 6)).toEqual(expect.arrayContaining([expect.stringContaining('预期')]));
        const prompt = formatOpenPromisesForPrompt(items, 6);
        expect(prompt).toContain('未兑现承诺');
        expect(prompt).toContain('救父');
        expect(prompt).toContain('逾期');
    });
});

describe('character-arc — 角色弧线', () => {
    it('从角色 frontmatter 建骨架，缺字段留空', () => {
        const rows = buildArcRowsFromCharacters([
            { name: '林晚', motivation: '救父', fear: '失去家人', stage: '逃避' },
        ]);
        expect(rows[0]).toMatchObject({ name: '林晚', want: '救父', lie: '失去家人', stage: '逃避' });
        expect(rows[0].need).toBe('');
    });

    it('ARC 指令推进阶段并保留表格', () => {
        let rows = buildArcRowsFromCharacters([{ name: '林晚', motivation: '救父' }]);
        rows = applyArcInstruction(rows, {
            name: '林晚', from: '逃避', to: '直面', trigger: '父亲病危', visible: '是',
        }, '第3章');
        expect(rows[0].stage).toBe('直面');
        expect(rows[0].chapterChange).toContain('父亲病危');
        const md = formatCharacterArcTable(rows);
        expect(parseCharacterArcTable(md)[0].stage).toBe('直面');
    });

    it('按相关角色生成 prompt，最多 6 条', () => {
        const rows = Array.from({ length: 8 }, (_, i) => ({
            name: `角色${i}`, want: '', need: '', lie: '', stage: '未定义', chapterChange: '', updatedChapter: '',
        }));
        const prompt = formatArcsForPrompt(rows, new Set(['角色0', '角色1']));
        expect(prompt).toContain('角色0');
        expect(prompt).toContain('角色1');
        expect(prompt).not.toContain('角色7');
    });
});

describe('report-parser — PROMISE/ARC 指令', () => {
    it('解析四类承诺指令与 ARC', () => {
        const instr = parseReport(`
PROMISE_OPEN: 救父 | 角色承诺 | 第5章 | 父亲病重
PROMISE_ADVANCE: 救父 | 第2章 | 找到线索
PROMISE_RESOLVE: 救父 | 第3章 | 救出
PROMISE_DROP: 旧约定 | 已无意义
ARC: 林晚 | 逃避 | 直面 | 父亲病危 | 是
`);
        expect(instr.promise).toHaveLength(4);
        expect(instr.promise[0]).toMatchObject({ action: 'open', name: '救父', expected: '第5章' });
        expect(instr.arc[0]).toMatchObject({ name: '林晚', from: '逃避', to: '直面' });
    });
});
