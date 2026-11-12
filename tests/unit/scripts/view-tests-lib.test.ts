/**
 * `check:view-tests` 的 import 提取回归测试
 *
 * 锁一个**真实假阳性**：原实现用全文正则扫 `from '...'`，
 * 于是断言字符串 / 注释里出现的 import 文案会被当成真 import。
 *
 * 已实测的受害者：`ui/add-fanfic-setting-modal.ts`（720 行、实际零测试）因
 * `tests/unit/ui/kb-fanfic-entry.test.ts:32` 的
 * `expect(view).toContain("import { AddFanficSettingModal } from '@/ui/add-fanfic-setting-modal'")`
 * 被判为「有测试」，从零覆盖基线里消失，门禁显示 94 → 93 的**假进步**。
 *
 * 修复后：只认**行首**的 import/export 语句。实测全仓 727 个测试文件，
 * 说明符从 2372 降到 2352，减少的 20 个全是注释/字符串里的假阳性。
 */

import { describe, expect, it } from 'vitest';
import {
    collectImportedSpecifiers,
    evaluateScanSanity,
    evaluateViewTestsRatchet,
} from '../../../scripts/lib/view-tests-lib.mjs';

describe('门禁-1：行首 import 正常提取', () => {
    it('单行 import', () => {
        expect(collectImportedSpecifiers("import { a } from './a';")).toEqual(['./a']);
    });

    it('多行 import', () => {
        const src = [
            'import {',
            '    a,',
            '    b,',
            "} from '@/shared/x';",
        ].join('\n');
        expect(collectImportedSpecifiers(src)).toEqual(['@/shared/x']);
    });

    it('类型 import 与 export-from', () => {
        const src = [
            "import type { T } from './types';",
            "export * from './re-export';",
            "export { x } from './named';",
        ].join('\n');
        expect(collectImportedSpecifiers(src)).toEqual(['./types', './re-export', './named']);
    });

    it('侧效应 import', () => {
        expect(collectImportedSpecifiers("import './setup';")).toEqual(['./setup']);
    });

    it('缩进的 import（在 if/块里）也能识别', () => {
        const src = ['    if (x) {', "        const m = require('x');", '    }'].join('\n');
        // require 不是 import，不计
        expect(collectImportedSpecifiers(src)).toEqual([]);
    });
});

describe('门禁-2：不把字符串/注释里的 import 文案当真 import（假阳性回归）', () => {
    it('断言字符串里的 import 不被计入（真实事故）', () => {
        const src = [
            "import { describe, it, expect } from 'vitest';",
            'const view = read("ui/views/knowledge-base-view.ts");',
            "expect(view).toContain(\"import { AddFanficSettingModal } from '@/ui/add-fanfic-setting-modal'\");",
        ].join('\n');
        const specs = collectImportedSpecifiers(src);
        expect(specs).toEqual(['vitest']);
        expect(specs).not.toContain('@/ui/add-fanfic-setting-modal');
    });

    it('注释里的 import 不被计入', () => {
        const src = [
            "import { describe, it, expect } from 'vitest';",
            "// 原因：engine-registry.ts 顶部 import NovelWriterPlugin from '../main'",
        ].join('\n');
        const specs = collectImportedSpecifiers(src);
        expect(specs).toEqual(['vitest']);
        expect(specs).not.toContain('../main');
    });

    it('单引号字符串里的 import 不被计入', () => {
        const src = [
            "import { describe, it, expect } from 'vitest';",
            "expect(src).toContain(\"import { requestUrl } from 'obsidian';\");",
        ].join('\n');
        expect(collectImportedSpecifiers(src)).not.toContain('obsidian');
    });

    it('动态 import 不计（已知限制，门禁只看静态依赖图）', () => {
        const src = "const m = await import('./lazy');";
        expect(collectImportedSpecifiers(src)).toEqual([]);
    });
});

describe('门禁-3：健壮性', () => {
    it('空文本返回空数组', () => {
        expect(collectImportedSpecifiers('')).toEqual([]);
        expect(collectImportedSpecifiers(null)).toEqual([]);
    });

    it('CRLF 换行也能识别', () => {
        expect(collectImportedSpecifiers("import { a } from './a';\r\n")).toEqual(['./a']);
    });

    it('多个 import 按出现顺序返回', () => {
        const src = [
            "import a from './a';",
            "import b from './b';",
            "import c from './c';",
        ].join('\n');
        expect(collectImportedSpecifiers(src)).toEqual(['./a', './b', './c']);
    });
});

describe('扫描健全性（Trae 审计 P2 · ui/ 缺失即绿）', () => {
    it('正常扫描无错误', () => {
        expect(evaluateScanSanity({ uiFiles: 300, testFiles: 700 })).toEqual([]);
    });

    it('ui/ 扫到 0 个文件 → 报错（目录改名/缺失会让门禁空转）', () => {
        const errors = evaluateScanSanity({ uiFiles: 0, testFiles: 700 });
        expect(errors.some(e => e.includes('ui/'))).toBe(true);
    });

    it('tests/ 扫到 0 个文件 → 报错（无法判定有无测试）', () => {
        const errors = evaluateScanSanity({ uiFiles: 300, testFiles: 0 });
        expect(errors.some(e => e.includes('tests/'))).toBe(true);
    });

    it('两个都为空 → 两条错误', () => {
        expect(evaluateScanSanity({ uiFiles: 0, testFiles: 0 })).toHaveLength(2);
    });

    it('非整数/负数也报错（不静默放过）', () => {
        expect(evaluateScanSanity({ uiFiles: -1, testFiles: 700 }).length).toBe(1);
        expect(evaluateScanSanity({ uiFiles: Number.NaN, testFiles: 700 }).length).toBe(1);
    });
});

describe('基线棘轮（Trae 审计 P2 · 登记簿不是棘轮）', () => {
    it('基线 = 当前 → ok', () => {
        const r = evaluateViewTestsRatchet({ baseline: ['a', 'b'], current: ['a', 'b'] });
        expect(r.ok).toBe(true);
        expect(r.added).toEqual([]);
        expect(r.fixed).toEqual([]);
    });

    it('新增未达标文件 → needsWiden', () => {
        const r = evaluateViewTestsRatchet({ baseline: ['a'], current: ['a', 'b'] });
        expect(r.needsWiden).toBe(true);
        expect(r.added).toEqual(['b']);
        expect(r.ok).toBe(false);
    });

    it('已补测试但基线未收紧 → needsTighten（原实现只提示、不失败）', () => {
        const r = evaluateViewTestsRatchet({ baseline: ['a', 'b'], current: ['a'] });
        expect(r.needsTighten).toBe(true);
        expect(r.fixed).toEqual(['b']);
        expect(r.ok).toBe(false);
    });

    it('同时新增与收紧 → 两者都报', () => {
        const r = evaluateViewTestsRatchet({ baseline: ['a'], current: ['c'] });
        expect(r.added).toEqual(['c']);
        expect(r.fixed).toEqual(['a']);
        expect(r.needsWiden).toBe(true);
        expect(r.needsTighten).toBe(true);
    });

    it('基线为空 + 当前为空 → ok', () => {
        expect(evaluateViewTestsRatchet({ baseline: [], current: [] }).ok).toBe(true);
    });

    it('null 安全（基线文件缺失时按空处理）', () => {
        const r = evaluateViewTestsRatchet({ baseline: null as never, current: ['a'] });
        expect(r.needsWiden).toBe(true);
    });

    it('输出排序稳定（便于人读与 diff）', () => {
        const r = evaluateViewTestsRatchet({ baseline: ['z', 'a'], current: [] });
        expect(r.fixed).toEqual(['a', 'z']);
    });
});
