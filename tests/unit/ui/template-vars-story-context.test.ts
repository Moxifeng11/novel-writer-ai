import { describe, expect, it } from 'vitest';
import type { GatheredContext } from '../../../engine/context/context-types';
import {
    applyStoryContextBus,
    buildContextVars,
    buildEntityVars,
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
        app: { vault: { getFiles: () => [], getAbstractFileByPath: () => null } } as never,
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

describe('buildContextVars — 上下文变量装配', () => {
    it('非压缩路径透传世界观，并按世界类型推导禁用要素', async () => {
        const deps = makeDeps(makeContext());
        const vars: Record<string, string> = {};
        const d = {
            world_view: { raw: '题材：修仙\n\n## 力量体系\n境界：炼气→筑基\n\n## 地理\n断魂桥通砂峡' },
            setting_lib: { raw: '## 力量体系\n炼气、筑基、金丹' },
            timeline: [{ time: '清晨', chapter: '第1章', event: '过桥', impact: '复测' }],
        } as unknown as GatheredContext['data'];

        await buildContextVars(deps, vars, d);

        expect(vars.worldView).toBe('题材：修仙\n\n## 力量体系\n境界：炼气→筑基\n\n## 地理\n断魂桥通砂峡');
        expect(vars.worldType).toBe('修仙');
        expect(vars.forbiddenElements).toContain('手机');
        expect(vars.powerSystem).toContain('炼气');
        expect(vars.settingLib).toBe('## 力量体系\n炼气、筑基、金丹');
        expect(vars.timelineEvents).toBe('- 清晨 | 第1章 | 过桥 | 复测');
        expect(vars.chapPosition).toBe('第1章（第1卷）');
    });

    it('设定库只含占位注释时回退到世界观摘要', async () => {
        const deps = makeDeps(makeContext());
        const vars: Record<string, string> = {};
        const d = {
            world_view: { raw: '## 力量体系\n灵气自地脉升起' },
            setting_lib: { raw: '<!-- 尚未填写 -->' },
        } as unknown as GatheredContext['data'];

        await buildContextVars(deps, vars, d);

        expect(vars.settingLib).toContain('灵气自地脉升起');
    });

    it('写作规则被塞进文笔风格时默认去重，可在设置中关闭', async () => {
        const ruleChunk = ['写作规则', '角色活着', '写作自检', '规则正文。'.repeat(120)].join('\n');
        const d = { writing_rules: { style: ruleChunk } } as unknown as GatheredContext['data'];

        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, d);
        expect(vars.writingStyle).toBe('');

        const depsOff = makeDeps(makeContext());
        (depsOff.plugin.settings as unknown as Record<string, unknown>).dedupeRulesInStyle = false;
        const varsOff: Record<string, string> = {};
        await buildContextVars(depsOff, varsOff, d);
        expect(varsOff.writingStyle).toBe(ruleChunk);
    });

    it('文笔风格原文同样做规则去重，普通风格文本保留', async () => {
        const ruleChunk = ['写作规则', '角色活着', '格式参考', '规则正文。'.repeat(120)].join('\n');
        const d = {
            writing_style: { raw: ruleChunk },
        } as unknown as GatheredContext['data'];
        const vars: Record<string, string> = {};

        await buildContextVars(makeDeps(makeContext()), vars, d);

        expect(vars.writingStyleContent).toBe('');
    });

    it('汇总上一章正文、续写建议、审查问题与情绪字段', async () => {
        const deps = makeDeps(makeContext());
        deps.viewVars = { crossVolumeSnapshot: '上卷末沈砚断脉' };
        const vars: Record<string, string> = {};
        const d = {
            previous_chapter: {
                bodySummary: '沈砚过桥复测。'.repeat(400),
                ending: '差役扣下梳妆匣。',
                outline: '第1章大纲',
                analysisReport: '续写建议：加快节奏\n互信息断裂：人物动机缺环',
                continuityReview: '❌ 时间线冲突\n⚠️ 人物口音漂移\n正常行',
                infoPlan: '情感温度：压抑\n冲突强度：7\n节奏节拍：紧-松',
                stateSnapshot: '沈砚：复测前',
            },
        } as unknown as GatheredContext['data'];

        await buildContextVars(deps, vars, d);

        expect(vars.prevChaptersSummary).toContain('跨卷状态快照');
        expect(vars.prevChaptersSummary).toContain('上卷末沈砚断脉');
        expect(vars.prevChaptersSummary).toContain('上一章正文：');
        expect(vars.prevChaptersSummary).toContain('上一章续写建议：加快节奏');
        expect(vars.prevChaptersSummary).toContain('上一章改进方向：人物动机缺环');
        expect(vars.prevReview).toContain('❌ 时间线冲突');
        expect(vars.prevReview).toContain('⚠️ 人物口音漂移');
        expect(vars.prevReview).not.toContain('正常行');
        expect(vars.emotionContext).toContain('上一章情感温度：压抑');
        expect(vars.emotionContext).toContain('上一章冲突强度：7');
        expect(vars.emotionContext).toContain('上一章节奏模式：紧-松');
        expect(vars.prevChapEnding).toBe('差役扣下梳妆匣。');
        expect(vars.prevChapterStateSnapshot).toBe('沈砚：复测前');
    });

    it('无上一章时显式标记开篇，避免模型自行编造结尾', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, {
            outline: { raw: '第1章细纲' },
        } as unknown as GatheredContext['data']);

        expect(vars.prevChapEnding).toBe('（本章为开篇，无上一章结尾）');
        expect(vars.prevChapterStateSnapshot).toBe('');
        expect(vars.outlineContent).toBe('第1章细纲');
    });

    it('压缩上下文直接透传世界观/设定库/时间线', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, {
            compressed: {
                worldView: '压缩后世界观：修仙',
                settingLib: '<!-- 空 -->',
                timeline: '- 压缩时间线',
                foreshadows: '[F1] 月牙疤',
            },
        } as unknown as GatheredContext['data']);

        expect(vars.worldView).toBe('压缩后世界观：修仙');
        expect(vars.worldType).toBe('修仙');
        expect(vars.settingLib).toBe('压缩后世界观：修仙');
        expect(vars.timelineEvents).toBe('- 压缩时间线');
    });
});

describe('buildEntityVars — 实体变量装配', () => {
    it('四类实体按各自格式拼装，并汇总上下文 token 估算', async () => {
        const deps = makeDeps(makeContext());
        const vars: Record<string, string> = {};
        const d = {
            outline: { raw: '沈砚 断魂桥 天阙 月牙匕' },
            character_state: [
                { name: '沈砚', 角色定位: '主角', 身份: '砂民少年', 当前状态: '复测前', 性格标签: '倔' },
            ],
            factions: [{ name: '天阙', 类型: '王朝', 领袖: '国师', 描述: '控制测脉' }],
            locations: [{ name: '断魂桥', 类型: '关隘', 重要程度: '高', 描述: '唯一通道' }],
            items: [{ name: '月牙匕', 类型: '兵器', '品阶/等级': '凡品', 描述: '旧刃' }],
        } as unknown as GatheredContext['data'];

        await buildEntityVars(deps, vars, d);

        expect(vars.allChars).toContain('沈砚：定位：主角，身份：砂民少年，状态：复测前，性格：倔');
        expect(vars.allFactions).toContain('天阙：类型：王朝，领袖：国师，描述：控制测脉');
        expect(vars.allLocs).toContain('断魂桥：类型：关隘，重要程度：高，描述：唯一通道');
        expect(vars.allItems).toContain('月牙匕：类型：兵器，等级：凡品');
        expect(Number(vars._contextTokens)).toBeGreaterThan(0);
    });

    it('人物超出 12 名额预算时仍强制保留主角', async () => {
        const extras = Array.from({ length: 12 }, (_, i) => `配角${i + 1}`);
        const d = {
            outline: { raw: extras.join(' ') },
            character_state: [
                ...extras.map((name) => ({ name, 角色定位: '配角', 身份: '路人' })),
                { name: '沈砚', 角色定位: '主角', 身份: '砂民少年' },
            ],
        } as unknown as GatheredContext['data'];
        const vars: Record<string, string> = {};

        await buildEntityVars(makeDeps(makeContext()), vars, d);

        expect(vars.allChars).toContain('沈砚');
    });

    it('无实体数据时输出空串且不抛错', async () => {
        const vars: Record<string, string> = {};
        await buildEntityVars(makeDeps(makeContext()), vars, {
            outline: { raw: '' },
        } as unknown as GatheredContext['data']);

        expect(vars.allChars).toBe('');
        expect(vars.allFactions).toBe('');
        expect(vars._contextTokens).toBe('0');
    });
});
