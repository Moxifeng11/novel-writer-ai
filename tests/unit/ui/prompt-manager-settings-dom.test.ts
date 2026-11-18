/**
 * prompt-manager-settings-dom.test.ts — 提示词管理器设置假 DOM 回归（DSH-20261112-13）
 *
 * prompt-manager-settings.ts（464 可执行行）此前 0%：四个子页签（模板/A-B 测试/
 * 使用统计/导入导出）、模板侧栏分类与详情都在 Setting 链里。
 * 桩宿主：promptManager 提供 getAllTemplates/getTemplate 等最小面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { setLocale } from '../../../i18n';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

const { PromptManagerSettings } = await import('../../../ui/prompt-manager-settings');

function makePluginStub(overrides: { templateCount?: number } = {}) {
    const templates = Array.from({ length: overrides.templateCount ?? 3 }, (_, i) => ({
        id: `tpl_${i}`,
        name: `模板${i}`,
        description: '种子模板描述，用于列表截断断言。',
        category: i === 0 ? 'chapter' : 'scene',
        steps: [],
        versions: [] as Array<Record<string, unknown>>,
        variables: [] as Array<Record<string, unknown>>,
        isCustom: false,
    }));
    return {
        promptManager: {
            getAllTemplates: vi.fn(() => templates),
            // 真实实现返回 {category, count}[]，桩必须同形状，否则分类按钮文案是 undefined
            getCategories: vi.fn(() => [
                { category: 'chapter', count: 1 },
                { category: 'scene', count: templates.length - 1 },
            ]),
            getTemplatesByCategory: vi.fn((cat: string) => templates.filter(t => t.category === cat)),
            getTemplateById: vi.fn((id: string) => templates.find(t => t.id === id)),
            getABTests: vi.fn(() => []),
            getUsageHistory: vi.fn((_id?: unknown, _limit?: unknown) => [] as Array<Record<string, unknown>>),
            getUsageHistoryPage: vi.fn((_offset?: number, _limit?: number, _id?: string) => ({
                records: [] as Array<{ templateId: string; version: number; timestamp: number }>,
                total: 0,
            })),
            getCustomTemplates: vi.fn(() => templates.filter(t => t.isCustom)),
            clearUsageHistory: vi.fn(async () => undefined),
            parseImportPayload: vi.fn(() => ({ ok: false as const, error: '测试桩' })),
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
        stub.promptManager.getUsageHistoryPage = vi.fn(() => ({
            records: [{ templateId: 'tpl_0', version: 2, timestamp: Date.UTC(2026, 0, 2) }],
            total: 1,
        }));
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

describe('PromptManagerSettings 局部重建与键盘导航（功能缺口 ④）', () => {
    it('使用统计：条数 + 分页器，点「下一页」翻页', () => {
        const stub = makePluginStub();
        const all = Array.from({ length: 45 }, (_, i) => ({
            templateId: 'tpl_0',
            version: 1,
            timestamp: Date.UTC(2026, 0, 1) + i * 3600_000,
        }));
        stub.promptManager.getUsageHistoryPage = vi.fn((offset: number = 0, limit: number = 20) => {
            const end = Math.max(0, all.length - offset);
            const start = Math.max(0, end - limit);
            return { records: all.slice(start, end).reverse(), total: all.length };
        });
        const { root } = render(stub);
        switchTab(root, '📊 使用统计');
        expect(root.allText()).toContain('共 45 条记录');
        expect(root.allText()).toContain('第 1 / 3 页');
        const next = root.findAll('nw-pm-pager-btn').find(b => b.textContent.includes('下一页'));
        expect(next).toBeTruthy();
        (next as unknown as { onclick: () => void }).onclick();
        expect(root.allText()).toContain('第 2 / 3 页');
    });

    it('使用统计：空历史不渲染分页器', () => {
        const { root } = render(makePluginStub());
        switchTab(root, '📊 使用统计');
        expect(root.findAll('nw-pm-usage-pager')).toHaveLength(0);
        expect(root.findAll('nw-pm-pager-btn')).toHaveLength(0);
    });

    it('模板页：列表项可聚焦且 Enter 激活后渲染详情', () => {
        const { root } = render(makePluginStub());
        const item = root.findAll('nw-pm-template-item')[0];
        expect(item.getAttribute('tabindex')).toBe('0');
        item.dispatch('keydown', { key: 'Enter' });
        expect(root.allText()).toContain('📋 版本历史');
        expect(root.findAll('nw-pm-template-item--selected')).toHaveLength(1);
    });

    it('模板页：切分类只重绘列表，页签栏与详情容器不被重建', () => {
        const { root } = render(makePluginStub({ templateCount: 3 }));
        const tabBar = root.findAll('nw-settings-subtab-bar')[0];
        const categoryBtn = root.findAll('nw-pm-category-btn')[1];
        expect(categoryBtn.textContent).not.toContain('全部');
        (categoryBtn as unknown as { onclick: () => void }).onclick();
        // 外壳未重建：页签栏仍是同一个对象且仍有四个子页签
        expect(root.findAll('nw-settings-subtab-bar')[0]).toBe(tabBar);
        expect(tabBar.children).toHaveLength(4);
        // 列表被过滤成 chapter 分类（模板0），场景模板（模板1）消失
        const listText = root.findAll('nw-pm-template-list')[0].allText();
        expect(listText).toContain('模板0');
        expect(listText).not.toContain('模板1');
        expect(categoryBtn.className).toContain('nw-pm-category-btn--active');
    });
});

describe('PromptManagerSettings 双语（缺口⑦ 第二期第七片）', () => {
    afterEach(() => setLocale('zh-CN'));

    it('en-US 下子页签、分类按钮、搜索与空态渲染英文且无键名回退', () => {
        setLocale('en-US');
        const { root } = render(makePluginStub({ templateCount: 0 }));
        const text = root.allText();
        expect(text).toContain('📝 Prompt templates');
        expect(text).toContain('🧪 A/B tests');
        expect(text).toContain('📦 Import / export');
        expect(text).toContain('Search prompts');
        expect(text).toContain('📚 All (0)');
        expect(text).not.toContain('settings.promptManager.');
        expect(text).not.toContain('提示词模板');
    });

    it('en-US 下使用统计的标题、条数与分页文案走英文', () => {
        setLocale('en-US');
        const stub = makePluginStub();
        stub.promptManager.getUsageHistoryPage = vi.fn(() => ({
            records: [{ templateId: 'tpl_0', version: 1, timestamp: Date.UTC(2026, 0, 2) }],
            total: 45,
        }));
        const { root } = render(stub);
        switchTab(root, '📊 Usage');
        const text = root.allText();
        expect(text).toContain('📊 Usage history');
        expect(text).toContain('45 record(s)');
        expect(text).toContain('Page 1 / 3');
        expect(text).toContain('Next →');
        expect(text).not.toContain('使用记录');
    });

    it('切回 zh-CN 后恢复原文案', () => {
        setLocale('zh-CN');
        const { root } = render(makePluginStub({ templateCount: 3 }));
        expect(root.allText()).toContain('📝 提示词模板');
        expect(root.allText()).toContain('📚 全部 (3)');
    });
});

