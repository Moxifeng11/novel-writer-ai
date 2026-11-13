import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, Vault } from 'obsidian';
import type { GatheredContext } from '../../../engine/context/context-types';
import {
    applyStoryContextBus,
    buildContextVars,
    buildEntityVars,
    buildSceneStyleHint,
    buildTemplateVars,
    type TemplateVarsDeps,
} from '../../../ui/full-writer/template-vars-builder';
import { extractCharacterCoreFromContent } from '@/engine/character-soul';

// compact 口径依赖正文文件定位与涉及实体抽取：只替换这两个出口，其余实现保持真实
// （filterForeshadowsByChapter 等仍走原实现，避免影响本文件既有 40 条用例）
const { mockFindBodyFileV4, mockGetInvolvedEntities } = vi.hoisted(() => ({
    mockFindBodyFileV4: vi.fn(),
    mockGetInvolvedEntities: vi.fn(),
}));

vi.mock('@/engine/chapter-utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/engine/chapter-utils')>();
    return { ...actual, findBodyFileV4: mockFindBodyFileV4 };
});

vi.mock('@/engine/chapter-context-builder', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/engine/chapter-context-builder')>();
    return { ...actual, getInvolvedEntities: mockGetInvolvedEntities };
});

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

    it('上一章字段全为空时返回空摘要，不写入审查与情绪变量', async () => {
        const vars: Record<string, string> = {};
        const d = {
            timeline: [],
            previous_chapter: {
                bodySummary: '',
                ending: '',
                outline: '',
                analysisReport: '',
                continuityReview: '',
                infoPlan: '',
            },
        } as unknown as GatheredContext['data'];

        await buildContextVars(makeDeps(makeContext()), vars, d);

        expect(vars.prevChaptersSummary).toBe('');
        expect(vars.prevChapEnding).toBe('');
        expect(vars.prevChapterStateSnapshot).toBe('');
        expect(vars.prevReview).toBeUndefined();
        expect(vars.emotionContext).toBeUndefined();
        expect(vars.timelineEvents).toBe('');
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

    it('四类实体字段全量时按约定顺序拼装（含别名与备用键）', async () => {
        const d = {
            outline: { raw: '沈砚 天阙 断魂桥 月牙匕' },
            character_state: [
                {
                    name: '沈砚',
                    角色定位: '主角',
                    身份: '砂民少年',
                    当前状态: '复测前',
                    核心动机: '救母',
                    性格标签: '倔',
                    当前目标: '过桥',
                    '金手指/特殊能力': '逆脉感知',
                    所属势力: '砂民区',
                    年龄: '十六',
                    人物背景: '父亲卖匣凑费',
                    外貌特征: '眉间疤',
                    核心驱动力_软肋: '母亲',
                    习惯性小动作: '搓指',
                    当前情绪: '压着怒',
                    '功法/技能树': '逆脉诀',
                },
            ],
            factions: [
                { 名称: '天阙', 别称: '测脉司', 类型: '王朝', '地位/排名': '第一', 领袖: '国师', 描述: '控制测脉' },
            ],
            locations: [
                {
                    name: '断魂桥',
                    别称: '棺桥',
                    类型: '关隘',
                    '所在世界/区域': '砂峡',
                    重要程度: '高',
                    '地理特征': '单索',
                    '主要居民/势力': '砂民',
                    描述: '唯一通道',
                },
            ],
            items: [
                { name: '月牙匕', 类型: '兵器', '品阶/等级': '凡品', 效果: '割雾', '所属/归属': '沈砚', 描述: '旧刃' },
            ],
        } as unknown as GatheredContext['data'];
        const vars: Record<string, string> = {};

        await buildEntityVars(makeDeps(makeContext()), vars, d);

        expect(vars.allChars).toContain('沈砚：定位：主角，身份：砂民少年，状态：复测前，动机：救母');
        expect(vars.allChars).toContain('性格：倔，目标：过桥，能力：逆脉感知，势力：砂民区');
        expect(vars.allChars).toContain('年龄：十六，背景：父亲卖匣凑费，外貌：眉间疤');
        expect(vars.allChars).toContain('软肋：母亲，习惯：搓指，情绪：压着怒，功法：逆脉诀');
        expect(vars.allFactions).toContain('天阙：别称：测脉司，类型：王朝，地位：第一，领袖：国师，描述：控制测脉');
        expect(vars.allLocs).toContain('断魂桥：别称：棺桥，类型：关隘，区域：砂峡，重要程度：高');
        expect(vars.allLocs).toContain('地理特征：单索，居民：砂民，描述：唯一通道');
        expect(vars.allItems).toContain('月牙匕：类型：兵器，等级：凡品，效果：割雾，归属：沈砚，描述：旧刃');
    });

    it('实体字段缺省时按备用键取名，非字符串与空值字段被跳过', async () => {
        const d = {
            previous_chapter: {},
            character_state: [
                { 姓名: '沈砚', 角色定位: '主角' },
                { fileName: '路人甲.md', 年龄: 16, 当前状态: '' },
                { 备注: '无名' },
            ],
            factions: [{ 名称: '天阙', 描述: '' }],
            locations: [{ fileName: '断魂桥.md', 重要程度: 5 }],
            items: [{ name: '月牙匕', 效果: null }],
        } as unknown as GatheredContext['data'];
        const vars: Record<string, string> = {};

        await buildEntityVars(makeDeps(makeContext()), vars, d);

        // 姓名 / fileName / 无名为第四条兜底，三档备用键依次命中
        expect(vars.allChars).toContain('- 沈砚：定位：主角');
        expect(vars.allChars).toContain('- 路人甲.md：年龄：16');
        expect(vars.allChars).toContain('- ?：');
        // 空字符串与非字符串字段不进入字段表，因此不产生空标签
        expect(vars.allChars).not.toContain('当前状态：');
        expect(vars.allFactions).toBe('- 天阙：');
        expect(vars.allLocs).toContain('- 断魂桥.md：重要程度：5');
        expect(vars.allItems).toBe('- 月牙匕：');
    });
});

function makeForeshadows(count: number, plannedReveal: string) {
    return {
        unrevealed: Array.from({ length: count }, (_, i) => ({
            id: `F${i + 1}`,
            name: `伏笔${i + 1}`,
            importance: '中',
            buryChapter: '第1章',
            plannedReveal,
            relatedChars: '沈砚',
            status: '未揭示',
        })),
        revealed: [],
        abandoned: [],
    };
}

/** 便于在测试内替换 vault 行为的窄类型，避免使用 any（any 基线已无余量） */
type MutableVaultApp = {
    vault: {
        getAbstractFileByPath: (path: string) => unknown;
        read: (file: unknown) => Promise<string>;
    };
};

/**
 * 构造带文笔风格文件的 deps。
 * @param styleContent - 风格文件正文；null 表示路径下无文件
 * @param opts - readError 让读取抛错；notTFile 让路径命中非 TFile 对象
 * @returns 可直接传入 buildSceneStyleHint 的依赖
 * @example
 * const deps = await makeStyleDeps('### 战斗/冲突场景样本\n刀锋压到喉间。');
 * await buildSceneStyleHint(deps, { infoPlan: '情感温度：8' });
 */
async function makeStyleDeps(
    styleContent: string | null,
    opts: { readError?: boolean; notTFile?: boolean } = {},
): Promise<TemplateVarsDeps> {
    const deps = makeDeps(makeContext());
    if (styleContent === null) return deps;
    const app = deps.app as unknown as MutableVaultApp;
    if (opts.notTFile) {
        app.vault.getAbstractFileByPath = () => ({ path: '九霄逆脉行/文笔风格.md' });
        return deps;
    }
    const { TFile } = await import('obsidian');
    const file = new TFile();
    file.path = '九霄逆脉行/文笔风格.md';
    app.vault.getAbstractFileByPath = () => file;
    app.vault.read = async () => {
        if (opts.readError) throw new Error('读取风格文件失败');
        return styleContent;
    };
    return deps;
}

describe('buildSceneStyleHint — 场景类型与节奏推导', () => {
    it('无风格文件时提前返回，不写入任何变量', async () => {
        const deps = await makeStyleDeps(null);
        const vars: Record<string, string> = {};

        await buildSceneStyleHint(deps, vars);

        expect(vars.sceneStyleSnippet).toBeUndefined();
        expect(vars.suggestedRhythm).toBeUndefined();
        expect(vars._sceneType).toBeUndefined();
    });

    it('路径命中非 TFile 对象时同样早退', async () => {
        const deps = await makeStyleDeps('### 日常/对话场景样本\n两人对坐。', { notTFile: true });
        const vars: Record<string, string> = {};

        await buildSceneStyleHint(deps, vars);

        expect(vars.suggestedRhythm).toBeUndefined();
        expect(vars._sceneType).toBeUndefined();
    });

    it('情感温度≥7 判为 battle，片段去除注释与代码围栏', async () => {
        const content = [
            '### 战斗/冲突场景样本',
            '刀锋压到喉间。<!-- 内部批注 -->',
            '```',
            '血从指缝渗出。',
            '```',
            '### 日常/对话场景样本',
            '寒暄两句。',
        ].join('\n');
        const deps = await makeStyleDeps(content);
        const vars: Record<string, string> = { infoPlan: '情感温度：8\n冲突强度：2' };

        await buildSceneStyleHint(deps, vars);

        expect(vars._sceneType).toBe('battle');
        expect(vars.sceneStyleSnippet).toContain('刀锋压到喉间。');
        expect(vars.sceneStyleSnippet).toContain('血从指缝渗出。');
        expect(vars.sceneStyleSnippet).not.toContain('内部批注');
        expect(vars.sceneStyleSnippet).not.toContain('```');
        expect(vars.sceneStyleSnippet).not.toContain('寒暄两句。');
        expect(vars.suggestedRhythm).toContain('急起急落');
    });

    it('仅冲突强度≥4 也判为 battle', async () => {
        const deps = await makeStyleDeps('### 战斗/冲突场景样本\n一刀劈落。');
        const vars: Record<string, string> = { infoPlan: '冲突强度：5' };

        await buildSceneStyleHint(deps, vars);

        expect(vars._sceneType).toBe('battle');
        expect(vars.sceneStyleSnippet).toContain('一刀劈落。');
    });

    it('情感温度≥4 判为 emotional；段落未命中时只给节奏不给片段', async () => {
        const deps = await makeStyleDeps('### 日常/对话场景样本\n寒暄两句。');
        const vars: Record<string, string> = { infoPlan: '情感温度：5' };

        await buildSceneStyleHint(deps, vars);

        expect(vars._sceneType).toBe('emotional');
        expect(vars.sceneStyleSnippet).toBeUndefined();
        expect(vars.suggestedRhythm).toContain('倒叙切入');
    });

    it('仅冲突强度≥2 判为 emotional，并命中情绪段', async () => {
        const deps = await makeStyleDeps('### 情绪/心理场景样本\n她攥紧了袖口。');
        const vars: Record<string, string> = { infoPlan: '冲突强度：2' };

        await buildSceneStyleHint(deps, vars);

        expect(vars._sceneType).toBe('emotional');
        expect(vars.sceneStyleSnippet).toContain('她攥紧了袖口。');
    });

    it('无 infoPlan 时默认 dialogue', async () => {
        const deps = await makeStyleDeps('### 日常/对话场景样本\n两人对坐。');
        const vars: Record<string, string> = {};

        await buildSceneStyleHint(deps, vars);

        expect(vars._sceneType).toBe('dialogue');
        expect(vars.suggestedRhythm).toContain('对话推进');
        expect(vars.sceneStyleSnippet).toContain('两人对坐。');
    });

    it('vars 中没有信息计划时回退到 stepResults', async () => {
        const deps = await makeStyleDeps('### 情绪/心理场景样本\n她攥紧了袖口。');
        deps.stepResults = { infoPlan: '情感温度：6' };
        const vars: Record<string, string> = {};

        await buildSceneStyleHint(deps, vars);

        expect(vars._sceneType).toBe('emotional');
        expect(vars.sceneStyleSnippet).toContain('她攥紧了袖口。');
    });

    it('读取风格文件失败时吞掉异常，不写入任何变量', async () => {
        const deps = await makeStyleDeps('', { readError: true });
        const vars: Record<string, string> = {};

        await expect(buildSceneStyleHint(deps, vars)).resolves.toBeUndefined();

        expect(vars.sceneStyleSnippet).toBeUndefined();
        expect(vars.suggestedRhythm).toBeUndefined();
    });
});

describe('buildContextVars — 信息债阶梯', () => {
    it('严重档（>20）且无临近揭示窗口时给出检查计划文案', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, {
            foreshadows: makeForeshadows(25, '第100章'),
        } as unknown as GatheredContext['data']);

        expect(vars.forcedRevealHint).toContain('信息债严重（25个未揭示）');
        expect(vars.forcedRevealHint).toContain('当前无临近揭示窗口内的伏笔');
        expect(vars.revealInstruction).toContain('信息债严重：但当前无临近揭示窗口内的伏笔');
    });

    it('过高档（>阈值）且无窗口时提示回顾伏笔计划', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, {
            foreshadows: makeForeshadows(18, '第100章'),
        } as unknown as GatheredContext['data']);

        expect(vars.forcedRevealHint).toContain('信息债过高（18个未揭示）');
        expect(vars.revealInstruction).toContain('信息债过高：但当前无临近揭示窗口内的伏笔，建议回顾伏笔计划');
    });

    it('偏高档（>10）且有窗口时列出建议揭示的伏笔', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, {
            foreshadows: makeForeshadows(12, '第3章'),
        } as unknown as GatheredContext['data']);

        expect(vars.forcedRevealHint).toContain('信息债偏高（12个未揭示）');
        expect(vars.revealInstruction).toContain('信息债偏高：建议揭示');
    });

    it('轻档（>5）且无窗口时给出「有N个未揭示」提示', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, {
            foreshadows: makeForeshadows(7, '第100章'),
        } as unknown as GatheredContext['data']);

        expect(vars.forcedRevealHint).toContain('有7个未揭示伏笔，当前无临近揭示窗口的伏笔');
        expect(vars.revealInstruction).toBe('每章至少回收1个旧伏笔、埋下1个新伏笔');
    });

    it('健康档（≤5）时给出健康文案', async () => {
        const vars: Record<string, string> = {};
        await buildContextVars(makeDeps(makeContext()), vars, {
            foreshadows: makeForeshadows(3, '第100章'),
        } as unknown as GatheredContext['data']);

        expect(vars.forcedRevealHint).toBe('当前伏笔生态健康');
        expect(vars.revealInstruction).toBe('每章至少回收1个旧伏笔、埋下1个新伏笔');
    });
});

// ---------------------------------------------------------------------------
// buildTemplateVars — 信号段（灵魂层 / 上下文体检 / 自定义模板覆盖 / 变体开关）
// ---------------------------------------------------------------------------

const SOUL_FM = `---
tags: [人物]
姓名: 沈砚
character_core:
  desire: 活着走过断魂桥
  fear: 被天阙再次标记
  obsession: 查明母亲死因
  shame: 复测前退缩过一次
  trauma: 父亲卖掉梳妆匣
  weakness: 听见「逆脉」会手抖
  soft_spot: 砂民区的孩童
  rage_trigger: 有人拿测脉碑威胁弱者
  moral_boundary: 不连累无辜
---`;

function makeFullDeps(opts: {
    context?: GatheredContext | null;
    stepResults?: Record<string, string>;
    settings?: Record<string, unknown>;
} = {}): TemplateVarsDeps {
    const vault = new Vault();
    const app = { vault, metadataCache: { getFileCache: () => null } };
    return {
        app: app as never,
        plugin: {
            app,
            settings: {
                contextScope: 'full',
                dedupeRulesInStyle: true,
                storyContextTier: 'cloud',
                maxContext: 128000,
                maxOutput: 8192,
                defaultWordCount: 3000,
                activeRulesVersion: undefined,
                ...(opts.settings ?? {}),
            },
        } as never,
        project: '长篇小说/书A',
        chapterName: '第3章',
        chapterNum: 3,
        volume: '第1卷',
        chapDir: '',
        context: opts.context === undefined ? makeContext() : opts.context,
        viewVars: {},
        stepResults: opts.stepResults ?? {},
    };
}

function makeSoulContext(cores: unknown[]): GatheredContext {
    const ctx = makeContext();
    (ctx.data as unknown as Record<string, unknown>).character_cores = cores;
    return ctx;
}

function longWorldText(seed: string): string {
    return Array.from({ length: 20 }, (_, i) => `${seed}第${i}段：灵气从地脉升起，断魂桥的冷雾贴着桥栏，砂民把手炉抱得更紧。`).join('\n');
}

describe('buildTemplateVars — 信号分支', () => {
    it('context 有完整灵魂层时注入摘要，并写出 9 字段主角详情与就绪标记', async () => {
        const soul = extractCharacterCoreFromContent('沈砚', SOUL_FM);
        const vars = await buildTemplateVars(makeFullDeps({ context: makeSoulContext([soul]) }));

        expect(vars.characterCores).toContain('沈砚');
        expect(vars.protagonistSoulDetail).toContain('他/她最渴望的是：活着走过断魂桥');
        expect(vars.characterSoulReady).toBe('1');
    });

    it('步骤结果里手工编辑的灵魂层优先于 context 摘要（避免编辑保存后被旧快照覆盖）', async () => {
        const soul = extractCharacterCoreFromContent('沈砚', SOUL_FM);
        const vars = await buildTemplateVars(makeFullDeps({
            context: makeSoulContext([soul]),
            stepResults: { characterSoul: '  手工编辑的灵魂层  ' },
        }));

        expect(vars.characterCores).toBe('手工编辑的灵魂层');
        expect(vars.protagonistSoulDetail).toContain('他/她最渴望的是：');
    });

    it('context 无灵魂层但步骤结果有内容时回退到步骤结果', async () => {
        const vars = await buildTemplateVars(makeFullDeps({
            stepResults: { characterSoul: '仅步骤结果的灵魂层' },
        }));

        expect(vars.characterCores).toBe('仅步骤结果的灵魂层');
        expect(vars.protagonistSoulDetail).toBe('仅步骤结果的灵魂层');
        expect(vars.characterSoulReady).toBe('1');
    });

    it('context 灵魂层没有匹配主角时不写主角详情与就绪标记', async () => {
        const soul = extractCharacterCoreFromContent('路人甲', SOUL_FM);
        const vars = await buildTemplateVars(makeFullDeps({ context: makeSoulContext([soul]) }));

        expect(vars.protagonistSoulDetail).toBe('');
        expect(vars.characterSoulReady).toBe('');
    });

    it('既无 context 灵魂层也无步骤结果时三个灵魂变量均为空', async () => {
        const vars = await buildTemplateVars(makeFullDeps());

        expect(vars.characterCores).toBe('');
        expect(vars.protagonistSoulDetail).toBe('');
        expect(vars.characterSoulReady).toBe('');
    });

    it('世界观与设定库重复时按体检清空设定库并记录 dropped', async () => {
        const text = longWorldText('世界观');
        const ctx = makeContext();
        const data = ctx.data as unknown as {
            world_view: { raw: string; sections: unknown[] };
            setting_lib: { raw: string; sections: unknown[] };
        };
        data.world_view = { raw: text, sections: [] };
        data.setting_lib = { raw: `${text}\n`, sections: [] };

        const vars = await buildTemplateVars(makeFullDeps({ context: ctx }));

        expect(vars.settingLib).toBe('');
        expect(vars._contextHygiene).toContain('duplicate');
        expect(vars._contextHygiene).toContain('settingLib');
    });

    it('体检自动修复关闭时只告警、不清空重复段', async () => {
        const text = longWorldText('世界观');
        const ctx = makeContext();
        const data = ctx.data as unknown as {
            world_view: { raw: string; sections: unknown[] };
            setting_lib: { raw: string; sections: unknown[] };
        };
        data.world_view = { raw: text, sections: [] };
        data.setting_lib = { raw: `${text}\n`, sections: [] };

        const vars = await buildTemplateVars(makeFullDeps({
            context: ctx,
            settings: { contextHygieneAutoFix: false },
        }));

        expect(vars.settingLib).toContain(text);
        expect(vars._contextHygiene).toContain('duplicate');
        expect(JSON.parse(vars._contextHygiene).dropped).toEqual([]);
    });

    it('步骤结果只引用旧章节时写入串章告警', async () => {
        const vars = await buildTemplateVars(makeFullDeps({
            stepResults: { infoPlan: '## 第1章 信息规划\n本章承接第1章结尾。' },
        }));

        expect(vars._contextHygiene).toContain('staleChapter');
    });

    it('仅用户改过的模板才写入 _stepOverrides', async () => {
        const deps = makeFullDeps();
        (deps.plugin as unknown as Record<string, unknown>).promptManager = {
            getTemplateById: (id: string) => (id === 'info-plan' ? { id } : null),
            renderPrompt: () => ({ systemPrompt: '自定义 system', userPrompt: '自定义 user' }),
            config: { customTemplates: [{ id: 'info-plan' }] },
        };

        const vars = await buildTemplateVars(deps);

        expect(JSON.parse(vars._stepOverrides)).toEqual({
            infoPlan: { system: '自定义 system', user: '自定义 user' },
        });
    });

    it('没有自定义模板时不写入 _stepOverrides（避免默认值二份漂移）', async () => {
        const deps = makeFullDeps();
        (deps.plugin as unknown as Record<string, unknown>).promptManager = {
            getTemplateById: (id: string) => (id === 'info-plan' ? { id } : null),
            renderPrompt: () => ({ systemPrompt: '默认 system', userPrompt: '默认 user' }),
            config: { customTemplates: [] },
        };

        const vars = await buildTemplateVars(deps);

        expect(vars._stepOverrides).toBeUndefined();
    });

    it('quota 人味模式与强制正文变体按设置生效', async () => {
        const vars = await buildTemplateVars(makeFullDeps({
            settings: {
                humanVoiceMode: 'quota',
                activeBodyTemplate: 'v2',
                countableHumanHints: true,
                experimentGroup: 'E9',
            },
        }));

        expect(JSON.parse(vars._voiceMeta).id).toBe('voice.quota');
        expect(vars._bodyVariant).toBe('v2');
        expect(vars._countableHints).toBe('1');
        expect(vars._experimentGroup).toBe('E9');
    });
});

function makeCompactContext(): GatheredContext {
    const ctx = makeContext();
    const data = ctx.data as unknown as Record<string, unknown>;
    data.character_state = [
        { name: '沈砚', 角色定位: '主角', 身份: '砂民少年', 当前状态: '复测前' },
        { name: '沈铁山', 身份: '铁匠' },
        { name: '柳婆', 当前状态: '守桥', 核心动机: '护孙' },
        { name: '路人丙' },
    ];
    data.factions = [
        { name: '天阙', 类型: '王朝', 描述: '控制测脉。' },
        { name: '玄门', 类型: '宗门', 领袖: '玄尊', '地位/排名': '第一' },
        { name: '无名帮' },
    ];
    data.locations = [
        { name: '断魂桥', 类型: '关隘', 描述: '砂峡唯一通道。' },
        { name: '落霞谷', 类型: '秘境', '所在世界/区域': '东域', 重要程度: '高' },
        { name: '荒滩' },
    ];
    data.items = [
        { name: '测脉石', 类型: '法器', 描述: '测脉用。' },
        { name: '玄铁令', 类型: '令牌', '品阶/等级': '天级', '所属/归属': '玄门' },
        { name: '破碗' },
    ];
    return ctx;
}

describe('buildEntityVars — compact 涉及实体口径', () => {
    beforeEach(() => {
        mockFindBodyFileV4.mockReturnValue(undefined);
        mockGetInvolvedEntities.mockReturnValue({ chars: [], locs: [], factions: [], items: [] });
    });

    it('compact 模式找不到正文文件时退化为全量实体清单，不抽取涉及实体', async () => {
        const deps = makeFullDeps({ settings: { contextScope: 'compact' } });

        const vars = await buildTemplateVars(deps);

        expect(mockFindBodyFileV4).toHaveBeenCalledWith(deps.app, deps.project, 1, 3);
        expect(mockGetInvolvedEntities).not.toHaveBeenCalled();
        expect(vars.allChars).toContain('定位：主角');
        expect(vars.allChars).toContain('状态：复测前');
    });

    it('compact 模式按涉及实体精简非涉及项，卷名缺章号时回落第 0 卷', async () => {
        const deps = makeFullDeps({ context: makeCompactContext(), settings: { contextScope: 'compact' } });
        deps.volume = '序章';
        const bodyFile = Object.assign(new TFile(), { path: '长篇小说/书A/正文/第1卷/第3章.md' });
        mockFindBodyFileV4.mockReturnValue(bodyFile);
        mockGetInvolvedEntities.mockReturnValue({
            chars: ['沈砚'],
            locs: ['断魂桥'],
            factions: ['天阙'],
            items: ['测脉石'],
        });

        const vars = await buildTemplateVars(deps);

        expect(mockFindBodyFileV4).toHaveBeenCalledWith(deps.app, deps.project, 0, 3);
        expect(mockGetInvolvedEntities).toHaveBeenCalledWith(deps.app, bodyFile);
        // 涉及人物保留全量字段，非涉及人物只留身份/状态/动机摘要
        expect(vars.allChars).toContain('定位：主角');
        expect(vars.allChars).toContain('沈铁山：身份：铁匠');
        expect(vars.allChars).toContain('柳婆：当前状态：守桥；核心动机：护孙');
        // 涉及势力保留描述，非涉及势力只留类型/领袖/地位摘要
        expect(vars.allFactions).toContain('描述：控制测脉。');
        expect(vars.allFactions).toContain('玄门：类型：宗门');
        expect(vars.allFactions).toContain('领袖：玄尊');
        expect(vars.allFactions).toContain('地位：第一');
        // 涉及地点保留描述，非涉及地点只留类型/区域/重要程度摘要
        expect(vars.allLocs).toContain('描述：砂峡唯一通道。');
        expect(vars.allLocs).toContain('落霞谷：类型：秘境');
        expect(vars.allLocs).toContain('区域：东域');
        expect(vars.allLocs).toContain('重要程度：高');
        // 涉及物品保留描述，非涉及物品只留类型/等级/归属摘要
        expect(vars.allItems).toContain('描述：测脉用。');
        expect(vars.allItems).toContain('玄铁令：类型：令牌');
        expect(vars.allItems).toContain('天级');
        expect(vars.allItems).toContain('归属：玄门');
    });

    it('compact 模式抽到空涉及集合时仍按全量输出', async () => {
        const deps = makeFullDeps({ context: makeCompactContext(), settings: { contextScope: 'compact' } });
        mockFindBodyFileV4.mockReturnValue(Object.assign(new TFile(), { path: '长篇小说/书A/正文/第1卷/第3章.md' }));

        const vars = await buildTemplateVars(deps);

        expect(vars.allChars).toContain('沈铁山：身份：铁匠');
        expect(vars.allFactions).toContain('描述：控制测脉。');
        expect(vars.allLocs).toContain('描述：砂峡唯一通道。');
        expect(vars.allItems).toContain('描述：测脉用。');
    });
});

describe('buildEntityVars — 连续性三字段（DSH-20261114-02）', () => {
    beforeEach(() => {
        mockFindBodyFileV4.mockReturnValue(undefined);
        mockGetInvolvedEntities.mockReturnValue({ chars: [], locs: [], factions: [], items: [] });
    });

    it('人物卡更新 已知信息/伤势/持有物品 后 allChars 同步可见（audit §四-2 断点④）', async () => {
        const ctx = makeContext();
        const lead = ctx.data.character_state![0] as Record<string, unknown>;
        lead['伤势'] = '左肋骨裂';
        lead['持有物品'] = '月牙匕';
        lead['已知信息'] = '知晓天阙密令';
        const deps = makeDeps(ctx);
        const vars: Record<string, string> = {};
        await buildEntityVars(deps, vars, ctx.data);

        expect(vars.allChars).toContain('伤势：左肋骨裂');
        expect(vars.allChars).toContain('持有：月牙匕');
        expect(vars.allChars).toContain('已知：知晓天阙密令');
    });

    it('三字段缺省时不出空标签（非空才输出）', async () => {
        const deps = makeDeps(makeContext());
        const vars: Record<string, string> = {};
        await buildEntityVars(deps, vars, {
            character_state: [{ name: '沈砚', 角色定位: '主角', 当前状态: '复测前' }],
        } as unknown as GatheredContext['data']);

        expect(vars.allChars).toContain('状态：复测前');
        expect(vars.allChars).not.toContain('伤势：');
        expect(vars.allChars).not.toContain('持有：');
        expect(vars.allChars).not.toContain('已知：');
    });
});
