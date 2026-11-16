/**
 * 供应商 UI 纯逻辑测试：可见性语义 / 每渠道分配 / 思考能力识别 / 请求头解析 / 旧预设迁移
 */

import { describe, expect, it } from 'vitest';
import {
    clampAssignment,
    defaultHeadersForProvider,
    defaultAssignmentFor,
    describeThinkingLevel,
    getOpenCodeSessionId,
    isProviderVisible,
    migrateRemovedPresets,
    parseHeaderLines,
    PRESET_PROVIDER_IDS,
    resolveProviderHeaders,
    resolveThinkingCapability,
    serializeHeaderLines,
    thinkingBudgetFromLevel,
    toggleProviderVisibility,
} from '@/shared/provider-ui-model';

const provider = (overrides: Partial<Parameters<typeof resolveThinkingCapability>[0]> = {}) => ({
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    ...overrides,
});

describe('isProviderVisible / toggleProviderVisibility', () => {
    it('未设置启用列表 = 全部显示', () => {
        expect(isProviderVisible('deepseek', undefined)).toBe(true);
        expect(isProviderVisible('volc', undefined)).toBe(true);
    });

    it('设置后只显示列表内渠道', () => {
        expect(isProviderVisible('deepseek', ['deepseek', 'ollama'])).toBe(true);
        expect(isProviderVisible('volc', ['deepseek', 'ollama'])).toBe(false);
    });

    it('关闭一个渠道只把它从列表移除，不影响其他', () => {
        expect(toggleProviderVisibility(undefined, ['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c']);
        expect(toggleProviderVisibility(['a', 'c'], ['a', 'b', 'c'], 'b', true)).toEqual(['a', 'b', 'c']);
    });
});

describe('每渠道模型分配', () => {
    const p = { id: 'deepseek', name: 'DeepSeek', endpoint: 'e', models: ['flash', 'pro', 'max'] };

    it('默认分配：第一个做默认/Flash，第二个做 Pro', () => {
        expect(defaultAssignmentFor(p)).toEqual({ defaultModel: 'flash', flashModel: 'flash', proModel: 'pro' });
    });

    it('旧配置指向已不存在模型时收敛到有效模型', () => {
        expect(clampAssignment({ defaultModel: 'ghost', flashModel: 'pro', proModel: 'ghost' }, p.models))
            .toEqual({ defaultModel: 'flash', flashModel: 'pro', proModel: 'pro' });
    });

    it('空模型列表不抛错', () => {
        expect(clampAssignment({}, [])).toEqual({ defaultModel: '', flashModel: '', proModel: '' });
    });
});

describe('resolveThinkingCapability 按渠道自动识别', () => {
    it('Anthropic 协议 → budget_tokens', () => {
        expect(resolveThinkingCapability(provider({ apiFormat: 'anthropic-messages' }), 'claude').kind)
            .toBe('anthropic-budget');
    });

    it('本地渠道 → 不支持', () => {
        expect(resolveThinkingCapability(provider({ endpoint: 'http://localhost:11434/v1/chat/completions', sourceType: 'local' }), 'qwen').supported)
            .toBe(false);
    });

    it('OpenAI o 系 → reasoning_effort', () => {
        expect(resolveThinkingCapability(provider({ endpoint: 'https://api.openai.com/v1/chat/completions' }), 'o3-mini').kind)
            .toBe('reasoning_effort');
    });

    it('DeepSeek / SenseNova → thinking.type', () => {
        expect(resolveThinkingCapability(provider(), 'deepseek-v4-pro').kind).toBe('thinking');
        expect(resolveThinkingCapability(provider({ endpoint: 'https://token.sensenova.cn/v1/chat/completions' }), 'x').kind).toBe('thinking');
    });

    // 语义变更（2026-11-16）：OpenCode 网关按 reasoning_effort 分级（能力声明 low/high/max，
    // 实测 thinking.type 也兼容，但旧实现是「UI 说支持、运行时完全不下发」）。
    it('OpenCode → reasoning_effort（与运行时下发同源）', () => {
        expect(resolveThinkingCapability(provider({ endpoint: 'https://opencode.ai/zen/v1/chat/completions' }), 'big-pickle').kind)
            .toBe('reasoning_effort');
    });

    it('未知渠道 → 不下发', () => {
        expect(resolveThinkingCapability(provider({ endpoint: 'https://my-proxy.example.com/v1' }), 'm').supported).toBe(false);
    });
});

describe('思考强度换算', () => {
    it('0 = 关闭；越高预算越多并夹取上限', () => {
        expect(thinkingBudgetFromLevel(0)).toBe(0);
        expect(thinkingBudgetFromLevel(50)).toBe(6400);
        expect(thinkingBudgetFromLevel(999)).toBe(12800);
        expect(describeThinkingLevel(0)).toBe('关闭');
        expect(describeThinkingLevel(85)).toContain('高');
    });
});

describe('请求头解析/序列化', () => {
    it('解析每行 Key: Value，忽略空行与注释', () => {
        expect(parseHeaderLines('# 注释\nHTTP-Referer: https://a.com\n\nX-Title: nw')).toEqual({
            'HTTP-Referer': 'https://a.com',
            'X-Title': 'nw',
        });
    });

    it('往返序列化', () => {
        const headers = { 'HTTP-Referer': 'https://a.com', 'X-Title': 'nw' };
        expect(parseHeaderLines(serializeHeaderLines(headers))).toEqual(headers);
    });
});

describe('内置请求头适配', () => {
    it('OpenRouter 自动补 Referer / Title', () => {
        const result = defaultHeadersForProvider({ endpoint: 'https://openrouter.ai/api/v1/chat/completions' });
        expect(result.headers['HTTP-Referer']).toBeTruthy();
        expect(result.headers['X-Title']).toBe('Novel Writer AI');
    });

    it('Anthropic 协议补版本头', () => {
        const result = defaultHeadersForProvider({ endpoint: 'https://api.anthropic.com/v1/messages', apiFormat: 'anthropic-messages' });
        expect(result.headers['anthropic-version']).toBe('2023-06-01');
    });

    // 语义变更（2026-11-16）：OpenCode Go 缺 x-opencode-session 会 400 MissingSessionID，
    // 因此改为自动补会话头；普通渠道仍然不补。
    it('OpenCode 自动补会话头，普通渠道不补', () => {
        const opencode = defaultHeadersForProvider(
            { endpoint: 'https://opencode.ai/zen/v1/chat/completions' },
            { sessionId: 'fixed-session' },
        );
        expect(opencode.headers['x-opencode-session']).toBe('fixed-session');
        expect(defaultHeadersForProvider({ endpoint: 'https://api.deepseek.com/v1/chat/completions' }).headers).toEqual({});
    });

    it('用户自定义请求头覆盖内置值，且会话 id 稳定', () => {
        const a = getOpenCodeSessionId();
        const b = getOpenCodeSessionId();
        expect(a).toBe(b);
        const merged = resolveProviderHeaders({
            endpoint: 'https://opencode.ai/zen/v1/chat/completions',
            headers: { 'x-opencode-session': 'mine' },
        });
        expect(merged['x-opencode-session']).toBe('mine');
    });
});

describe('旧预设迁移', () => {
    it('历史预设（火山/CatCat）转成自定义供应商，四个新预设不动', () => {
        const migrated = migrateRemovedPresets([
            { id: 'volc', isDefault: true },
            { id: 'catcat', isDefault: true },
            { id: 'deepseek', isDefault: true },
            { id: 'opencode', isDefault: true },
        ], PRESET_PROVIDER_IDS);
        expect(migrated.map(item => [item.id, item.isDefault])).toEqual([
            ['volc', false],
            ['catcat', false],
            ['deepseek', true],
            ['opencode', true],
        ]);
    });

    it('幂等：迁移后的列表再迁移不变', () => {
        const once = migrateRemovedPresets([{ id: 'volc', isDefault: true }], PRESET_PROVIDER_IDS);
        expect(migrateRemovedPresets(once, PRESET_PROVIDER_IDS)).toEqual(once);
    });
});
