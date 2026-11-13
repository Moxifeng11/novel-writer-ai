/**
 * story-structure-prompt.test.ts — 结构阶段/硬规则进正文 prompt 的链路锁（DSH-20261114-07）
 *
 * audit §四-5 断点勘误：此前取证称「五套结构的 stages/hardRules 只到 UI、
 * 不进正文 prompt」——实测为**误报**：buildLongStoryPromptBlock 一直包含
 * 「结构阶段 + 硬约束」段，且经 getCreationModePromptBlock → creationModePrompt
 * 追加到**每个步骤**的 system prompt（template-utils modeBlock 链）。
 *
 * 真实缺口是「链路无测试锁定」——本文件把链路逐环锁死，防止未来重构
 * （例如 creationModePrompt 改为只带指纹行）时结构约束静默消失。
 *
 * 落点决策（accept ①）：不再新建独立模板变量/注入通道——既有
 * creationModePrompt 链就是最佳落点（单点、全步骤覆盖、一键与协同共用）；
 * narrativeStructureStages 变量定位为 UI 展示（template-vars-builder 注释已说明）。
 */
import { describe, expect, it } from 'vitest';
import {
    STORY_STRUCTURES,
    buildLongStoryPromptBlock,
    getStructureStageSummary,
    type LongStorySettings,
} from '../../../shared/story-structure';
import { getCreationModePromptBlock } from '../../../shared/creation-mode';
import { getStepTemplateAuto } from '../../../engine/prompts/template-utils';

function makeSettings(structureId: LongStorySettings['structureId']): LongStorySettings {
    return {
        structureId,
        protagonistStart: '落魄者',
        coreConflict: '身份之谜',
        powerSystem: '逆脉',
        goldenFinger: '神秘令牌',
        archetype: '孤勇者',
        temperament: '外冷内热',
        tone: '冷峻',
        romance: '克制',
        pacing: '渐快',
        oneLineStory: '落魄少年在测脉制度下找回自己的名字。',
        randomSeed: '',
    };
}

describe('五套结构的阶段与硬规则完整性（accept ②）', () => {
    it('每套结构都有非空 stages 与 hardRules', () => {
        expect(STORY_STRUCTURES).toHaveLength(5);
        for (const structure of STORY_STRUCTURES) {
            expect(structure.stages.length, `${structure.id} stages`).toBeGreaterThan(0);
            expect(structure.hardRules.length, `${structure.id} hardRules`).toBeGreaterThan(0);
            expect(getStructureStageSummary(structure.id).length, `${structure.id} summary`).toBeGreaterThan(0);
        }
    });

    it('未知结构 id 安全回退默认结构（不抛错）', () => {
        const summary = getStructureStageSummary('不存在的结构');
        expect(summary.length).toBeGreaterThan(0);
    });
});

describe('结构块进 creationModePrompt（链路环 1）', () => {
    it('长篇 + storySettings：块内含结构名、各阶段与硬约束', () => {
        const block = getCreationModePromptBlock('long', { storySettings: makeSettings('qichengzhuanhe') });
        expect(block).toContain('【长篇小说故事结构');
        expect(block).toContain('起'); // 起承转合首阶段
        expect(block).toContain('硬约束');
        expect(block).toContain('不得提前解决核心冲突');
    });

    it('空配置安全跳过（storySettings 缺省 → 空块，不抛错）', () => {
        expect(getCreationModePromptBlock('long', {})).toBe('');
    });

    it('五套结构各自的关键节点都进块（beats 不丢）', () => {
        for (const structure of STORY_STRUCTURES) {
            const block = getCreationModePromptBlock('long', { storySettings: makeSettings(structure.id) });
            for (const stage of structure.stages) {
                expect(block).toContain(stage.name);
                expect(block).toContain(stage.purpose);
                // 每阶段至少一个关键节点进块
                expect(block).toContain(stage.beats[0]);
            }
            expect(block).toContain(structure.hardRules[0]);
        }
    });
});

describe('结构块追加到步骤 system prompt（链路环 2，accept ③）', () => {
    it('正文（bodyGeneration）prompt 含所选结构阶段清单', () => {
        const settings = makeSettings('three_act');
        const template = getStepTemplateAuto('bodyGeneration', {
            creationModePrompt: getCreationModePromptBlock('long', { storySettings: settings }),
        });
        expect(template?.systemPrompt).toContain('【长篇小说故事结构：三幕式】');
        expect(template?.systemPrompt).toContain('第一幕：建置');
        expect(template?.systemPrompt).toContain('激励事件不得晚于全书的 20%');
        expect(template?.systemPrompt).toContain('所有章节必须服务当前结构阶段');
    });
});
