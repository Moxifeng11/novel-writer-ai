/**
 * 桌宠状态驱动：运行时活动 → 宠物状态映射
 */

import { describe, expect, it } from 'vitest';
import { moodForPetActivity } from '@/ui/writing-pet';

describe('moodForPetActivity', () => {
    it('写作/AI 思考/完成/出错分别映射到对应状态', () => {
        expect(moodForPetActivity('writing')).toBe('writing');
        expect(moodForPetActivity('thinking')).toBe('thinking');
        expect(moodForPetActivity('happy')).toBe('happy');
        expect(moodForPetActivity('error')).toBe('error');
    });

    it('无活动返回 null（由字数状态兜底）', () => {
        expect(moodForPetActivity(null)).toBeNull();
    });
});
