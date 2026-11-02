/**
 * divergence-trend.ts — 偏离度「持续上升」的判定
 *
 * 面板 B 的偏离评估在打字停顿后 500ms 就会跑一次，历史里存的是「评估次数」。
 * 只比较最近 3 次数值，几秒钟内的三次编辑就会被判成「连续多章偏离度上升」，
 * 文案与事实不符、且 24 小时冷却会吃掉真正有意义的预警。
 *
 * 这里把判定收敛成纯函数：既要数值连续上升（相邻 >5），
 * 也要这三次评估至少跨过 `DIVERGENCE_RISING_MIN_WINDOW_MS`。
 */

import { DIVERGENCE_RISING_MIN_WINDOW_MS } from './thresholds';

export interface DivergenceSample {
    value: number;
    at: number;
}

/**
 * @param samples 按时间顺序排列的评估样本（至少 3 条才可能判定）
 * @param now 当前时间戳
 * @returns 是否成功
 */
export function isRisingDivergence(samples: DivergenceSample[], now: number): boolean {
    if (samples.length < 3) return false;

    const recent = samples.slice(-3);
    const span = now - recent[0].at;
    if (span < DIVERGENCE_RISING_MIN_WINDOW_MS) return false;

    let risingCount = 0;
    for (let i = 1; i < recent.length; i++) {
        if (recent[i].value > recent[i - 1].value + 5) {
            risingCount++;
        }
    }
    return risingCount >= 2;
}
