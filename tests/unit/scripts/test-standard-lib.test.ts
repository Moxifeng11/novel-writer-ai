/**
 * 测试标准门禁的规则回归（docs/handbook/05-testing.md）
 *
 * 这些规则本身就是「防止测试标准漂移」的护栏，必须有测试锁住它们，
 * 否则改了正则把规则改松，门禁会静默变成摆设——正是本项目反复出现的缺陷类型。
 */

import { describe, expect, it } from 'vitest';
import {
    MOCK_FIDELITY_MARKER,
    checkMockFidelity,
    scanTestFile,
    summarizeViolations,
} from '../../../scripts/lib/test-standard-lib.mjs';

describe('测试标准-1：禁止 .only', () => {
    it('it.only / describe.only / test.only 都报错', () => {
        for (const line of [
            "it.only('只跑我', () => {});",
            "describe.only('只跑这组', () => {});",
            "test.only('e2e', async () => {});",
        ]) {
            const v = scanTestFile({ rel: 'x.test.ts', text: line });
            expect(v.some(item => item.rule === 'no-only'), line).toBe(true);
        }
    });

    it('普通用例不报错', () => {
        expect(scanTestFile({ rel: 'x.test.ts', text: "it('正常用例', () => {});" })).toEqual([]);
    });
});

describe('测试标准-2：skip 必须给理由', () => {
    it('第二个参数是理由字符串 → 通过', () => {
        const v = scanTestFile({
            rel: 'x.spec.ts',
            text: "test.skip(process.env.E2E_REAL_AI !== '1', '未设置 E2E_REAL_AI=1：会消耗 API 额度');",
        });
        expect(v).toEqual([]);
    });

    it('第二个参数是 describeSkipReason() → 通过', () => {
        const v = scanTestFile({
            rel: 'x.spec.ts',
            text: 'test.skip(!isObsidianE2EEnabled(), describeSkipReason());',
        });
        expect(v).toEqual([]);
    });

    it('硬跳过整个套件且无注释 → 报错（回调不是理由）', () => {
        const v = scanTestFile({
            rel: 'x.spec.ts',
            text: "test.describe.skip('项目创建功能', () => {",
        });
        expect(v.some(item => item.rule === 'skip-needs-reason')).toBe(true);
    });

    it('硬跳过但有 skip-reason 注释 → 通过', () => {
        const v = scanTestFile({
            rel: 'x.spec.ts',
            text: "// skip-reason: 浏览器无法加载 app://obsidian.md\ntest.describe.skip('项目创建功能', () => {",
        });
        expect(v).toEqual([]);
    });

    it('中文标题里的逗号不会被当成理由', () => {
        const v = scanTestFile({
            rel: 'x.spec.ts',
            text: "test.describe.skip('项目创建功能（浏览器模拟，已停用）', () => {",
        });
        expect(v.some(item => item.rule === 'skip-needs-reason')).toBe(true);
    });
});

describe('测试标准-3：禁止空断言', () => {
    it('expect(true).toBe(true) 报错', () => {
        expect(scanTestFile({ rel: 'x', text: 'expect(true).toBe(true);' })
            .some(item => item.rule === 'no-empty-assertion')).toBe(true);
    });

    it('expect(1).toBe(1) 报错', () => {
        expect(scanTestFile({ rel: 'x', text: 'expect(1).toBe(1);' })
            .some(item => item.rule === 'no-empty-assertion')).toBe(true);
    });

    it('真实断言不报错', () => {
        expect(scanTestFile({ rel: 'x', text: "expect(result.ok).toBe(true);" })).toEqual([]);
    });
});

describe('测试标准-4：测试替身忠实性', () => {
    it('缺守卫注释 → 报错', () => {
        const v = checkMockFidelity({ rel: 'tests/__mocks__/obsidian.ts', text: 'export class Vault {}' });
        expect(v.some(item => item.rule === 'mock-fidelity')).toBe(true);
    });

    it('有注释但没实现 → 报错', () => {
        const text = `// ${MOCK_FIDELITY_MARKER}\nexport class Vault {}`;
        const v = checkMockFidelity({ rel: 'tests/__mocks__/obsidian.ts', text });
        expect(v.some(item => item.detail.includes('没有'))).toBe(true);
    });

    it('注释与实现都在 → 通过', () => {
        const text = [
            `        // ${MOCK_FIDELITY_MARKER}`,
            '        const baseName = path.split(\'/\').pop() || \'\';',
            "        if (baseName.startsWith('.')) return null;",
        ].join('\n');
        expect(checkMockFidelity({ rel: 'tests/__mocks__/obsidian.ts', text })).toEqual([]);
    });
});

describe('测试标准-5：违规汇总', () => {
    it('按规则统计', () => {
        const s = summarizeViolations([
            { rel: 'a', line: 1, rule: 'no-only', detail: '' },
            { rel: 'b', line: 2, rule: 'no-only', detail: '' },
            { rel: 'c', line: 3, rule: 'no-empty-assertion', detail: '' },
        ]);
        expect(s.total).toBe(3);
        expect(s.byRule['no-only']).toBe(2);
        expect(s.byRule['no-empty-assertion']).toBe(1);
    });

    it('空列表', () => {
        expect(summarizeViolations([])).toEqual({ total: 0, byRule: {} });
    });
});
