/**
 * A1：场景卡字段解析容忍列表前缀
 */

import { describe, expect, it } from 'vitest';
import { parseSceneField } from '@/shared/scene-card';

describe('parseSceneField 列表前缀', () => {
    it('兼容 `- characters: …` 历史写法', () => {
        const block = '- characters: 林玄、苏婉\n- objective: 测灵';
        expect(parseSceneField(block, 'characters')).toBe('林玄、苏婉');
        expect(parseSceneField(block, 'objective')).toBe('测灵');
    });

    it('标准无前缀写法不受影响', () => {
        expect(parseSceneField('characters: 林玄', 'characters')).toBe('林玄');
    });

    it('加粗字段名仍可解析', () => {
        expect(parseSceneField('**characters**：林玄', 'characters')).toBe('林玄');
    });
});
