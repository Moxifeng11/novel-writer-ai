import { describe, it, expect } from 'vitest';
import {
    STORY_STRUCTURES,
    buildLongStoryPromptBlock,
    buildStoryStructureGuide,
    buildStorySettingsMetaSection,
    createDefaultStorySettings,
    generateRandomStorySettings,
    getStructureStageSummary,
    parseStorySettingsFromProjectMeta,
    upsertStorySettingsInProjectMeta,
    validateStorySettings,
} from '../../../shared/story-structure';
import { createSeededRandom } from '../../../shared/true-random';
import { buildCreationModeMetaSection, parseCreationModeMeta, getCreationModePromptBlock } from '../../../shared/creation-mode';
import { buildWizardSteps } from '../../../ui/full-writer/wizard-types';

describe('故事结构模板', () => {
    it('五套结构齐全且阶段比例合计 100%', () => {
        expect(STORY_STRUCTURES.map(s => s.id)).toEqual([
            'qichengzhuanhe', 'three_act', 'five_act', 'hero_journey', 'kishotenketsu',
        ]);
        for (const structure of STORY_STRUCTURES) {
            const total = structure.stages.reduce((sum, stage) => sum + stage.ratio, 0);
            expect(total).toBe(100);
            expect(structure.stages.length).toBeGreaterThanOrEqual(3);
            expect(structure.hardRules.length).toBeGreaterThan(0);
        }
    });

    it('阶段摘要包含每一幕名称与比例', () => {
        const summary = getStructureStageSummary('three_act');
        expect(summary).toContain('第一幕');
        expect(summary).toContain('25%');
    });
});

describe('组合校验', () => {
    it('默认组合自洽', () => {
        expect(validateStorySettings(createDefaultStorySettings())).toEqual([]);
    });

    it('识别科技体系 + 血脉、系统流 + 非系统、日常流 + 复仇', () => {
        const base = createDefaultStorySettings();
        expect(validateStorySettings({ ...base, powerSystem: '科技', goldenFinger: '血脉' }).length).toBeGreaterThan(0);
        expect(validateStorySettings({ ...base, archetype: '系统流', goldenFinger: '读心' }).length).toBeGreaterThan(0);
        expect(validateStorySettings({ ...base, archetype: '日常流', coreConflict: '复仇' }).length).toBeGreaterThan(0);
    });
});

describe('真随机组合', () => {
    it('100 次随机全部自洽，且结构不只一种', () => {
        const structures = new Set<string>();
        for (let i = 0; i < 100; i++) {
            const settings = generateRandomStorySettings({ genre: '玄幻' });
            expect(validateStorySettings(settings)).toEqual([]);
            expect(settings.oneLineStory.length).toBeGreaterThan(10);
            structures.add(settings.structureId);
        }
        expect(structures.size).toBeGreaterThan(1);
    });

    it('锁定结构时只生成该结构', () => {
        for (const structure of STORY_STRUCTURES) {
            for (let i = 0; i < 10; i++) {
                const settings = generateRandomStorySettings({ structureId: structure.id, genre: '玄幻' });
                expect(settings.structureId).toBe(structure.id);
                expect(validateStorySettings(settings)).toEqual([]);
            }
        }
    });

    it('注入确定性随机源时结果可复现', () => {
        const first = generateRandomStorySettings({ structureId: 'three_act', random: createSeededRandom('seed-1') });
        const second = generateRandomStorySettings({ structureId: 'three_act', random: createSeededRandom('seed-1') });
        expect(second).toEqual(first);
    });
});

describe('.project 元数据', () => {
    it('写入后可完整解析，并保留原有章节', () => {
        const settings = createDefaultStorySettings('hero_journey');
        settings.oneLineStory = '普通人被卷入王朝更替，最终带着代价归来。';
        settings.randomSeed = 'seed-abc';
        const meta = `# 书甲\n\n## 题材\n玄幻\n\n## 类型\noriginal\n`;
        const next = upsertStorySettingsInProjectMeta(meta, settings);
        const parsed = parseStorySettingsFromProjectMeta(next);

        expect(next).toContain('## 题材');
        expect(parsed?.structureId).toBe('hero_journey');
        expect(parsed?.oneLineStory).toBe(settings.oneLineStory);
        expect(parsed?.randomSeed).toBe('seed-abc');
    });

    it('重复写入不会累积重复章节', () => {
        const settings = createDefaultStorySettings('five_act');
        const once = upsertStorySettingsInProjectMeta('# 项目\n', settings);
        const twice = upsertStorySettingsInProjectMeta(once, settings);
        expect(twice.match(/## 故事结构/g)?.length).toBe(1);
        expect(twice.match(/## 故事创作设置/g)?.length).toBe(1);
    });

    it('切换结构保留其余设定，并更新提示词', () => {
        const original = createDefaultStorySettings('qichengzhuanhe');
        original.oneLineStory = '原来的故事';
        const meta = upsertStorySettingsInProjectMeta('# 项目\n', original);
        const changed = { ...original, structureId: 'five_act' as const };
        const next = upsertStorySettingsInProjectMeta(meta, changed);
        const parsed = parseStorySettingsFromProjectMeta(next);
        expect(parsed?.structureId).toBe('five_act');
        expect(parsed?.oneLineStory).toBe('原来的故事');
        expect(getCreationModePromptBlock('long', { storySettings: parsed! })).toContain('五幕式');
    });

    it('buildStorySettingsMetaSection 与解析函数往返一致', () => {
        const settings = createDefaultStorySettings('kishotenketsu');
        const parsed = parseStorySettingsFromProjectMeta(buildStorySettingsMetaSection(settings));
        expect(parsed?.structureId).toBe(settings.structureId);
        expect(parsed?.coreConflict).toBe(settings.coreConflict);
    });
});

describe('创作模式与提示词', () => {
    it('创建模式元数据包含故事结构并可在解析后恢复', () => {
        const settings = createDefaultStorySettings('three_act');
        const section = buildCreationModeMetaSection({
            mode: 'long',
            shortCategory: '',
            scriptGenre: '',
            targetWords: 1000000,
            targetUnits: 200,
            storyStructure: settings.structureId,
            storySettings: settings,
        });
        const parsed = parseCreationModeMeta(section);
        expect(parsed.storyStructure).toBe('three_act');
        expect(parsed.storySettings?.tone).toBe(settings.tone);
    });

    it('长篇故事结构块进入提示词，旧项目仍为空串', () => {
        const settings = createDefaultStorySettings('hero_journey');
        const block = getCreationModePromptBlock('long', { storySettings: settings });
        expect(block).toContain('英雄之旅');
        expect(block).toContain('主角起点');
        expect(block).toContain('所有章节必须服务当前结构阶段');
        expect(getCreationModePromptBlock('long', {})).toBe('');
    });

    it('指南包含阶段、设定与硬约束', () => {
        const guide = buildStoryStructureGuide(createDefaultStorySettings('five_act'));
        expect(guide).toContain('五幕式');
        expect(guide).toContain('第一幕');
        expect(guide).toContain('硬约束');
    });

    it('prompt block 包含全部阶段比例与一句话故事', () => {
        const settings = createDefaultStorySettings('qichengzhuanhe');
        settings.oneLineStory = '一句话故事测试';
        const block = buildLongStoryPromptBlock(settings);
        expect(block).toContain('起（25%）');
        expect(block).toContain('一句话故事测试');
    });

    it('长篇小说向导把故事结构放在第一步', () => {
        expect(buildWizardSteps('original')[0].id).toBe('story_structure');
        const fanficSteps = buildWizardSteps('fanfic');
        expect(fanficSteps.findIndex(step => step.id === 'story_structure')).toBe(1);
    });
});
