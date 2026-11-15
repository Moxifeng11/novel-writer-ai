/**
 * 使用约定速查（社区下载后的自助文档）
 */

import { describe, expect, it } from 'vitest';
import { buildUsageGuide, USAGE_GUIDE_PATH } from '@/shared/usage-guide-content';

describe('buildUsageGuide', () => {
    const text = buildUsageGuide('4.96.0');

    it('覆盖目录/标签/属性三类约定', () => {
        expect(text).toContain('元文件/');
        expect(text).toContain('长篇小说/<书名>/');
        expect(text).toContain('nw/人物');
        expect(text).toContain('status');
        expect(text).toContain('id');
    });

    it('给出首启最短路径与排错', () => {
        expect(text).toContain('首次使用最短路径');
        expect(text).toContain('看不到作品');
        expect(text).toContain('补齐模板文件');
    });

    it('路径固定写在写作知识库', () => {
        expect(USAGE_GUIDE_PATH).toBe('写作知识库/插件使用约定.md');
    });

    it('带版本号便于用户核对', () => {
        expect(text).toContain('v4.96.0');
    });
});
