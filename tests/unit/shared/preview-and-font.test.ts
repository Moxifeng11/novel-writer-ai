import { describe, expect, it } from 'vitest';
import { classifyPreviewKind } from '../../../shared/preview-kind';
import {
    FONT_EXTENSIONS,
    isSupportedFontFile,
    fontFileFormat,
    sanitizeFamily,
    SYSTEM_FONT_PRESETS,
} from '../../../services/font-manager';

describe('classifyPreviewKind — 文件预览自适应分类', () => {
    it('图片扩展名 → image', () => {
        for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif']) {
            expect(classifyPreviewKind(ext)).toBe('image');
        }
        expect(classifyPreviewKind('PNG')).toBe('image');
    });

    it('音频/视频扩展名 → audio/video', () => {
        expect(classifyPreviewKind('mp3')).toBe('audio');
        expect(classifyPreviewKind('flac')).toBe('audio');
        expect(classifyPreviewKind('mp4')).toBe('video');
        expect(classifyPreviewKind('webm')).toBe('video');
    });

    it('Markdown → markdown（走 MarkdownRenderer）', () => {
        expect(classifyPreviewKind('md')).toBe('markdown');
        expect(classifyPreviewKind('markdown')).toBe('markdown');
    });

    it('文本类扩展 → text', () => {
        for (const ext of ['txt', 'json', 'csv', 'yml', 'yaml', 'js', 'ts', 'html', 'css', 'xml', 'log']) {
            expect(classifyPreviewKind(ext)).toBe('text');
        }
    });

    it('未知二进制 → binary', () => {
        expect(classifyPreviewKind('exe')).toBe('binary');
        expect(classifyPreviewKind('')).toBe('binary');
        expect(classifyPreviewKind('pdf')).toBe('binary');
    });
});

describe('font-manager — 纯函数', () => {
    it('支持的字体扩展名', () => {
        expect(FONT_EXTENSIONS).toEqual(['ttf', 'otf', 'woff', 'woff2']);
        expect(isSupportedFontFile('思源黑体 Bold.woff2')).toBe(true);
        expect(isSupportedFontFile('font.TTF')).toBe(true);
        expect(isSupportedFontFile('readme.txt')).toBe(false);
        expect(isSupportedFontFile('cover.png')).toBe(false);
    });

    it('扩展名 → FontFace 格式标识', () => {
        expect(fontFileFormat('a.ttf')).toBe('truetype');
        expect(fontFileFormat('a.otf')).toBe('opentype');
        expect(fontFileFormat('a.woff')).toBe('woff');
        expect(fontFileFormat('a.woff2')).toBe('woff2');
        expect(fontFileFormat('a.png')).toBeNull();
    });

    it('family 名净化：去扩展名 + 剔除 CSS 非法字符', () => {
        expect(sanitizeFamily('思源黑体 Bold.ttf')).toBe('思源黑体 Bold');
        expect(sanitizeFamily('my"font.otf')).toBe('myfont');
        expect(sanitizeFamily('  spaced   name.woff2  ')).toBe('spaced name');
        expect(sanitizeFamily('.ttf')).toBe('自定义字体');
    });

    it('系统字体预设包含主题变量与常见中文字体', () => {
        const values = SYSTEM_FONT_PRESETS.map(preset => preset.value);
        expect(values).toContain('var(--font-text)');
        expect(values).toContain('var(--font-monospace)');
        expect(values.some(value => value.includes('Microsoft YaHei'))).toBe(true);
        expect(values.some(value => value.includes('KaiTi'))).toBe(true);
    });
});
