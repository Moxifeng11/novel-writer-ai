import { describe, expect, it } from 'vitest';
import { buildTimeContextMessage, formatTimeContext, timeContextKey } from '../../../shared/time-context';

describe('time-context — 注入给模型的当前时间', () => {
    const fixed = new Date(2026, 9, 27, 14, 3, 0); // 2026-10-27 14:03 周二

    it('按本地时区格式化为「日期 时间（周X）」', () => {
        expect(formatTimeContext(fixed)).toBe('2026-10-27 14:03（周二）');
    });

    it('月/日/时/分补零', () => {
        expect(formatTimeContext(new Date(2026, 0, 5, 9, 8))).toBe('2026-01-05 09:08（周一）');
    });

    it('周日映射正确', () => {
        expect(formatTimeContext(new Date(2026, 9, 25, 0, 0))).toBe('2026-10-25 00:00（周日）');
    });

    it('分钟级键：同分钟相同、跨分钟不同', () => {
        expect(timeContextKey(fixed)).toBe(timeContextKey(new Date(2026, 9, 27, 14, 3, 59)));
        expect(timeContextKey(fixed)).not.toBe(timeContextKey(new Date(2026, 9, 27, 14, 4, 0)));
    });

    it('注入消息包含时间与「以此为准」约束', () => {
        const message = buildTimeContextMessage(fixed);
        expect(message).toContain('【当前时间】2026-10-27 14:03（周二）');
        expect(message).toContain('以此为准');
    });
});