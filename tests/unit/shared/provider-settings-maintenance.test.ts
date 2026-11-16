/**
 * 供应商设置清理测试（2026-11-16 验收遗留）
 *
 * 两个清理都必须幂等、不丢用户配置：
 * 1. 同一端点因历史写法残留两条 modelOverrides key → 合并为一条；
 * 2. enabledProviderIds 残留已删除渠道 id → 过滤。
 */
import { describe, expect, it } from 'vitest';
import {
    mergeDuplicateOverrideKeys,
    pruneUnknownProviderIds,
} from '../../../shared/provider-settings-maintenance';
import { normalizeEndpointKey } from '../../../shared/endpoint-key';

describe('normalizeEndpointKey', () => {
    it('循环剥离版本段与协议尾段', () => {
        expect(normalizeEndpointKey('https://api.deepseek.com/v1/chat/completions/')).toBe('https://api.deepseek.com');
        expect(normalizeEndpointKey('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com');
        expect(normalizeEndpointKey('https://api.deepseek.com')).toBe('https://api.deepseek.com');
        expect(normalizeEndpointKey('https://a.com/api/v3')).toBe('https://a.com/api/v3');
    });

    it('不同子路径不会被误合并', () => {
        expect(normalizeEndpointKey('https://opencode.ai/zen/v1')).not.toBe(normalizeEndpointKey('https://opencode.ai/zen/go/v1'));
        expect(normalizeEndpointKey('https://opencode.ai/inference/go/openai/v1')).toBe('https://opencode.ai/inference/go/openai');
    });
});

describe('mergeDuplicateOverrideKeys', () => {
    it('同一端点的两条 key 合并，保留不丢字段', () => {
        const result = mergeDuplicateOverrideKeys({
            'https://api.deepseek.com/v1/chat/completions': { 'deepseek-flash': { maxOutput: 131072 } },
            'https://api.deepseek.com': { 'deepseek-flash': { maxContext: 1048576 } },
        }, ['https://api.deepseek.com']);
        expect(result.changed).toBe(true);
        expect(Object.keys(result.value)).toEqual(['https://api.deepseek.com']);
        expect(result.value['https://api.deepseek.com']['deepseek-flash'])
            .toEqual({ maxContext: 1048576, maxOutput: 131072 });
    });

    it('冲突时先出现的值优先（与运行时读取语义一致）', () => {
        const result = mergeDuplicateOverrideKeys({
            'https://a.com/v1': { m: { maxContext: 111 } },
            'https://a.com': { m: { maxContext: 999 } },
        }, []);
        // 无精确端点匹配时保留条目数最多的 key（相同则保留最先出现的）
        const values = Object.values(result.value);
        expect(values).toHaveLength(1);
        expect(values[0].m.maxContext).toBe(111);
    });

    it('没有重复 key 时不标记变化', () => {
        const original = { 'https://a.com': { m: { maxContext: 1 } } };
        const result = mergeDuplicateOverrideKeys(original, ['https://a.com']);
        expect(result.changed).toBe(false);
        expect(result.value).toBe(original);
    });

    it('幂等：合并结果再合并不再变化', () => {
        const once = mergeDuplicateOverrideKeys({
            'https://a.com/v1': { m: { maxContext: 1 } },
            'https://a.com': { m: { maxOutput: 2 } },
        }, ['https://a.com']);
        const twice = mergeDuplicateOverrideKeys(once.value, ['https://a.com']);
        expect(twice.changed).toBe(false);
        expect(twice.value).toEqual(once.value);
    });

    it('空条目被丢弃', () => {
        const result = mergeDuplicateOverrideKeys({
            'https://a.com': { m: {} },
            'https://a.com/v1': { m: { maxContext: 5 } },
        }, []);
        expect(result.value['https://a.com']['m']).toEqual({ maxContext: 5 });
    });
});

describe('pruneUnknownProviderIds', () => {
    it('过滤已删除渠道 id，保持顺序', () => {
        const result = pruneUnknownProviderIds(['deepseek', 'volc', 'ollama', 'catcat'], ['deepseek', 'ollama']);
        expect(result.changed).toBe(true);
        expect(result.value).toEqual(['deepseek', 'ollama']);
    });

    it('undefined（全部显示）保持不变', () => {
        const result = pruneUnknownProviderIds(undefined, ['a']);
        expect(result.changed).toBe(false);
        expect(result.value).toBeUndefined();
    });

    it('幂等：清理后再清理不再变化', () => {
        const once = pruneUnknownProviderIds(['a', 'gone'], ['a']);
        const twice = pruneUnknownProviderIds(once.value, ['a']);
        expect(twice.changed).toBe(false);
    });
});
