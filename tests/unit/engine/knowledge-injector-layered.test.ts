/**
 * Task 6: 分层上下文注入显式化 — 测试
 * 对应 spec: story-quality-closed-loop-optimization TR-6.1 ~ TR-6.4
 *
 * 三层契约：
 * - 必须层：任务卡/场景目标/上一场景结尾/人物状态/时间地点/禁止事项，每次场景生成都注入
 * - 按需层：涉及实体完整设定，仅相关性命中才注入（relevanceMatcher 可注入以便 mock）
 * - 低频层：完整世界观/全部档案/大事记等，不进入每次场景 prompt（kind 白名单强制拒绝）
 */
import { describe, it, expect, vi } from 'vitest';
import {
    KnowledgeInjector,
    INJECTION_LAYER_CONTRACT,
    ON_DEMAND_KINDS,
    LOW_FREQUENCY_KINDS,
} from '../../../engine/knowledge-injector';
import type { InjectionContext } from '../../../engine/knowledge-injector';
import type { ChapterStateSnapshot, StoryBeat } from '../../../engine/story-state-types';

function makeInjector(): KnowledgeInjector {
    return new KnowledgeInjector(null as never);
}

function makeSnapshot(overrides: Partial<ChapterStateSnapshot> = {}): ChapterStateSnapshot {
    return {
        chapterNumber: 3,
        timeline: { time: '第3天黄昏', location: '皇城东市' },
        povCharacter: '林晚',
        mainGoal: '拿到密信',
        coreConflict: '追兵将至',
        requiredBeats: [],
        requiredReveals: [],
        forbiddenReveals: ['主角是皇子'],
        characterStates: [
            {
                name: '林晚', emotion: '焦虑', injury: '左臂擦伤',
                goal: '找到信物', secret: '', relationships: '与萧然结盟',
            },
        ],
        previousEnding: { action: '', emotion: '', unfinished: '', mustContinue: '' },
        acceptanceCriteria: [],
        ...overrides,
    };
}

const BEATS: StoryBeat[] = [
    { id: 'b1', description: '在东市与线人接头', type: 'event', required: true },
    { id: 'b2', description: '可插入环境描写', type: 'emotion', required: false },
];

function makeContext(overrides: Partial<InjectionContext> = {}): InjectionContext {
    return {
        projectPath: '/test',
        chapterIndex: 3,
        outline: '林晚在东市与线人接头，追兵逼近。',
        ...overrides,
    };
}

describe('Task 6 分层注入 — 契约常量（TR-6.3 前置）', () => {
    it('INJECTION_LAYER_CONTRACT 覆盖 spec 全部 16 项：必须 6 / 按需 5 / 低频 5', () => {
        const required = Object.values(INJECTION_LAYER_CONTRACT).filter((l) => l === 'required');
        const onDemand = Object.values(INJECTION_LAYER_CONTRACT).filter((l) => l === 'onDemand');
        const low = Object.values(INJECTION_LAYER_CONTRACT).filter((l) => l === 'lowFrequency');
        expect(required.length).toBe(6);
        expect(onDemand.length).toBe(5);
        expect(low.length).toBe(5);
        expect(ON_DEMAND_KINDS.has('worldview')).toBe(false);
        expect(LOW_FREQUENCY_KINDS.has('worldview')).toBe(true);
    });
});

describe('Task 6 分层注入 — TR-6.1 必须层每次生成都注入', () => {
    it('任务卡/场景目标/上一场景结尾/人物状态/时间地点/禁止事项全部出现', async () => {
        const injector = makeInjector();
        const result = await injector.injectForSceneBody(makeContext(), {
            snapshot: makeSnapshot(),
            beats: BEATS,
            sceneObjective: '取得密信并全身而退',
            previousSceneEnding: '线人倒下前塞给她半张纸条',
        });

        expect(result).toContain('在东市与线人接头');   // 任务卡（必做）
        expect(result).toContain('可插入环境描写');     // 任务卡（可选）
        expect(result).toContain('取得密信并全身而退'); // 场景目标
        expect(result).toContain('线人倒下前塞给她半张纸条'); // 上一场景结尾
        expect(result).toContain('林晚');               // 人物状态
        expect(result).toContain('皇城东市');           // 时间地点
        expect(result).toContain('主角是皇子');         // 禁止事项
    });

    it('必做/可选任务卡有明确标记', async () => {
        const injector = makeInjector();
        const result = await injector.injectForSceneBody(makeContext(), { beats: BEATS });
        expect(result).toMatch(/必做[\s\S]*在东市与线人接头/);
        expect(result).toMatch(/可选[\s\S]*可插入环境描写/);
    });

    it('snapshot/beats 缺失时不抛异常，仅注入已提供项', async () => {
        const injector = makeInjector();
        const result = await injector.injectForSceneBody(makeContext(), {
            sceneObjective: '唯一提供的目标',
        });
        expect(result).toContain('唯一提供的目标');
        expect(result).not.toContain('皇城东市');
    });

    it('enabled=false 时返回空串（与现有注入方法语义一致）', async () => {
        const injector = makeInjector();
        injector.setEnabled(false);
        const result = await injector.injectForSceneBody(makeContext(), {
            snapshot: makeSnapshot(),
            beats: BEATS,
        });
        expect(result).toBe('');
    });
});

describe('Task 6 分层注入 — TR-6.2 按需层仅相关时注入', () => {
    const CANDIDATES = [
        { id: 'c1', name: '林晚', content: '林晚的完整小传：前朝遗孤，擅长易容', kind: 'character' },
        { id: 'c2', name: '萧然', content: '萧然的完整小传：皇家暗卫统领', kind: 'character' },
        { id: 'c3', name: '东市', content: '东市设定：鱼龙混杂，三教九流之地', kind: 'location' },
    ];

    it('注入的 relevanceMatcher 命中项才注入，未命中项不出现', async () => {
        const injector = makeInjector();
        const relevanceMatcher = vi.fn(
            (c: { name: string }) => c.name === '林晚'
        );
        const result = await injector.injectForSceneBody(makeContext(), {
            candidates: CANDIDATES,
            relevanceMatcher: relevanceMatcher as never,
        });

        expect(result).toContain('前朝遗孤');
        expect(result).not.toContain('皇家暗卫统领');
        expect(result).not.toContain('鱼龙混杂');
        expect(relevanceMatcher).toHaveBeenCalled();
    });

    it('未提供 matcher 时使用默认相关性：名字出现在 outline/场景目标/出场人物中命中', async () => {
        const injector = makeInjector();
        const result = await injector.injectForSceneBody(
            makeContext({ characterNames: ['林晚'] }),
            { candidates: CANDIDATES }
        );

        // 林晚出现于 outline 与 characterNames → 命中
        expect(result).toContain('前朝遗孤');
        // 萧然、东市仅作为候选名出现与否取决于 outline 是否含其名 —— outline 含"东市"但不含"萧然"
        expect(result).toContain('鱼龙混杂');
        expect(result).not.toContain('皇家暗卫统领');
    });
});

describe('Task 6 分层注入 — TR-6.3 低频层不进入每次场景 prompt', () => {
    it('低频 kind 候选即使 relevanceMatcher 全部命中也被契约拒绝', async () => {
        const injector = makeInjector();
        const candidates = [
            { id: 'w1', name: '世界观全录', content: '完整世界观设定文本：九洲十三国', kind: 'worldview' },
            { id: 'a1', name: '大事记', content: '建国以来全部大事记', kind: 'chronicle' },
            { id: 'c1', name: '林晚', content: '林晚的完整小传', kind: 'character' },
        ];
        const result = await injector.injectForSceneBody(makeContext(), {
            candidates,
            relevanceMatcher: () => true, // 相关性全命中
        });

        // 低频层内容被 kind 白名单拒绝
        expect(result).not.toContain('九洲十三国');
        expect(result).not.toContain('建国以来全部大事记');
        // 按需层正常注入
        expect(result).toContain('林晚的完整小传');
    });
});
