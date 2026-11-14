/**
 * 附件模型测试
 */

import { describe, expect, it } from 'vitest';
import {
    ATTACHMENT_EXTENSIONS,
    attachmentKind,
    attachmentMarkdown,
    isSupportedAttachment,
    parseAttachmentRefs,
    safeAttachmentName,
} from '@/shared/attachment-model';

describe('附件扩展名', () => {
    it('支持常见图片/文档', () => {
        for (const name of ['a.png', 'b.pdf', 'c.md', 'd.docx']) {
            expect(isSupportedAttachment(name), name).toBe(true);
        }
    });

    it('拒绝不支持的类型', () => {
        expect(isSupportedAttachment('a.exe')).toBe(false);
        expect(isSupportedAttachment('')).toBe(false);
    });

    it('扩展名表非空且唯一', () => {
        expect(new Set(ATTACHMENT_EXTENSIONS).size).toBe(ATTACHMENT_EXTENSIONS.length);
    });
});

describe('附件分类', () => {
    it('图片/文本/文档三分类', () => {
        expect(attachmentKind('a.png')).toBe('image');
        expect(attachmentKind('b.md')).toBe('text');
        expect(attachmentKind('c.pdf')).toBe('document');
    });
});

describe('safeAttachmentName', () => {
    it('去非法字符并保留扩展名', () => {
        const name = safeAttachmentName('参考 图.png', 1000);
        expect(name.endsWith('.png')).toBe(true);
        expect(name).not.toContain(' ');
    });

    it('同名不同时间不冲突', () => {
        expect(safeAttachmentName('a.png', 1)).not.toBe(safeAttachmentName('a.png', 2));
    });

    it('路径只取文件名', () => {
        expect(safeAttachmentName('C:/tmp/图.png', 5)).toContain('图');
    });
});

describe('引用 Markdown', () => {
    it('生成引用并解析回路径', () => {
        const md = attachmentMarkdown('长篇小说/书A/04-项目总控/附件/a.png');
        expect(parseAttachmentRefs(`请看 ${md}`)).toEqual(['长篇小说/书A/04-项目总控/附件/a.png']);
    });

    it('无引用返回空数组', () => {
        expect(parseAttachmentRefs('普通消息')).toEqual([]);
    });

    it('重复引用去重', () => {
        const md = attachmentMarkdown('x/a.png');
        expect(parseAttachmentRefs(`${md}${md}`)).toHaveLength(1);
    });
});
