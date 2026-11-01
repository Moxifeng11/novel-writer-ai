import { describe, expect, it } from 'vitest';
import { formatExportPrecheck } from '../../../shared/export-precheck';

describe('formatExportPrecheck', () => {
    it('无问题时不提示', () => {
        expect(formatExportPrecheck({ mode: 'long' })).toBeNull();
        expect(formatExportPrecheck({ mode: 'short', unfinished: [] })).toBeNull();
    });

    it('长篇区分未结算与未过质控', () => {
        const msg = formatExportPrecheck({
            mode: 'long',
            unsettled: ['第1章 开端', '第2章 试炼'],
            unreviewed: ['第3章 变数'],
        });
        expect(msg).toContain('未结算 2 章');
        expect(msg).toContain('未过质控 1 章');
        expect(msg).toContain('第3章 变数');
    });

    it('短篇/剧本使用节/集单位', () => {
        expect(formatExportPrecheck({ mode: 'short', unfinished: ['第1节'] })).toContain('未完成 1 节');
        expect(formatExportPrecheck({ mode: 'script', unfinished: ['第1集'] })).toContain('未完成 1 集');
    });

    it('超过上限时截断名单', () => {
        const names = Array.from({ length: 8 }, (_, i) => `第${i + 1}节`);
        const msg = formatExportPrecheck({ mode: 'short', unfinished: names, maxListed: 3 });
        expect(msg).toContain('第1节、第2节、第3节…');
        expect(msg).not.toContain('第4节');
    });
});
