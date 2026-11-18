/**
 * mode-section-i18n.test.ts — 设置页「创作模式与路径」分区双语（缺口⑦ 第二期第13片，ZC-20261118-03）
 *
 * 共享常量 CREATION_MODE_SPECS 的展示字段不改（引擎/提示词/其他视图共用），
 * 分区通过 MODE_SPEC_KEYS 按语言求值；MODE_LIBRARY_ROOTS / MODE_CONTENT_LAYOUT /
 * WRITING_RULES_PATH_TEMPLATE 是真实 vault 路径（数据），en 下保留中文。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { setLocale } from '../../../i18n';
import { MODE_LIBRARY_ROOTS } from '../../../shared/creation-mode';
import { WRITING_RULES_PATH_TEMPLATE } from '../../../shared/format-constants';
import { SHORT_CONTENT_ROOT, SCRIPT_CONTENT_ROOT } from '../../../shared/mode-content';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

// vi.mock 会被提升到所有 import 之上，所以这里可以静态 import（也让 check:view-tests 认得这个文件）
import { ModeSection } from '../../../ui/settings/mode-section';

/** 桩宿主：分区渲染不读 plugin，只走共享常量 */
function makeHost(): SettingsSectionHost {
    return {
        app: {} as never,
        plugin: { settings: {} } as never,
        refresh: () => undefined,
        reopen: () => undefined,
    };
}

/** FakeEl 的 textContent 不聚合子节点，这里手动收集 */
function collectText(el: FakeEl): string {
    return [el.textContent, ...el.children.map(collectText)].join('\n');
}

function renderText(): string {
    const section = new ModeSection(makeHost());
    const container = new FakeEl('div');
    section.render(container as unknown as HTMLElement);
    return collectText(container);
}

/** en 下允许的 CJK：模式库根目录 + 内容结构路径 + 写作规则路径（vault 数据，不译） */
const EN_CJK_ALLOWED = new Set(
    [
        ...Object.values(MODE_LIBRARY_ROOTS),
        `03-大纲与章节/正文/第N卷 · 步骤结果 · 11 步流水线`,
        `${SHORT_CONTENT_ROOT}/03-正文 · 02-分节大纲 · 04-质检`,
        `${SCRIPT_CONTENT_ROOT}/03-剧本 · 02-分集大纲 · 04-分镜`,
        WRITING_RULES_PATH_TEMPLATE,
    ].join(''),
);

beforeEach(() => {
    setLocale('zh-CN');
    stubCreateDiv();
    stubDocument();
});

afterEach(() => {
    setLocale('zh-CN');
    vi.unstubAllGlobals();
});

describe('ModeSection 双语（缺口⑦ 第二期第13片）', () => {
    it('中文默认：标题 / 三张模式卡 / 单元规格 / 页脚提示', () => {
        const text = renderText();
        expect(text).toContain('📚 创作模式与路径');
        expect(text).toContain('📖 长篇小说');
        expect(text).toContain('📄 短篇小说');
        expect(text).toContain('🎬 短剧剧本');
        expect(text).toContain('项目库根目录');
        expect(text).toContain('内容结构');
        expect(text).toContain('单元规格');
        expect(text).toContain('每个章默认 1000000 字');
        // 禁用输入框的 value 走 setValue，不进 textContent；键解析由 check:i18n 兜底
        expect(text).toContain('每个集默认 80000 字');
        expect(text).toContain('写作规则唯一来源是「元文件/00-系统模板/写作规则.md」');
    });

    it('en-US：全部界面文案英文化，且不回退成键名', () => {
        setLocale('en-US');
        const text = renderText();
        expect(text).toContain('📚 Creation modes & paths');
        expect(text).toContain('📖 Long-form novel');
        expect(text).toContain('📄 Short story');
        expect(text).toContain('🎬 Short drama script');
        expect(text).toContain('Project library root');
        expect(text).toContain('Content layout');
        expect(text).toContain('Default 1000000 words per chapter');
        // 禁用输入框的 value 走 setValue，不进 textContent；键解析由 check:i18n 兜底
        expect(text).toContain('Default 80000 words per episode');
        expect(text).toContain('Unit specification');
        expect(text).not.toContain('settings.mode.');
    });

    it('en-US：CJK 只剩 vault 路径与目录名（白名单字符集）', () => {
        setLocale('en-US');
        const text = renderText();
        const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
        for (const char of cjk) {
            expect(EN_CJK_ALLOWED.has(char), `en 渲染出现数据外中文：${char}（上下文：${text.slice(Math.max(0, text.indexOf(char) - 20), text.indexOf(char) + 20)}）`).toBe(true);
        }
    });
});
