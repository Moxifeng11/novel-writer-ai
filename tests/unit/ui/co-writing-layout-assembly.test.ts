import { describe, expect, it } from 'vitest';
import {
    formatMarkdownStatus,
    resolveFontOptions,
    resolveLayoutState,
} from '@/ui/co-writing/layout-assembly';
import { DEFAULT_BODY_FORMAT } from '@/shared/body-format';

describe('resolveFontOptions', () => {
    it('默认为空字体，且管理项固定在末尾', () => {
        const { options, selected } = resolveFontOptions('', []);
        expect(options[0]).toEqual({ value: '', label: '默认（跟随主题）' });
        expect(options[options.length - 1].value).toBe('__manage__');
        expect(selected).toBe('');
    });

    it('自定义字体生成带引号的 CSS 值与星标文案', () => {
        const { options } = resolveFontOptions('', ['思源宋体']);
        const custom = options.find((option) => option.value === '"思源宋体", sans-serif');
        expect(custom?.label).toBe('★ 思源宋体');
    });

    it('已保存的预设字体保持选中', () => {
        const { selected } = resolveFontOptions('var(--font-text)', []);
        expect(selected).toBe('var(--font-text)');
    });

    it('字体被删除后回落到默认，避免下拉空值', () => {
        const { selected } = resolveFontOptions('"已删除字体", sans-serif', []);
        expect(selected).toBe('');
    });
});

describe('resolveLayoutState', () => {
    it('默认左右分栏、编辑区 65%、建议面板展开', () => {
        expect(resolveLayoutState({})).toEqual({
            stacked: false,
            editorPercent: '65%',
            panelCollapsed: false,
        });
    });

    it('读取堆叠布局与面板收起', () => {
        const state = resolveLayoutState({
            coWriteLayout: 'stacked',
            coWriteSuggestionPanelVisible: false,
        });
        expect(state.stacked).toBe(true);
        expect(state.panelCollapsed).toBe(true);
    });

    it('宽度比例钳制在 40%-85%', () => {
        expect(resolveLayoutState({ coWriteEditorWidthRatio: 0.2 }).editorPercent).toBe('40%');
        expect(resolveLayoutState({ coWriteEditorWidthRatio: 0.9 }).editorPercent).toBe('85%');
    });
});

describe('formatMarkdownStatus', () => {
    it('字数为去空白长度，段落按非空行统计', () => {
        const status = formatMarkdownStatus('第一段\n\n第二段', DEFAULT_BODY_FORMAT);
        expect(status.mode).toBe('Markdown');
        expect(status.words).toBe('字数 6');
        expect(status.paragraphs).toBe('段落 2');
    });

    it('契约文案取自正文格式契约', () => {
        const status = formatMarkdownStatus('正文', DEFAULT_BODY_FORMAT);
        expect(status.contract).toBe('格式：单换行分段 · 首行空两格');
    });
});
