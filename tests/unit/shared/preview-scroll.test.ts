/**
 * preview-scroll.test.ts — 协同预览区滚动锚点
 *
 * `refreshPreview` 每次输入都 empty() + 全量重渲染，scrollTop 会归零；
 * 用户向下翻看前文时打字会被拉回顶部。锚点必须在渲染后恢复，
 * 原本贴底则继续跟随最新内容。
 */
import { describe, it, expect } from 'vitest';
import {
    PREVIEW_BOTTOM_THRESHOLD_PX,
    captureScrollSnapshot,
    resolveRestoredScrollTop,
} from '../../../shared/preview-scroll';

describe('captureScrollSnapshot', () => {
    it('记录非贴底的滚动位置', () => {
        expect(captureScrollSnapshot(120, 1000, 400)).toEqual({ top: 120, atBottom: false });
    });

    it('距底部在阈值内视为贴底', () => {
        const snapshot = captureScrollSnapshot(600 - PREVIEW_BOTTOM_THRESHOLD_PX, 1000, 400);
        expect(snapshot.atBottom).toBe(true);
    });

    it('超出可滚动范围时先夹紧再判断', () => {
        // 内容刚被删减，旧 scrollTop 大于新的最大滚动值
        expect(captureScrollSnapshot(900, 500, 400)).toEqual({ top: 100, atBottom: true });
    });

    it('内容不足一屏时 maxScrollTop 为 0，视为贴底', () => {
        expect(captureScrollSnapshot(0, 200, 400)).toEqual({ top: 0, atBottom: true });
    });
});

describe('resolveRestoredScrollTop', () => {
    it('非贴底时保持原绝对位置（内容变长）', () => {
        expect(resolveRestoredScrollTop({ top: 120, atBottom: false }, 2000, 400)).toBe(120);
    });

    it('贴底时恢复到新的最大滚动值，跟随最新正文', () => {
        expect(resolveRestoredScrollTop({ top: 600, atBottom: true }, 2000, 400)).toBe(1600);
    });

    it('内容变短时把非贴底位置夹紧到新上限', () => {
        expect(resolveRestoredScrollTop({ top: 900, atBottom: false }, 500, 400)).toBe(100);
    });

    it('内容清空（隐藏/折叠）后恢复为 0', () => {
        expect(resolveRestoredScrollTop({ top: 300, atBottom: false }, 0, 0)).toBe(0);
    });
});
