/**
 * 门禁量具自检回归（Trae preflight 审计 P3 · 第 20/21 步）
 *
 * 两个门禁（check:any / check:jsdoc）的同一个盲区：
 * **只检查「有没有变差」，从不检查「我要量的东西还在不在」**。
 * 扫描根改名、AST 访问器坏掉、文件搬家，都会让统计变成 0，
 * 而 0 永远不超基线 → 门禁绿。
 *
 * 最坏的一例是 check:jsdoc：`pct = totalExports ? ... : 100`
 * 在什么都没扫到时兜底成 **100%**，打印「✅ 导出覆盖 100%」。
 *
 * 评估过 Trae 建议的「校验 6 目录存在且文件数 > 0」，认为偏弱：
 * 只挡整体目录改名，挡不住量具失效，还要维护硬编码目录清单。
 * 这里用三条不依赖目录清单的通用判定替代。
 */

import { describe, expect, it } from 'vitest';
import {
    describeVanishedFiles,
    evaluateMeasurement,
    evaluateScanScope,
    findVanishedBaselineFiles,
} from '../../../scripts/lib/gate-sanity-lib.mjs';

describe('自检-1：扫描范围', () => {
    it('正常文件数无错误', () => {
        expect(evaluateScanScope({ count: 838, label: '[jsdoc] 源文件扫描' })).toEqual([]);
    });

    it('扫到 0 个 → 报错（目录改名/缺失）', () => {
        const errors = evaluateScanScope({ count: 0, label: '[jsdoc] 源文件扫描' });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('扫描到 0 个文件');
        expect(errors[0]).toContain('空转');
    });

    it('负数/非整数 → 报错（不静默放过）', () => {
        expect(evaluateScanScope({ count: -1, label: 'x' })).toHaveLength(1);
        expect(evaluateScanScope({ count: Number.NaN, label: 'x' })).toHaveLength(1);
    });
});

describe('自检-2：量具有效性（0 的两种含义）', () => {
    it('总数正常 → 无错误', () => {
        expect(evaluateMeasurement({ total: 74, baselineTotal: 74, label: 'any' })).toEqual([]);
    });

    it('总数下降但非 0 → 不算量具失效（可能是真修好了）', () => {
        expect(evaluateMeasurement({ total: 60, baselineTotal: 74, label: 'any' })).toEqual([]);
    });

    it('总数 0 而基线非 0 → 报错（不是「都修好了」，是「没量到」）', () => {
        const errors = evaluateMeasurement({ total: 0, baselineTotal: 74, label: 'any' });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('量具可能失效');
        expect(errors[0]).toContain('74');
    });

    it('总数 0 且基线也 0 → 正常（本来就没有可统计对象）', () => {
        expect(evaluateMeasurement({ total: 0, baselineTotal: 0, label: 'any' })).toEqual([]);
    });

    it('负数统计 → 报错', () => {
        expect(evaluateMeasurement({ total: -3, baselineTotal: 74, label: 'any' })).toHaveLength(1);
    });
});

describe('自检-3：基线对象消失', () => {
    const exists = (rel: string): boolean => !rel.includes('gone');

    it('全部仍存在 → 无消失', () => {
        const r = findVanishedBaselineFiles({
            baselineFiles: ['a.ts', 'b.ts'],
            exists,
        });
        expect(r.vanished).toEqual([]);
        expect(r.truncated).toBe(false);
    });

    it('基线文件消失 → 列出（搬家/改名/删除必须同步基线）', () => {
        const r = findVanishedBaselineFiles({
            baselineFiles: ['a.ts', 'gone/b.ts'],
            exists,
        });
        expect(r.vanished).toEqual(['gone/b.ts']);
    });

    it('超过 limit → 标记 truncated 但仍全部返回', () => {
        const files = Array.from({ length: 15 }, (_, i) => `gone/${i}.ts`);
        const r = findVanishedBaselineFiles({ baselineFiles: files, exists, limit: 10 });
        expect(r.vanished).toHaveLength(15);
        expect(r.truncated).toBe(true);
    });

    it('空基线 → 无消失', () => {
        expect(findVanishedBaselineFiles({ baselineFiles: [], exists }).vanished).toEqual([]);
    });

    it('null 安全', () => {
        expect(findVanishedBaselineFiles({ baselineFiles: null as never, exists }).vanished).toEqual([]);
    });
});

describe('自检-4：消失文件文案', () => {
    it('无消失 → 空数组', () => {
        expect(describeVanishedFiles({ vanished: [], truncated: false, label: 'x' })).toEqual([]);
    });

    it('有消失 → 一条多行文案，含文件名与同步提示', () => {
        const lines = describeVanishedFiles({
            vanished: ['a.ts', 'b.ts'],
            truncated: false,
            label: '[check:any]',
        });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('2 个基线登记的文件在磁盘上已不存在');
        expect(lines[0]).toContain('a.ts');
        expect(lines[0]).toContain('必须同步基线');
    });

    it('truncated → 附「其余 N 个略」', () => {
        const vanished = Array.from({ length: 12 }, (_, i) => `${i}.ts`);
        const lines = describeVanishedFiles({ vanished, truncated: true, limit: 10, label: 'x' });
        expect(lines[0]).toContain('…其余 2 个略');
    });
});
