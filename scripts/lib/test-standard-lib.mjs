/**
 * test-standard-lib.mjs — 测试标准中「可机械校验」的部分
 *
 * 背景：2026-11-12 的对抗性审查发现，同人功能全线失效的**根因不在生产代码写错，
 * 而在测试替身不忠实**——`tests/__mocks__/obsidian.ts` 的 `getAbstractFileByPath`
 * 对点文件也返回 TFile，与真实 Obsidian 相反，于是测试「认证」了一个生产环境不可用的实现。
 *
 * 这类问题靠人记纪律必然会复发。本模块把测试标准里能机械判定的四条固化下来，
 * 由 `npm run check:test-standard` 在 preflight 里强制执行：
 *
 * 1. 不得提交 `.only(` —— 它会让其余用例静默不跑（CI 绿得毫无意义）
 * 2. `.skip(` 必须带 `skip-reason:` —— 无理由跳过等同于删除测试
 * 3. 不得写空断言（`expect(true).toBe(true)` 之类）—— 永远为真的测试不测任何东西
 * 4. 测试替身必须保留「点文件不在 vault 索引内」的忠实性守卫
 */

/** 测试替身忠实性守卫的标记（改动 mock 时必须保留） */
export const MOCK_FIDELITY_MARKER = '点文件（.project 等）不进入 vault 索引';

/**
 * 扫描一个测试文件的内容，返回违规列表。
 *
 * @param input - 输入
 * @param input.rel - 文件相对路径（用于报错）
 * @param input.text - 文件内容
 * @returns 违规列表
 */
export function scanTestFile({ rel, text }) {
    const violations = [];
    const lines = String(text ?? '').split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;

        // 规则 1：`.only(` 绝不允许提交
        if (/\.only\s*\(/.test(line)) {
            violations.push({
                rel,
                line: lineNo,
                rule: 'no-only',
                detail: '.only( 会让其余用例静默不跑，提交前必须移除',
            });
        }

        // 规则 2：`.skip(` 必须说明理由
        // 合法形态（第二参数必须是「理由」，不能是回调）：
        //   test.skip(cond, '理由字符串')
        //   test.skip(cond, describeSkipReason())
        //   test.describe.skip('标题')  —— 硬跳过整个套件，需附近 skip-reason: 注释
        if (/\.skip\s*\(/.test(line)) {
            const hasReasonArg = /\.skip\s*\(.*,\s*(['"`]|describeSkipReason\s*\(|skipReason\b)/.test(line);
            const window = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join('\n');
            const hasReasonComment = /skip-reason:|跳过原因[:：]/.test(window);
            if (!hasReasonArg && !hasReasonComment) {
                violations.push({
                    rel,
                    line: lineNo,
                    rule: 'skip-needs-reason',
                    detail: '.skip( 必须在第二个参数给出理由字符串/describeSkipReason()，或附近写 skip-reason: 注释',
                });
            }
        }

        // 规则 3：空断言
        if (/expect\s*\(\s*(true|1)\s*\)\s*\.\s*toBe\s*\(\s*(true|1)\s*\)/.test(line)
            || /expect\s*\(\s*(false|0)\s*\)\s*\.\s*toBe\s*\(\s*(false|0)\s*\)/.test(line)) {
            violations.push({
                rel,
                line: lineNo,
                rule: 'no-empty-assertion',
                detail: '空断言永远为真，不测任何行为',
            });
        }
    }

    return violations;
}

/**
 * 校验测试替身是否保留忠实性守卫。
 *
 * @param input - 输入
 * @param input.rel - 文件相对路径
 * @param input.text - 文件内容
 * @returns 违规列表
 */
export function checkMockFidelity({ rel, text }) {
    const content = String(text ?? '');
    if (!content.includes(MOCK_FIDELITY_MARKER)) {
        return [{
            rel,
            line: 0,
            rule: 'mock-fidelity',
            detail: `测试替身缺少忠实性守卫（应保留含「${MOCK_FIDELITY_MARKER}」的注释与点文件返回 null 的行为）。`
                + '去掉它会让「用 vault 索引 API 读 .project」这类缺陷在测试里重新变成绿的。',
        }];
    }
    // 守卫存在时，行为也必须在：点文件分支返回 null
    if (!/startsWith\('\.'\)\s*\)\s*return\s+null/.test(content)) {
        return [{
            rel,
            line: 0,
            rule: 'mock-fidelity',
            detail: '测试替身有守卫注释但没有「basename 以 . 开头 → return null」的实现',
        }];
    }
    return [];
}

/**
 * 汇总所有违规并生成摘要。
 *
 * @param violations - 违规列表
 * @returns 摘要
 */
export function summarizeViolations(violations) {
    const byRule = {};
    for (const item of violations) {
        byRule[item.rule] = (byRule[item.rule] ?? 0) + 1;
    }
    return { total: violations.length, byRule };
}
