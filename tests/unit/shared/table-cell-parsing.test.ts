/**
 * Markdown 表格单元格解析（B3）
 *
 * `split('|').map(trim).filter(Boolean)` 会丢掉空单元格，导致后续列整体左移：
 * 「计划回收」为空时，关联主线会被写进「相关人物」。统一用 splitTableCells，
 * 保留空位、只去掉首尾边框。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { splitTableCells } from '../../../shared/chapter-table';

describe('splitTableCells', () => {
    it('保留中间空单元格，列位置不左移', () => {
        expect(splitTableCells('| 伏笔A |  | 关联主线 |')).toEqual(['伏笔A', '', '关联主线']);
    });

    it('去掉首尾边框与空白，不产生空首尾列', () => {
        expect(splitTableCells('  |  a  |  b  |  ')).toEqual(['a', 'b']);
        expect(splitTableCells('|a|b|')).toEqual(['a', 'b']);
    });

    it('非表格行返回空数组', () => {
        expect(splitTableCells('普通文本')).toEqual([]);
        expect(splitTableCells('')).toEqual([]);
    });

    it('分隔行保持可识别', () => {
        expect(splitTableCells('|---|---|---|')).toEqual(['---', '---', '---']);
    });
});

describe('源码约束', () => {
    it('engine/services/ui/shared 不再出现丢空列的表格解析', () => {
        const root = path.resolve(__dirname, '../../..');
        const dirs = ['engine', 'services', 'ui', 'shared'];
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                if (!entry.name.endsWith('.ts')) continue;
                const source = fs.readFileSync(full, 'utf8');
                const re = /\.split\('\|'\)\.map\([^)]*\)\.filter\(Boolean\)/;
                if (re.test(source)) offenders.push(path.relative(root, full));
            }
        };
        for (const dir of dirs) walk(path.join(root, dir));
        expect(offenders).toEqual([]);
    });
});
