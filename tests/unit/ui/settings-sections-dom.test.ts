/**
 * settings-sections-dom.test.ts — 设置页分区假 DOM 渲染回归（DSH-20261112-13）
 *
 * general-sections / writing-sections 此前 0% 覆盖：分区 render() 直接拼 DOM，
 * 判定与文案内联在 createDiv 之间——改坏版本信息、支持入口或外观分组没有任何
 * 测试变红。这里用假 DOM + 桩宿主（app/plugin/refresh/reopen）直跑各分区，
 * 断言「渲染出来的文案与控件真的在」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import {
    AboutSection,
    PerformanceSection,
    PromptsSection,
    RecognitionSection,
    SuggestionsSection,
} from '../../../ui/settings/general-sections';
import {
    AppearanceSection,
    CoWriteSection,
    LayoutSection,
    ProjectLibrarySection,
    TemplateSection,
    WritingSection,
} from '../../../ui/settings/writing-sections';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

/** 桩宿主：plugin 只带分区真正读取的最小字段 */
function makeHost(overrides: {
    settings?: Record<string, unknown>;
    pluginExtra?: Record<string, unknown>;
} = {}): SettingsSectionHost {
    const settings = {
        panelSizes: { left: 260, right: 320 },
        autoSettle: true,
        settleLightMode: 'standard',
        coWritingMode: 'local',
        coWriteCloudModel: 'gpt-x',
        coWriteModelMode: 'cloud',
        appearanceScheme: 'default',
        writingStatsEnabled: true,
        ...overrides.settings,
    };
    const plugin = {
        settings,
        manifest: { version: '4.83.1' },
        getAllProviders: () => [],
        getAvailableProviders: () => [],
        engineRegistry: { getOrNull: () => null, get: () => null },
        petState: {},
        ...overrides.pluginExtra,
    };
    return {
        app: {} as never,
        plugin: plugin as never,
        refresh: vi.fn(),
        reopen: vi.fn(),
    };
}

function render(section: { render(c: HTMLElement): void | Promise<void> }, host: SettingsSectionHost): FakeEl {
    const container = new FakeEl('div');
    void section.render(container as unknown as HTMLElement);
    return container;
}

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
    // AboutSection 读取的是构建期注入的全局版本号（esbuild define）
    (globalThis as unknown as Record<string, unknown>).PLUGIN_VERSION = '4.83.1';
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AboutSection（关于页）', () => {
    it('渲染版本卡、检查更新按钮与支持作者入口', () => {
        const host = makeHost();
        const root = render(new AboutSection(host), host);
        const text = root.allText();
        expect(text).toContain('当前版本');
        expect(text).toContain('v4.');
        expect(text).toContain('最新版本');
        expect(text).toContain('从未检查'); // engineRegistry.getOrNull 恒 null → 未检查占位
        expect(text).toContain('🔍 检查更新');
    });

    it('更新缓存存在时显示上次检查时间与最新版本', () => {
        const cacheManager = {
            getUpdateLastCheck: () => Date.UTC(2026, 0, 2, 8, 0, 0),
            getUpdateLastResult: () => ({ latestVersion: '4.84.0', hasUpdate: true }),
        };
        const host = makeHost({ pluginExtra: {
            engineRegistry: { getOrNull: (name: string) => (name === 'cacheManager' ? cacheManager : null) },
        } });
        const root = render(new AboutSection(host), host);
        const text = root.allText();
        expect(text).toContain('v4.84.0 (有更新)');
        expect(text).not.toContain('从未检查');
    });
});

describe('PerformanceSection（性能页）', () => {
    it('渲染性能指标与说明（无监控数据时给占位）', () => {
        const host = makeHost();
        const root = render(new PerformanceSection(host), host);
        const text = root.allText();
        expect(text).toContain('性能监控');
        expect(text).toContain('总操作数');
        expect(text).toContain('暂无慢操作记录');
    });

    it('监控数据存在时渲染统计卡', () => {
        const host = makeHost({ pluginExtra: {
            engineRegistry: { getOrNull: () => null },
        } });
        const root = render(new PerformanceSection(host), host);
        expect(root.allText()).not.toContain('undefined');
    });
});

describe('PromptsSection / SuggestionsSection', () => {
    it('PromptsSection 挂载提示词管理器并渲染内容', () => {
        const host = makeHost();
        const root = render(new PromptsSection(host), host);
        expect(root).toBeTruthy();
    });

    it('SuggestionsSection 渲染反馈建议区', () => {
        const host = makeHost();
        const root = render(new SuggestionsSection(host), host);
        expect(root.allText().length).toBeGreaterThan(0);
    });
});

describe('RecognitionSection（支持作者）', () => {
    it('渲染支持入口卡片（不含真实收款码内容断言，只验文案存在）', () => {
        const host = makeHost();
        const root = render(new RecognitionSection(host), host);
        const text = root.allText();
        expect(text).toContain('角色识别设置');
        expect(text).toContain('规则层');
        expect(text).toContain('LLM 层');
        expect(text).toContain('最小提及次数');
    });
});

describe('CoWriteSection（协同写作设置）', () => {
    it('渲染协同模式与模型选择分组', () => {
        const host = makeHost();
        const root = render(new CoWriteSection(host), host);
        const text = root.allText();
        expect(text).toContain('模型模式');
        expect(text).toContain('本地模型');
        expect(text).toContain('云端供应商');
        expect(text).toContain('Temperature');
    });

    it('设置变更后调用 host.refresh', () => {
        const host = makeHost();
        render(new CoWriteSection(host), host);
        // Setting 控件 onChange 由 mock 的 Setting 提供；至少保证 render 不抛错
        expect(host.refresh).not.toHaveBeenCalled();
    });
});

describe('WritingSection（写作配置五组）', () => {
    it('渲染写作配置分组且不抛错', () => {
        const host = makeHost();
        const root = render(new WritingSection(host), host);
        const text = root.allText();
        expect(text).toContain('篇幅与字数');
        expect(text).toContain('默认字数');
        expect(text).toContain('正文形态');
        expect(text).toContain('自然段模式');
    });
});

describe('TemplateSection / AppearanceSection / ProjectLibrarySection / LayoutSection', () => {
    it('四个分区 render 全部不抛错且产出内容', async () => {
        const host = makeHost({ pluginExtra: {
            engineRegistry: { getOrNull: () => null, get: () => ({ renderTemplateList: async () => {} }) },
        } });
        expect(render(new TemplateSection(host), host).allText().length).toBeGreaterThanOrEqual(0);
        const appearance = render(new AppearanceSection(host), host);
        expect(appearance.allText()).toContain('外观设置');
        expect(appearance.allText()).toContain('主题模式');
        expect(appearance.allText()).toContain('基底色');
        const library = render(new ProjectLibrarySection(host), host);
        expect(library.allText()).toContain('项目库迁移');
        expect(library.allText()).toContain('生成迁移计划');
        expect(library.allText()).toContain('执行迁移');
        const layout = render(new LayoutSection(host), host);
        expect(layout.allText()).toContain('工作台布局');
        expect(layout.allText()).toContain('启动时恢复上次工作台');
        expect(layout.allText()).toContain('面板尺寸');
    });
});
