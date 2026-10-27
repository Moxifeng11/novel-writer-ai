/**
 * Task 10 遗留项 — createSceneBodyGenerator 组装器测试
 * 验证 generateSceneBody 回调正确组装 injectForSceneBody + callAI。
 */
import { describe, it, expect, vi } from 'vitest';
import {
    createSceneBodyGenerator,
    buildUserPrompt,
    type SceneBodyGeneratorDeps,
} from '../../../engine/scene-body-generator';
import type { SceneTask } from '../../../engine/scene-generation-loop';

function makeTask(overrides: Partial<SceneTask> = {}): SceneTask {
    return {
        num: 1,
        name: '雨夜对峙',
        objective: '主角在雨夜与仇人对峙',
        emotionArc: '紧张 → 爆发',
        conflict: '多年恩怨集中爆发',
        sensoryHook: '雨声与血腥味',
        memoryTrigger: '旧伤复发',
        bodyReaction: '握拳颤抖',
        subtext: '另有隐情',
        cliffhanger: '仇人道出真相',
        rawBlock: '',
        ...overrides,
    };
}

function makeDeps(overrides: Partial<SceneBodyGeneratorDeps> = {}): SceneBodyGeneratorDeps {
    return {
        projectPath: '测试项目',
        model: 'flash-model',
        injectForSceneBody: vi.fn(async () => '【本章必须遵循】\n当前场景目标：主角在雨夜与仇人对峙'),
        callAI: vi.fn(async () => ({ content: '正文段落。', error: undefined })),
        ...overrides,
    };
}

describe('createSceneBodyGenerator — 组装与调用', () => {
    it('正常生成：调用注入与 callAI，返回正文', async () => {
        const deps = makeDeps();
        const generate = createSceneBodyGenerator(deps);

        const result = await generate(makeTask(), '上一场景结尾', undefined);

        expect(deps.injectForSceneBody).toHaveBeenCalledTimes(1);
        expect(deps.callAI).toHaveBeenCalledTimes(1);
        expect(result.content).toBe('正文段落。');
        expect(result.error).toBeNull();
    });

    it('注入时传入逐场景的 sceneObjective 与 previousSceneEnding', async () => {
        const deps = makeDeps();
        const generate = createSceneBodyGenerator(deps);

        await generate(makeTask(), '衔接结尾', undefined);

        const injectCall = (deps.injectForSceneBody as ReturnType<typeof vi.fn>).mock.calls[0];
        const context = injectCall[0];
        const options = injectCall[1];
        expect(context.sceneObjective).toBe('主角在雨夜与仇人对峙');
        expect(context.previousSceneEnding).toBe('衔接结尾');
        expect(options.sceneObjective).toBe('主角在雨夜与仇人对峙');
        expect(options.previousSceneEnding).toBe('衔接结尾');
    });

    it('callAI 返回 error 时透传 error', async () => {
        const deps = makeDeps({
            callAI: vi.fn(async () => ({ content: '', error: 'rate_limited' })),
        });
        const generate = createSceneBodyGenerator(deps);

        const result = await generate(makeTask(), '', undefined);
        expect(result.error).toBe('rate_limited');
    });

    it('注入抛异常时不崩溃，返回 error', async () => {
        const deps = makeDeps({
            injectForSceneBody: vi.fn(async () => { throw new Error('注入失败'); }),
        });
        const generate = createSceneBodyGenerator(deps);

        const result = await generate(makeTask(), '', undefined);
        expect(result.content).toBe('');
        expect(result.error).toBe('注入失败');
    });
});

describe('buildUserPrompt — prompt 组装', () => {
    it('包含任务卡 8 要素、上一场景结尾、修正方向与注入内容', () => {
        const prompt = buildUserPrompt(
            makeTask(),
            '上一场景结尾',
            '修正方向：更有压迫感',
            '【本章必须遵循】\n当前场景目标：主角在雨夜与仇人对峙',
        );

        expect(prompt).toContain('场景 1：雨夜对峙');
        expect(prompt).toContain('- 场景目标：主角在雨夜与仇人对峙');
        expect(prompt).toContain('- 情绪弧线：紧张 → 爆发');
        expect(prompt).toContain('- 冲突：多年恩怨集中爆发');
        expect(prompt).toContain('- 结尾钩子：仇人道出真相');
        expect(prompt).toContain('上一场景结尾');
        expect(prompt).toContain('修正方向：更有压迫感');
        expect(prompt).toContain('【本章必须遵循】');
    });

    it('包含完整场景卡：POV/时间/地点/入场/转折/离场', () => {
        const prompt = buildUserPrompt(
            makeTask({
                pov: '林晚',
                time: '亥时',
                location: '书房外',
                entryState: '警惕，左手握刀',
                turn: '听见咳血',
                exitState: '决定破门',
                relationshipShift: '对父亲从怨恨转为担忧',
                dialogueFunction: '揭露父亲隐瞒病情',
            }),
            '',
            undefined,
            '',
        );

        expect(prompt).toContain('- POV：林晚');
        expect(prompt).toContain('- 时间：亥时');
        expect(prompt).toContain('- 地点：书房外');
        expect(prompt).toContain('- 入场状态：警惕，左手握刀');
        expect(prompt).toContain('- 场景转折：听见咳血');
        expect(prompt).toContain('- 离场状态：决定破门');
        expect(prompt).toContain('- 关系变化：对父亲从怨恨转为担忧');
        expect(prompt).toContain('- 对话功能：揭露父亲隐瞒病情');
    });

    it('无修正方向与注入时仍可组装（不出现空标题）', () => {
        const prompt = buildUserPrompt(makeTask(), '', undefined, '');
        expect(prompt).toContain('【场景任务卡】');
        expect(prompt).not.toContain('【用户修正方向】');
    });
});
