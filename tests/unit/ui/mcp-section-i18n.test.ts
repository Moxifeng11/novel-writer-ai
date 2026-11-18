/**
 * mcp-section-i18n.test.ts — 设置页「MCP 服务」分区双语（缺口⑦ 第二期第14片，ZC-20261118-04）
 *
 * 分区只做概览与入口：服务器行的 name 是用户数据、describeMcpServer 的输出无汉字
 * （transport/target 是数据）；空态提示 / 管理中心 / 移动端说明全部走 settings.mcp.*。
 * 环境检查的 Notice 与按钮文案由 check:i18n 兜底（按钮走 mock Setting 游离节点）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { setLocale } from '../../../i18n';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

// vi.mock 会被提升到所有 import 之上，所以这里可以静态 import（也让 check:view-tests 认得这个文件）
import { McpSection } from '../../../ui/settings/mcp-section';

/** 桩宿主：plugin.settings.mcpServers 走空列表（空态提示分支） */
function makeHost(): SettingsSectionHost {
    const plugin = {
        settings: { mcpServers: [] },
    };
    return {
        app: {} as never,
        plugin: plugin as never,
        refresh: () => undefined,
        reopen: () => undefined,
    };
}

/** FakeEl 的 textContent 不聚合子节点，这里手动收集 */
function collectText(el: FakeEl): string {
    return [el.textContent, ...el.children.map(collectText)].join('\n');
}

function renderText(): string {
    const section = new McpSection(makeHost());
    const container = new FakeEl('div');
    section.render(container as unknown as HTMLElement);
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

describe('McpSection 双语（缺口⑦ 第二期第14片）', () => {
    it('中文默认：标题 / 引导语 / 空态 / 管理中心 / 移动端说明', () => {
        const text = renderText();
        expect(text).toContain('🔌 MCP 服务');
        expect(text).toContain('接入外部 MCP 服务');
        expect(text).toContain('还没有配置 MCP 服务');
        expect(text).toContain('MCP 管理中心');
        expect(text).toContain('新增 / 编辑 / 删除服务');
        expect(text).toContain('移动端说明');
        expect(text).toContain('stdio 服务依赖本地子进程');
    });

    it('en-US：全部界面文案英文化，且不回退成键名', () => {
        setLocale('en-US');
        const text = renderText();
        expect(text).toContain('🔌 MCP servers');
        expect(text).toContain('Connect external MCP servers');
        expect(text).toContain('No MCP servers configured yet');
        expect(text).toContain('MCP management center');
        expect(text).toContain('Mobile note');
        expect(text).toContain('stdio servers depend on local subprocesses');
        expect(text).not.toContain('settings.mcp.');
    });

    it('en-US：分区骨架 CJK 为 0（服务器行未配置，无用户数据）', () => {
        setLocale('en-US');
        const text = renderText();
        const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
        expect(cjk).toHaveLength(0);
    });
});
