import { describe, expect, it, vi } from 'vitest';
import { ContextLoaderController } from '../../../ui/full-writer/context-loader-controller';

/**
 * PF-2（2026-11-10 首屏性能审计）：工作台首次打开时 activeTabId 已是
 * project-selector，onOpen 随后还会 renderProjectSelectorInTab()。
 * loadContext() 若再次 activateTab('project-selector')，项目选择页会被
 * 完整渲染两遍（长篇库每次含多次全库 getFiles），并误弹「已刷新当前页面」。
 * 这里锁住「已在选择页就不再激活」与「不在选择页仍要切回」两个分支。
 */
function makeController(activeTabId: string, project = '') {
    const activateTab = vi.fn(async () => undefined);
    const state = { project, chapterName: '', activeTabId };
    const controller = new ContextLoaderController({
        app: {} as never,
        plugin: {} as never,
        state: state as never,
        contextManager: { gatherAll: vi.fn(), getInfoSummary: () => '' } as never,
        getChapterStateManager: () => ({}) as never,
        getContext: () => ({}) as never,
        setContext: () => undefined,
        activateTab,
        entityStateController: {} as never,
        saveStepResult: vi.fn(),
    });
    return { controller, activateTab };
}

describe('ContextLoaderController — 空项目的首屏渲染次数', () => {
    it('已在项目选择页：不再 activateTab（避免同页二次全量渲染）', async () => {
        const { controller, activateTab } = makeController('project-selector');
        await controller.loadContext();
        expect(activateTab).not.toHaveBeenCalled();
    });

    it('停在其它页签：仍然切回 project-selector', async () => {
        const { controller, activateTab } = makeController('chapter-123');
        await controller.loadContext();
        expect(activateTab).toHaveBeenCalledTimes(1);
        expect(activateTab).toHaveBeenCalledWith('project-selector');
    });
});
