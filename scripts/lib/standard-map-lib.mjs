/**
 * standard-map-lib.mjs — 开发规矩文档 ↔ 门禁脚本 双向完整性校验
 *
 * 规矩（docs/STANDARD.md §0.4）：规矩文档自己必须防腐——
 *  - package.json 里每个 check* 脚本必须登记在标准文档 §三 门禁表
 *  - 门禁表里写的每个脚本必须真实存在于 package.json
 *  - 标准文档必备章节骨架必须存在（防止被削成空壳）
 *  - §三 引用的规则 ID 必须在 §一 有定义（防拼写漂移）
 */

/** 标准文档必备章节（按顺序出现在文中即可，不要求相邻） */
export const REQUIRED_SECTIONS = [
    '元规则',
    '规矩清单',
    '验收标准',
    '门禁总表',
    '豁免机制',
];

/**
 * 从 package.json scripts 收集「需要登记的准入门禁」。
 *
 * 判定：名字以 check 开头（含 check:xxx 与 check-xxx），或属于核心命令
 * （typecheck / lint / test / build）。
 *
 * @param {Record<string, string>} scripts - package.json scripts
 * @returns {string[]} 去重排序后的脚本名
 * @example
 * collectGateScripts({ 'check:deps': '…', 'other': '…' }) // ['check:deps']
 */
export function collectGateScripts(scripts) {
    const out = new Set();
    for (const name of Object.keys(scripts || {})) {
        if (/^check/.test(name) || /^(typecheck|lint|test|build)$/.test(name)) out.add(name);
    }
    return [...out].sort();
}

/**
 * 解析标准文档 §三 门禁表。
 *
 * 行形态：| `门禁` | 守的规矩（R-xx …） | 时机 |
 *
 * @param {string} markdown - 文档全文
 * @returns {Array<{gate: string, rules: string[], timing: string}>}
 * @example
 * parseGateTable('| `check:deps` | R-A1 分层 | 提交前 |')
 * // [{ gate: 'check:deps', rules: ['R-A1'], timing: '提交前' }]
 */
export function parseGateTable(markdown) {
    const rows = [];
    for (const line of String(markdown || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < 2) continue;
        const gateMatch = cells[0].match(/^`([^`]+)`$/);
        if (!gateMatch) continue;
        const gate = gateMatch[1];
        // 只看像脚本名的首列（含 check 或核心命令），避免误吃普通表格
        if (!/^check/.test(gate) && !/^(typecheck|lint|test|build)$/.test(gate)) continue;
        rows.push({
            gate,
            rules: [...new Set([...cells[1].matchAll(/R-[A-Z]\d+/g)].map((m) => m[0]))],
            timing: cells[2] || '',
        });
    }
    return rows;
}

/**
 * 解析文档中定义的规则 ID（表格首列形如 `R-A1`）。
 *
 * @param {string} markdown - 文档全文
 * @returns {string[]} 去重排序后的规则 ID
 * @example
 * extractDefinedRules('| R-D1 | 正文只经 body-writer | 门禁 | 数据损坏 |') // ['R-D1']
 */
export function extractDefinedRules(markdown) {
    const ids = new Set();
    for (const line of String(markdown || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        const first = trimmed.split('|')[1]?.trim() ?? '';
        const m = first.match(/^R-[A-Z]\d+$/);
        if (m) ids.add(m[0]);
    }
    return [...ids].sort();
}

/**
 * 校验章节骨架。
 *
 * @param {string} markdown - 文档全文
 * @returns {string[]} 缺失的章节标题关键词
 */
export function findMissingSections(markdown) {
    const text = String(markdown || '');
    return REQUIRED_SECTIONS.filter((keyword) => {
        // 章节标题形如 `## 〇、元规则（…）`：要求出现以 # 开头且含关键词的行
        const re = new RegExp(`^#{1,3}\\s*[^\\n]*${keyword}`, 'm');
        return !re.test(text);
    });
}

/**
 * 计算双向差异与规则引用一致性。
 *
 * @param {object} input - 输入
 * @param {string[]} input.pkgGates - package.json 里的门禁脚本名
 * @param {Array<{gate: string, rules: string[]}>} input.docRows - 文档门禁表行
 * @param {string[]} input.definedRules - 文档 §一 定义的规则 ID
 * @param {string[]} [input.exemptGateScripts] - 明确不纳入门禁表的脚本（需文档说明）
 * @returns {{missingInDoc: string[], missingInPkg: string[], unknownRules: Array<{gate: string, rule: string}>, undocumentedRulesInTable: string[]}}
 */
export function diffGateMapping(input) {
    const exempt = new Set(input.exemptGateScripts || []);
    const docGates = new Set(input.docRows.map((r) => r.gate));
    const pkgGates = new Set(input.pkgGates);

    const missingInDoc = [...pkgGates].filter((g) => !docGates.has(g) && !exempt.has(g)).sort();
    const missingInPkg = [...docGates].filter((g) => !pkgGates.has(g)).sort();

    const defined = new Set(input.definedRules);
    const unknownRules = [];
    for (const row of input.docRows) {
        for (const rule of row.rules) {
            if (!defined.has(rule)) unknownRules.push({ gate: row.gate, rule });
        }
    }

    // 定义了但门禁表从未引用的规则（不一定是错，可能是纯人工评审规矩）
    const referenced = new Set(input.docRows.flatMap((r) => r.rules));
    const undocumentedRulesInTable = [...defined].filter((r) => !referenced.has(r)).sort();

    return { missingInDoc, missingInPkg, unknownRules, undocumentedRulesInTable };
}
