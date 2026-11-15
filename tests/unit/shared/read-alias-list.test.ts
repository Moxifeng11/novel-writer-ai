/**
 * M2-3：别名读取助手
 */

import { describe, expect, it } from 'vitest';
import { readAliasList } from '@/shared/frontmatter-schema';

describe('readAliasList', () => {
    it('数组形式', () => {
        expect(readAliasList(['林玄', '小玄'])).toEqual(['林玄', '小玄']);
    });

    it('分隔串形式（中文/英文/竖线）', () => {
        expect(readAliasList('林玄|小玄，阿玄、玄子')).toEqual(['林玄', '小玄', '阿玄', '玄子']);
    });

    it('合并多个键并去重', () => {
        expect(readAliasList(['林玄'], '小玄|林玄', undefined, ['曾用名1'])).toEqual(['林玄', '小玄', '曾用名1']);
    });

    it('忽略非法类型', () => {
        expect(readAliasList(undefined, null, 3, {})).toEqual([]);
    });

    it('去空白', () => {
        expect(readAliasList([' 林玄 ', '  小玄'])).toEqual(['林玄', '小玄']);
    });
});
