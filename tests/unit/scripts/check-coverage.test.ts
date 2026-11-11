import { describe, expect, it } from 'vitest';
import {
    METRICS,
    aggregateByDir,
    checkProvenance,
    compareCoverage,
    evaluateProvenance,
    isInDir,
    toBaselineDirs,
    toRelativePath,
    validateBaselineUpdate,
} from '../../../scripts/lib/coverage-lib.mjs';

/**
 * check-coverage 门禁的纯逻辑回归（DSH-20261112-01）。
 *
 * 锁定定稿口径：
 * - 目录聚合 count-weighted（不是文件百分比平均）；
 * - 严格路径段前缀（ui 不能吃进 ui-services）；
 * - lines 棘轮：下降失败、上升/持平通过；
 * - provenance：gitHead 不符拒绝比较；
 * - 写基线：note 必填；下调需 --allow-decrease 双确认。
 */

const ROOT = '/repo';

function metric(total: number, covered: number) {
    return { total, covered, pct: total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 0 };
}

function fileEntry(lines: { total: number; covered: number }) {
    return { lines, statements: lines, branches: lines, functions: lines };
}

describe('aggregateByDir — count-weighted 聚合', () => {
    it('按行数加权，而非对文件百分比做平均', () => {
        const summary = {
            total: fileEntry({ total: 9999, covered: 9999 }),
            '/repo/ui/a.ts': fileEntry({ total: 100, covered: 100 }), // 100%
            '/repo/ui/b.ts': fileEntry({ total: 1000, covered: 0 }), // 0%
        };

        const entry = aggregateByDir(summary, 'ui', ROOT);
        expect(entry.files).toBe(2);
        expect(entry.lines.total).toBe(1100);
        expect(entry.lines.covered).toBe(100);
        expect(entry.lines.pct).toBe(9.09); // 加权结果；简单平均会是 50
    });

    it('严格目录前缀：ui 不吃 ui-services，也不吃顶层文件', () => {
        const summary = {
            '/repo/ui/a.ts': fileEntry({ total: 10, covered: 10 }),
            '/repo/ui-services/x.ts': fileEntry({ total: 100, covered: 0 }),
            '/repo/uix.ts': fileEntry({ total: 100, covered: 0 }),
        };

        const entry = aggregateByDir(summary, 'ui', ROOT);
        expect(entry.files).toBe(1);
        expect(entry.lines.pct).toBe(100);
    });

    it('ui/views 是 ui 的子集，两级都能单独聚合', () => {
        const summary = {
            '/repo/ui/a.ts': fileEntry({ total: 100, covered: 50 }),
            '/repo/ui/views/v.ts': fileEntry({ total: 10, covered: 10 }),
        };

        expect(aggregateByDir(summary, 'ui', ROOT).files).toBe(2);
        const views = aggregateByDir(summary, 'ui/views', ROOT);
        expect(views.files).toBe(1);
        expect(views.lines.pct).toBe(100);
    });

    it('空目录返回 0 而不是 NaN；total 键被忽略', () => {
        const entry = aggregateByDir({ total: fileEntry({ total: 100, covered: 100 }) }, 'ui', ROOT);
        expect(entry.files).toBe(0);
        expect(entry.lines.pct).toBe(0);
    });
});

describe('compareCoverage — lines 棘轮', () => {
    const baseline = { dirs: { ui: { lines: { pct: 12.5 } }, 'ui/views': { lines: { pct: 20 } } } };

    it('下降判负，并给出基线与实际值', () => {
        const current = {
            ui: { lines: { pct: 11.9 } },
            'ui/views': { lines: { pct: 20 } },
        };
        const result = compareCoverage(baseline, current);
        expect(result.ok).toBe(false);
        expect(result.decreased[0]).toEqual({ dir: 'ui', baseline: 12.5, actual: 11.9 });
    });

    it('极小抖动（≤0.05pp）不算下降（v8 运行间抖动）', () => {
        const current = {
            ui: { lines: { pct: 12.47 } },
            'ui/views': { lines: { pct: 20 } },
        };
        expect(compareCoverage(baseline, current).ok).toBe(true);
    });

    it('超过 0.05pp 的下降仍判负', () => {
        const current = {
            ui: { lines: { pct: 12.44 } },
            'ui/views': { lines: { pct: 20 } },
        };
        expect(compareCoverage(baseline, current).ok).toBe(false);
    });

    it('上升或持平判正', () => {
        const current = {
            ui: { lines: { pct: 12.5 } },
            'ui/views': { lines: { pct: 21.01 } },
        };
        expect(compareCoverage(baseline, current).ok).toBe(true);
    });
});

describe('checkProvenance — 基线与 HEAD 同源', () => {
    it('gitHead 不符拒绝比较', () => {
        const result = checkProvenance({ gitHead: 'deadbeef' }, 'abc123');
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('deadbeef');
        expect(result.reason).toContain('abc123');
    });

    it('gitHead 一致通过；缺失 gitHead 也拒绝', () => {
        expect(checkProvenance({ gitHead: 'abc123' }, 'abc123').ok).toBe(true);
        expect(checkProvenance({ gitHead: '' }, 'abc123').ok).toBe(false);
    });
});

describe('evaluateProvenance — 自引用提交与陈旧数据', () => {
    it('gitHead 精确一致通过', () => {
        expect(evaluateProvenance({ baselineHead: 'abc', head: 'abc', isAncestor: false, sourcesChanged: true }).ok).toBe(true);
    });

    it('祖先后代且源码未变按同源处理（基线随门禁提交的自引用场景）', () => {
        const result = evaluateProvenance({ baselineHead: 'abc', head: 'def', isAncestor: true, sourcesChanged: false });
        expect(result.ok).toBe(true);
        expect(result.note).toContain('祖先');
    });

    it('祖先但源码已变拒绝比较（防陈旧数据）', () => {
        const result = evaluateProvenance({ baselineHead: 'abc', head: 'def', isAncestor: true, sourcesChanged: true });
        expect(result.ok).toBe(false);
        expect(result.code).toBe(2);
    });

    it('非祖先（如 deadbeef）拒绝比较', () => {
        const result = evaluateProvenance({ baselineHead: 'deadbeef', head: 'def', isAncestor: false, sourcesChanged: false });
        expect(result.ok).toBe(false);
        expect(result.code).toBe(2);
        expect(result.reason).toContain('deadbeef');
    });
});

describe('validateBaselineUpdate — note 与下调双确认', () => {
    const oldBaseline = { dirs: { ui: { lines: { pct: 20 } } } };
    const lower = { ui: { lines: { pct: 18 } } };
    const higher = { ui: { lines: { pct: 21 } } };

    it('note 为空直接拒绝', () => {
        const result = validateBaselineUpdate({ oldBaseline, current: higher, note: '  ', allowDecrease: false });
        expect(result.ok).toBe(false);
        expect(result.errors.join()).toContain('--note');
    });

    it('下调但没有 --allow-decrease 被拒绝', () => {
        const result = validateBaselineUpdate({ oldBaseline, current: lower, note: '测试下调', allowDecrease: false });
        expect(result.ok).toBe(false);
        expect(result.decreased).toEqual(['ui']);
        expect(result.errors.join()).toContain('--allow-decrease');
    });

    it('下调 + --allow-decrease + note 才通过', () => {
        const result = validateBaselineUpdate({ oldBaseline, current: lower, note: '测试下调', allowDecrease: true });
        expect(result.ok).toBe(true);
    });

    it('上调只需 note', () => {
        expect(validateBaselineUpdate({ oldBaseline, current: higher, note: '覆盖提升', allowDecrease: false }).ok).toBe(true);
    });
});

describe('工具函数', () => {
    it('toRelativePath 统一斜杠并剥离仓库根', () => {
        expect(toRelativePath('C:\\repo\\ui\\a.ts', 'C:\\repo')).toBe('ui/a.ts');
        expect(toRelativePath('/repo/ui/a.ts', '/repo')).toBe('ui/a.ts');
    });

    it('isInDir 只认路径段前缀', () => {
        expect(isInDir('ui/a.ts', 'ui')).toBe(true);
        expect(isInDir('ui/views/a.ts', 'ui')).toBe(true);
        expect(isInDir('ui-services/a.ts', 'ui')).toBe(false);
        expect(isInDir('uix.ts', 'ui')).toBe(false);
    });

    it('toBaselineDirs 保留四项计数与文件数', () => {
        const current = {
            ui: {
                dir: 'ui',
                files: 3,
                lines: metric(100, 50),
                statements: metric(100, 40),
                branches: metric(100, 30),
                functions: metric(100, 20),
            },
        };
        const dirs = toBaselineDirs(current) as Record<string, any>;
        expect(dirs.ui.files).toBe(3);
        for (const key of METRICS) {
            expect(dirs.ui[key].pct).toBeTypeOf('number');
            expect(dirs.ui[key].total).toBe(100);
        }
    });
});
