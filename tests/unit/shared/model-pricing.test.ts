import { describe, expect, it } from 'vitest';
import { estimateCostYuan, lookupModelPricing } from '../../../shared/model-pricing';

describe('model-pricing — 模型单价与费用估算', () => {
    // 显式标注：异构字面量推断会产生 `?: undefined` 属性，无法直接赋给 Record 索引签名
    const settings: {
        customProviders: Array<{ modelMeta?: Record<string, { inputPricePerM?: number; outputPricePerM?: number }> }>;
    } = {
        customProviders: [
            { modelMeta: { 'deepseek-v4-flash': { inputPricePerM: 1, outputPricePerM: 4 } } },
            { modelMeta: { 'glm-4.7': { inputPricePerM: 2 } } },
            { modelMeta: { 'free-model': {} } },
        ],
    };

    it('lookupModelPricing 命中任一 provider 的精确键', () => {
        expect(lookupModelPricing('deepseek-v4-flash', settings)).toEqual({ inputPerM: 1, outputPerM: 4 });
    });

    it('只配置单边单价时另一边按 0 计', () => {
        expect(lookupModelPricing('glm-4.7', settings)).toEqual({ inputPerM: 2, outputPerM: 0 });
    });

    it('未配置单价（查不到 / meta 为空 / 空模型名 / 未传 settings）返回 null', () => {
        expect(lookupModelPricing('unknown-model', settings)).toBeNull();
        // meta 存在但两侧单价都没填：视为未配置
        expect(lookupModelPricing('free-model', settings)).toBeNull();
        expect(lookupModelPricing('', settings)).toBeNull();
        expect(lookupModelPricing('deepseek-v4-flash')).toBeNull();
    });

    it('estimateCostYuan 按百万 token 单价估算并保留 6 位小数', () => {
        const pricing = { inputPerM: 2, outputPerM: 6 };
        // 100万入 + 50万出 = 2 + 3 = 5 元
        expect(estimateCostYuan(pricing, 1_000_000, 500_000)).toBe(5);
        // 1000 入 + 2000 出 = 0.002 + 0.012 = 0.014 元
        expect(estimateCostYuan(pricing, 1000, 2000)).toBe(0.014);
        // 1.3 元/百万 × 1000001 tokens = 1.3000013 → 保留 6 位小数 1.300001
        expect(estimateCostYuan({ inputPerM: 1.3, outputPerM: 0 }, 1_000_001, 0)).toBe(1.300001);
    });

    it('estimateCostYuan 未配置单价返回 null，0 token 时为 0', () => {
        expect(estimateCostYuan(null, 1000, 2000)).toBeNull();
        expect(estimateCostYuan({ inputPerM: 2, outputPerM: 6 }, 0, 0)).toBe(0);
    });
});
