/**
 * 命令执行体门禁单测
 *
 * 缘起（2026-11-13 实踩）：一致性审核命令「显示已执行」但什么也没发生——
 * `exec(id)` 依赖 registry 里已有执行体，缺失时**完全静默**。
 * 本门禁要能稳定抓出这种缺失，且不能误报正常写法。
 */

import { describe, expect, it } from 'vitest';
import {
    collectExecUsedIds,
    collectExecutorCases,
    collectRegisteredIds,
    evaluateCommandHandlers,
    findMissingHandlers,
} from '../../../scripts/lib/command-handlers-lib.mjs';

describe('解析：exec 使用方', () => {
    it('抽取 exec(...) 与 execGuarded(...)', () => {
        const src = [
            "addCommand({ id: CommandIds.A, callback: exec(CommandIds.A) });",
            "addCommand({ id: CommandIds.B, callback: execGuarded(CommandIds.B, LONG_ONLY) });",
        ].join('\n');
        expect(collectExecUsedIds(src)).toEqual(['A', 'B']);
    });

    it('去重且保持顺序', () => {
        const src = 'exec(CommandIds.A); exec(CommandIds.A); exec(CommandIds.B)';
        expect(collectExecUsedIds(src)).toEqual(['A', 'B']);
    });

    it('空源码返回空', () => {
        expect(collectExecUsedIds('')).toEqual([]);
    });
});

describe('解析：注册方（两种写法都要认）', () => {
    it('直连 r.register(CommandIds.X)', () => {
        const src = 'r.register(CommandIds.X, async () => {});';
        expect(collectRegisteredIds(src).direct.has('X')).toBe(true);
    });

    it('内联数组 for (const id of [ ... ]) { r.register(id, ...) }', () => {
        const src = [
            'for (const id of [',
            '    CommandIds.A,',
            '    CommandIds.B,',
            ']) {',
            '    r.register(id, async () => {});',
            '}',
        ].join('\n');
        const { uiListed } = collectRegisteredIds(src);
        expect(uiListed.has('A')).toBe(true);
        expect(uiListed.has('B')).toBe(true);
    });

    it('变量数组 for (const id of uiCommandIds) —— 最容易漏的写法', () => {
        const src = [
            'const uiCommandIds: string[] = [',
            '    CommandIds.A,',
            '    CommandIds.B,',
            '];',
            'for (const id of uiCommandIds) {',
            '    r.register(id, async () => {});',
            '}',
        ].join('\n');
        const { uiListed } = collectRegisteredIds(src);
        expect(uiListed.has('A')).toBe(true);
        expect(uiListed.has('B')).toBe(true);
    });
});

describe('解析：执行器分支', () => {
    it('抽取 case CommandIds.X:', () => {
        expect([...collectExecutorCases('case CommandIds.A:\ncase CommandIds.B:')]).toEqual(['A', 'B']);
    });
});

describe('判定：会静默失效的命令必须被抓出来', () => {
    it('**只有执行器分支、没有注册 → 缺失**（不能因为 case 存在就放行）', () => {
        const missing = findMissingHandlers({
            execUsed: ['A'],
            registered: { direct: new Set(), uiListed: new Set() },
            executorCases: new Set(['A']),
        });
        expect(missing).toHaveLength(1);
        expect(missing[0]).toContain('无 r.register');
    });

    it('**走 UI 列表但没有 case 分支 → 缺失**', () => {
        const missing = findMissingHandlers({
            execUsed: ['A'],
            registered: { direct: new Set(), uiListed: new Set(['A']) },
            executorCases: new Set(),
        });
        expect(missing).toHaveLength(1);
        expect(missing[0]).toContain('无 case 分支');
    });

    it('直连注册即可（不需要 case）', () => {
        expect(findMissingHandlers({
            execUsed: ['A'],
            registered: { direct: new Set(['A']), uiListed: new Set() },
            executorCases: new Set(),
        })).toHaveLength(0);
    });

    it('UI 列表 + case 都有 → 通过', () => {
        expect(findMissingHandlers({
            execUsed: ['A'],
            registered: { direct: new Set(), uiListed: new Set(['A']) },
            executorCases: new Set(['A']),
        })).toHaveLength(0);
    });
});

describe('判定：量具自检', () => {
    it('解析不到任何 exec 命令 → 判定失败（防止正则失效后永远绿）', () => {
        const verdict = evaluateCommandHandlers({
            execUsed: [],
            registered: { direct: new Set(), uiListed: new Set() },
            executorCases: new Set(),
        });
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toContain('解析规则可能失效');
    });

    it('全部覆盖 → ok', () => {
        const verdict = evaluateCommandHandlers({
            execUsed: ['A', 'B'],
            registered: { direct: new Set(['A']), uiListed: new Set(['B']) },
            executorCases: new Set(['B']),
        });
        expect(verdict.ok).toBe(true);
        expect(verdict.missing).toHaveLength(0);
    });
});
