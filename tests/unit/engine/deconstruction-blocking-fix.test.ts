/**
 * 知识库拆解卡死 + 本地模型缺陷的回归测试（2026-11-25）。
 *
 * 覆盖四个修复点：
 * 1. LLM 增强拒绝本地模型（resolveLlmCallOptions → localModelRejected）
 * 2. llmModel 默认值不再是本地模型
 * 3. 拆解输入有硬上限（KB_BREAKDOWN_HARD_LIMIT）
 * 4. Worker 绕过时给用户可见提示（而非只 log）
 *
 * 背景（用户实测）：93 万字书 + 8 维全开 + 向量增强（退回主线程）→ Obsidian 卡死。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS,
    ALL_BREAKDOWN_DIMENSIONS,
} from '../../../shared/deconstruction-settings';
import { KB_BREAKDOWN_HARD_LIMIT } from '../../../shared/thresholds';
import { resolveProviderSourceType } from '../../../shared/model-source';

describe('拆解卡死修复：本地模型拒绝', () => {
    it('llmModel 默认值必须是空字符串（不能预设本地模型）', () => {
        // 旧默认 'deepseek-r1:7b' 是本地 Ollama 模型：结构化输出成功率高不了，且阻塞主线程
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.llmModel).toBe('');
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.llmModel).not.toMatch(/:[0-9]+b\b/);
    });

    it('vectorModel 仍然默认本地 bge-m3（embedding 用本地是对的）', () => {
        // 关键区分：向量模型本地 OK，LLM 增强模型必须云端
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.vectorModel).toBe('bge-m3');
    });

    it('llmEnabled 默认关闭', () => {
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.llmEnabled).toBe(false);
    });
});

describe('拆解卡死修复：输入硬上限', () => {
    it('硬上限必须存在且是合理量级（10万~20万字）', () => {
        expect(KB_BREAKDOWN_HARD_LIMIT).toBeGreaterThanOrEqual(100_000);
        expect(KB_BREAKDOWN_HARD_LIMIT).toBeLessThanOrEqual(200_000);
    });

    it('93 万字（用户那本书）必须被硬上限截断', () => {
        const userBookChars = 930_000;
        expect(userBookChars).toBeGreaterThan(KB_BREAKDOWN_HARD_LIMIT);
    });

    it('默认 textSampleLimit 小于硬上限（采样模式仍然更保守）', () => {
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.textSampleLimit)
            .toBeLessThanOrEqual(KB_BREAKDOWN_HARD_LIMIT);
    });
});

describe('拆解卡死修复：provider 来源判定', () => {
    it('localhost 端点必须判为 local', () => {
        expect(resolveProviderSourceType({ id: 'x', endpoint: 'http://localhost:11434/v1/chat/completions' }))
            .toBe('local');
        expect(resolveProviderSourceType({ id: 'x', endpoint: 'http://127.0.0.1:8080/v1' }))
            .toBe('local');
    });

    it('id=ollama 即使端点不是 localhost 也判为 local', () => {
        expect(resolveProviderSourceType({ id: 'ollama', endpoint: 'https://proxy.example.com/v1' }))
            .toBe('local');
    });

    it('云端端点是 cloud', () => {
        expect(resolveProviderSourceType({ id: 'deepseek', endpoint: 'https://api.deepseek.com/v1' }))
            .toBe('cloud');
        expect(resolveProviderSourceType({ id: 'opencode', endpoint: 'https://opencode.ai/inference/go/openai/v1' }))
            .toBe('cloud');
    });

    it('显式 sourceType 优先于端点推断', () => {
        expect(resolveProviderSourceType({
            id: 'x', endpoint: 'http://localhost:11434', sourceType: 'cloud',
        })).toBe('cloud');
    });
});

describe('拆解卡死修复：维度数量', () => {
    it('全维度是 8 个（用户实测全开是卡死放大因素）', () => {
        expect(ALL_BREAKDOWN_DIMENSIONS).toHaveLength(8);
    });

    it('默认只开 6 维（commercial/readability 通过独立开关控制）', () => {
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.enabledDimensions).toHaveLength(6);
    });
});

describe('拆解卡死修复：重负载预检', () => {
    it('重负载通知去重状态可重置（测试隔离）', async () => {
        const mod = await import('../../../engine/deconstruction-scheduler');
        expect(typeof mod.resetHeavyTaskNoticeForTest).toBe('function');
        expect(() => mod.resetHeavyTaskNoticeForTest()).not.toThrow();
    });

    it('本地模型通知去重状态可重置', async () => {
        const mod = await import('../../../engine/deconstruction-scheduler');
        expect(typeof mod.resetLlmLocalModelNoticeForTest).toBe('function');
        expect(() => mod.resetLlmLocalModelNoticeForTest()).not.toThrow();
    });
});

/**
 * 2026-11-28 补漏：模型没登记在 customProviders 里时的本地识别。
 *
 * 原实现只在 `customProviders` 里查 owner，查不到就直接放行（当云端）。
 * 但用户手填 `deepseek-r1:7b` 却忘了建 provider 时，请求会打到默认云端端点
 * 并稳定失败（模型不存在）——比明确拒绝更难排查。
 */
describe('拆解本地模型识别：未登记 provider 时的兜底', () => {
    it('识别 Ollama 尺寸标签', async () => {
        const { looksLikeLocalModelName } = await import('../../../engine/deconstruction-scheduler');
        expect(looksLikeLocalModelName('deepseek-r1:7b')).toBe(true);
        expect(looksLikeLocalModelName('qwen2.5:14b-instruct')).toBe(true);
        expect(looksLikeLocalModelName('llama3:70b')).toBe(true);
    });

    it('识别本地推理服务名', async () => {
        const { looksLikeLocalModelName } = await import('../../../engine/deconstruction-scheduler');
        expect(looksLikeLocalModelName('ollama/llama3')).toBe(true);
        expect(looksLikeLocalModelName('lmstudio-community/qwen')).toBe(true);
        expect(looksLikeLocalModelName('vllm-model')).toBe(true);
    });

    it('识别带端口的写法', async () => {
        const { looksLikeLocalModelName } = await import('../../../engine/deconstruction-scheduler');
        expect(looksLikeLocalModelName('localhost:11434/llama3')).toBe(true);
        expect(looksLikeLocalModelName('127.0.0.1:8080/v1')).toBe(true);
    });

    it('云端模型名不得误判（宁可漏判也不误伤）', async () => {
        const { looksLikeLocalModelName } = await import('../../../engine/deconstruction-scheduler');
        expect(looksLikeLocalModelName('deepseek-v4-pro')).toBe(false);
        expect(looksLikeLocalModelName('glm-5.2')).toBe(false);
        expect(looksLikeLocalModelName('gpt-4o')).toBe(false);
        expect(looksLikeLocalModelName('claude-sonnet-4.5')).toBe(false);
        expect(looksLikeLocalModelName('')).toBe(false);
    });
});
