/**
 * fingerprint-selection-b4.test.ts — 协同 / 11 步共用的指纹注入选择器
 *
 * 缺陷：上限 3 只在协同写作生效，11 步正文把全部启用指纹塞进 system。
 * 修复：抽出纯选择器；协同回退「全量」，11 步回退「前 3」并上报降级。
 */

import { describe, it, expect, vi } from 'vitest';
import {
    MAX_INJECTED_STYLE_FINGERPRINTS,
    selectFingerprintsForInjection,
} from '../../../engine/style/fingerprint-selection';

const FIVE = ['fp1', 'fp2', 'fp3', 'fp4', 'fp5'].map(id => ({ id }));

describe('B4 — selectFingerprintsForInjection', () => {
    it('启用数不超过上限时不发起检索', async () => {
        const searchV2 = vi.fn();
        const result = await selectFingerprintsForInjection(FIVE.slice(0, 3), {
            query: '正文',
            searchV2,
        });

        expect(searchV2).not.toHaveBeenCalled();
        expect(result.map(fp => fp.id)).toEqual(['fp1', 'fp2', 'fp3']);
        expect(MAX_INJECTED_STYLE_FINGERPRINTS).toBe(3);
    });

    it('超过上限时按 V2 排名挑 topN，保持启用列表顺序', async () => {
        const searchV2 = vi.fn(async () => [
            { fingerprintId: 'fp4' },
            { fingerprintId: 'fp1' },
            { fingerprintId: 'fp5' },
        ]);

        const result = await selectFingerprintsForInjection(FIVE, { query: '正文', searchV2 });

        expect(searchV2).toHaveBeenCalledWith('正文', {
            topN: 3,
            fingerprintIds: ['fp1', 'fp2', 'fp3', 'fp4', 'fp5'],
        });
        expect(result.map(fp => fp.id)).toEqual(['fp1', 'fp4', 'fp5']);
    });

    it('检索不可用 + fallback=firstN：只保留前 3 并回调原因', async () => {
        const onFallback = vi.fn();
        const result = await selectFingerprintsForInjection(FIVE, {
            query: '正文',
            fallback: 'firstN',
            onFallback,
        });

        expect(result.map(fp => fp.id)).toEqual(['fp1', 'fp2', 'fp3']);
        expect(onFallback).toHaveBeenCalledTimes(1);
        expect(onFallback.mock.calls[0][0]).toContain('V2 12 维检索不可用');
    });

    it('检索失败 + fallback=all：保留全部（协同不丢风格约束）', async () => {
        const searchV2 = vi.fn(async () => { throw new Error('embed boom'); });
        const onFallback = vi.fn();

        const result = await selectFingerprintsForInjection(FIVE, {
            query: '正文',
            searchV2,
            fallback: 'all',
            onFallback,
        });

        expect(result).toHaveLength(5);
        expect(onFallback.mock.calls[0][0]).toContain('V2 检索异常');
    });

    it('检索结果与启用指纹无交集时走 fallback', async () => {
        const searchV2 = vi.fn(async () => [{ fingerprintId: 'disabled-fp' }]);
        const onFallback = vi.fn();

        const result = await selectFingerprintsForInjection(FIVE, {
            query: '正文',
            searchV2,
            fallback: 'firstN',
            onFallback,
        });

        expect(result.map(fp => fp.id)).toEqual(['fp1', 'fp2', 'fp3']);
        expect(onFallback.mock.calls[0][0]).toContain('无交集');
    });
});
