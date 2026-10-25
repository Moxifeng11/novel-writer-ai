import { describe, it, expect } from 'vitest';
import {
    buildChapterBrief,
    buildBriefPromptParts,
    formatEntityBrief,
    resolveSceneIndex,
    hasUsablePlanning,
    canStartFromBrief,
    type BriefScene,
} from '../../../engine/chapter-brief';
import { PromptBuilder } from '../../../engine/prompt-builder';

const SCENE_EXPANSION = `## scene1: 祠堂惊香
objective: 完成例行祭拜
conflict: 闻到不属于祠堂的香味
sensory_hook: 香灰里混着陌生的甜腻气味
memory_trigger: 触发 m001 — 童年也闻过
body_reaction: 手指攥紧香炉边沿
subtext: 嘴上说"今日香火盛"，心里想"有人翻过这里"
relationship_shift: 与林父信任动摇
key_scene: 牌位前的香灰被人拨动
dialogue_function: 用一句家常话掩盖试探
cliffhanger: 门外传来第二串脚步声
word_count: 1200

## scene2: 后山追凶
objective: 追上翻祠堂的人
conflict: 山路湿滑，对方更快
sensory_hook: 鞋底踩到湿泥
memory_trigger: 无
body_reaction: 牙关咬出血腥味
subtext: 必须活捉
relationship_shift: 无
key_scene: 崖边擦肩
dialogue_function: 无
cliffhanger: 对方消失在旧矿洞口
word_count: 1500

## scene3: 矿洞真相
objective: 进入矿洞查看
conflict: 洞内有人先一步设伏
sensory_hook: 铁锈味混着潮气
memory_trigger: 无
body_reaction: 后背贴住冰凉岩壁
subtext: 这里来过
relationship_shift: 与沈砚结盟
key_scene: 火折子照出墙上的血字
dialogue_function: 用短句交换情报
cliffhanger: 血字指向林父
word_count: 1800

## scene4: 归家对峙
objective: 当面质问林父
conflict: 林父回避眼神
sensory_hook: 堂屋烛火突然爆了一下
memory_trigger: 无
body_reaction: 掌心全是汗
subtext: 他早就知道
relationship_shift: 父子彻底决裂
key_scene: 摔碎祖传茶盏
dialogue_function: 一句反问逼出真相
cliffhanger: 林父说出"你娘没死"
word_count: 900
`;

const EMOTION_PLAN = `## scene1: 祠堂惊香
emotion_start: 平静
emotion_end: 警觉
emotion_delta: 警觉+3

## scene4: 归家对峙
emotion_start: 压抑
emotion_end: 暴怒
emotion_delta: 愤怒+5
`;

const INFO_PLAN = `# 第1章 信息规划

## 信息释放计划
- 本章只释放：祠堂香灰异常、旧矿洞存在
- 暂不释放：林父与矿洞的关系
`;

describe('buildChapterBrief — 场景承接', () => {
    it('解析 4 个场景并保留 8 要素', () => {
        const brief = buildChapterBrief({ sceneExpansion: SCENE_EXPANSION });
        expect(brief.scenes).toHaveLength(4);
        expect(brief.scenes[0].name).toBe('祠堂惊香');
        expect(brief.scenes[0].objective).toBe('完成例行祭拜');
        expect(brief.scenes[0].sensoryHook).toContain('甜腻');
        expect(brief.scenes[0].subtext).toContain('有人翻过这里');
        expect(brief.scenes[3].cliffhanger).toContain('你娘没死');
    });

    it('情绪规划按场景序号合并', () => {
        const brief = buildChapterBrief({ sceneExpansion: SCENE_EXPANSION, emotionPlan: EMOTION_PLAN });
        expect(brief.scenes[0].emotionStart).toBe('平静');
        expect(brief.scenes[0].emotionEnd).toBe('警觉');
        expect(brief.scenes[3].emotionDelta).toBe('愤怒+5');
        expect(brief.scenes[1].emotionStart).toBe('');
    });

    it('缺情绪规划时用 emotion_arc 兜底', () => {
        const expansion = `## scene1: 祠堂惊香
objective: 完成祭拜
emotion_arc: 压抑的希冀(6.5/10) → 压抑的焦虑(4.5/10) — 录事拒收
conflict: 有人翻过这里
`;
        const brief = buildChapterBrief({ sceneExpansion: expansion });
        expect(brief.scenes[0].emotionStart).toBe('压抑的希冀(6.5/10)');
        expect(brief.scenes[0].emotionEnd).toBe('压抑的焦虑(4.5/10)');
    });

    it('兼容加粗与列表形式的字段', () => {
        const expansion = `## scene1: 祠堂惊香
- **objective**：完成祭拜
**conflict**：有人翻过这里
`;
        const brief = buildChapterBrief({ sceneExpansion: expansion });
        expect(brief.scenes[0].objective).toBe('完成祭拜');
        expect(brief.scenes[0].conflict).toBe('有人翻过这里');
    });

    it('空正文从第 1 场开始', () => {
        const brief = buildChapterBrief({ sceneExpansion: SCENE_EXPANSION, bodyText: '' });
        expect(brief.currentIndex).toBe(0);
        expect(brief.currentScene?.name).toBe('祠堂惊香');
        expect(brief.otherScenes).toHaveLength(3);
    });

    it('按累计字数推进当前场景', () => {
        const brief = buildChapterBrief({
            sceneExpansion: SCENE_EXPANSION,
            bodyText: '字'.repeat(1400),
        });
        expect(brief.currentIndex).toBe(1);
        expect(brief.currentScene?.name).toBe('后山追凶');
    });

    it('提取信息释放计划', () => {
        const brief = buildChapterBrief({ sceneExpansion: SCENE_EXPANSION, infoPlan: INFO_PLAN });
        expect(brief.infoRelease).toContain('祠堂香灰异常');
        expect(brief.infoRelease).not.toContain('# 第1章 信息规划');
    });

    it('无规划时不具备冷启动能力', () => {
        const brief = buildChapterBrief({});
        expect(hasUsablePlanning(brief)).toBe(false);
        expect(canStartFromBrief(brief, false)).toBe(false);
        expect(canStartFromBrief(brief, true)).toBe(true);
    });

    it('有 Scene 展开且正文为空时允许冷启动', () => {
        const brief = buildChapterBrief({ sceneExpansion: SCENE_EXPANSION });
        expect(canStartFromBrief(brief, false)).toBe(true);
    });

    it('剥离规划文件的 YAML frontmatter', () => {
        const fm = '---\nstep_status: generated\ntags:\n  - 大纲摘要\n---\n';
        const brief = buildChapterBrief({
            outline: `${fm}**全书定位**：开篇`,
            infoPlan: `${fm}${INFO_PLAN}`,
            sceneExpansion: `${fm}${SCENE_EXPANSION}`,
            emotionPlan: `${fm}${EMOTION_PLAN}`,
        });
        expect(brief.outlineSummary).toBe('**全书定位**：开篇');
        expect(brief.outlineSummary).not.toContain('step_status');
        expect(brief.infoRelease).toContain('祠堂香灰异常');
        expect(brief.infoRelease).not.toContain('step_status');
        expect(brief.scenes.length).toBe(4);
        expect(brief.scenes[0].emotionEnd).toBe('警觉');
    });
});

describe('resolveSceneIndex', () => {
    const scenes: BriefScene[] = [
        { index: 1, name: 'a', objective: '', conflict: '', sensoryHook: '', memoryTrigger: '', bodyReaction: '', subtext: '', relationshipShift: '', keyScene: '', dialogueFunction: '', cliffhanger: '', emotionStart: '', emotionEnd: '', emotionDelta: '', wordCountEstimate: 1000 },
        { index: 2, name: 'b', objective: '', conflict: '', sensoryHook: '', memoryTrigger: '', bodyReaction: '', subtext: '', relationshipShift: '', keyScene: '', dialogueFunction: '', cliffhanger: '', emotionStart: '', emotionEnd: '', emotionDelta: '', wordCountEstimate: 1000 },
    ];

    it('0 字指向第 1 场', () => {
        expect(resolveSceneIndex(scenes, 0)).toBe(0);
    });

    it('超出总预算时停在第 2 场', () => {
        expect(resolveSceneIndex(scenes, 5000)).toBe(1);
    });
});

describe('buildBriefPromptParts', () => {
    it('当前场景 8 要素完整，其余场景只给索引', () => {
        const brief = buildChapterBrief({
            sceneExpansion: SCENE_EXPANSION,
            emotionPlan: EMOTION_PLAN,
            infoPlan: INFO_PLAN,
            outline: '本章大纲：主角发现祠堂被人动过。',
        });
        const text = buildBriefPromptParts(brief).join('\n');
        expect(text).toContain('【当前场景设计——必须落地，不得跳过】');
        expect(text).toContain('objective（角色目的）：完成例行祭拜');
        expect(text).toContain('subtext（潜台词）');
        expect(text).toContain('情绪曲线：平静 → 警觉');
        expect(text).toContain('【本章信息释放计划');
        expect(text).toContain('第2场 后山追凶');
        // 后续场景不应展开冲突细节，避免提前写完
        expect(text).not.toContain('崖边擦肩');
    });

    it('无场景时返回空数组', () => {
        const brief = buildChapterBrief({ outline: '只有大纲' });
        expect(buildBriefPromptParts(brief)).toEqual([]);
    });
});

describe('formatEntityBrief — 中文字段映射', () => {
    it('人物读取 姓名/人物背景/当前状态', () => {
        const text = formatEntityBrief([
            { 姓名: '裴无极', 身份: '宗门弃徒', 人物背景: '被逐出师门后独自修行', 当前状态: '重伤未愈', tags: ['主角'] },
        ]);
        expect(text).toContain('裴无极');
        expect(text).toContain('宗门弃徒');
        expect(text).toContain('重伤未愈');
        expect(text).toContain('主角');
    });

    it('地点读取 名称/描述', () => {
        const text = formatEntityBrief([{ 名称: '落霞镇', 描述: '边陲小镇，常年有雾' }]);
        expect(text).toBe('落霞镇：边陲小镇，常年有雾');
    });

    it('旧英文字段仍然可用', () => {
        const text = formatEntityBrief([{ name: 'Lin', description: 'young hunter', state: 'injured' }]);
        expect(text).toContain('Lin');
        expect(text).toContain('young hunter');
        expect(text).toContain('injured');
    });

    it('无名字的实体被跳过，不产生 “：”', () => {
        const text = formatEntityBrief([{ 描述: '没有名字' }]);
        expect(text).toBe('');
    });
});

describe('PromptBuilder — 简报注入与去重', () => {
    const snapshot = {
        chapPlan: 'SCENE_RAW_PLAN',
        sceneExpansion: 'SCENE_RAW_EXPANSION',
        allChars: '裴无极：宗门弃徒',
    };

    it('有简报时不再重复注入整段场景展开', () => {
        const builder = new PromptBuilder(() => snapshot);
        const { user } = builder.buildSuggestionPrompt(
            '前文一句。',
            'action',
            '',
            '',
            '',
            undefined,
            undefined,
            undefined,
            ['【本章写作简报】当前写第 1 场']
        );
        expect(user).toContain('【本章写作简报】');
        expect(user).not.toContain('SCENE_RAW_EXPANSION');
        expect(user).not.toContain('SCENE_RAW_PLAN');
        expect(user).toContain('裴无极：宗门弃徒');
    });

    it('无简报时保留原有大纲与场景展开', () => {
        const builder = new PromptBuilder(() => snapshot);
        const { user } = builder.buildSuggestionPrompt('前文一句。', 'action', '', '', '');
        expect(user).toContain('【场景展开】');
        expect(user).toContain('SCENE_RAW_EXPANSION');
    });
});

describe('PromptBuilder — 同人约束注入', () => {
    const FANFIC_CTX = [
        '【同人创作约束（最高优先级，违反即返工）】',
        '原作：《测试原作》',
        '【原作核心设定】',
        '- 力量体系：灵脉九境，越境必遭反噬',
        '【创作规则】',
        '- 必须遵守：主角不得提前突破第三境',
    ].join('\n');

    it('同人项目：约束进入续写 prompt，且排在简报之前', () => {
        const builder = new PromptBuilder(() => ({ fanficRulesContext: FANFIC_CTX }));
        const { user, system } = builder.buildSuggestionPrompt(
            '前文一句。', 'action', '', '', '', undefined, undefined, undefined,
            ['【本章写作简报】当前写第 1 场']
        );
        expect(user).toContain('【同人创作约束（最高优先级，违反即返工）】');
        expect(user).toContain('灵脉九境');
        expect(user.indexOf('【同人创作约束')).toBeLessThan(user.indexOf('【本章写作简报】'));
        // 同人约束属于正文内容约束，不进入静态 system
        expect(system).not.toContain('灵脉九境');
    });

    it('原创项目：无同人约束时 prompt 不出现该块', () => {
        const builder = new PromptBuilder(() => ({ fanficRulesContext: '' }));
        const { user } = builder.buildSuggestionPrompt('前文一句。', 'action', '', '', '');
        expect(user).not.toContain('【同人创作约束');
    });

    it('选区改写同样受同人约束', () => {
        const builder = new PromptBuilder(() => ({ fanficRulesContext: FANFIC_CTX }));
        const prompt = builder.buildRewritePrompt('原句。', '前文。', '后文。', '', 'description');
        expect(prompt).toContain('【同人创作约束（最高优先级，违反即返工）】');
    });
});
