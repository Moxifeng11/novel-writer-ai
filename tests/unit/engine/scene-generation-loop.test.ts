import { describe, it, expect, vi } from 'vitest';
import { SceneGenerationLoop, parseSceneBlocks } from '../../../engine/scene-generation-loop';
import type { ChapterStateSnapshot, StoryBeat } from '../../../engine/story-state-types';

// —— 测试数据 ——
const EXPANSION = `## 场景1：雨夜初遇
objective: 找到失落的信物
emotion_arc: 警惕(3) → 动摇(5) — 被对方的镇定震住
conflict: 争夺玉佩
sensory_hook: 铁锈味的雨
memory_trigger: 无
body_reaction: 指尖发凉
subtext: 嘴上质问，心里已信了三分
relationship_shift: 敌对 → 半信半疑
key_scene: ⭐ 名场面
dialogue_function: 揭露玉佩来历
cliffhanger:

## 场景2：巷口缠斗
objective: 摆脱追兵
emotion_arc: 慌乱(7) → 冷静(4) — 想起师父的话
conflict: 狭路相逢
sensory_hook: 湿漉漉的青苔味
memory_trigger: 触发 m003 — 铁锈味勾起旧伤记忆
body_reaction: 拳头自己收紧了
subtext: 说不怕，怕得要命
relationship_shift: 独自面对
key_scene: 否
dialogue_function: 塑造硬汉外壳下的恐惧
cliffhanger:

## scene3: 天台对峙
objective: 问出真相
emotion_arc: 冷静(4) → 决绝(8) — 真相击穿底线
conflict: 真相 vs 情义
sensory_hook: 风声灌进衣领
memory_trigger: 无
body_reaction: 胃部收紧
subtext: 说"我不在乎"，在乎得要死
relationship_shift: 情义 → 决裂
key_scene: 否
dialogue_function: 改变两人关系
cliffhanger: 真相只说了一半`;

const BEATS: StoryBeat[] = [
    { id: 'b1', description: '找到失落的信物', type: 'event', required: true },
    { id: 'b2', description: '摆脱追兵', type: 'conflict', required: true },
];

function makeSnapshot(overrides: Partial<ChapterStateSnapshot> = {}): ChapterStateSnapshot {
    return {
        chapterNumber: 1,
        timeline: { time: '第3天', location: '皇城' },
        povCharacter: '',
        mainGoal: '',
        coreConflict: '',
        requiredBeats: [],
        requiredReveals: [],
        forbiddenReveals: [],
        characterStates: [],
        previousEnding: { action: '', emotion: '', unfinished: '', mustContinue: '' },
        acceptanceCriteria: [],
        ...overrides,
    };
}

function okBody(text: string) { return { content: text, error: null }; }

describe('parseSceneBlocks — 场景拆分（TR-5.1 前置）', () => {
    it('按 ## 场景N：/ ## sceneN: 切分为 3 个场景块', () => {
        const blocks = parseSceneBlocks(EXPANSION);
        expect(blocks).toHaveLength(3);
        expect(blocks[0].num).toBe(1);
        expect(blocks[1].num).toBe(2);
        expect(blocks[2].num).toBe(3);
        expect(blocks[2].name).toBe('天台对峙');
    });

    it('提取核心字段（objective/emotionArc/conflict/cliffhanger）', () => {
        const blocks = parseSceneBlocks(EXPANSION);
        expect(blocks[0].objective).toContain('信物');
        expect(blocks[0].emotionArc).toContain('→');
        expect(blocks[1].conflict).toContain('狭路相逢');
        expect(blocks[2].cliffhanger).toContain('一半');
    });

    it('提取完整场景卡字段（POV/时间/地点/入场/转折/离场）', () => {
        const blocks = parseSceneBlocks(`## 场景1：夜探
pov: 林晚
time: 亥时
location: 书房外
objective: 找到密信
entry_state: 警惕，左手握刀
conflict: 父亲在门内
turn: 听见咳血
exit_state: 决定破门
emotion_arc: 警惕(5) → 恐惧(8)
sensory_hook: 血腥味
memory_trigger: 无
body_reaction: 手指发凉
subtext: 不敢推门
relationship_shift: 怨恨 → 担忧
key_scene: 否
dialogue_function: 揭露病情
cliffhanger: 门后有人
`);
        const scene = blocks[0];
        expect(scene.pov).toBe('林晚');
        expect(scene.time).toBe('亥时');
        expect(scene.location).toBe('书房外');
        expect(scene.entryState).toContain('左手握刀');
        expect(scene.turn).toContain('咳血');
        expect(scene.exitState).toContain('破门');
        expect(scene.relationshipShift).toContain('担忧');
    });

    it('无场景格式时返回空数组，不抛异常', () => {
        expect(parseSceneBlocks('')).toEqual([]);
        expect(parseSceneBlocks('没有场景的普通文本')).toEqual([]);
    });
});

describe('SceneGenerationLoop — TR-5.1 逐场景生成', () => {
    it('3 场景依次生成，每项含正文与校验结果，prevEnding 传递上一场景结尾', async () => {
        const generate = vi.fn(async (_task: any, prevEnding: string) =>
            okBody(prevEnding ? `承接「${prevEnding}」的场景正文` : '第一个场景正文'));
        const loop = new SceneGenerationLoop();
        const result = await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: BEATS,
            generateSceneBody: generate,
        });

        expect(result.scenes).toHaveLength(3);
        expect(result.completedAll).toBe(true);
        expect(result.failedScenes).toEqual([]);
        // 第二个场景收到第一个场景的正文结尾作为 prevEnding
        expect(generate).toHaveBeenCalledTimes(3);
        const secondCall = generate.mock.calls[1];
        expect(secondCall[1]).toContain('第一个场景正文');
        // 每项含场景级校验产物（TR-5.4）
        for (const s of result.scenes) {
            expect(s.body).toBeTruthy();
            expect(s.beatVerify).toBeDefined();
            expect(s.beatVerify.results).toBeDefined();
            expect(Array.isArray(s.conflicts)).toBe(true);
        }
    });
});

describe('SceneGenerationLoop — TR-5.2 失败隔离', () => {
    it('场景 2 生成失败 → 已完成场景保留，失败场景入列，不中断后续', async () => {
        const generate = vi.fn(async (task: any, _prevEnding: string) => {
            if (task.num === 2) throw new Error('AI 超时');
            return okBody(`场景${task.num} 正文`);
        });
        const loop = new SceneGenerationLoop();
        const result = await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: [],
            generateSceneBody: generate,
        });

        expect(result.completedAll).toBe(false);
        expect(result.failedScenes.map((f) => f.task.num)).toEqual([2]);
        expect(result.scenes.map((s) => s.task.num)).toEqual([1, 3]);
        // 失败场景的 prevEnding 传给场景 3 的应是场景 1 的结尾（失败场景被跳过）
        const thirdCall = generate.mock.calls[2];
        expect(thirdCall[1]).toContain('场景1 正文');
    });
});

describe('SceneGenerationLoop — TR-5.3 场景间修正方向（引擎层钩子）', () => {
    it('onSceneComplete 返回修正字符串 → 作为下一场景 directive 传入生成器', async () => {
        const generate = vi.fn(async (_task: any, _prevEnding: string, _directive?: string) => okBody('正文'));
        const loop = new SceneGenerationLoop();
        await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: [],
            generateSceneBody: generate,
            onSceneComplete: async () => '节奏放慢，加入环境描写',
        });
        const secondCall = generate.mock.calls[1];
        expect(secondCall[2]).toBe('节奏放慢，加入环境描写');
    });

    it('onSceneComplete 返回 false → 停止后续场景，返回已完成项', async () => {
        const generate = vi.fn(async () => okBody('正文'));
        const loop = new SceneGenerationLoop();
        const result = await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: [],
            generateSceneBody: generate,
            onSceneComplete: async () => false,
        });
        expect(result.scenes).toHaveLength(1);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(result.aborted).toBe(true);
    });
});

describe('SceneGenerationLoop — 边界', () => {
    it('abort signal → 返回已完成项并标记 aborted', async () => {
        const generate = vi.fn(async () => okBody('正文'));
        const ac = new AbortController();
        const loop = new SceneGenerationLoop();
        const result = await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: [],
            generateSceneBody: async (task: any) => {
                if (task.num === 2) { ac.abort(); throw new Error('aborted'); }
                return okBody('正文');
            },
            signal: ac.signal,
        });
        expect(result.scenes.map((s: any) => s.task.num)).toEqual([1]);
        expect(result.aborted).toBe(true);
    });

    it('空 expansionText → 0 场景，不抛异常', async () => {
        const loop = new SceneGenerationLoop();
        const result = await loop.run({
            expansionText: '',
            snapshot: makeSnapshot(),
            beats: [],
            generateSceneBody: async () => okBody('x'),
        });
        expect(result.scenes).toEqual([]);
        expect(result.completedAll).toBe(true);
    });
});

describe('SceneGenerationLoop — 断点恢复（TR-7.2 resume / Task 10 恢复面板数据源）', () => {
    function makeCheckpoint(overrides: Record<string, unknown>) {
        return {
            projectId: 'p',
            chapter: '第1章',
            sceneNum: 1,
            promptHash: 'h',
            content: '',
            lastAcceptedParagraph: '',
            finishReason: 'scene_done',
            savedAt: 0,
            version: 1,
            ...overrides,
        };
    }

    it('TR-C1: scene_done 断点直接复用正文，不调 generateSceneBody', async () => {
        const generate = vi.fn(async () => okBody('新生成正文'));
        const loop = new SceneGenerationLoop();
        const result = await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: BEATS,
            generateSceneBody: generate,
            resumeCheckpoints: new Map([
                [1, makeCheckpoint({ content: '已确认的场景一正文' })],
            ]),
        });

        expect(generate).toHaveBeenCalledTimes(2); // 仅场景 2/3 重新生成
        expect(result.scenes[0].body).toBe('已确认的场景一正文');
        expect(result.completedAll).toBe(true);
        expect(result.failedScenes).toEqual([]);
        // 恢复场景照常产出场景级校验（TR-5.4 不回归）
        expect(result.scenes[0].beatVerify).toBeDefined();
        expect(Array.isArray(result.scenes[0].conflicts)).toBe(true);
    });

    it('TR-C2: 失败断点（content 为空）不恢复，正常重新生成', async () => {
        const generate = vi.fn(async () => okBody('正文'));
        const loop = new SceneGenerationLoop();
        const result = await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: [],
            generateSceneBody: generate,
            resumeCheckpoints: new Map([
                [1, makeCheckpoint({ content: '', finishReason: 'scene_failed' })],
            ]),
        });

        expect(generate).toHaveBeenCalledTimes(3);
        expect(result.scenes[0].body).toBe('正文');
    });

    it('TR-C2b: 恢复场景的正文结尾作为后续场景 prevEnding 衔接', async () => {
        const generate = vi.fn(async (_task: any, prev: string) =>
            okBody(prev ? `承接：${prev}` : '全新正文'));
        const loop = new SceneGenerationLoop();
        await loop.run({
            expansionText: EXPANSION,
            snapshot: makeSnapshot(),
            beats: [],
            generateSceneBody: generate,
            resumeCheckpoints: new Map([
                [1, makeCheckpoint({ content: '恢复正文的结尾在此' })],
            ]),
        });

        expect(generate.mock.calls[0][1]).toContain('恢复正文的结尾在此');
    });
});
