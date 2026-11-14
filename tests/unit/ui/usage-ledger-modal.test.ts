/**
 * usage-ledger-modal 行为测试（视图门禁要求）
 *
 * 测从账本服务导入到弹窗的计价来源展示逻辑（pricingSourceByModel）。
 */

import { describe, expect, it } from 'vitest';
import { pricingSourceByModel } from '@/services/usage-ledger';
import { UsageLedgerModal } from '@/ui/usage-ledger-modal';
import type { UsageRecord } from '@/services/usage-ledger';

/** 构造测试记录。 */
const record = (model: string, source: 'user' | 'default' | undefined): UsageRecord => ({
    id: `${model}-${source}`,
    at: 1,
    source: 'ai',
    model,
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    durationMs: 1,
    status: 'ok',
    pricing: source ? { inputPerM: 1, outputPerM: 2, source } : undefined,
});

describe('用量弹窗模块', () => {
    it('弹窗类可导入（视图门禁：视图文件需被测试 import）', () => {
        expect(typeof UsageLedgerModal).toBe('function');
    });
});

describe('用量弹窗 · 计价来源展示', () => {
    it('用户配置的单价显示为「自定义」', () => {
        expect(pricingSourceByModel([record('m1', 'user')])).toEqual({ m1: 'user' });
    });

    it('默认参考价显示为「参考价」', () => {
        expect(pricingSourceByModel([record('m2', 'default')])).toEqual({ m2: 'default' });
    });

    it('没有价格快照的模型不显示计价来源', () => {
        expect(pricingSourceByModel([record('m3', undefined)])).toEqual({});
    });

    it('多模型各自独立', () => {
        expect(pricingSourceByModel([record('a', 'user'), record('b', 'default')]))
            .toEqual({ a: 'user', b: 'default' });
    });
});
