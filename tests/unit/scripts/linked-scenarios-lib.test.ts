/**
 * 联动场景锚点校验回归（Trae preflight 审计 P2 · 第 17 步）
 *
 * 原缺陷：锚点清单**内嵌在检查脚本里**，形成自证循环——
 * 文件搬家时把锚点从脚本删掉，检查就跟着消失，门禁永远绿。
 *
 * 修法：清单外置 JSON + 缺失/空/schema 失败 + 锚点总数下限棘轮 + 文档小节交叉校验。
 * 本文件锁住这些「防退化」语义，防止有人把外置清单又塞回脚本里。
 */

import { describe, expect, it } from 'vitest';
import {
    ANCHOR_FILE,
    countAnchors,
    evaluateAnchorFloor,
    evaluateAnchors,
    validateAnchorData,
    type LinkedScenarioAnchorData,
} from '../../../scripts/lib/linked-scenarios-lib.mjs';

/** 造一份合法锚点数据 */
function makeData(overrides: Partial<LinkedScenarioAnchorData> = {}): LinkedScenarioAnchorData {
    return {
        schemaVersion: 1,
        doc: 'docs/regression/LINKED-SCENARIOS.md',
        floor: 3,
        chains: {
            '链 1 · 甲': [
                { file: 'a.ts', text: 'exportA', why: '入口 A' },
                { file: 'b.ts', why: '入口 B' },
            ],
            '链 2 · 乙': [{ file: 'c.ts', text: 'exportC', why: '入口 C' }],
        },
        ...overrides,
    };
}

/** 假文件系统 */
function makeReader(files: Record<string, string>) {
    return (rel: string): string | null => (rel in files ? files[rel] : null);
}

const DOC_OK = '## 链 1：甲\n内容\n## 链 2：乙\n内容\n';
const FS_OK = {
    'docs/regression/LINKED-SCENARIOS.md': DOC_OK,
    'a.ts': 'export const exportA = 1;',
    'b.ts': 'whatever',
    'c.ts': 'export const exportC = 2;',
};

describe('锚点-1：清单外置（破自证循环）', () => {
    it('清单路径指向独立数据文件，不是脚本自身', () => {
        expect(ANCHOR_FILE).toBe('scripts/linked-scenarios.anchors.json');
        expect(ANCHOR_FILE).not.toContain('check-linked-scenarios.mjs');
    });
});

describe('锚点-2：结构校验（缺失/空/坏 schema 都要失败）', () => {
    it('合法数据无错误', () => {
        expect(validateAnchorData(makeData())).toEqual([]);
    });

    it('null / 非对象 → 报错', () => {
        expect(validateAnchorData(null).length).toBeGreaterThan(0);
        expect(validateAnchorData('字符串').length).toBeGreaterThan(0);
    });

    it('schemaVersion 不是 1 → 报错', () => {
        expect(validateAnchorData(makeData({ schemaVersion: 2 })).some(e => e.includes('schemaVersion'))).toBe(true);
    });

    it('缺 doc → 报错', () => {
        expect(validateAnchorData({ ...makeData(), doc: '' }).some(e => e.includes('doc'))).toBe(true);
    });

    it('floor 非正整数 → 报错', () => {
        expect(validateAnchorData({ ...makeData(), floor: 0 }).some(e => e.includes('floor'))).toBe(true);
        expect(validateAnchorData({ ...makeData(), floor: 1.5 }).some(e => e.includes('floor'))).toBe(true);
    });

    it('chains 为空 → 报错（删光了不能算通过）', () => {
        expect(validateAnchorData({ ...makeData(), chains: {} }).some(e => e.includes('为空'))).toBe(true);
    });

    it('某条链锚点列表为空 → 报错', () => {
        const data = makeData();
        data.chains['链 2 · 乙'] = [];
        expect(validateAnchorData(data).some(e => e.includes('锚点列表为空'))).toBe(true);
    });

    it('锚点缺 file → 报错', () => {
        const data = makeData();
        data.chains['链 1 · 甲'] = [{ file: '', why: 'x' } as never];
        expect(validateAnchorData(data).some(e => e.includes('缺少 file'))).toBe(true);
    });

    it('锚点 text 非字符串 → 报错', () => {
        const data = makeData();
        data.chains['链 1 · 甲'] = [{ file: 'a.ts', text: 123 as never }];
        expect(validateAnchorData(data).some(e => e.includes('必须是字符串'))).toBe(true);
    });
});

describe('锚点-3：总数与下限棘轮', () => {
    it('统计总数', () => {
        expect(countAnchors(makeData())).toBe(3);
        expect(countAnchors(null)).toBe(0);
    });

    it('低于下限 → 失败（删锚点必须显式下调）', () => {
        const r = evaluateAnchorFloor({ total: 34, floor: 35 });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('34');
        expect(r.reason).toContain('35');
        expect(r.reason).toContain('--update-floor');
    });

    it('等于下限 → 通过', () => {
        expect(evaluateAnchorFloor({ total: 35, floor: 35 }).ok).toBe(true);
    });

    it('高于下限 → 通过但提示可收紧', () => {
        const r = evaluateAnchorFloor({ total: 40, floor: 35 });
        expect(r.ok).toBe(true);
        expect(r.tighten).toBe(true);
    });

    it('floor 非法 → 失败（不静默放过）', () => {
        expect(evaluateAnchorFloor({ total: 5, floor: Number.NaN }).ok).toBe(false);
    });
});

describe('锚点-4：与文档/源码交叉校验', () => {
    it('全部有效 → 无问题', () => {
        const r = evaluateAnchors({ data: makeData(), readFile: makeReader(FS_OK) });
        expect(r.problems).toEqual([]);
        expect(r.checked).toBe(3);
        expect(r.chains).toBe(2);
        expect(r.files).toBe(3);
    });

    it('锚点文件不存在 → 报错', () => {
        const r = evaluateAnchors({
            data: makeData(),
            readFile: makeReader({ 'a.ts': 'exportA' }),
        });
        expect(r.problems.some(p => p.includes('b.ts') && p.includes('不存在'))).toBe(true);
        expect(r.problems.some(p => p.includes('c.ts') && p.includes('不存在'))).toBe(true);
    });

    it('锚点 text 不在文件里 → 报错', () => {
        const r = evaluateAnchors({
            data: makeData(),
            readFile: makeReader({ ...FS_OK, 'a.ts': '被改名了' }),
        });
        expect(r.problems.some(p => p.includes('不再包含'))).toBe(true);
    });

    it('文档缺失 → 报错（联动清单被删不能静默通过）', () => {
        const r = evaluateAnchors({
            data: makeData(),
            readFile: makeReader({ 'a.ts': 'exportA', 'b.ts': 'x', 'c.ts': 'exportC' }),
        });
        expect(r.problems.some(p => p.includes('LINKED-SCENARIOS.md') && p.includes('不存在'))).toBe(true);
    });

    it('文档缺某条链的小节 → 报错', () => {
        const r = evaluateAnchors({
            data: makeData(),
            readFile: makeReader({ ...FS_OK, 'docs/regression/LINKED-SCENARIOS.md': '## 链 1：甲\n' }),
        });
        expect(r.problems.some(p => p.includes('缺少「## 链 2：」'))).toBe(true);
    });

    it('链名缺编号 → 报错', () => {
        const data = makeData();
        data.chains['没有编号的链'] = [{ file: 'a.ts' }];
        const r = evaluateAnchors({ data, readFile: makeReader(FS_OK) });
        expect(r.problems.some(p => p.includes('缺少编号'))).toBe(true);
    });

    it('只有 file 没有 text 的锚点只校验存在性', () => {
        const r = evaluateAnchors({
            data: makeData({ chains: { '链 1 · 甲': [{ file: 'b.ts', why: '仅存在性' }] } }),
            readFile: makeReader({ ...FS_OK }),
        });
        expect(r.problems).toEqual([]);
        expect(r.checked).toBe(1);
    });
});
