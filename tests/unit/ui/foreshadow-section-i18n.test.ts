/**
 * foreshadow-section-i18n.test.ts — 设置页「伏笔管理」分区双语（缺口⑦ 第二期第12片，ZC-20261118-02）
 *
 * 分区为同步渲染：最大未揭示伏笔 Setting + 伏笔类型列表（启停/编辑/删除）+ 导入/导出/重置。
 * 伏笔类型的 name/description/keywords 是用户数据（随配置导出导入），en 下保留原文；
 * 这里用 DEFAULT_FORESHADOW_TYPES 拼出「允许的数据字符集」做 en CJK 白名单断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { setLocale } from '../../../i18n';
import { DEFAULT_FORESHADOW_TYPES } from '../../../shared/foreshadow-config';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

// vi.mock 会被提升到所有 import 之上，所以这里可以静态 import（也让 check:view-tests 认得这个文件）
import { ForeshadowSection } from '../../../ui/settings/foreshadow-section';

/** 桩宿主：plugin 只带分区真正读取的最小字段（foreshadowConfig 缺省 → 用内置默认类型） */
function makeHost(): SettingsSectionHost {
    const plugin = {
        settings: { maxUnrevealedForeshadow: 20 },
        saveSettings: async () => undefined,
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
    const section = new ForeshadowSection(makeHost());
    const container = new FakeEl('div');
    section.render(container as unknown as HTMLElement);
    return collectText(container);
}

/** en 下允许的 CJK：默认伏笔类型的数据（名称/描述/关键词），随配置导出导入，不译 */
const EN_CJK_ALLOWED = new Set(
    DEFAULT_FORESHADOW_TYPES.map(type => `${type.name}${type.description}${type.keywords.join('')}`).join(''),
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

describe('ForeshadowSection 双语（缺口⑦ 第二期第12片）', () => {
    it('中文默认：标题 / Setting / 类型列表 / 导入导出重置按钮', () => {
        const text = renderText();
        expect(text).toContain('🔮 伏笔管理');
        expect(text).toContain('最大未揭示伏笔');
        expect(text).toContain('📝 伏笔类型配置');
        expect(text).toContain('关键词');
        // 启停按钮的 title 走 attr.title，不进 textContent；键解析由 check:i18n 兜底
        expect(text).toContain('编辑');
        expect(text).toContain('删除');
        expect(text).toContain('+ 添加新伏笔类型');
        expect(text).toContain('📥 导出配置');
        expect(text).toContain('📤 导入配置');
        expect(text).toContain('🔄 重置为默认');
    });

    it('en-US：全部界面文案英文化，且不回退成键名', () => {
        setLocale('en-US');
        const text = renderText();
        expect(text).toContain('🔮 Foreshadowing');
        expect(text).toContain('Max unrevealed foreshadowing');
        expect(text).toContain('📝 Foreshadow type configuration');
        expect(text).toMatch(/\d+ keywords/);
        // 启停按钮的 title 走 attr.title，不进 textContent；键解析由 check:i18n 兜底
        expect(text).toContain('Edit');
        expect(text).toContain('Delete');
        expect(text).toContain('+ Add foreshadow type');
        expect(text).toContain('📥 Export configuration');
        expect(text).toContain('🔄 Reset to defaults');
        expect(text).not.toContain('settings.foreshadow.');
    });

    it('en-US：CJK 只剩伏笔类型数据（白名单字符集）', () => {
        setLocale('en-US');
        const text = renderText();
        const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
        for (const char of cjk) {
            expect(EN_CJK_ALLOWED.has(char), `en 渲染出现数据外中文：${char}（上下文：${text.slice(Math.max(0, text.indexOf(char) - 20), text.indexOf(char) + 20)}）`).toBe(true);
        }
    });
});
