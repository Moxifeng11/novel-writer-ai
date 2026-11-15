/**
 * pet-activity：桌宠「正在运行什么功能」的活动信号（优先级 / TTL / 订阅）
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clearPetActivity,
    getActivePetActivity,
    markPetActivity,
    resetPetActivity,
    resolvePetActivity,
    subscribePetActivity,
} from '@/shared/pet-activity';

afterEach(() => {
    resetPetActivity();
    vi.useRealTimers();
});

describe('resolvePetActivity 优先级与过期', () => {
    it('出错 > 写作 > 思考 > 开心', () => {
        const now = 1000;
        const marks = [
            { kind: 'happy' as const, until: now + 100 },
            { kind: 'thinking' as const, until: now + 100 },
            { kind: 'writing' as const, until: now + 100 },
            { kind: 'error' as const, until: now + 100 },
        ];
        expect(resolvePetActivity(marks, now)).toBe('error');
        expect(resolvePetActivity(marks.filter(m => m.kind !== 'error'), now)).toBe('writing');
        expect(resolvePetActivity(marks.filter(m => m.kind === 'thinking' || m.kind === 'happy'), now)).toBe('thinking');
    });

    it('过期标记不参与', () => {
        const marks = [{ kind: 'thinking' as const, until: 900 }];
        expect(resolvePetActivity(marks, 1000)).toBeNull();
    });
});

describe('markPetActivity / clear / 订阅', () => {
    it('打标记后立即可读，过期后回落 null', () => {
        vi.useFakeTimers();
        markPetActivity('thinking', 2000);
        expect(getActivePetActivity()).toBe('thinking');
        vi.advanceTimersByTime(2100);
        expect(getActivePetActivity()).toBeNull();
    });

    it('clear 立即清除指定类型', () => {
        markPetActivity('writing', 5000);
        expect(getActivePetActivity()).toBe('writing');
        clearPetActivity('writing');
        expect(getActivePetActivity()).toBeNull();
    });

    it('订阅只在可见活动变化时回调', () => {
        const seen: Array<string | null> = [];
        const dispose = subscribePetActivity(kind => seen.push(kind));
        markPetActivity('writing', 1000);
        markPetActivity('writing', 1000); // 同类重复不重复通知
        markPetActivity('error', 1000);   // 优先级更高的新活动
        clearPetActivity('error');
        dispose();
        markPetActivity('thinking', 1000);
        expect(seen).toEqual(['writing', 'error', 'writing']);
    });
});
