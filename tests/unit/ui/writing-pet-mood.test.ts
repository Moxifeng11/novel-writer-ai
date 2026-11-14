/**
 * 陪伴层用量联动单测：进度→情绪 + 庆祝判定
 */

import { describe, expect, it } from 'vitest';
import { moodForProgress, shouldCelebrate } from '@/ui/writing-pet';

describe('moodForProgress 进度→情绪', () => {
    it('今天没写 → 睡觉', () => {
        expect(moodForProgress(0, 3000)).toBe('sleep');
    });

    it('写了但没到目标 → 待机', () => {
        expect(moodForProgress(1200, 3000)).toBe('idle');
    });

    it('达到目标 → 开心', () => {
        expect(moodForProgress(3000, 3000)).toBe('happy');
        expect(moodForProgress(5000, 3000)).toBe('happy');
    });

    it('未设目标（0）且写了 → 待机', () => {
        expect(moodForProgress(500, 0)).toBe('idle');
    });
});

describe('shouldCelebrate 庆祝判定', () => {
    it('首次观测不庆祝（避免一打开就弹）', () => {
        expect(shouldCelebrate(null, 1200)).toBe(false);
    });

    it('字数增加 → 庆祝', () => {
        expect(shouldCelebrate(1000, 1200)).toBe(true);
    });

    it('字数不变或减少 → 不庆祝', () => {
        expect(shouldCelebrate(1200, 1200)).toBe(false);
        expect(shouldCelebrate(1200, 800)).toBe(false);
    });
});
