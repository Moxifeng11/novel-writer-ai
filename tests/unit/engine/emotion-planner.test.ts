import { describe, it, expect, vi } from 'vitest';
import {
    validateEmotionPlan,
    generateEmotionPlan,
    EMOTION_PLAN_SYSTEM_PROMPT,
    EMOTION_PLAN_USER_TEMPLATE,
} from '../../../engine/emotion-planner';

const VALID_PLAN = `## 总体情绪曲线
开篇情绪: 平静(3/10) | 高潮情绪: 狂怒(9/10) | 结尾情绪: 释然(5/10)
情绪总变化次数: 3

## 场景级情绪规划

### scene1: 林家祠堂
emotion_start: 平静(3/10) — 例行祭拜
emotion_end: 警觉(6/10) — 发现牌位被动过
emotion_delta: +3
body_reaction: 手指攥紧香炉边沿
relationship_change: 与林父信任动摇

### scene2: 后山追凶
emotion_start: 警觉(6/10) — 跟随血迹
emotion_end: 狂怒(9/10) — 看见尸首
emotion_delta: +3
body_reaction: 牙关咬出血腥味
relationship_change: 无

### scene3: 灯下独坐
emotion_start: 狂怒(9/10) — 余怒
emotion_end: 释然(5/10) — 看见画像
emotion_delta: -4
body_reaction: 长出一口气
relationship_change: 与亡妹羁绊点燃
`;

describe('validateEmotionPlan — 合法情绪规划', () => {
    it('合法的 3 场景规划通过校验', () => {
        const r = validateEmotionPlan(VALID_PLAN);
        expect(r.valid).toBe(true);
        expect(r.errors).toEqual([]);
    });
});

describe('validateEmotionPlan — 非法场景', () => {
    it('完全没有 scene 段应失败', () => {
        const r = validateEmotionPlan('## 总体情绪曲线\n开篇情绪: 平静(3/10)\n（无场景）');
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('未找到任何场景'))).toBe(true);
    });

    it('某场景 emotion_start 和 emotion_end 等级相同 → 报错', () => {
        const bad = `## 总体情绪曲线
开篇情绪: 平静(5/10) | 高潮情绪: 平静(5/10) | 结尾情绪: 平静(5/10)
情绪总变化次数: 0

### scene1: 静态场景
emotion_start: 平静(5/10) — A
emotion_end: 平静(5/10) — B
`;
        const r = validateEmotionPlan(bad);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('scene1') && e.includes('情绪无变化'))).toBe(true);
    });

    it('情绪等级缺失（无 N/10 格式）应报错', () => {
        const bad = `## 总体情绪曲线
开篇: X

### scene1: 缺等级
emotion_start: 模糊感受
emotion_end: 另一种感受
`;
        const r = validateEmotionPlan(bad);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('缺少情绪等级'))).toBe(true);
    });

    it('emotion_start / emotion_end 数量与场景数不匹配', () => {
        const bad = `### scene1: A
emotion_start: 平静(3/10) — x
emotion_end: 警觉(5/10) — y

### scene2: B
emotion_start: 警觉(5/10) — z
`;
        const r = validateEmotionPlan(bad);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('不匹配'))).toBe(true);
    });

    it('缺少「总体情绪曲线」段 → 报错', () => {
        const noOverall = `### scene1: A
emotion_start: 平静(3/10) — x
emotion_end: 警觉(6/10) — y
`;
        const r = validateEmotionPlan(noOverall);
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.includes('总体情绪曲线'))).toBe(true);
    });

    it('多场景中只有一个无变化应只报一处错', () => {
        const partial = `## 总体情绪曲线
开篇情绪: 平静(3/10)

### scene1: 静态
emotion_start: 平静(5/10) — A
emotion_end: 平静(5/10) — B

### scene2: 变化
emotion_start: 警觉(6/10) — x
emotion_end: 狂怒(9/10) — y
`;
        const r = validateEmotionPlan(partial);
        expect(r.valid).toBe(false);
        const noChangeErrors = r.errors.filter(e => e.includes('情绪无变化'));
        expect(noChangeErrors.length).toBe(1);
        expect(noChangeErrors[0]).toContain('scene1');
    });
});

describe('generateEmotionPlan — 调用契约', () => {
    it('必须以 (systemPrompt, userPrompt) 顺序调用 callAI', async () => {
        const callAI = vi.fn(async (_system: string, _user: string) => ({ content: 'plan' }));
        const aiEngine = { callAI } as any;

        const out = await generateEmotionPlan(
            aiEngine,
            {} as any,
            {
                chapNum: '12',
                worldView: '世界观X',
                infoPlan: '规划Y',
                characterCores: '灵魂Z',
            },
            'flash-model',
        );

        expect(out).toBe('plan');
        const [system, user] = callAI.mock.calls[0];
        expect(system).toContain('情绪规划师');
        expect(system).toContain('灵魂Z');
        expect(user).toContain('第12章');
        expect(user).toContain('世界观X');
        expect(user).toContain('规划Y');
    });
});

describe('EMOTION_PLAN prompts 契约', () => {
    it('system prompt 含核心原则关键词与占位符', () => {
        expect(EMOTION_PLAN_SYSTEM_PROMPT).toContain('情绪不是状态');
        expect(EMOTION_PLAN_SYSTEM_PROMPT).toContain('emotion_start');
        expect(EMOTION_PLAN_SYSTEM_PROMPT).toContain('emotion_end');
        expect(EMOTION_PLAN_SYSTEM_PROMPT).toContain('${characterSouls}');
    });

    it('user template 含全部占位符', () => {
        expect(EMOTION_PLAN_USER_TEMPLATE).toContain('${chapNum}');
        expect(EMOTION_PLAN_USER_TEMPLATE).toContain('${infoPlan}');
        expect(EMOTION_PLAN_USER_TEMPLATE).toContain('${distilledContent}');
        expect(EMOTION_PLAN_USER_TEMPLATE).toContain('${outlineContent}');
        expect(EMOTION_PLAN_USER_TEMPLATE).toContain('${chapPlan}');
        expect(EMOTION_PLAN_USER_TEMPLATE).toContain('${characterSouls}');
    });
});

describe('validateEmotionPlan — 全角括号等级（实测回归）', () => {
    it('模型输出用全角（）标注等级时不再误判「缺少情绪等级」', () => {
        const plan = [
            '## 总体情绪曲线',
            '开篇情绪: 紧张（4/10）',
            '',
            '### scene1: 复测',
            'emotion_start: 强压的紧张与侥幸（4/10） — 原因甲',
            'emotion_end: 茫然与寒意（6/10） — 原因乙',
            'emotion_delta: +2',
            'body_reaction: 后背发痒、手心出汗',
            'relationship_change: 无',
        ].join('\n');
        const result = validateEmotionPlan(plan);
        expect(result.errors.filter(e => e.includes('缺少情绪等级'))).toEqual([]);
    });
});
