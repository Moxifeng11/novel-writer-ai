import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { LiveAnalysisController } from '../../../ui/cowrite/live-analysis-controller';
import { GUARD_INPUT_COOLDOWN_MS, GUARD_INPUT_MIN_GROWTH_CHARS } from '../../../shared/thresholds';

/**
 * 「输入」触发的设定守卫在每次停顿（8s）后都会执行，而实体状态检测会把正文前
 * 6000 字发给 AI：连续写作时等于每停一次就全量重扫一遍。这里锁定节流口径——
 * 正文新增不足门槛且未过冷却时跳过；插入/保存/手动检查不受限。
 */

type FakeEl = {
    empty: () => void;
    createDiv: (opts?: { text?: string; cls?: string }) => FakeEl;
};

function createFakeEl(): FakeEl {
    const el: FakeEl = {
        empty: vi.fn(),
        createDiv: () => createFakeEl(),
    };
    return el;
}

type GuardCtx = {
    view: {
        rightEditor: { value: string };
        engine: { inspectSettingGuard: any };
        warningContainer: FakeEl | null;
        plugin: { workspaceManager: { getMonitorPanelA: () => null } };
    };
    isInspectingGuard: boolean;
    guardSeq: number;
    lastGuardCheck: { length: number; at: number } | null;
};

function makeCtx(body: string): GuardCtx {
    const ctx = Object.create(LiveAnalysisController.prototype) as GuardCtx;
    ctx.view = {
        rightEditor: { value: body },
        engine: {
            inspectSettingGuard: vi.fn(async () => ({ oocResult: null, entityChanges: [] })),
        },
        warningContainer: createFakeEl(),
        plugin: { workspaceManager: { getMonitorPanelA: () => null } },
    };
    ctx.isInspectingGuard = false;
    ctx.guardSeq = 0;
    ctx.lastGuardCheck = null;
    return ctx;
}

function run(ctx: GuardCtx, trigger: 'manual' | 'insert' | 'save' | 'input') {
    return (ctx as unknown as LiveAnalysisController).inspectSettingGuard(trigger);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('LiveAnalysisController — 输入触发的设定守卫节流', () => {
    it('首次输入触发会执行检查', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        await run(ctx, 'input');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(1);
    });

    it('新增字数不足门槛且未过冷却时跳过', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        await run(ctx, 'input');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(1);

        // 只多写了不到 300 字，且同一时刻
        ctx.view.rightEditor.value = '字'.repeat(1000 + GUARD_INPUT_MIN_GROWTH_CHARS - 1);
        await run(ctx, 'input');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(1);
    });

    it('新增字数达到门槛后重新检查', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        await run(ctx, 'input');

        ctx.view.rightEditor.value = '字'.repeat(1000 + GUARD_INPUT_MIN_GROWTH_CHARS);
        await run(ctx, 'input');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(2);
    });

    it('冷却时间到后即使没有新增也重新检查', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        await run(ctx, 'input');

        ctx.lastGuardCheck = {
            length: 1000,
            at: Date.now() - GUARD_INPUT_COOLDOWN_MS,
        };
        await run(ctx, 'input');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(2);
    });

    it('插入 / 保存 / 手动检查不受节流限制', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        await run(ctx, 'input');

        await run(ctx, 'insert');
        await run(ctx, 'save');
        await run(ctx, 'manual');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(4);
    });

    it('检查失败也记录时间，避免每次停顿重试全量检测', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        ctx.view.engine.inspectSettingGuard.mockRejectedValueOnce(new Error('AI 调用失败'));

        await run(ctx, 'input');
        expect(ctx.lastGuardCheck).toEqual({ length: 1000, at: Date.now() });

        // 失败后紧接着的输入应被节流跳过，而不是立刻重试
        await run(ctx, 'input');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(1);
    });
});
