/**
 * standard-map-lib — 开发规矩文档 ↔ 门禁脚本 完整性校验（2026-11-28）
 *
 * 背景：本仓历史上出现过「文档承诺了门禁但门禁并不校验」（docs/README 声称新增文档
 * 必须登记否则失败，实际只校验 handbook/adr/glossary），也出现过规矩散落多份文档
 * 互相矛盾（audits 被声明为历史只读，却又被要求随码更新）。
 * 该 lib 把「规矩文档与门禁双向完整」变成可机械判定的规则。
 */
import { describe, expect, it } from 'vitest';
import {
    REQUIRED_SECTIONS,
    collectGateScripts,
    parseGateTable,
    extractDefinedRules,
    findMissingSections,
    diffGateMapping,
} from '../../../scripts/lib/standard-map-lib.mjs';

describe('collectGateScripts — 哪些脚本算准入门禁', () => {
    it('收 check* 与核心命令，忽略其它脚本', () => {
        const gates = collectGateScripts({
            'check:deps': 'x',
            'check-engines': 'x',
            'check:release:remote': 'x',
            typecheck: 'x',
            lint: 'x',
            test: 'x',
            build: 'x',
            dev: 'x',
            'gen:docs': 'x',
            'preflight': 'x',
        });
        expect(gates).toEqual([
            'build', 'check-engines', 'check:deps', 'check:release:remote',
            'lint', 'test', 'typecheck',
        ]);
    });

    it('空输入不崩', () => {
        expect(collectGateScripts({})).toEqual([]);
        expect(collectGateScripts(undefined)).toEqual([]);
    });
});

describe('parseGateTable — 门禁表解析', () => {
    it('解析门禁 + 规则 ID + 时机', () => {
        const md = [
            '| 门禁 | 守的规矩 | 时机 |',
            '|---|---|---|',
            '| `check:deps` | R-A1 分层不反向依赖 | 提交前 |',
            '| `check:docs` | R-O1/R-O2 文档索引 | 提交前 |',
        ].join('\n');
        const rows = parseGateTable(md);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ gate: 'check:deps', rules: ['R-A1'], timing: '提交前' });
        expect(rows[1].rules).toEqual(['R-O1', 'R-O2']);
    });

    it('忽略非门禁表格行（首列不是反引号脚本名）', () => {
        const md = [
            '| `some-file.ts` | R-A1 | 提交前 |',
            '| `dev` | R-A1 | 按需 |',
        ].join('\n');
        expect(parseGateTable(md)).toEqual([]);
    });

    it('表头分隔行不被误认为数据', () => {
        const md = '| `门禁` | 规矩 | 时机 |\n|---|---|---|';
        expect(parseGateTable(md)).toEqual([]);
    });
});

describe('extractDefinedRules — 规则定义收集', () => {
    it('收集首列为 R-XX 的表格行', () => {
        const md = [
            '| ID | 规则 | 强制方式 |',
            '|---|---|---|',
            '| R-D1 | 正文只经 body-writer | 门禁 |',
            '| R-L2 | 计数必须守恒 | 人工评审 |',
            '| 其它 | 不是规则行 | — |',
        ].join('\n');
        expect(extractDefinedRules(md)).toEqual(['R-D1', 'R-L2']);
    });
});

describe('findMissingSections — 章节骨架', () => {
    it('骨架齐全时无缺失', () => {
        const md = REQUIRED_SECTIONS.map((k) => `## ${k}`).join('\n');
        expect(findMissingSections(md)).toEqual([]);
    });

    it('被削薄时报出缺失章节（防止空壳文档）', () => {
        const missing = findMissingSections('## 元规则\n随便写点');
        expect(missing).toContain('规矩清单');
        expect(missing).toContain('验收标准');
        expect(missing).not.toContain('元规则');
    });
});

describe('diffGateMapping — 双向完整 + 规则引用', () => {
    const docRows = [
        { gate: 'check:deps', rules: ['R-A1'], timing: '提交前' },
        { gate: 'check:docs', rules: ['R-O1'], timing: '提交前' },
    ];

    it('完整时无差异', () => {
        const r = diffGateMapping({
            pkgGates: ['check:docs', 'check:deps'],
            docRows,
            definedRules: ['R-A1', 'R-O1'],
        });
        expect(r.missingInDoc).toEqual([]);
        expect(r.missingInPkg).toEqual([]);
        expect(r.unknownRules).toEqual([]);
    });

    it('漏登记门禁 → missingInDoc（新增门禁必须登记规矩归属）', () => {
        const r = diffGateMapping({
            pkgGates: ['check:docs', 'check:deps', 'check:new-gate'],
            docRows,
            definedRules: ['R-A1', 'R-O1'],
        });
        expect(r.missingInDoc).toEqual(['check:new-gate']);
    });

    it('幽灵门禁 → missingInPkg', () => {
        const r = diffGateMapping({
            pkgGates: ['check:deps'],
            docRows,
            definedRules: ['R-A1', 'R-O1'],
        });
        expect(r.missingInPkg).toEqual(['check:docs']);
    });

    it('引用未定义规则 → unknownRules（拼写漂移）', () => {
        const r = diffGateMapping({
            pkgGates: ['check:deps'],
            docRows: [{ gate: 'check:deps', rules: ['R-A9'], timing: '提交前' }],
            definedRules: ['R-A1'],
        });
        expect(r.unknownRules).toEqual([{ gate: 'check:deps', rule: 'R-A9' }]);
    });

    it('exempt 列表可豁免明确不登记的门禁', () => {
        const r = diffGateMapping({
            pkgGates: ['check:deps', 'check:dev-only'],
            docRows,
            definedRules: ['R-A1', 'R-O1'],
            exemptGateScripts: ['check:dev-only'],
        });
        expect(r.missingInDoc).toEqual([]);
    });

    it('定义了但门禁表未引用 → 只报告（可能是纯人工评审规矩）', () => {
        const r = diffGateMapping({
            pkgGates: ['check:deps', 'check:docs'],
            docRows,
            definedRules: ['R-A1', 'R-O1', 'R-D2'],
        });
        expect(r.undocumentedRulesInTable).toEqual(['R-D2']);
    });
});
