import { describe, expect, it } from 'vitest';
import { formatCompactDirectionText, formatMetricsDirectionText } from '@/ui/co-writing/metrics-render';
import { emptyMetrics } from '@/ui/cowrite/cowrite-mappers';

describe('metrics-render — 方向文本', () => {
    it('带上下文方向用箭头连接并翻译标签', () => {
        const text = formatMetricsDirectionText({
            ...emptyMetrics(),
            nextDirectionHints: ['action', 'emotion'],
        });
        expect(text).toContain('动作');
        expect(text).toContain('情绪');
        expect(text).toContain('→');
    });

    it('紧凑方向用顿号连接', () => {
        const text = formatCompactDirectionText({
            ...emptyMetrics(),
            nextDirectionHints: ['action', 'emotion'],
        });
        expect(text).toBe('action、emotion');
    });

    it('无方向时返回空串', () => {
        const metrics = { ...emptyMetrics(), nextDirectionHints: [] };
        expect(formatMetricsDirectionText(metrics)).toBe('');
        expect(formatCompactDirectionText(metrics)).toBe('');
    });
});
