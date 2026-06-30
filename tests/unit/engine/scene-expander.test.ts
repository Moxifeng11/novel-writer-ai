import { describe, it, expect } from 'vitest';
import {
    validateSceneExpansion,
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

describe('SCENE_EXPAND prompts 契约', () => {
    it('system prompt 含 8 要素关键词与占位符', () => {
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('objective');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('emotion_arc');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('sensory_hook');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('memory_trigger');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('subtext');
        expect(SCENE_EXPAND_SYSTEM_PROMPT).toContain('${protagonistSoul}');
    });

    it('user template 含核心占位符', () => {
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${protagonistName}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${chapNum}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${outlineContent}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${emotionPlan}');
        expect(SCENE_EXPAND_USER_TEMPLATE).toContain('${triggeredMemories}');
    });
});
