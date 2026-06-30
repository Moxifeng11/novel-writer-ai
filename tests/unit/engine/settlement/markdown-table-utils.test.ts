/**
 * tests/unit/engine/settlement/markdown-table-utils.test.ts
 * Markdown 表格工具纯函数测试（P1-2 拆分后新增）。
 */
import { describe, it, expect } from 'vitest';
import {
    getNextRowNum,
    hasTableSeparator,
    appendAfterSeparator,
    appendAfterSectionHeader,
    renumberTable,
    getNextRowNumInSection,
} from '../../../../engine/settlement/markdown-table-utils';

describe('getNextRowNum', () => {
    it('空内容返回 1', () => {
        expect(getNextRowNum('')).toBe(1);
    });

    it('无表格返回 1', () => {
        expect(getNextRowNum('# 标题\n\n纯文本')).toBe(1);
    });

    it('取表格最大编号 + 1', () => {
        const content = `| # | 名称 |
|---|------|
| 1 | A |
| 2 | B |
| 5 | C |`;
        expect(getNextRowNum(content)).toBe(6);
    });
});

describe('hasTableSeparator', () => {
    it('包含 |--- 返回 true', () => {
        expect(hasTableSeparator('| A |\n|---|\n| 1 |')).toBe(true);
    });

    it('不包含返回 false', () => {
        expect(hasTableSeparator('# 标题\n纯文本')).toBe(false);
    });
});

describe('appendAfterSeparator', () => {
    it('在分隔行后插入新行', () => {
        const r = appendAfterSeparator('| # | A |\n|---|---|\n| 1 | X |', '| 2 | Y |');
        expect(r).toBe('| # | A |\n|---|---|\n| 2 | Y |\n| 1 | X |');
    });

    it('无分隔行附加到末尾', () => {
        const r = appendAfterSeparator('# 标题', '| 1 | X |');
        expect(r).toBe('# 标题\n| 1 | X |\n');
    });
});

describe('appendAfterSectionHeader', () => {
    it('在指定标题下表格分隔行后插入', () => {
        const content = `## 未回收伏笔
| # | 名称 |
|---|------|
| 1 | A |
## 已回收伏笔
| # | 名称 |
|---|------|`;
        const r = appendAfterSectionHeader(content, '未回收伏笔', '| 2 | B |');
        expect(r).toContain('|---|------|\n| 2 | B |\n| 1 | A |');
    });

    it('有标题无表格自动新建时间线表格', () => {
        const content = '## 时间线\n（待补充）';
        const r = appendAfterSectionHeader(content, '时间线', '| 春 | 第1章 | 旅行开始 | 重要 |');
        expect(r).toContain('| 时间 | 对应章节 | 事件 | 影响 |');
        expect(r).toContain('| 春 | 第1章 | 旅行开始 | 重要 |');
    });

    it('找不到标题附加到末尾', () => {
        const r = appendAfterSectionHeader('# 不存在的标题', '## 未回收伏笔', '| 1 | A |');
        expect(r).toBe('# 不存在的标题\n| 1 | A |\n');
    });
});

describe('renumberTable', () => {
    it('重新编号节内表格', () => {
        const lines = `## 未回收伏笔
| # | 名称 |
|---|------|
| 5 | A |
| 9 | B |
| 3 | C |`.split('\n');
        renumberTable(lines, '未回收伏笔');
        expect(lines.join('\n')).toContain('| 1 | A |');
        expect(lines.join('\n')).toContain('| 2 | B |');
        expect(lines.join('\n')).toContain('| 3 | C |');
    });

    it('遇到其他节标题停止', () => {
        const lines = `## 未回收伏笔
|---|---|
| 9 | A |
## 已回收伏笔
| 9 | X |`.split('\n');
        renumberTable(lines, '未回收伏笔');
        expect(lines[2]).toContain('| 1 | A |');
        expect(lines[4]).toContain('| 9 | X |');  // 不动
    });
});

describe('getNextRowNumInSection', () => {
    it('取分隔线后最大编号 + 1', () => {
        const lines = `## 节标题
| # | 名称 |
|---|------|
| 3 | A |
| 7 | B |`.split('\n');
        const sepIdx = lines.findIndex(l => l.includes('|---'));
        expect(getNextRowNumInSection(lines, sepIdx)).toBe(8);
    });

    it('遇到非表格行立即停止', () => {
        const lines = `|---|---|
| 1 | A |

| 99 | B |`.split('\n');
        expect(getNextRowNumInSection(lines, 0)).toBe(2);
    });
});
