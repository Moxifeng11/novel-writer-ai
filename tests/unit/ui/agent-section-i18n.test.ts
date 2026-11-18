/**
 * agent-section-i18n.test.ts — 设置页「Agent 对话」分区双语（缺口⑦ 第二期第15片，ZC-20261118-05）
 *
 * 最小的设置分区：标题 / 引导语 / 写入确认下拉（option 值是 'ask'/'allow' id，文案走键）。
 * 下拉 option 的可见文案走 mock Setting 游离节点，FakeEl 收不到——由 check:i18n 兜底键解析。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { setLocale } from '../../../i18n';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

// vi.mock 会被提升到所有 import 之上，所以这里可以静态 import（也让 check:view-tests 认得这个文件）
import { AgentBackendSection } from '../../../ui/settings/agent-section';

/** 桩宿主：plugin 只带 agentWriteApproval */
function makeHost(): SettingsSectionHost {
    const plugin = { settings: { agentWriteApproval: 'ask' } };
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
    const section = new AgentBackendSection(makeHost());
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

describe('AgentBackendSection 双语（缺口⑦ 第二期第15片）', () => {
    it('中文默认：标题 / 引导语 / 写入确认', () => {
        const text = renderText();
        expect(text).toContain('🤖 Agent 对话');
        expect(text).toContain('Agent 工作台运行插件内置 Harness');
        expect(text).toContain('Agent 写入确认');
        expect(text).toContain('默认开启：覆盖/追加已有笔记前确认');
    });

    it('en-US：全部界面文案英文化，且不回退成键名', () => {
        setLocale('en-US');
        const text = renderText();
        expect(text).toContain('🤖 Agent chat');
        expect(text).toContain("The agent workbench runs the plugin's built-in Harness");
        expect(text).toContain('Agent write confirmation');
        expect(text).not.toContain('settings.agent.');
    });

    it('en-US：分区骨架 CJK 为 0', () => {
        setLocale('en-US');
        const text = renderText();
        const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
        expect(cjk).toHaveLength(0);
    });
});
