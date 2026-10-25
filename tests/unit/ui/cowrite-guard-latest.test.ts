import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LiveAnalysisController } from '../../../ui/cowrite/live-analysis-controller';

/**
 * 设定守卫（OOC + 实体状态变更）是异步 AI 调用，而切章是同步的：
 * - 旧章在途结果晚到会写进新章的警告容器与面板 A；
 * - `lastGuardCheck` 跨章保留长度基准，新章更短时输入检查会被长期跳过；
 * - 自动检查在途时点「检查」此前静默丢弃，看起来像按钮坏了。
 */

const noticeMessages: string[] = [];

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<any>();
    class Notice {
        constructor(message: string) {
            noticeMessages.push(String(message));
        }
        setMessage(): this { return this; }
        hide(): void {}
    }
    return { ...actual, Notice };
});

function createFakeEl(): any {
    return {
        empty: vi.fn(),
        createDiv: () => createFakeEl(),
        createEl: () => createFakeEl(),
        createSpan: () => createFakeEl(),
        addEventListener: vi.fn(),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type GuardCtx = {
    view: {
        rightEditor: { value: string };
        engine: { inspectSettingGuard: any; confirmStateChanges: any };
        warningContainer: any;
        plugin: { workspaceManager: { getMonitorPanelA: () => any } };
    };
    isInspectingGuard: boolean;
    guardSeq: number;
    lastGuardCheck: { length: number; at: number } | null;
};

function makeCtx(
    body: string,
    engine?: any,
    panelA: any = null,
): GuardCtx {
    const ctx = Object.create(LiveAnalysisController.prototype) as GuardCtx;
    ctx.view = {
        rightEditor: { value: body },
        engine: engine ?? {
            inspectSettingGuard: vi.fn(async () => ({ oocResult: null, entityChanges: [] })),
            confirmStateChanges: vi.fn(async () => 0),
        },
        warningContainer: createFakeEl(),
        plugin: { workspaceManager: { getMonitorPanelA: () => panelA } },
    };
    ctx.isInspectingGuard = false;
    ctx.guardSeq = 0;
    ctx.lastGuardCheck = null;
    return ctx;
}

function run(ctx: GuardCtx, trigger: 'manual' | 'insert' | 'save' | 'input') {
    return (ctx as unknown as LiveAnalysisController).inspectSettingGuard(trigger);
}

function switchChapter(ctx: GuardCtx) {
    (ctx as unknown as LiveAnalysisController).resetForChapterSwitch();
}

beforeEach(() => {
    noticeMessages.length = 0;
});

describe('LiveAnalysisController — 设定守卫的切章代次', () => {
    it('切章后在途旧结果不写警告容器、不推面板 A', async () => {
        const pending = deferred<any>();
        const engine = {
            inspectSettingGuard: vi.fn(() => pending.promise),
            confirmStateChanges: vi.fn(async () => 0),
        };
        const panelA = { showOOCWarnings: vi.fn(), showEntityChanges: vi.fn() };
        const ctx = makeCtx('字'.repeat(1000), engine, panelA);

        const request = run(ctx, 'input');
        switchChapter(ctx);
        pending.resolve({
            oocResult: { hasOOC: true, score: 40, warnings: ['性格不符'] },
            entityChanges: [{ entityName: '林凡', newStatus: '重伤' }],
        });
        await request;

        expect(panelA.showOOCWarnings).not.toHaveBeenCalled();
        expect(panelA.showEntityChanges).not.toHaveBeenCalled();
        expect(ctx.view.warningContainer.empty).not.toHaveBeenCalled();
    });

    it('切章清空长度基准：新章更短时输入检查不被旧基准拦住', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        await run(ctx, 'input');
        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(1);
        expect(ctx.lastGuardCheck?.length).toBe(1000);

        switchChapter(ctx);
        ctx.view.rightEditor.value = '字'.repeat(500);
        await run(ctx, 'input');

        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(2);
    });

    it('自动检查在途时点「检查」给出提示且不重复发起', async () => {
        const pending = deferred<any>();
        const ctx = makeCtx('字'.repeat(1000), {
            inspectSettingGuard: vi.fn(() => pending.promise),
            confirmStateChanges: vi.fn(async () => 0),
        });

        const first = run(ctx, 'manual');
        await run(ctx, 'manual');

        expect(ctx.view.engine.inspectSettingGuard).toHaveBeenCalledTimes(1);
        expect(noticeMessages.some(m => m.includes('正在进行'))).toBe(true);

        pending.resolve({ oocResult: null, entityChanges: [] });
        await first;
    });

    it('旧请求返回后不释放新请求的锁', async () => {
        const first = deferred<any>();
        const second = deferred<any>();
        let calls = 0;
        const ctx = makeCtx('字'.repeat(1000), {
            inspectSettingGuard: vi.fn(() => (++calls === 1 ? first.promise : second.promise)),
            confirmStateChanges: vi.fn(async () => 0),
        });

        const oldRequest = run(ctx, 'input');
        switchChapter(ctx);
        ctx.view.rightEditor.value = '字'.repeat(600);
        const newRequest = run(ctx, 'input');
        expect(ctx.isInspectingGuard).toBe(true);

        first.resolve({ oocResult: null, entityChanges: [] });
        await oldRequest;
        expect(ctx.isInspectingGuard).toBe(true);

        second.resolve({ oocResult: null, entityChanges: [] });
        await newRequest;
        expect(ctx.isInspectingGuard).toBe(false);
        expect(ctx.lastGuardCheck?.length).toBe(600);
    });

    it('同章正常返回仍写结果（回归）', async () => {
        const ctx = makeCtx('字'.repeat(1000));
        await run(ctx, 'input');
        expect(ctx.view.warningContainer.empty).toHaveBeenCalledTimes(1);
        expect(ctx.isInspectingGuard).toBe(false);
    });
});
