/**
 * silent-failures-lib.test.ts — 「读失败当没有 / 写失败当成功」检测纯逻辑（DSH-20261113-26）
 *
 * 门禁把本轮 27 处静默失效的两个模式固化成可执行规则：
 *   A 读失败当没有：catch 返回 null/[]/{} 且在写上下文
 *   B 写失败当成功：catch 只 log（或空）且在写上下文
 * 本文件锁：两类模式命中/不命中、写上下文门槛、豁免（含空理由）、基线棘轮、空扫描。
 */
import { describe, expect, it } from 'vitest';
import {
    classifyCatchBody,
    collectSilentFailures,
    evaluateSilentFailures,
    isInWriteContext,
} from '../../../scripts/lib/silent-failures-lib.mjs';

describe('classifyCatchBody：模式判定', () => {
    it('A 读失败当没有：catch 返回 null → read-as-empty', () => {
        expect(classifyCatchBody('{ log.warn("x"); return null; }'))
            .toEqual({ silent: true, kind: 'read-as-empty' });
    });

    it('A 读失败当没有：catch 返回 [] / {} / undefined 都命中', () => {
        for (const empty of ['[]', '{}', 'undefined']) {
            expect(classifyCatchBody(`{ return ${empty}; }`))
                .toEqual({ silent: true, kind: 'read-as-empty' });
        }
    });

    it('B 写失败当成功：catch 只有 log → write-as-success', () => {
        expect(classifyCatchBody('{ log.warn("保存失败", e); }'))
            .toEqual({ silent: true, kind: 'write-as-success' });
    });

    it('B：空 catch 也算 write-as-success', () => {
        expect(classifyCatchBody('{}')).toEqual({ silent: true, kind: 'write-as-success' });
    });

    it('不命中：有可见出口/抛错/失败标志', () => {
        expect(classifyCatchBody('{ throw e; }').silent).toBe(false);
        expect(classifyCatchBody('{ log.warn("x"); ctx.hasPartialFailure = true; }').silent).toBe(false);
        expect(classifyCatchBody('{ log.warn("x"); markPostStepFailure(ctx, "x"); }').silent).toBe(false);
        expect(classifyCatchBody('{ new Notice("保存失败"); }').silent).toBe(false);
    });

    it('不命中：catch 里有实质逻辑（非仅日志）不判静默', () => {
        expect(classifyCatchBody('{ log.warn("x"); this.retryCount += 1; }').silent).toBe(false);
    });
});

describe('isInWriteContext：写上下文门槛', () => {
    it('邻近行含写动词 → true', () => {
        expect(isInWriteContext(['await this.getFS().write(path, content);', '} catch (e) {'], 1)).toBe(true);
        expect(isInWriteContext(['// 保存失败', '} catch (e) {'], 1)).toBe(true);
    });

    it('纯读上下文 → false（读路径降级合法）', () => {
        expect(isInWriteContext(['const x = await fs.read(path);', '} catch (e) {'], 1)).toBe(false);
    });

    it('超出窗口的写动词不算（避免整文件命中）', () => {
        const lines = ['write(a);', ...Array.from({ length: 30 }, () => '// filler'), '} catch (e) {'];
        expect(isInWriteContext(lines, lines.length - 1)).toBe(false);
    });
});

describe('collectSilentFailures：整文件扫描', () => {
    const WRITE_THEN_CATCH = [
        'async function saveConfig() {',
        '    try {',
        '        await write(path, data);',
        '    } catch (e) {',
        '        log.warn("保存失败", e);',
        '    }',
        '}',
    ].join('\n');

    it('写上下文里的 log-only catch → 命中（B）', () => {
        const found = collectSilentFailures(WRITE_THEN_CATCH);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ line: 4, kind: 'write-as-success', exempt: false });
    });

    it('同行 silent-ok 豁免（带理由）→ exempt', () => {
        const text = WRITE_THEN_CATCH.replace('} catch (e) {', '} catch (e) { // silent-ok: 清理临时文件失败可忽略');
        expect(collectSilentFailures(text)[0]).toMatchObject({ exempt: true });
    });

    it('上一行 silent-ok 也算豁免', () => {
        const text = WRITE_THEN_CATCH.replace('    } catch (e) {', '    // silent-ok: best-effort 缓存清理\n    } catch (e) {');
        expect(collectSilentFailures(text)[0]).toMatchObject({ exempt: true });
    });

    it('空理由的 silent-ok 不算豁免（防万能膏药）', () => {
        const text = WRITE_THEN_CATCH.replace('} catch (e) {', '} catch (e) { // silent-ok:');
        expect(collectSilentFailures(text)[0]).toMatchObject({ exempt: false });
    });

    it('读上下文里的 catch 不报（不误伤合法降级）', () => {
        const text = [
            'async function loadConfig() {',
            '    try {',
            '        return await read(path);',
            '    } catch (e) {',
            '        log.warn("读取失败", e);',
            '    }',
            '}',
        ].join('\n');
        expect(collectSilentFailures(text)).toHaveLength(0);
    });
});

describe('evaluateSilentFailures：基线棘轮', () => {
    const files = {
        'engine/a.ts': 'function save() { try { write(x); } catch (e) { log.warn("x"); } }',
        'engine/b.ts': 'function del() { try { delete2(x); } catch (e) { return null; } }',
        'engine/c.ts': 'function pure() { try { read(x); } catch (e) { } }',
    };

    it('统计违规与豁免，并按文件聚合', () => {
        const result = evaluateSilentFailures({ files, baseline: { total: 2, files: { 'engine/a.ts': 1, 'engine/b.ts': 1 } } });
        expect(result.total).toBe(2);
        expect(result.added).toEqual([]);
        expect(result.exempted).toBe(0);
    });

    it('新增违规 → added 非空（门禁会红）', () => {
        const result = evaluateSilentFailures({
            files: {
                ...files,
                'engine/d.ts': 'function persist() { try { write(x); } catch (e) { log.warn("x"); } }',
            },
            baseline: { total: 2, files: { 'engine/a.ts': 1, 'engine/b.ts': 1 } },
        });
        expect(result.added.map(v => v.path)).toEqual(['engine/d.ts']);
    });

    it('文件清零 → fixed 列出（提示可收紧基线）', () => {
        const result = evaluateSilentFailures({
            files: { 'engine/a.ts': files['engine/a.ts'] },
            baseline: { total: 2, files: { 'engine/a.ts': 1, 'engine/b.ts': 1 } },
        });
        expect(result.fixed).toEqual(['engine/b.ts']);
    });

    it('空输入 → total=0（由门禁的空扫描自检兜底）', () => {
        expect(evaluateSilentFailures({ files: {}, baseline: { total: 0, files: {} } }))
            .toMatchObject({ total: 0, added: [], exempted: 0 });
    });
});
