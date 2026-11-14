/**
 * 附件工具测试
 */

import { describe, expect, it } from 'vitest';
import { createAttachmentTools } from '@/engine/agent/harness/attachment-tools';

const service = {
    read: async (path: string) => {
        if (path.includes('missing')) return null;
        if (path.endsWith('.md')) return { path, kind: 'text' as const, size: 12, text: '正文内容' };
        return { path, kind: 'image' as const, size: 2048 };
    },
};

describe('read_attachment 工具', () => {
    const tool = createAttachmentTools(() => service as never)[0];

    it('是只读工具', () => {
        expect(tool.kind).toBe('read');
        expect(tool.sideEffect).toBe('none');
    });

    it('文本附件返回正文', async () => {
        const result = await tool.execute({ path: 'p/附件/a.md' }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('正文内容');
    });

    it('图片附件返回元信息', async () => {
        const result = await tool.execute({ path: 'p/附件/a.png' }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('图片');
        expect(result.content).toContain('2048');
    });

    it('找不到附件时明确提示', async () => {
        const result = await tool.execute({ path: 'p/missing.png' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('找不到附件');
    });

    it('服务缺失时提示不支持', async () => {
        const noService = createAttachmentTools(() => null)[0];
        const result = await noService.execute({ path: 'a.md' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('不支持');
    });
});
