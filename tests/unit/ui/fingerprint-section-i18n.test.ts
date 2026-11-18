/**
 * fingerprint-section-i18n.test.ts — 设置页「写作指纹库」分区双语（缺口⑦ 第二期第十片）
 *
 * 该分区的 render() 先建统计词表、再异步读三级指纹库（模板 / 全局 / 项目）。
 * 这里用假 DOM + 桩库实例，只断言界面文案随语言切换，不碰真实磁盘。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { setLocale } from '../../../i18n';
import { formatWordCount } from '../../../ui/fingerprint-utils';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

const { libraryStub } = vi.hoisted(() => ({
    libraryStub: {
        loadTemplate: async () => [],
        loadGlobal: async () => [],
        loadProject: async () => [{
            name: '样书指纹', id: 'fp-1', scope: 'project', enabled: true,
            source: 'manual', stats: { wordCount: 12000 }, extractedAt: 1_700_000_000_000,
        }],
        setProject() { /* 桩：项目切换不读盘 */ },
        syncFromTemplate: async () => ({ added: [], updated: [] }),
        updateTemplate: async () => undefined,
        updateGlobal: async () => undefined,
        updateProject: async () => undefined,
        deleteTemplate: async () => undefined,
        deleteGlobal: async () => undefined,
        deleteProject: async () => undefined,
        addTemplate: async () => undefined,
        addGlobal: async () => undefined,
        addProject: async () => undefined,
    },
}));

vi.mock('@/engine/style-fingerprint-library', () => ({
    StyleFingerprintLibrary: { get: () => libraryStub },
}));
// vi.mock 会被提升到所有 import 之上，所以这里可以静态 import（也让 check:view-tests 认得这个文件）
import { FingerprintSection } from '../../../ui/settings/fingerprint-section';

/** 桩宿主：plugin 只带分区真正读取的最小字段 */
function makeHost(activeProject: string | null = '示例项目'): SettingsSectionHost {
    const plugin = {
        settings: { extraAiHighFreqWords: ['不禁'], styleKeywordOverrides: {} },
        getActiveProject: () => activeProject,
        app: {},
        aiEngine: {},
        saveSettings: async () => undefined,
    };
    return {
        app: {} as never,
        plugin: plugin as never,
        refresh: vi.fn(),
        reopen: vi.fn(),
    };
}

/** FakeEl 的 textContent 不聚合子节点，这里手动收集 */
function collectText(el: FakeEl): string {
    return [el.textContent, ...el.children.map(collectText)].join('\n');
}

async function renderText(activeProject: string | null = '示例项目'): Promise<string> {
    const section = new FingerprintSection(makeHost(activeProject));
    const container = new FakeEl('div');
    await section.render(container as unknown as HTMLElement);
    return collectText(container);
}

beforeEach(() => {
    setLocale('zh-CN');
    stubCreateDiv();
    stubDocument();
});

afterEach(() => {
    setLocale('zh-CN');
    vi.unstubAllGlobals();
});

describe('FingerprintSection 双语（缺口⑦ 第二期第十片）', () => {
    it('中文默认：标题 / 统计词表 / 三级分组 / 按钮', async () => {
        const text = await renderText();
        expect(text).toContain('🔍 写作指纹库');
        expect(text).toContain('📊 统计词表（追加）');
        expect(text).toContain('只影响风格与 AI 味统计口径，不改变正文判定。');
        expect(text).toContain('模板指纹库（0 个）');
        expect(text).toContain('全局指纹库（0 个）');
        expect(text).toContain('项目指纹库（1 个）· 示例项目');
        expect(text).toContain('➕ 添加模板指纹');
        expect(text).toContain('🔄 从模板同步');
        expect(text).toContain('详情');
    });

    it('en-US：全部界面文案英文化，且不回退成键名', async () => {
        setLocale('en-US');
        const text = await renderText();
        expect(text).toContain('🔍 Writing fingerprints');
        expect(text).toContain('📊 Statistic word lists (extra)');
        expect(text).toContain('Template fingerprints (0)');
        expect(text).toContain('Global fingerprints (0)');
        expect(text).toContain('Project fingerprints (1) · 示例项目');
        expect(text).toContain('➕ Add template fingerprint');
        expect(text).toContain('🔄 Sync from templates');
        expect(text).toContain('Details');
        expect(text).not.toContain('settings.fingerprint.');
    });

    it('字数格式化按语言换单位（万 / k）', () => {
        setLocale('zh-CN');
        expect(formatWordCount(123400)).toBe('12.3万字');
        expect(formatWordCount(880)).toBe('880字');
        setLocale('en-US');
        expect(formatWordCount(123400)).toBe('123.4k words');
        expect(formatWordCount(880)).toBe('880 words');
    });

    it('无活动项目时的空态提示随语言切换', async () => {
        setLocale('zh-CN');
        expect(await renderText(null)).toContain('请先打开一个项目查看项目级指纹');
        setLocale('en-US');
        expect(await renderText(null)).toContain('Open a project first to see project-level fingerprints');
    });
});
