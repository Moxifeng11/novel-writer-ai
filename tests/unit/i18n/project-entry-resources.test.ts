/**
 * project-entry-resources.test.ts — 项目入口三件套双语（缺口⑦ 第二期第38片）
 *
 * 第38片迁三类文案：
 * 1. \`ui/home-view.ts\`（创作主页）→ \`home.*\` 36 键；
 * 2. \`ui/mode-document-modal.ts\`（模式文档弹窗）→ \`modeDoc.*\` 27 键，模块常量 TITLES/DESCRIPTIONS 改键函数；
 * 3. \`ui/pre-research-modal.ts\` 残留 → \`preResearch.hint.*\` 8 + \`.msg.*\` 19 键。
 *
 * 另锁 \`shared/creation-mode.ts\` 的三个**界面**显示函数（\`getCreationModeLabel\` 不动，它喂提示词与落盘口径）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { hasMessage, setLocale, translate } from '../../../i18n';
import {
    creationModeDisplayDescription,
    creationModeDisplayName,
    creationUnitDisplayLabel,
} from '../../../shared/creation-mode';

const CJK = /[\u4e00-\u9fff]/;

const HOME_KEYS = [
    'viewTitle', 'heroTitle', 'heroWithProjects', 'heroRunning', 'heroEmpty', 'jobCenter', 'jobCenterCount',
    'projectHealth', 'assetRegistry', 'planningCanvas', 'memoryGraph', 'usageLedger', 'backupCenter',
    'onboarding', 'start', 'modeMeta', 'modeMetaEmpty', 'enterMode', 'createMode', 'nextStep', 'needKeyTitle',
    'needKeyDesc', 'goSettings', 'noProjectTitle', 'noProjectDesc', 'importExample', 'newLong', 'continueTitle',
    'continueDesc', 'openFlow', 'handToAgent', 'recent', 'emptyTitle', 'emptyDesc', 'legacyProject', 'open',
];

const MODE_DOC_KEYS = [
    'fallbackTitle', 'titleStoryCore', 'titleOutlineShort', 'titleBible', 'titleOutlineScript', 'titleStoryboard',
    'descStoryCore', 'descOutline', 'descBible', 'descStoryboard', 'contentUnsupported', 'modeMismatch', 'savePath',
    'placeholder', 'instructionPlaceholder', 'generate', 'generating', 'save', 'overwriteTitle', 'overwriteDesc',
    'overwriteWarning', 'overwriteConfirm', 'generatedNotice', 'savedNotice', 'readFailedTitle',
    'generateFailedTitle', 'saveFailedTitle',
];

const PRE_RESEARCH_HINT_KEYS = [
    'categoryPlaceholder', 'genrePlaceholder', 'targetWordsShort', 'targetSectionsShort', 'targetWordsScript',
    'targetEpisodesScript', 'episodeSecondsScript', 'paywallEpisodeScript',
];

const PRE_RESEARCH_MSG_KEYS = [
    'needCategoryBeforeResearch', 'sourceVerified', 'sourceDraft', 'researchDone', 'researchDoneNotice',
    'researchFailed', 'appliedCandidate', 'applyCandidate', 'wrongMode', 'needProjectName', 'needShortCategory',
    'needScriptGenre', 'wordsRange', 'sectionsRange', 'episodesRange', 'secondsRange', 'paywallRange',
    'projectCreated',
];

afterEach(() => {
    setLocale('zh-CN');
});

describe('第38片：资源覆盖（zh / en 同集）', () => {
    it('三类资源在两种语言下都能解析，且不自回落成键名', () => {
        const keys = [
            ...HOME_KEYS.map(key => 'home.' + key),
            ...MODE_DOC_KEYS.map(key => 'modeDoc.' + key),
            ...PRE_RESEARCH_HINT_KEYS.map(key => 'preResearch.hint.' + key),
            ...PRE_RESEARCH_MSG_KEYS.map(key => 'preResearch.msg.' + key),
            ...['label.long', 'label.short', 'label.script', 'desc.long', 'desc.short', 'desc.script',
                'unit.long', 'unit.short', 'unit.script'].map(key => 'creationMode.' + key),
        ];
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const key of keys) {
                expect(hasMessage(key), locale + ' 缺键 ' + key).toBe(true);
                const value = translate(locale, key);
                expect(value, locale + ' 回落到键名 ' + key).not.toBe(key);
                expect(value.trim().length, locale + ' 空值 ' + key).toBeGreaterThan(0);
            }
        }
    });

    it('en 下四组界面文案零中文（数据类占位符除外，本组无占位符数据）', () => {
        const enKeys = [
            ...HOME_KEYS.map(key => 'home.' + key),
            ...MODE_DOC_KEYS.map(key => 'modeDoc.' + key),
            ...PRE_RESEARCH_HINT_KEYS.map(key => 'preResearch.hint.' + key),
            ...PRE_RESEARCH_MSG_KEYS.map(key => 'preResearch.msg.' + key),
            ...['label.long', 'label.short', 'label.script', 'desc.long', 'desc.short', 'desc.script',
                'unit.long', 'unit.short', 'unit.script'].map(key => 'creationMode.' + key),
        ];
        for (const key of enKeys) {
            expect(translate('en-US', key), key).not.toMatch(CJK);
        }
    });
});

describe('第38片：zh 逐字（零回归）', () => {
    it('主页 hero 两种组合与模式卡元信息', () => {
        expect(translate('zh-CN', 'home.heroWithProjects', { count: 2, extra: '' })).toBe('已有 2 个项目。');
        expect(translate('zh-CN', 'home.heroWithProjects', { count: 2, extra: translate('zh-CN', 'home.heroRunning', { count: 1 }) }))
            .toBe('已有 2 个项目，1 个任务进行中。');
        expect(translate('zh-CN', 'home.modeMeta', { count: 3, unit: '节' })).toBe('3 个项目 · 单元「节」');
        expect(translate('zh-CN', 'home.modeMetaEmpty', { mode: '短篇小说' })).toBe('还没有短篇小说项目');
        expect(translate('zh-CN', 'home.jobCenterCount', { count: 4 })).toBe('🧵 任务中心（4）');
        expect(translate('zh-CN', 'home.continueTitle', { name: '示例项目' })).toBe('继续《示例项目》');
    });

    it('模式文档标题四类按 mode/kind 分派（常量改函数的落点）', () => {
        expect(translate('zh-CN', 'modeDoc.titleStoryCore')).toBe('📖 故事核');
        expect(translate('zh-CN', 'modeDoc.titleOutlineShort')).toBe('📋 分节大纲');
        expect(translate('zh-CN', 'modeDoc.titleOutlineScript')).toBe('📋 分集大纲');
        expect(translate('zh-CN', 'modeDoc.titleBible')).toBe('🎭 场景圣经');
        expect(translate('zh-CN', 'modeDoc.titleStoryboard')).toBe('🎬 分镜表');
        expect(translate('zh-CN', 'modeDoc.titleOutlineShort')).not.toBe(translate('zh-CN', 'modeDoc.titleOutlineScript'));
    });

    it('前期调研提示与校验文案保持原措辞', () => {
        expect(translate('zh-CN', 'preResearch.hint.targetWordsShort')).toBe('5–10 万字；建议 8 万字。');
        expect(translate('zh-CN', 'preResearch.hint.targetSectionsShort')).toBe('8–40 节；建议 20 节。');
        expect(translate('zh-CN', 'preResearch.msg.needProjectName')).toBe('❌ 请填写项目名称');
        expect(translate('zh-CN', 'preResearch.msg.wordsRange', { min: 50000, max: 100000 }))
            .toBe('❌ 目标字数必须在 50000–100000 字之间');
    });
});

describe('第38片：creationMode 显示函数（与落盘口径分离）', () => {
    it('名称 / 描述 / 单位三模式双语', () => {
        expect(creationModeDisplayName('long')).toBe('长篇小说');
        expect(creationModeDisplayName('short')).toBe('短篇小说');
        expect(creationModeDisplayName('script')).toBe('短剧剧本');
        expect(creationUnitDisplayLabel('long')).toBe('章');
        expect(creationUnitDisplayLabel('short')).toBe('节');
        expect(creationUnitDisplayLabel('script')).toBe('集');

        setLocale('en-US');
        expect(creationModeDisplayName('long')).toBe('Novel');
        expect(creationModeDisplayName('short')).toBe('Short story');
        expect(creationModeDisplayName('script')).toBe('Screenplay');
        expect(creationUnitDisplayLabel('short')).toBe('section');
        expect(creationModeDisplayDescription('script')).not.toMatch(CJK);
        expect(creationModeDisplayDescription('script').length).toBeGreaterThan(10);
    });

    it('en 插值形态：主页元信息与文档保存位置', () => {
        expect(translate('en-US', 'home.modeMeta', { count: 1, unit: 'section' })).toBe('1 project(s) · unit: “section”');
        expect(translate('en-US', 'modeDoc.savePath', { path: 'a/b.md' })).toBe('Save location: a/b.md');
        expect(translate('en-US', 'modeDoc.modeMismatch', { projectMode: 'Novel', saveMode: 'Screenplay' }))
            .toContain('Novel');
    });
});
