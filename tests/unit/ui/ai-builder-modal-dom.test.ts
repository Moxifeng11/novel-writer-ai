/**
 * ai-builder-modal-dom.test.ts — AI 世界元素生成器假 DOM 渲染回归（DSH-20261112-13）
 *
 * ai-builder-modal.ts（493 可执行行）此前 0%：空状态 / 多项目矩阵 / 仪表盘
 * 三种入口形态与实体统计聚合内联在 onOpen 的异步初始化里。
 * 桩宿主：contextManager.detectProjects 决定走哪条形态，vault 直读实体文件计数。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));
vi.mock('@/engine/context-manager', () => ({ ContextManager: class {} }));

const { AiBuilderModal } = await import('../../../ui/ai-builder-modal');

function makePluginStub(projects: string[], worldFiles: string[] = []) {
    return {
        ctxManager: {
            detectProjects: vi.fn(async () => projects),
            getProjectDir: vi.fn(async (p: string) => p),
        },
        aiEngine: { callAI: vi.fn(async () => ({ content: '{}' })) },
        settings: { maxOutput: 4096 },
        app: {
            vault: {
                getAbstractFileByPath: (p: string) => (worldFiles.includes(p) ? { path: p } : null),
                read: async (f: { path: string }) => `# ${f.path} 内容`,
            },
        },
        getActiveProject: () => projects[0] ?? null,
    };
}

async function open(plugin: ReturnType<typeof makePluginStub>): Promise<FakeEl> {
    const modal = new AiBuilderModal({} as never, plugin as never);
    modal.onOpen();
    // onOpen 的初始化是异步 IIFE：让微任务跑完
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    return modal.contentEl as unknown as FakeEl;
}

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
});

describe('AiBuilderModal 入口形态', () => {
    it('零项目：渲染空状态引导（不再调用 vault）', async () => {
        const plugin = makePluginStub([]);
        const root = await open(plugin);
        const text = root.allText();
        expect(text).toContain('✨ AI世界元素生成器');
        expect(text).toContain('尚未创建任何项目');
        expect(text).toContain('请先在「完整工作台」中创建小说项目');
        expect(plugin.ctxManager.detectProjects).toHaveBeenCalledTimes(1);
    });

    it('多项目：渲染项目矩阵与副标题', async () => {
        const plugin = makePluginStub(['长篇小说/晨星外传', '短篇小说/雨巷']);
        const root = await open(plugin);
        const text = root.allText();
        expect(text).toContain('✨ AI世界元素生成器');
        expect(text).toContain('选择项目进入世界元素管理');
        expect(text).toContain('晨星外传');
        expect(text).toContain('雨巷');
    });

    it('单项目：进入仪表盘（世界元素工作台文案出现）', async () => {
        const plugin = makePluginStub(['长篇小说/晨星外传']);
        const root = await open(plugin);
        expect(root.allText().length).toBeGreaterThan(10);
    });
});
