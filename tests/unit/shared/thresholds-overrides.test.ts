/**
 * thresholds-overrides.test.ts — R1 业务阈值运行时可覆盖
 *
 * 核心契约：未设置覆盖时，生效值与内置常量完全一致（保证零行为变化）；
 * 覆盖值非法时回落到内置常量，不会把错误配置带进运行时。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    BUSINESS_THRESHOLD_DEFAULTS,
    PROMPT_SPLIT_RATIO,
    WORD_MIN_RATIO,
    getBusinessThreshold,
    setBusinessThresholdOverrides,
} from '../../../shared/thresholds';

afterEach(() => {
    setBusinessThresholdOverrides({ wordMinRatio: undefined, promptSplitRatio: undefined });
});

describe('业务阈值覆盖 — 默认值', () => {
    it('内置默认值与既有常量一致', () => {
        expect(BUSINESS_THRESHOLD_DEFAULTS.wordMinRatio).toBe(WORD_MIN_RATIO);
        expect(BUSINESS_THRESHOLD_DEFAULTS.promptSplitRatio).toBe(PROMPT_SPLIT_RATIO);
    });

    it('未覆盖时读取结果等于内置常量', () => {
        expect(getBusinessThreshold('wordMinRatio')).toBe(WORD_MIN_RATIO);
        expect(getBusinessThreshold('promptSplitRatio')).toBe(PROMPT_SPLIT_RATIO);
    });
});

describe('业务阈值覆盖 — 生效与回落', () => {
    it('合法覆盖立即生效', () => {
        setBusinessThresholdOverrides({ wordMinRatio: 0.5, promptSplitRatio: 0.8 });
        expect(getBusinessThreshold('wordMinRatio')).toBe(0.5);
        expect(getBusinessThreshold('promptSplitRatio')).toBe(0.8);
    });

    it('非法值（≤0 / >1 / 非数）被忽略并回落内置常量', () => {
        setBusinessThresholdOverrides({ wordMinRatio: 0.5 });
        setBusinessThresholdOverrides({ wordMinRatio: -1 });
        expect(getBusinessThreshold('wordMinRatio')).toBe(WORD_MIN_RATIO);

        setBusinessThresholdOverrides({ promptSplitRatio: 1.2 });
        expect(getBusinessThreshold('promptSplitRatio')).toBe(PROMPT_SPLIT_RATIO);

        setBusinessThresholdOverrides({ wordMinRatio: Number.NaN });
        expect(getBusinessThreshold('wordMinRatio')).toBe(WORD_MIN_RATIO);
    });

    it('传入空对象等价于清空覆盖（设置未填写的场景）', () => {
        setBusinessThresholdOverrides({ wordMinRatio: 0.5 });
        setBusinessThresholdOverrides({});
        expect(getBusinessThreshold('wordMinRatio')).toBe(WORD_MIN_RATIO);
    });
});
