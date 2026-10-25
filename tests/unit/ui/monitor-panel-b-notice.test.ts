import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 面板 B 的偏离预警 / 质量提醒 / 里程碑此前走 `(this.app as any).notice?.addNotice?.()`：
 * Obsidian 没有该 API，可选链让调用恒为 undefined，用户从未看到提示。
 * 现在统一改为 `new Notice(...)`，这里锁定「确实构造了 Notice」与冷却口径。
 */
const noticeLog = vi.hoisted(() => [] as Array<{ message: string; timeout?: number }>);

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class Notice {
        message: string;
        timeout?: number;
        constructor(message: string, timeout?: number) {
            this.message = message;
            this.timeout = timeout;
            noticeLog.push({ message, timeout });
        }
        setMessage(): this {
            return this;
        }
        hide(): void {}
    }
    return { ...actual, Notice };
});

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { MonitorPanelB } from '../../../ui/monitor-panel-b';

type PanelCtx = {
    lastQualityAlertTime: number;
    QUALITY_ALERT_COOLDOWN: number;
    showDivergenceAlert: (reason: string) => void;
    checkQualityAlert: (result: { overallScore: number; grade: string }) => void;
    showMilestoneNotice: (milestone: string, score: number) => void;
};

function makeCtx(): PanelCtx {
    const ctx = Object.create(MonitorPanelB.prototype) as PanelCtx;
    ctx.lastQualityAlertTime = 0;
    ctx.QUALITY_ALERT_COOLDOWN = 10 * 60 * 1000;
    return ctx;
}

beforeEach(() => {
    noticeLog.length = 0;
});

describe('MonitorPanelB — 用户提示必须真正可见', () => {
    it('偏离预警构造带原因的 Notice', () => {
        const ctx = makeCtx();

        ctx.showDivergenceAlert('主线关键词覆盖不足');

        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0].message).toContain('剧情偏离预警');
        expect(noticeLog[0].message).toContain('主线关键词覆盖不足');
        expect(noticeLog[0].timeout).toBe(5000);
    });

    it('里程碑构造带字数的 Notice', () => {
        const ctx = makeCtx();

        ctx.showMilestoneNotice('500字里程碑', 82);

        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0].message).toContain('500字里程碑');
        expect(noticeLog[0].message).toContain('82分');
        expect(noticeLog[0].timeout).toBe(3000);
    });

    it('质量提醒在冷却窗口内只提示一次', () => {
        const ctx = makeCtx();
        const result = { overallScore: 42, grade: 'D' };

        ctx.checkQualityAlert(result);
        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0].message).toContain('42');

        // 冷却窗口内：不再提示
        ctx.checkQualityAlert(result);
        expect(noticeLog).toHaveLength(1);

        // 超过冷却窗口：允许再次提示
        ctx.lastQualityAlertTime = Date.now() - ctx.QUALITY_ALERT_COOLDOWN - 1;
        ctx.checkQualityAlert(result);
        expect(noticeLog).toHaveLength(2);
    });
});
