import { describe, it, expect, vi } from 'vitest';
import {
    validateSceneExpansion,
    parseSceneHeadings,
    splitSceneSections,
    generateSceneExpansion,
    SCENE_EXPAND_SYSTEM_PROMPT,
    SCENE_EXPAND_USER_TEMPLATE,
} from '../../../engine/scene-expander';

const VALID_EXPANSION = `## scene1: 林家祠堂
objective: 完成例行祭拜
emotion_arc: 平静(3) → 警觉(6) — 发现牌位被动过
conflict: 直觉告诉我有人来过
sensory_hook: 闻到一股不属于祠堂的香味
memory_trigger: 触发 m001 — 童年那次也闻过这种味
body_reaction: 手指攥紧了香炉边沿
subtext: 嘴上说"今日香火盛"，心里想"有人翻过这里"
relationship_shift: 与林父信任动摇

## scene2: 后山追凶
objective: 追上那个翻过祠堂的人
emotion_arc: 警觉(6) → 狂怒(9) — 看到尸体
conflict: 山路湿滑，对方又快
sensory_hook: 鞋底踩到湿泥
memory_trigger: 无
body_reaction: 牙关咬出血腥味
subtext: 没说话，心里想"必须活捉"
relationship_shift: 无
`;

describe('validateSceneExpansion — 合法展开', () => {
    it('合法 2 场景展开通过校验', () => {
        const r = validateSceneExpansion(VALID_EXPANSION);
        expect(r.valid).toBe(true);
        expect(r.errors).toEqual([]);
    });
});

describe('validateSceneExpansion — 非法场景', () => {
    it('无任何场景应失败', () => {
        const r = validateSceneExpansion('没有任何场景内容');
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('未找到任何场景'))).toBe(true);
    });

    it('缺 objective 字段应报错', () => {
        const bad = `## scene1: A
emotion_arc: 平静(3) → 警觉(6) — x
conflict: y
sensory_hook: z
body_reaction: w
subtext: q
`;
        const r = validateSceneExpansion(bad);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('objective'))).toBe(true);
    });

    it('缺多个必填字段应分别报错', () => {
        const bad = `## scene1: A
objective: x
`;
        const r = validateSceneExpansion(bad);
        expect(r.valid).toBe(false);
        // 至少包含 emotion_arc / conflict / sensory_hook / body_reaction / subtext
        expect(r.errors.some(e => e.includes('emotion_arc'))).toBe(true);
        expect(r.errors.some(e => e.includes('conflict'))).toBe(true);
        expect(r.errors.some(e => e.includes('sensory_hook'))).toBe(true);
        expect(r.errors.some(e => e.includes('body_reaction'))).toBe(true);
        expect(r.errors.some(e => e.includes('subtext'))).toBe(true);
    });

    it('emotion_arc 无 → 符号也无 -> 符号 → 报错', () => {
        const bad = `## scene1: A
objective: x
emotion_arc: 平静(3) 警觉(6) 无箭头
conflict: y
sensory_hook: z
body_reaction: w
subtext: q
`;
        const r = validateSceneExpansion(bad);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('emotion_arc') && e.includes('→'))).toBe(true);
    });

    it('emotion_arc 用 ASCII -> 也算合法', () => {
        const ok = `## scene1: A
objective: x
emotion_arc: 平静(3) -> 警觉(6)
conflict: y
sensory_hook: z
body_reaction: w
subtext: q
`;
        const r = validateSceneExpansion(ok);
        // emotion_arc 校验通过；其余字段齐全
        expect(r.valid).toBe(true);
    });
});

describe('parseSceneHeadings — 场景标题解析', () => {
    it('识别 ### sceneN: 标题（AI 常见输出）', () => {
        const content = '### scene1: 碎砂渡·悬索栈桥边\nobjective: a\n\n### scene2: 测脉碑前\nobjective: b\n';
        const headings = parseSceneHeadings(content);
        expect(headings.map(h => h.name)).toEqual(['碎砂渡·悬索栈桥边', '测脉碑前']);
        expect(headings.map(h => h.index)).toEqual([1, 2]);
        expect(headings[0].start).toBe(0);
    });

    it('识别 ## 场景N：与中文数字序号', () => {
        const content = '## 场景三：祠堂\nobjective: a\n## 场景四：后山\nobjective: b\n';
        const headings = parseSceneHeadings(content);
        expect(headings.map(h => h.index)).toEqual([3, 4]);
        expect(headings.map(h => h.name)).toEqual(['祠堂', '后山']);
    });

    it('支持 #### 标题与无标题（标题为空时仍计数）', () => {
        const content = '#### scene1:\nobjective: a\n### scene2: 标题二\n';
        const headings = parseSceneHeadings(content);
        expect(headings).toHaveLength(2);
        expect(headings[0].name).toBe('');
        expect(headings[1].name).toBe('标题二');
    });

    it('普通段落中的「场景1：」不被误判（必须带标题标记）', () => {
        const content = '场景1：这是正文而不是标题\nobjective: a\n';
        expect(parseSceneHeadings(content)).toHaveLength(0);
    });

    it('splitSceneSections 切出的正文不包含标题行', () => {
        const content = '### scene1: 甲\nobjective: a\n### scene2: 乙\nobjective: b\n';
        const sections = splitSceneSections(content);
        expect(sections).toHaveLength(2);
        expect(sections[0].body.trim().startsWith('objective: a')).toBe(true);
        expect(sections[1].body.trim()).toBe('objective: b');
    });

    it('### sceneN: 格式的展开应通过 validateSceneExpansion', () => {
        const content = `### scene1: 碎砂渡·悬索栈桥边
objective: 收买录事
emotion_arc: 希冀(6.5/10) → 焦虑(4.5/10)
conflict: 录事拒收
sensory_hook: 砂粒打在脸上
memory_trigger: 三年前的测脉礼
body_reaction: 手指攥紧布袋
subtext: 嘴上说再等等，心里想走
key_scene: ⭐ 名场面 — 父亲驼背的瞬间
dialogue_function: 揭露录事做不了主
cliffhanger: 碑后站着天阙的人
`;
        const r = validateSceneExpansion(content);
        expect(r.valid).toBe(true);
    });
});

describe('SCENE_EXPAND prompts 契约', () => {
    it('system prompt 含完整场景卡关键词与占位符', () => {
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('pov');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('entry_state');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('turn');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('exit_state');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('objective');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('emotion_arc');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('sensory_hook');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('memory_trigger');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('subtext');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('${protagonistSoul}');
    });

    it('system prompt 要求入场/离场不同、转折可指认、POV 纪律', () => {
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('entry_state 与 exit_state 必须不同');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('turn 必须是可指认的');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('POV');
    });

    it('user template 含核心占位符与跨章承接占位符', () => {
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${protagonistName}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${chapNum}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${outlineContent}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${emotionPlan}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${triggeredMemories}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${infoPlan}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${prevChapEnding}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${timelineEvents}');
    });

    it('system prompt 含跨章承接与时间线约束', () => {
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('上一章结尾');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('时间');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('信息规划');
    });
});

describe('generateSceneExpansion — 跨章信息注入', () => {
    it('注入信息规划/上一章结尾/时间线', async () => {
        const callAI = vi.fn(async (_system: string, _user: string) => ({ content: '展开结果' }));

        await generateSceneExpansion({ callAI } as never, {
            protagonistName: '林晚',
            chapNum: '3',
            outlineContent: '林晚夜探书房。',
            infoPlan: '信息释放：只揭示半封密信',
            prevChapEnding: '林晚在门外听见父亲咳血。',
            timelineEvents: '- 亥时 | 第2章 | 父亲病倒 | 林晚必须赶回',
            emotionPlan: '警惕(5) → 恐惧(8)',
        });

        const system = String(callAI.mock.calls[0][0]);
        const user = String(callAI.mock.calls[0][1]);
        expect(system).toContain('上一章结尾');
        expect(system).toContain('生成期工艺硬约束');
        expect(user).toContain('林晚在门外听见父亲咳血。');
        expect(user).toContain('只揭示半封密信');
        expect(user).toContain('父亲病倒');
    });

    it('缺失时不留下未替换占位符，并给出明确缺失标记', async () => {
        const callAI = vi.fn(async (_system: string, _user: string) => ({ content: '展开结果' }));

        await generateSceneExpansion({ callAI } as never, {
            protagonistName: '林晚',
            chapNum: '1',
            outlineContent: '开篇。',
        });

        const user = String(callAI.mock.calls[0][1]);
        expect(user).not.toContain('${');
        expect(user).toContain('未执行信息规划');
        expect(user).toContain('无上一章结尾信息');
        expect(user).toContain('无时间线信息');
    });
});
