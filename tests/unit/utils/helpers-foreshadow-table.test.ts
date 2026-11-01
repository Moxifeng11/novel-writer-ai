import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
    Notice: class { constructor(_msg?: string, _duration?: number) {} },
    App: class {},
    TFile: class {},
    TFolder: class {},
    Modal: class {},
    Setting: class {},
    Platform: { isMobile: false },
}));

import {
    getNextRowNum,
    getNextRowNumInSection,
    hasTableSeparator,
    appendAfterSeparator,
    renumberTable,
    moveForeshadowToRevealed,
} from '../../../utils/helpers';

const LIB = `## 未回收伏笔

| 序号 | 伏笔名称 | 重要度 | 埋入章节 | 计划回收 | 相关人物 | 关联主线 | 状态 |
|---|---|---|---|---|---|---|---|
| 1 | 铜镜 | 高 | 第1章 |  | 沈砚 | 身世线 | 未揭示 |
| 2 | 残卷 | 中 | 第2章 | 第9章 | 苏晚 | 主线 | 未揭示 |

## 已回收伏笔

| 序号 | 伏笔名称 | 重要度 | 埋入章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |
|---|---|---|---|---|---|---|---|
| 1 | 旧剑 | 低 | 第1章 | 沈砚 | 身世线 | 第3章 | 正文揭示 |
`;

describe('伏笔表格解析', () => {
    it('保留空单元格，不因「计划回收」为空导致列左移', () => {
        // 旧实现 filter(Boolean) 会把空列丢掉：相关人物会读到「身世线」
        const result = moveForeshadowToRevealed(LIB, '铜镜', '第5章');
        expect(result).not.toBeNull();
        const rows = (result as string).split('\n').filter(l => l.includes('铜镜'));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toContain('沈砚');
        expect(rows[0]).toContain('身世线');
        // 重要度仍来自原「高」列，而不是错位后的单元格
        expect(rows[0]).toMatch(/\|\s*高\s*\|/);
    });

    it('已回收表新行落在分隔行之后、且编号顺延', () => {
        const result = moveForeshadowToRevealed(LIB, '铜镜', '第5章') as string;
        const lines = result.split('\n');
        const sepIdx = lines.findIndex(l => l.includes('已回收伏笔'));
        expect(sepIdx).toBeGreaterThan(-1);
        const afterSep = lines.slice(sepIdx).findIndex(l => /^\|[\s:|-]+\|$/.test(l.trim()));
        expect(afterSep).toBeGreaterThan(-1);
        expect(lines[sepIdx + afterSep + 1]).toContain('铜镜');
        expect(lines[sepIdx + afterSep + 2]).toContain('旧剑');
    });

    it('未在未回收表找到返回 null', () => {
        expect(moveForeshadowToRevealed(LIB, '不存在', '第5章')).toBeNull();
    });
});

describe('renumberTable', () => {
    it('按出现顺序重排序号（旧实现 cols[0] 恒为空串 → no-op）', () => {
        const lines = [
            '## 未回收伏笔',
            '| 序号 | 名称 |',
            '|---|---|',
            '| 7 | 甲 |',
            '| 3 | 乙 |',
            '',
            '## 其他',
            '| 9 | 不该被改 |',
        ];
        renumberTable(lines, '未回收伏笔');
        expect(lines[3]).toBe('| 1 | 甲 |');
        expect(lines[4]).toBe('| 2 | 乙 |');
        expect(lines[7]).toBe('| 9 | 不该被改 |');
    });

    it('无尾管道的行不被误改', () => {
        const lines = ['## 未回收伏笔', '| 7 | 甲', '## 其他'];
        renumberTable(lines, '未回收伏笔');
        expect(lines[1]).toBe('| 7 | 甲');
    });

    it('带空格的对齐分隔行也能识别', () => {
        const lines = ['## 未回收伏笔', '| --- | --- |', '| 4 | 甲 |'];
        renumberTable(lines, '未回收伏笔');
        expect(lines[1]).toBe('| --- | --- |');
        expect(lines[2]).toBe('| 1 | 甲 |');
    });
});

describe('表格定位容错', () => {
    it('getNextRowNum 支持无空格的表格写法', () => {
        expect(getNextRowNum('|1 | 甲 |\n|2|乙|')).toBe(3);
    });

    it('hasTableSeparator / appendAfterSeparator 支持 | --- | 写法', () => {
        expect(hasTableSeparator('| --- | --- |')).toBe(true);
        const out = appendAfterSeparator('| 序号 | 名 |\n| --- | --- |\n| 1 | 甲 |', '| 2 | 乙 |');
        expect(out.split('\n')[2]).toBe('| 2 | 乙 |');
    });

    it('getNextRowNumInSection 不因空列错位', () => {
        expect(getNextRowNumInSection(LIB, '未回收伏笔')).toBe(3);
    });
});
