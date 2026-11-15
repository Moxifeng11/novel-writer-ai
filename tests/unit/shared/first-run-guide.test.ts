/**
 * 首装自动引导判定：市场下载后打开即进引导，且只弹一次
 */

import { describe, expect, it } from 'vitest';
import { shouldAutoOpenFirstRunGuide, type FirstRunGuideState } from '@/shared/first-run-guide';

const state = (overrides: Partial<FirstRunGuideState> = {}): FirstRunGuideState => ({
    hasLastRunVersion: false,
    firstRunComplete: false,
    projectCount: 0,
    guideShownBefore: false,
    ...overrides,
});

describe('shouldAutoOpenFirstRunGuide', () => {
    it('刚下载安装（无上次运行版本）→ 自动进引导', () => {
        expect(shouldAutoOpenFirstRunGuide(state())).toBe(true);
    });

    it('已完成引导 → 不弹', () => {
        expect(shouldAutoOpenFirstRunGuide(state({ firstRunComplete: true }))).toBe(false);
    });

    it('已经自动弹过一次 → 不弹（用户可命令重开）', () => {
        expect(shouldAutoOpenFirstRunGuide(state({ guideShownBefore: true }))).toBe(false);
    });

    it('升级后仍无作品且未完成引导 → 兜底弹一次', () => {
        expect(shouldAutoOpenFirstRunGuide(state({ hasLastRunVersion: true }))).toBe(true);
    });

    it('已有作品 → 不打扰', () => {
        expect(shouldAutoOpenFirstRunGuide(state({ hasLastRunVersion: true, projectCount: 2 }))).toBe(false);
    });
});
