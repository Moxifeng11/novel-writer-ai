/**
 * full-writer-status-i18n.test.ts — 写作主流程状态栏 / 向导残留文案双语（缺口⑦ 第二期第37片）
 *
 * 第37片把两处仍写死中文的界面文案迁到资源：
 * 1. `ui/full-writer/status-bar-controller.ts`（上下文占用、步骤、进度、token、场景节奏、叙事结构）；
 * 2. `ui/full-writer/wizard-step-renderers.ts` 的窗口标题/统计行/说明段。
 * 数据键（同人字段名、vault 目录、正则）保持中文，本测试只锁界面侧。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, translate } from '../../../i18n';
import { storyStructureLabel } from '../../../shared/story-structure';

const CJK = /[\u4e00-\u9fff]/;

const STATUS_KEYS = [
    'contextLoaded',
    'contextUnloaded',
    'currentStep',
    'progress',
    'bodyTokens',
    'context',
    'contextBudgetTitle',
    'sceneBattle',
    'sceneEmotional',
    'sceneDialogue',
    'rhythmDefault',
    'rhythmTitle',
    'rhythmFallback',
    'structure',
    'structureTitle',
    'unset',
];

const WIZ_KEYS = [
    'settingLibIntro',
    'settingLibTitle',
    'styleTitle',
    'worldviewTitle',
    'projectNameLine',
    'statWorldview',
    'statCharacters',
    'statLocations',
    'statFactions',
    'statItems',
    'statVolumes',
    'statChapters',
];

afterEach(() => {
    setLocale('zh-CN');
});

describe('写作主流程状态栏双语（第37片）', () => {
    it('zh：插值文案与旧版逐字一致', () => {
        setLocale('zh-CN');
        expect(translate('zh-CN', 'fullwriter.statusBar.currentStep', { label: '正文生成' })).toBe('当前步骤: 正文生成');
        expect(translate('zh-CN', 'fullwriter.statusBar.progress', { done: 3, total: 7 })).toBe('进度: 3/7');
        expect(translate('zh-CN', 'fullwriter.statusBar.context', { count: '1,024', pct: 12 })).toBe('上下文: ~1,024t (12%)');
        expect(translate('zh-CN', 'fullwriter.statusBar.structureTitle')).toBe('切换本章后续生成使用的叙事结构；已生成内容不会自动改写');
        expect(translate('zh-CN', 'cowrite.wiz.projectNameLine', { name: '测试项目' })).toBe('项目名称: 测试项目');
    });

    it('en：状态栏 16 键全部有译文且无中文残留', () => {
        setLocale('en-US');
        for (const key of STATUS_KEYS) {
            const text = translate('en-US', `fullwriter.statusBar.${key}`, { label: 'Draft', done: 1, total: 2, count: '10', pct: 5, used: 1, max: 2, value: 'x' });
            expect(text, key).not.toContain('fullwriter.statusBar');
            expect(CJK.test(text), key).toBe(false);
        }
        expect(translate('en-US', 'fullwriter.statusBar.currentStep', { label: 'Draft' })).toBe('Step: Draft');
    });

    it('en：向导残留 12 键全部有译文且无中文残留', () => {
        setLocale('en-US');
        for (const key of WIZ_KEYS) {
            const text = translate('en-US', `cowrite.wiz.${key}`, { name: 'Demo' });
            expect(text, key).not.toContain('cowrite.wiz');
            expect(CJK.test(text), key).toBe(false);
        }
    });

    it('叙事结构下拉走显示函数：zh 与旧数据名一致，en 出译名', () => {
        setLocale('zh-CN');
        expect(storyStructureLabel('qichengzhuanhe')).toBe('起承转合');
        setLocale('en-US');
        expect(storyStructureLabel('qichengzhuanhe')).toBe('Four-part arc');
        const source = readFileSync(resolve(__dirname, '../../../ui/full-writer/status-bar-controller.ts'), 'utf8');
        expect(source).toContain('storyStructureLabel(structure.id)');
    });

    it('源码：两个文件都不再有无参数的写死中文界面文案', () => {
        const files = ['ui/full-writer/status-bar-controller.ts', 'ui/full-writer/wizard-step-renderers.ts'];
        for (const file of files) {
            const source = readFileSync(resolve(__dirname, '../../../' + file), 'utf8');
            const offenders = source
                .split(/\r?\n/)
                .map((line, index) => ({ line: line.trim(), number: index + 1 }))
                .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
                .filter(({ line }) => CJK.test(line))
                .filter(({ line }) => /(?:text|label|title|placeholder):\s*'[^']*[\u4e00-\u9fff]/.test(line));
            expect(offenders, file).toEqual([]);
        }
    });
});
