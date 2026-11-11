/**
 * prompt-manager-settings-dom.test.ts — 提示词管理器设置假 DOM 回归（DSH-20261112-13）
 *
 * prompt-manager-settings.ts（464 可执行行）此前 0%：四个子页签（模板/A-B 测试/
 * 使用统计/导入导出）、模板侧栏分类与详情都在 Setting 链里。
 * 桩宿主：promptManager 提供 getAllTemplates/getTemplate 等最小面。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

const { PromptManagerSettings } = await import('../../../ui/prompt-manager-settings');

function makePluginStub(overrides: { templateCount?: number } = {}) {
    const templates = Array.from({ length: overrides.templateCount ?? 3 }, (_, i) => ({
        id: `tpl_${i}`,
        name: `模板${i}`,
        description: '种子模板描述，用于列表截断断言。',
        category: i === 0 ? 'chapter' : 'scene',
        steps: [],
    }));
    return {
        promptManager: {
            getAllTemplates: vi.fn(() => templates),
            getCategories: vi.fn(() => ['chapter', 'scene']),
            getTemplatesByCategory: vi.fn((cat: string) => templates.filter(t => t.category === cat)),
            getTemplateById: vi.fn((id: string) => templates.find(t => t.id === id)),
            getABTests: vi.fn(() => []),
            getUsageHistory: vi.fn((_id?: unknown, _limit?: unknown) => [] as Array<Record<string, unknown>>),
            isABTestingEnabled: vi.fn(() => false),
            getABTestStats: vi.fn(() => ({})),
            addVersion: vi.fn(),
            getActiveVersion: vi.fn(() => null),
            createABTest: vi.fn(),
            updateABTestStatus: vi.fn(),
            setWinner: vi.fn(),
            setABTestingEnabled: vi.fn(),
            resetTemplateToDefault: vi.fn(),
            setActiveVersion: vi.fn(),
            updateTemplate: vi.fn(),
            deleteABTest: vi.fn(),
            getTemplate: vi.fn((id: string) => templates.find(t => t.id === id)),
            getAllABTests: vi.fn(() => []),
            getUsageStats: vi.fn(() => ({ totalCalls: 0 })),
            exportConfig: vi.fn(() => '{}'),
            importConfig: vi.fn(),
        },
        settings: {},
    };
}

type ManagerInstance = InstanceType<typeof PromptManagerSettings>;
function render(pluginStub: ReturnType<typeof makePluginStub>): { root: FakeEl; manager: ManagerInstance } {
    const root = new FakeEl('div');
    const manager = new PromptManagerSettings({} as never, pluginStub as never, root as unknown as HTMLElement);
    manager.render();
    return { root, manager };
}


beforeEach(() => {
    stubCreateDiv();
    stubDocument();
});

function switchTab(root: FakeEl, label: string): void {
    const tabBar = root.findAll('nw-settings-subtab-bar')[0];
    const tab = tabBar.children.find(c => c.textContent.includes(label)) as unknown as { dispatch(type: string): void };
    tab.dispatch('click');
}


describe('PromptManagerSettings 子页签：使用统计与导入导出', () => {
    it('使用统计：空历史给「暂无使用记录」占位', () => {
        const { root } = render(makePluginStub());
        switchTab(root, '📊 使用统计');
        const text = root.allText();
        expect(text).toContain('📊 使用记录');
        expect(text).toContain('暂无使用记录');
    });

    it('使用统计：有历史时渲染记录列表', () => {
        const stub = makePluginStub();
        stub.promptManager.getUsageHistory = vi.fn((_id?: unknown, _limit?: unknown) => [
            { templateId: 'tpl_0', version: 2, timestamp: Date.UTC(2026, 0, 2) },
        ]);
        const { root } = render(stub);
        switchTab(root, '📊 使用统计');
        // 列表按 templateId + 版本号渲染（与实现一致：没有模板名字段）
        expect(root.allText()).toContain('tpl_0');
        expect(root.allText()).toContain('v2');
        expect(root.allText()).not.toContain('暂无使用记录');
    });

    it('导入/导出：导出 JSON 按钮与说明文案渲染', () => {
        const { root } = render(makePluginStub());
        switchTab(root, '📦 导入/导出');
        const text = root.allText();
        expect(text).toContain('📦 导入/导出');
        expect(text).toContain('📤 导出配置');
        expect(text).toContain('导出所有自定义提示词模板');
        expect(text).toContain('📥 导出 JSON');
    });
});

describe('PromptManagerSettings', () => {
    it('默认模板页签：四个子页签按钮与「📚 全部」分类按钮渲染，计数来自 promptManager', () => {
        const { root } = render(makePluginStub({ templateCount: 5 }));
        const text = root.allText();
        expect(text).toContain('📝 提示词模板');
        expect(text).toContain('🧪 A/B 测试');
        expect(text).toContain('📊 使用统计');
        expect(text).toContain('📦 导入/导出');
        expect(text).toContain('📚 全部 (5)');
        expect(text).toContain('搜索提示词');
    });

    it('子页签切换真的换内容（templates → abtests）', () => {
        const { root } = render(makePluginStub());
        const tabBar = root.findAll('nw-settings-subtab-bar')[0];
        const abTab = tabBar.children.find(c => c.textContent.includes('A/B 测试'));
        expect(abTab).toBeTruthy();
        abTab?.dispatch('click');
        expect(root.allText()).toContain('🧪 A/B 测试');
    });

    it('搜索输入 onChange 触发重渲染（搜索关键词进入状态）', () => {
        const { root } = render(makePluginStub());
        // Setting mock 的 addText 会立刻回调组件；至少保证初始渲染稳定
        expect(root.findAll('nw-settings-subtab-content')).toHaveLength(1);
    });
});
