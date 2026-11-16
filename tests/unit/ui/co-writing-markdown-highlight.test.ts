/**
 * Markdown 着色镜像测试（2026-11-16，E-11）
 */
import { describe, expect, it } from 'vitest';
import {
    buildHighlightHtml,
    escapeHtml,
    renderHighlightDom,
    tokenizeLine,
    tokenizeText,
} from '../../../ui/co-writing/markdown-highlight';
import { FakeEl, stubDocument } from './support/fake-dom';

describe('escapeHtml', () => {
    it('转义尖括号与引号', () => {
        expect(escapeHtml('<b a="1">&</b>')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&lt;/b&gt;');
    });
});

describe('tokenizeLine', () => {
    it('加粗拆成标记 + 内容 + 标记', () => {
        const segments = tokenizeLine('**重点**');
        expect(segments.map(s => s.kind)).toEqual(['marker', 'bold', 'marker']);
    });

    it('斜体', () => {
        expect(tokenizeLine('*斜*').some(s => s.kind === 'italic')).toBe(true);
    });

    it('行内代码用 italic 样式标记', () => {
        expect(tokenizeLine('\u0060code\u0060').some(s => s.kind === 'italic')).toBe(true);
    });

    it('普通文本原样', () => {
        expect(tokenizeLine('普通')).toEqual([{ kind: 'plain', text: '普通' }]);
    });
});

describe('tokenizeText', () => {
    it('标题行整体为 heading', () => {
        const segments = tokenizeText('# 标题');
        expect(segments[0].kind).toBe('heading');
        expect(segments.some(s => s.kind === 'heading' && s.text.includes('标题'))).toBe(true);
    });

    it('引用行', () => {
        expect(tokenizeText('> 引用').some(s => s.kind === 'quote')).toBe(true);
    });

    it('列表行', () => {
        expect(tokenizeText('- 条目').some(s => s.kind === 'list')).toBe(true);
    });

    it('分隔线', () => {
        expect(tokenizeText('---').some(s => s.kind === 'hr')).toBe(true);
    });

    it('保留换行数量（行数与 textarea 一致）', () => {
        const segments = tokenizeText('a\nb\nc');
        const newlines = segments.filter(s => s.text === '\n').length;
        expect(newlines).toBe(2);
    });

    it('空文本返回空数组', () => {
        expect(tokenizeText('')).toEqual([]);
    });
});

describe('buildHighlightHtml', () => {
    it('生成带类名的 span', () => {
        const html = buildHighlightHtml('# 标题');
        expect(html).toContain('nw-md-heading');
    });

    it('HTML 被转义（不产生 XSS）', () => {
        const html = buildHighlightHtml('<img src=x onerror=alert(1)>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });

    it('换行被保留', () => {
        expect(buildHighlightHtml('a\nb')).toContain('\n');
    });
});

describe('renderHighlightDom（不用 innerHTML 的等价渲染）', () => {
    it('写入节点且不产生 HTML 标签字符串', () => {
        // document.createElement 由 fake-dom 的 stubDocument 提供
        stubDocument();
        const backdrop = new FakeEl('div');
        renderHighlightDom(backdrop as unknown as HTMLElement, '# 标题');
        expect(backdrop.children.length).toBeGreaterThan(0);
        const text = backdrop.children.map(child => (child as FakeEl).textContent || '').join('');
        expect(text).toContain('标题');
        expect(text).not.toContain('<span');
    });
});

