/**
 * 设置弹窗分组化测试（2026-11-16，S-07）
 *
 * 弹窗 tab 栏由「20 个平铺按钮」改为「一级分组标题 + 组内 tab」两行布局，
 * 并接入同一套搜索。这里用假 DOM + 桩分区验证外壳结构。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../../i18n';
import { FakeEl } from './support/fake-dom';

vi.mock('obsidian', () => {
    class Modal {
        app: unknown;
        modalEl: FakeEl;
        titleEl: FakeEl;
        contentEl: FakeEl;
        containerEl: FakeEl;
        constructor(app: unknown) {
            this.app = app;
            this.modalEl = new FakeEl('div');
            this.titleEl = new FakeEl('div');
            this.contentEl = new FakeEl('div');
            this.containerEl = new FakeEl('div');
        }
        setTitle(_text: string): void {}
        open(): void {}
        close(): void {}
    }
    return { Modal, App: class {}, Notice: class {}, Setting: class {} };
});

// vi.mock 工厂会被提升到文件顶部，顶层 const 此时尚未初始化 → 用 vi.hoisted
const { GROUPS, TABS } = vi.hoisted(() => ({
    GROUPS: [
        { id: 'connect', label: '🔌 连接与模型', tabs: ['api', 'mcp'] },
        { id: 'writing', label: '✍️ 写作与协同', tabs: ['writing', 'suggestions'] },
    ],
    TABS: [
        { id: 'api', label: '🔌 API 配置', group: 'primary' },
        { id: 'mcp', label: '🔌 MCP 服务', group: 'primary' },
        { id: 'writing', label: '✍️ 写作配置', group: 'primary' },
        { id: 'suggestions', label: '💡 建议设置', group: 'advanced' },
    ],
}));

vi.mock('../../../ui/settings/section-factory', () => ({
    SETTINGS_GROUPS: GROUPS,
    SETTINGS_TAB_DEFINITIONS: TABS.map(tab => ({ ...tab, create: () => ({ render: () => {} }) })),
    createSettingsSection: () => ({ render: () => {}, asyncLoad: false }),
}));

import { MiniSettingsModal } from '../../../ui/mini-settings-modal';

function makeModal(initialTab = 'api'): MiniSettingsModal {
    const plugin = {
        settings: { settingsUiShowAdvanced: false },
        saveSettings: vi.fn(async () => {}),
    };
    return new MiniSettingsModal({} as never, plugin as never, initialTab);
}

function openModal(initialTab = 'api'): { modal: MiniSettingsModal; content: FakeEl } {
    const modal = makeModal(initialTab);
    modal.onOpen();
    return { modal, content: (modal as unknown as { contentEl: FakeEl }).contentEl };
}

describe('设置弹窗分组布局', () => {
    it('按一级分组渲染组标题与组内 tab', () => {
        const { content } = openModal();
        const titles = content.findAll('nw-mini-settings-group-title').map(el => el.textContent);
        expect(titles).toEqual(['🔌 连接与模型', '✍️ 写作与协同']);
        const tabs = content.findAll('nw-mini-settings-tab');
        expect(tabs.length).toBeGreaterThanOrEqual(3);
    });

    it('高级折叠时不渲染 advanced tab', () => {
        const { content } = openModal();
        const texts = content.findAll('nw-mini-settings-tab').map(el => el.textContent);
        expect(texts.some(text => text.includes('建议设置'))).toBe(false);
    });

    it('初始 tab 高亮', () => {
        const { content } = openModal('mcp');
        const active = content.findAll('nw-mini-settings-tab').filter(el => el.className.includes('is-active'));
        expect(active.map(el => el.textContent)).toEqual(['🔌 MCP 服务']);
    });

    it('点击其他分组 tab 会切换高亮与内容', () => {
        const { content } = openModal('api');
        const target = content.findAll('nw-mini-settings-tab').filter(el => el.textContent.includes('写作配置'))[0];
        expect(target).toBeDefined();
        target.dispatch('click');
        const active = content.findAll('nw-mini-settings-tab').filter(el => el.className.includes('is-active'));
        expect(active.map(el => el.textContent)).toEqual(['✍️ 写作配置']);
    });

    it('弹窗自带搜索框', () => {
        const { content } = openModal();
        const input = content.findAll('nw-settings-search-input');
        expect(input).toHaveLength(1);
        expect(input[0].getAttribute('type')).toBe('search');
    });
});

describe('设置弹窗外壳双语（缺口⑦ 第二期第八片）', () => {
    afterEach(() => setLocale('zh-CN'));

    it('en-US 下标题与搜索占位走英文资源', () => {
        setLocale('en-US');
        const modal = makeModal();
        modal.onOpen();
        const titleEl = (modal as unknown as { titleEl: FakeEl }).titleEl;
        const content = (modal as unknown as { contentEl: FakeEl }).contentEl;
        const input = content.findAll('nw-settings-search-input')[0];
        expect(titleEl.textContent).toBe('⚙️ Settings');
        expect(input.getAttribute('placeholder')).toBe('Search settings…');
    });

    it('en-US 下无结果提示为英文', () => {
        setLocale('en-US');
        const { content } = openModal();
        const input = content.findAll('nw-settings-search-input')[0];
        input.value = 'zzzz-no-hit';
        input.dispatch('input');
        const empty = content.findAll('nw-settings-search-empty');
        expect(empty).toHaveLength(1);
        expect(empty[0].textContent).toBe('No matching settings');
    });

    it('切回 zh-CN 后标题恢复中文', () => {
        const modal = makeModal();
        modal.onOpen();
        expect((modal as unknown as { titleEl: FakeEl }).titleEl.textContent).toBe('⚙️ 设置');
    });
});
