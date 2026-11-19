/**
 * story-settings-i18n.test.ts — 故事结构展示层双语（缺口⑦ 第二期第36片）
 *
 * 第36片把「数据」和「显示」拆开：`structure.name`、`option.label`、`FIELD_LABELS`、
 * `getStoryOptionLabel()` 仍以中文参与 .project 持久化，界面另走 `story*` 显示函数。
 * 本测试锁四件事：
 * 1. zh 下显示函数与数据表逐字一致（零回归，界面与旧版一字不差）；
 * 2. en 下 5 结构 / 19 阶段 / 9 组 / 58 选项全部拿到译文，无键名回退、无中文残留；
 * 3. 缺省值与未知值有兜底（未选择 / 原样返回），不会渲染出 undefined；
 * 4. 校验提示与阶段摘要：提示随语言，摘要（数据层）恒中文，避免污染 .project。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';
import {
    STORY_OPTION_GROUPS,
    STORY_STRUCTURES,
    createDefaultStorySettings,
    getStructureStageSummary,
    storyOptionDescription,
    storyOptionGroupHint,
    storyOptionGroupLabel,
    storyOptionLabel,
    storySectionLabel,
    storyStageBeats,
    storyStageLabel,
    storyStagePurpose,
    storyStructureDescription,
    storyStructureLabel,
    storyStructureStageSummary,
    validateStorySettings,
} from '../../../shared/story-structure';

/** 中日韩统一表意文字，用来断言译文里没有残留中文 */
const CJK = /[\u4e00-\u9fff]/;

afterEach(() => {
    setLocale('zh-CN');
});

describe('故事结构显示层双语（第36片）', () => {
    it('zh：显示函数与数据表逐字一致', () => {
        setLocale('zh-CN');
        expect(storySectionLabel('核心设定')).toBe('核心设定');
        expect(storySectionLabel('风格与节奏')).toBe('风格与节奏');
        for (const structure of STORY_STRUCTURES) {
            expect(storyStructureLabel(structure.id)).toBe(structure.name);
            expect(storyStructureDescription(structure.id)).toBe(structure.description);
            structure.stages.forEach((stage, index) => {
                expect(storyStageLabel(structure.id, index)).toBe(stage.name);
                expect(storyStagePurpose(structure.id, index)).toBe(stage.purpose);
                expect(storyStageBeats(structure.id, index)).toBe(stage.beats.join('、'));
            });
        }
        for (const group of STORY_OPTION_GROUPS) {
            expect(storyOptionGroupLabel(group.key)).toBe(group.label);
            expect(storyOptionGroupHint(group.key)).toBe(group.hint);
            for (const option of group.options) {
                expect(storyOptionLabel(group.key, option.id)).toBe(option.label);
                expect(storyOptionDescription(group.key, option.id)).toBe(option.description || '');
            }
        }
    });

    it('en：5 结构 / 19 阶段 / 9 组 / 58 选项全部有译文且无中文', () => {
        setLocale('en-US');
        expect(STORY_STRUCTURES).toHaveLength(5);
        expect(STORY_OPTION_GROUPS).toHaveLength(9);
        const stageTotal = STORY_STRUCTURES.reduce((sum, s) => sum + s.stages.length, 0);
        expect(stageTotal).toBe(19);

        let optionTotal = 0;
        for (const structure of STORY_STRUCTURES) {
            const label = storyStructureLabel(structure.id);
            const description = storyStructureDescription(structure.id);
            expect(label).not.toBe(`story.structure.${structure.id}.name`);
            expect(description).not.toBe(`story.structure.${structure.id}.desc`);
            expect(CJK.test(label)).toBe(false);
            expect(CJK.test(description)).toBe(false);
            structure.stages.forEach((stage, index) => {
                const stageName = storyStageLabel(structure.id, index);
                const purpose = storyStagePurpose(structure.id, index);
                const beats = storyStageBeats(structure.id, index);
                for (const value of [stageName, purpose, beats]) {
                    expect(value).not.toMatch(/^story\./);
                    expect(CJK.test(value)).toBe(false);
                }
                expect(purpose).not.toBe(stage.purpose);
            });
        }

        for (const group of STORY_OPTION_GROUPS) {
            const groupLabel = storyOptionGroupLabel(group.key);
            expect(groupLabel).not.toMatch(/^story\./);
            expect(CJK.test(groupLabel)).toBe(false);
            expect(CJK.test(storyOptionGroupHint(group.key))).toBe(false);
            for (const option of group.options) {
                optionTotal += 1;
                const label = storyOptionLabel(group.key, option.id);
                expect(label).not.toMatch(/^story\./);
                expect(CJK.test(label)).toBe(false);
                expect(label).not.toBe(option.label);
                const description = storyOptionDescription(group.key, option.id);
                if (option.description) {
                    expect(description).not.toMatch(/^story\./);
                    expect(CJK.test(description)).toBe(false);
                } else {
                    expect(description).toBe('');
                }
            }
        }
        expect(optionTotal).toBe(58);
    });

    it('缺省值与未知值有兜底', () => {
        setLocale('zh-CN');
        expect(storyOptionLabel('protagonistStart', '')).toBe('未选择');
        expect(storyOptionLabel('protagonistStart', '不存在的选项')).toBe('不存在的选项');
        expect(storyOptionDescription('protagonistStart', '不存在的选项')).toBe('');

        setLocale('en-US');
        expect(storyOptionLabel('protagonistStart', '')).toBe('Not selected');
    });

    it('阶段摘要：显示层随语言，数据层恒中文', () => {
        setLocale('en-US');
        expect(CJK.test(storyStructureStageSummary('qichengzhuanhe'))).toBe(false);
        expect(storyStructureStageSummary('three_act')).toContain('25%');
        // getStructureStageSummary 会写进创作模式指南与提示词，必须保持数据层中文
        expect(getStructureStageSummary('three_act')).toContain('第一幕');
    });

    it('校验提示随语言切换', () => {
        const settings = { ...createDefaultStorySettings(), powerSystem: '科技', goldenFinger: '血脉' };

        setLocale('zh-CN');
        const zhIssues = validateStorySettings(settings);
        expect(zhIssues.length).toBeGreaterThan(0);
        expect(zhIssues.some(issue => issue.includes('科技'))).toBe(true);

        setLocale('en-US');
        const enIssues = validateStorySettings(settings);
        expect(enIssues).toHaveLength(zhIssues.length);
        for (const issue of enIssues) {
            expect(issue).not.toMatch(/^story\./);
            expect(CJK.test(issue)).toBe(false);
        }
    });
});

/**
 * 表单与弹窗的静态断言：界面文案全部走 t()，代码里不再有写死中文。
 * 渲染块交给实机截图（见 docs/modules/i18n.md 第36片验收表）。
 */
const ROOT = resolve(process.cwd());
const FORM = readFileSync(resolve(ROOT, 'ui/story-settings-form.ts'), 'utf8');
const MODAL = readFileSync(resolve(ROOT, 'ui/story-settings-modal.ts'), 'utf8');

/** 去掉注释行后再扫，避免中文注释误报 */
function codeLines(source: string): Array<{ no: number; text: string }> {
    return source.split(/\r?\n/)
        .map((text, i) => ({ no: i + 1, text }))
        .filter(({ text }) => {
            const trimmed = text.trim();
            return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
        });
}

describe('故事结构界面静态检查（第36片）', () => {
    it('表单与弹窗没有写死的界面中文（text / placeholder / title）', () => {
        const offenders = [...codeLines(FORM), ...codeLines(MODAL)]
            .filter(({ text }) => /(?:text|placeholder|title):\s*'/.test(text) && CJK.test(text))
            .map(({ no, text }) => no + ': ' + text.trim());
        expect(offenders).toEqual([]);
    });

    it('弹窗标题、说明与 Notice 走 t()', () => {
        expect(MODAL).toMatch(/t\('story\.modal\.title'\)/);
        expect(MODAL).toMatch(/t\('story\.modal\.desc'/);
        expect(MODAL).toMatch(/t\('story\.modal\.saved'/);
        expect(MODAL).toMatch(/t\('story\.modal\.saveFailed'/);
    });

    it('代码用到的每个 story.* 键在中英资源里都能解析', () => {
        const used = new Set<string>();
        for (const source of [FORM, MODAL]) {
            for (const m of source.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
        }
        expect(used.size).toBeGreaterThan(10);
        const missing = [...used].filter(key => !hasMessage(key) || translate('en-US', key) === key);
        expect(missing).toEqual([]);
    });
});

