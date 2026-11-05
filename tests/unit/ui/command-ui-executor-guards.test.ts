/**
 * command-ui-executor-guards.test.ts — 执行器级守卫单测
 *
 * pure-helpers-coverage.test.ts 已覆盖命令路由与「无项目」短路；
 * 这里只补两条此前无执行的用户可见行为：
 *   - isBlockedByMode：模式不匹配时在开弹窗之前拦下，并给出可读提示
 *   - warnLegacyCommand：旧版正文命令的弃用提示按命令名去重（只提示一次）
 *
 * 只 mock 会被实例化的两个 Modal 模块，其余依赖走 tests/__mocks__/obsidian.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noticeCalls = vi.hoisted(() => [] as Array<{ message: unknown; timeout?: number | undefined }>);

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class RecordingNotice {
        message: unknown;
        timeout?: number;
        constructor(message: unknown, timeout?: number) {
            this.message = message;
            this.timeout = timeout;
            noticeCalls.push({ message, timeout });
        }
        setMessage(message: unknown): this {
            this.message = message;
            return this;
        }
        hide(): void {}
    }
    return { ...actual, Notice: RecordingNotice };
});

const openSpies = vi.hoisted(() => ({ planBook: vi.fn(), batchChapters: vi.fn() }));

vi.mock('../../../ui/plan-book-modal', () => ({
    PlanBookModal: class {
        constructor() {}
        open(): void { openSpies.planBook(); }
    },
}));

vi.mock('../../../ui/batch-chapters-modal', () => ({
    BatchChaptersModal: class {
        constructor() {}
        open(): void { openSpies.batchChapters(); }
    },
}));

import { CommandUiExecutor } from '@/ui/command-ui-executor';
import { CommandIds } from '@/shared/command-ids';
import { forgetProjectMode } from '@/shared/project-mode';

/** 只提供守卫路径需要的 plugin 成员 */
function makeExecutor(project: string) {
    const plugin = {
        getWorkbenchContext: () => undefined,
        getActiveProject: () => project,
    };
    const executor = new CommandUiExecutor({
        app: { vault: {} },
        plugin,
        getVersionService: () => null,
    } as never);
    return { executor, plugin };
}

describe('command-ui-executor 守卫（模式拦截 / 旧版命令去重）', () => {
    beforeEach(() => {
        noticeCalls.length = 0;
        openSpies.planBook.mockClear();
        openSpies.batchChapters.mockClear();
        forgetProjectMode('短篇创作/书B');
        forgetProjectMode('长篇小说/书A');
        forgetProjectMode('剧本创作/书C');
    });

    afterEach(() => {
        noticeCalls.length = 0;
    });

    it('长篇专属命令在短篇项目下被拦截：不开弹窗，提示命令名与当前模式', async () => {
        const { executor } = makeExecutor('短篇创作/书B');

        await expect(executor.executeCommand(CommandIds.PLAN_BOOK)).resolves.toBe(true);

        expect(openSpies.planBook).not.toHaveBeenCalled();
        const guard = noticeCalls.filter(c => typeof c.message === 'string' && c.message.includes('仅适用于'));
        expect(guard).toHaveLength(1);
        expect(guard[0].message).toContain('AI全书规划');
        expect(guard[0].message).toContain('当前项目是');
    });

    it('模式匹配时放行：长篇项目下同一命令正常打开弹窗', async () => {
        const { executor } = makeExecutor('长篇小说/书A');

        await expect(executor.executeCommand(CommandIds.PLAN_BOOK)).resolves.toBe(true);

        expect(openSpies.planBook).toHaveBeenCalledTimes(1);
        expect(noticeCalls.some(c => typeof c.message === 'string' && c.message.includes('仅适用于'))).toBe(false);
    });

    it('旧版命令弃用提示按命令名去重：连续两次调用只提示一次，弹窗仍打开两次', async () => {
        const { executor } = makeExecutor('长篇小说/书A');

        await executor.executeCommand(CommandIds.BATCH_CHAPTERS);
        await executor.executeCommand(CommandIds.BATCH_CHAPTERS);

        expect(openSpies.batchChapters).toHaveBeenCalledTimes(2);
        const legacy = noticeCalls.filter(c => typeof c.message === 'string' && c.message.includes('属于旧版正文链路'));
        expect(legacy).toHaveLength(1);
        expect(legacy[0].message).toContain('批量写正文〔旧〕');
        expect(legacy[0].message).toContain('v5.0.0');
    });
});
