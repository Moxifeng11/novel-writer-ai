/**
 * writing-rules-mode-addons —— 规则文本组合与 frontmatter 剥离
 *
 * 背景（2026-11-28 实测缺陷）：vault 的 `元文件/00-系统模板/写作规则.md` 开头带
 * YAML frontmatter，`readVaultRulesDoc` 原样返回文件内容，`composeWritingRules`
 * 只 `trimEnd()` 就拼进 system prompt。真实实例上抓到发给模型的 system prompt
 * 头部是：
 *
 *     ---
 *     version: "4.0.0"
 *     tags: [写作规则, 文风]
 *     ---
 *
 * 既浪费 token，又可能让模型把开头的 `---` 当成正文分隔符。
 */
import { describe, expect, it } from 'vitest';
import { composeWritingRules, stripFrontmatter } from '@/shared/writing-rules-mode-addons';

describe('stripFrontmatter', () => {
    it('剥掉文件头的 YAML frontmatter', () => {
        const raw = '---\nversion: "4.0.0"\ntags: [写作规则, 文风]\n---\n\n# 规则正文\n内容。';
        expect(stripFrontmatter(raw)).toBe('\n# 规则正文\n内容。');
    });

    it('兼容 CRLF 换行', () => {
        const raw = '---\r\nversion: "1"\r\n---\r\n正文';
        expect(stripFrontmatter(raw)).toBe('正文');
    });

    it('兼容 BOM 前缀', () => {
        const raw = '\uFEFF---\nversion: "1"\n---\n正文';
        expect(stripFrontmatter(raw)).toBe('正文');
    });

    it('没有 frontmatter 时原样返回', () => {
        const raw = '# 规则正文\n没有元数据。';
        expect(stripFrontmatter(raw)).toBe(raw);
    });

    it('正文中间的水平线不被误伤', () => {
        const raw = '# 标题\n\n---\n\n分隔线下面还有内容。';
        expect(stripFrontmatter(raw)).toBe(raw);
    });

    it('空字符串与异常输入兜底', () => {
        expect(stripFrontmatter('')).toBe('');
        // 真实调用方可能从 vault 拿到 undefined；函数内部用 String() 兜底
        expect(stripFrontmatter(null as unknown as string)).toBe('');
        expect(stripFrontmatter(undefined as unknown as string)).toBe('');
    });
});

describe('composeWritingRules', () => {
    it('frontmatter 不得进入最终注入文本', () => {
        const raw = '---\nversion: "4.0.0"\ntags: [写作规则, 文风]\n---\n\n# 小说写作规则\n核心锚点：每章只有一个镜头。';
        const composed = composeWritingRules(raw, 'long');
        expect(composed).not.toContain('version:');
        expect(composed).not.toContain('tags:');
        expect(composed.startsWith('---')).toBe(false);
        expect(composed).toContain('核心锚点：每章只有一个镜头。');
    });

    it('保留模式附录', () => {
        const composed = composeWritingRules('# 规则', 'short');
        expect(composed).toContain('# 规则');
        // 附录非空且与主文档分开
        expect(composed.length).toBeGreaterThan('# 规则'.length);
        expect(composed).toContain('\n');
    });

    it('空主文档时仍产出模式附录', () => {
        const composed = composeWritingRules('', 'long');
        expect(composed.trim().length).toBeGreaterThan(0);
        expect(composed.startsWith('---')).toBe(false);
    });
});
