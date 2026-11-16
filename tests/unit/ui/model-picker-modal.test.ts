/**
 * model-picker-modal 测试：从 URL 获取模型后的「确认勾选」结果。
 *
 * 2026-11-16（M-19/M-20/M-26）：确认结果除模型列表外还要带回端点披露的
 * 上下文/输出/视觉/单价，供调用方写入 modelMeta。
 */
import { describe, expect, it } from 'vitest';
import { buildPickerResult, isPickedByDefault } from '../../../ui/model-picker-modal';
import type { DiscoveredModel } from '../../../services/model-discovery';

const CANDIDATES: DiscoveredModel[] = [
    {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        contextWindow: 1000000,
        maxTokens: 384000,
        vision: true,
        pricing: { inputPerM: 0.15, outputPerM: 0.6, currency: 'USD' },
    },
    { id: 'glm-5.3-flash', contextWindow: 1000000, maxTokens: 131072 },
    { id: 'plain-model' },
];

describe('buildPickerResult', () => {
    it('空列表时全选（首装导入）', () => {
        const result = buildPickerResult(CANDIDATES, [], () => true);
        expect(result?.models).toEqual(['deepseek-v4.1-flash', 'glm-5.3-flash', 'plain-model']);
    });

    it('有重合时，未列出的已配置模型原样保留', () => {
        const result = buildPickerResult(CANDIDATES, ['local-only', 'glm-5.3-flash'], id => id === 'glm-5.3-flash');
        expect(result.models).toEqual(['local-only', 'glm-5.3-flash']);
    });

    it('不回填端点没给出的能力', () => {
        const result = buildPickerResult(CANDIDATES, [], () => true);
        expect(result?.capacities.find(item => item.id === 'plain-model')).toBeUndefined();
        expect(result?.capacities.find(item => item.id === 'deepseek-v4.1-flash')).toMatchObject({
            contextWindow: 1000000,
            maxTokens: 384000,
            vision: true,
            inputPricePerM: 0.15,
            outputPricePerM: 0.6,
            priceCurrency: 'USD',
        });
    });

    // 2026-11-16（M-32）：旧实现强制「至少保留一个」，导致「全部取消」后下方列表仍是全部模型。
    // 现在允许清空：取消哪些，列表里就不该再有那些。
    it('全部取消 → 返回空列表（允许清空）', () => {
        expect(buildPickerResult(CANDIDATES, [], () => false).models).toEqual([]);
    });

    it('只取消部分 → 列表里只剩勾选的', () => {
        const result = buildPickerResult(CANDIDATES, [], id => id !== 'glm-5.3-flash');
        expect(result.models).toEqual(['deepseek-v4.1-flash', 'plain-model']);
    });

    it('勾选判定生效：只保留被勾的候选', () => {
        const result = buildPickerResult(CANDIDATES, [], id => id !== 'plain-model');
        expect(result?.models).toEqual(['deepseek-v4.1-flash', 'glm-5.3-flash']);
    });
});

// 2026-11-16（M-27）：OpenCode go 拉回 86 个模型但弹窗一个都没勾，
// 点「应用」等于没导入——用户看到「获取成功却没效果」。
// 规则：已配置模型与候选完全不重合时视为首次导入，全选。
describe('ModelPickerModal 默认勾选规则', () => {
    it('已配置模型与候选完全不重合时全选（否则应用等于没导入）', () => {
        for (const id of ['deepseek-v4.1-flash', 'glm-5.3-flash', 'plain-model']) {
            expect(isPickedByDefault(CANDIDATES, ['old-channel-model'], id)).toBe(true);
        }
        // 换端点时旧模型不属于新端点：用候选替换，不叠加保留
        // （OpenCode Zen 42 个模型换到 Go 端点后，旧模型在 Go 端点全部 400）
        const result = buildPickerResult(CANDIDATES, ['old-channel-model'], () => true);
        expect(result.models).toEqual(['deepseek-v4.1-flash', 'glm-5.3-flash', 'plain-model']);
    });

    it('首次导入（无已配置）全选', () => {
        for (const model of CANDIDATES) {
            expect(isPickedByDefault(CANDIDATES, [], model.id)).toBe(true);
        }
    });

    it('有重合时只勾已配置的', () => {
        const result = buildPickerResult(CANDIDATES, ['glm-5.3-flash'], id => id === 'glm-5.3-flash');
        expect(result?.models).toEqual(['glm-5.3-flash']);
    });
});

// 2026-11-16：换端点（Zen → Go）时，旧模型在新端点全部不可用（claude-opus 400），
// 必须用新列表替换。仅靠「候选完全不重合」判断不够：两个端点可能恰好有几个同名模型。
describe('换端点替换（replaceMissing）', () => {
    it('显式标记换端点 → 旧模型全部替换，即使有同名重合', () => {
        const result = buildPickerResult(CANDIDATES, ['glm-5.3-flash', 'zen-only-model'], () => true, {
            replaceMissing: true,
        });
        expect(result.models).toEqual(['deepseek-v4.1-flash', 'glm-5.3-flash', 'plain-model']);
    });

    it('同端点（未标记）→ 保留未列出的模型', () => {
        const result = buildPickerResult(CANDIDATES, ['glm-5.3-flash', 'offline-only'], id => id === 'glm-5.3-flash');
        // kept 保持已配置顺序（候选里列出的按勾选，未列出的保留）
        expect(result.models).toEqual(['glm-5.3-flash', 'offline-only']);
    });
});

