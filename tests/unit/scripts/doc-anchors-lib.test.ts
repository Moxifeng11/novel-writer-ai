/**
 * doc-anchors-lib —— 活文档锚点提取与校验（2026-11-28 固化规矩）
 *
 * 规矩：*-flow/*-map/*-reference/*-guide 是活文档，必须随码更新；
 * *-audit.md 等是历史快照，允许过期。行内 `<!-- anchor-ok: … -->` 豁免历史记述。
 */
import { describe, expect, it } from 'vitest';
import {
    isLivingDoc,
    extractPathAnchors,
    extractSettingsFieldAnchors,
    verifyAnchors,
} from '../../../scripts/lib/doc-anchors-lib.mjs';

describe('isLivingDoc — 活文档/快照区分', () => {
    it('flow/map/reference/guide 是活文档', () => {
        expect(isLivingDoc('2026-11-28-kb-deconstruction-flow.md')).toBe(true);
        expect(isLivingDoc('2026-11-28-settings-module-map.md')).toBe(true);
        expect(isLivingDoc('2026-11-25-contracts-reference.md')).toBe(true);
    });

    it('STANDARD.md 是活文档（规矩文档本身引用代码路径）', () => {
        expect(isLivingDoc('STANDARD.md')).toBe(true);
    });

    it('audit 与其它后缀是快照', () => {
        expect(isLivingDoc('2026-11-28-plugin-full-audit.md')).toBe(false);
        expect(isLivingDoc('2026-11-25-zhuque-criteria-correction.md')).toBe(false);
        expect(isLivingDoc('2026-11-20-interaction-and-module-flow.md')).toBe(true);
    });
});

describe('extractPathAnchors — 路径锚点', () => {
    it('提取反引号包裹的仓库代码路径', () => {
        const md = '入口在 `engine/deconstruction-scheduler.ts`，默认值在 `core/settings-service.ts`。';
        expect(extractPathAnchors(md)).toEqual(['engine/deconstruction-scheduler.ts', 'core/settings-service.ts']);
    });

    it('带 anchor-ok 豁免标记的行被跳过（历史记述）', () => {
        const md = [
            '- 现址：`shared/edit-history.ts` ✓',
            '- 旧址：`ui/co-writing/edit-history.ts` <!-- anchor-ok: 历史记述 -->',
        ].join('\n');
        expect(extractPathAnchors(md)).toEqual(['shared/edit-history.ts']);
    });

    it('忽略通配符与目录引用', () => {
        expect(extractPathAnchors('见 `engine/prompts/*.ts` 与 `docs/audits/`')).toEqual([]);
    });
});

describe('extractSettingsFieldAnchors — 设置字段锚点', () => {
    it('提取字段清单行（- `field`（默认）', () => {
        const md = '- `structuredChangeLines`（默认 false）— toggle — 结构化变更行';
        expect(extractSettingsFieldAnchors(md)).toContain('structuredChangeLines');
    });

    it('提取反查表行的 field(行号) 形态', () => {
        const md = '| step-runner | `wordMinRatio`(143)、`promptSplitRatio`(291) |';
        const r = extractSettingsFieldAnchors(md);
        expect(r).toContain('wordMinRatio');
        expect(r).toContain('promptSplitRatio');
    });

    it('不把纯函数名当设置字段（无行号后缀）', () => {
        expect(extractSettingsFieldAnchors('`resolveSemanticKeywords` 零调用方')).toEqual([]);
    });
});

describe('verifyAnchors — 校验', () => {
    it('缺失路径与字段如实上报', () => {
        const r = verifyAnchors(
            { paths: ['engine/exists.ts', 'engine/gone.ts'], fields: ['realField', 'ghostField'] },
            {
                fileExists: (p) => p === 'engine/exists.ts',
                repoText: 'realField: false,',
            },
        );
        expect(r.missingPaths).toEqual(['engine/gone.ts']);
        expect(r.missingFields).toEqual(['ghostField']);
    });
});
