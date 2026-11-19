import { describe, expect, it } from 'vitest';
import {
    MODE_DOC_SPECS,
    modeDocKinds,
    modeDocPath,
    SCRIPT_CONTENT_ROOT,
    SHORT_CONTENT_ROOT,
} from '../../../shared/mode-content';
import { PRE_RESEARCH_MODE_DOC_FILES, preResearchDir, preResearchModeDocPath } from '../../../shared/pre-research';

/**
 * 模式文档路径单一真源（审计 B9 / C 清单 #11）。
 *
 * 历史问题：路径知识散在 `modeDocPath` 的 if 链与 `creation-flow-state.ts` 手写的
 * kinds 三元组，改名漏改一侧就静默把阶段判成「未完成」。现在两边都读
 * `MODE_DOC_SPECS` / `modeDocKinds`，本用例把这三处锁成一致。
 */
describe('MODE_DOC_SPECS 单一真源', () => {
    it('modeDocPath 与规格表逐条一致（短篇 2 份 / 剧本 3 份）', () => {
        for (const mode of ['short', 'script'] as const) {
            for (const spec of MODE_DOC_SPECS[mode]) {
                expect(modeDocPath('项目A', mode, spec.kind)).toBe(`项目A/${spec.dir}/${spec.file}`);
            }
        }
        expect(modeDocPath('项目A', 'short', 'storyCore')).toBe('项目A/短篇创作/01-故事核/故事核.md');
        expect(modeDocPath('项目A', 'script', 'storyboard')).toBe('项目A/剧本创作/04-分镜/分镜表.md');
    });

    it('modeDocKinds 覆盖规格表全部种类且长篇为空', () => {
        expect(modeDocKinds('short')).toEqual(MODE_DOC_SPECS.short.map(spec => spec.kind));
        expect(modeDocKinds('script')).toEqual(MODE_DOC_SPECS.script.map(spec => spec.kind));
        expect(modeDocKinds('long')).toEqual([]);
    });

    it('未知组合回落到 outline 文档（保持历史行为）', () => {
        expect(modeDocPath('项目A', 'short', 'bible')).toBe(modeDocPath('项目A', 'short', 'outline'));
        expect(modeDocPath('项目A', 'script', 'storyCore')).toBe(modeDocPath('项目A', 'script', 'outline'));
        expect(modeDocPath('项目A', 'long', 'outline')).toBe(modeDocPath('项目A', 'script', 'outline'));
    });

    it('调研定位稿与结构文档不撞路径（两套产物互不覆盖）', () => {
        for (const mode of ['long', 'short', 'script'] as const) {
            const positioning = preResearchModeDocPath('项目A', mode);
            expect(positioning.startsWith(preResearchDir('项目A') + '/')).toBe(true);
            expect(positioning.endsWith(PRE_RESEARCH_MODE_DOC_FILES[mode])).toBe(true);
            expect(positioning.includes(SHORT_CONTENT_ROOT)).toBe(false);
            expect(positioning.includes(SCRIPT_CONTENT_ROOT)).toBe(false);
        }
    });

    it('creation-flow-state 不再手写文档种类三元组', async () => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync('ui/full-writer/creation-flow-state.ts', 'utf8');
        expect(source).toContain('modeDocKinds(mode)');
        expect(source).not.toMatch(/\['bible', 'outline', 'storyboard'\]/);
        expect(source).not.toMatch(/\['storyCore', 'outline'\]/);
    });
});
