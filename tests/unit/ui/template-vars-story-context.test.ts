import { describe, expect, it } from 'vitest';
import type { GatheredContext } from '../../../engine/context/context-types';
import {
    applyStoryContextBus,
    type TemplateVarsDeps,
} from '../../../ui/full-writer/template-vars-builder';

function makeContext(): GatheredContext {
    return {
        project: '九霄逆脉行',
        gatheredAt: '2026-10-28T00:00:00.000Z',
        issues: [],
        data: {
            world_view: { raw: '题材：玄幻\n\n## 世界规则\n灵气从地脉升起，断魂桥是砂峡唯一通道。', sections: [] },
            setting_lib: {
                raw: '## 力量体系\n顺脉者引气入体；逆脉者被天阙标记。\n## 地理\n断魂桥连接砂民区与测脉碑。',
                sections: [],
            },
            character_state: [
                {
                    name: '沈砚',
                    角色定位: '主角',
                    身份: '砂民少年',
                    当前状态: '复测前',
                    人物背景: '父亲当了亡妻的梳妆匣凑复测费。',
                },
                {
                    name: '沈铁山',
                    角色定位: '重要配角',
                    身份: '铁匠',
                    当前状态: '陪儿子复测',
                },
            ],
            factions: [{ name: '天阙', 类型: '王朝', 描述: '控制测脉。' }],
            locations: [{ name: '断魂桥', 类型: '关隘', 描述: '砂峡唯一通道。' }],
            items: [],
            timeline: [
                {
                    time: '清晨',
                    chapter: '第1章',
                    event: '沈砚过断魂桥',
                    impact: '参加复测',
                    involvedEntities: ['沈砚', '断魂桥'],
                },
            ],
            foreshadows: {
                unrevealed: [
                    {
                        id: 'F1',
                        name: '月牙疤',
                        importance: '高',
                        buryChapter: '第1章',
                        plannedReveal: '第1章',
                        relatedChars: '沈砚',
                        status: '未揭示',
                    },
                ],
                revealed: [],
                abandoned: [],
            },
            scene_expansion: {
                raw: [
                    '## 场景1：断魂桥',
                    'POV: 沈砚',
                    '时间: 清晨',
                    '地点: 断魂桥',
                    '目标: 过桥复测',
                    '冲突: 差役盯上月牙疤',
                    '出场人物: 沈砚、沈铁山',
                ].join('\n'),
                sections: [],
            },
            emotion_plan: {
                raw: [
                    '### scene1: 断魂桥',
                    'emotion_start: 紧张(3/10)',
                    'emotion_end: 恐惧(6/10)',
                    'emotion_delta: +3',
                    'body_reaction: 手心出汗',
                    'relationship_change: 沈砚对差役更警惕',
                ].join('\n'),
                sections: [],
            },
            story_linkage: null,
        },
    } as unknown as GatheredContext;
}

function makeDeps(context: GatheredContext): TemplateVarsDeps {
    return {
        app: {} as never,
        plugin: {
            settings: {
                maxContext: 128000,
                maxOutput: 8192,
                defaultModel: 'deepseek-flash',
                storyContextTier: 'cloud',
            },
        } as never,
        project: context.project,
        chapterName: '第1章',
        chapterNum: 1,
        volume: '第1卷',
        chapDir: '',
        context,
        viewVars: {},
        stepResults: {},
    };
}

describe('applyStoryContextBus — 一键生成适配', () => {
    it('用总线覆盖核心模板变量，并写入关联摘要与遥测', async () => {
        const context = makeContext();
        const deps = makeDeps(context);
        const vars: Record<string, string> = {
            worldView: '旧世界观',
            settingLib: '旧设定库',
            allChars: '旧人物',
            allLocs: '旧地点',
            timelineEvents: '旧时间线',
            // v4.24：伏笔列表已有值（模板链路按章过滤的结果）时总线不再覆盖；留空才由节点版补
            unrevealedForeshadow: '',
            emotionPlan: '旧情绪',
            sceneCardDigest: '旧场景卡',
        };

        await applyStoryContextBus(deps, vars, context.data);

        expect(vars.worldView).toContain('灵气');
        expect(vars.settingLib).toContain('力量体系');
        expect(vars.allChars).toContain('沈砚');
        expect(vars.allChars).toContain('沈铁山');
        expect(vars.allLocs).toContain('断魂桥');
        expect(vars.timelineEvents).toContain('沈砚过断魂桥');
        expect(vars.unrevealedForeshadow).toContain('月牙疤');
        expect(vars.emotionPlan).toContain('紧张');
        expect(vars.sceneCardDigest).toContain('场景1');
        expect(vars.storyContextPack).toContain('场景→人物/地点');
        expect(vars.storyContextPack).toContain('伏笔→人物/主线');
        expect(vars._storyContextTier).toBe('cloud');
        const telemetry = JSON.parse(vars._storyContextTelemetry);
        expect(telemetry.missingRequired).toEqual([]);
        expect(telemetry.requiredIncluded).toBe(telemetry.requiredTotal);
    });

    it('空上下文不抛错，保留旧变量', async () => {
        const context: GatheredContext = {
            project: '空项目',
            gatheredAt: '2026-10-28T00:00:00.000Z',
            issues: [],
            data: {},
        };
        const deps = makeDeps(context);
        const vars: Record<string, string> = {
            worldView: '旧世界观',
            settingLib: '旧设定库',
            allChars: '旧人物',
        };

        await applyStoryContextBus(deps, vars, context.data);

        expect(vars.worldView).toBe('旧世界观');
        expect(vars.settingLib).toBe('旧设定库');
        expect(vars.allChars).toBe('旧人物');
    });
});
