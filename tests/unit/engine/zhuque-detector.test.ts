/**
 * 朱雀检测器回归测试（2026-11-25）。
 *
 * 核心约束：
 * 1. 默认关闭（不消耗额度）
 * 2. 失败不降级——拿不到就是拿不到，绝不用统计指标冒充
 * 3. 缓存安全（朱雀确定性，同文本可缓存）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// requestJson 走 http-transport（移动端 requestUrl / 桌面端 fetch），
// 单测直接 mock 传输层，避免依赖具体实现。
const mockRequestJson = vi.hoisted(() => vi.fn());
vi.mock('../../../shared/http-transport', () => ({ requestJson: mockRequestJson }));
import { ZhuqueDetector, gradeOf } from '../../../engine/zhuque-detector';
import { DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS } from '../../../shared/deconstruction-settings';
import { kbBookZhuqueDetectionFile } from '../../../shared/paths';

/** 桩返回体 */
function okBody(human = 1, ai = 0, sus = 0, softmax = 0.0005, tokens = 100) {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            status: 'success',
            labels_ratio: { '0': human, '1': ai, '2': sus },
            softmax_confidence: softmax,
            segment_labels: [],
            makers_models_usage: { total_tokens: tokens },
        }),
    };
}

describe('gradeOf 档位映射', () => {
    it('>=80% 为 HUMAN', () => expect(gradeOf(100, 0.0005)).toBe('HUMAN'));
    it('>=50% 为 LIKELY_HUMAN', () => expect(gradeOf(60, 0.3)).toBe('LIKELY_HUMAN'));
    it('>=20% 为 MIXED', () => expect(gradeOf(42.3, 0.63)).toBe('MIXED'));
    it('>0% 为 LIKELY_AI', () => expect(gradeOf(5, 0.9)).toBe('LIKELY_AI'));
    it('0% 且 softmax>0.99 为 AI', () => expect(gradeOf(0, 0.9999)).toBe('AI'));
    it('0% 且 softmax<=0.99 为 LIKELY_AI（低置信）', () => expect(gradeOf(0, 0.5)).toBe('LIKELY_AI'));
});

describe('ZhuqueDetector', () => {
    beforeEach(() => {
        mockRequestJson.mockReset();
    });
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('默认关闭：enabled=false 时直接返回不可用，不发请求', async () => {
        const d = new ZhuqueDetector({ enabled: false, apiKey: 'k' });
        const r = await d.detect('这是一段足够长的待检测文本，用于通过最短长度检查，需要超过五十个字符才能进入检测流程。这里再补一些内容确保长度足够，比如描写天气、人物动作、环境细节等等，总之要够长才行。');
        expect(r.available).toBe(false);
        expect(r.reason).toContain('未启用');
        expect(mockRequestJson).not.toHaveBeenCalled();
    });

    it('无 apiKey 时返回不可用，不发请求', async () => {
        const d = new ZhuqueDetector({ enabled: true, apiKey: '' });
        const r = await d.detect('这是一段足够长的待检测文本，用于通过最短长度检查，需要超过五十个字符才能进入检测流程。这里再补一些内容确保长度足够，比如描写天气、人物动作、环境细节等等，总之要够长才行。');
        expect(r.available).toBe(false);
        expect(r.reason).toContain('MAKERS_MODELS_KEY');
        expect(mockRequestJson).not.toHaveBeenCalled();
    });

    it('文本过短（<50字）时返回不可用', async () => {
        const d = new ZhuqueDetector({ enabled: true, apiKey: 'k' });
        const r = await d.detect('太短了');
        expect(r.available).toBe(false);
        expect(r.reason).toContain('过短');
    });

    it('正常返回时解析 labels_ratio 与 softmax', async () => {
        mockRequestJson.mockResolvedValue(okBody(1, 0, 0, 0.0005, 200));
        const d = new ZhuqueDetector({ enabled: true, apiKey: 'k' });
        const r = await d.detect('这是一段足够长的待检测文本，用于通过最短长度检查，需要超过五十个字符才能进入检测流程。这里再补一些内容确保长度足够，比如描写天气、人物动作、环境细节等等，总之要够长才行。');
        expect(r.available).toBe(true);
        expect(r.humanRate).toBe(100);
        expect(r.softmax).toBeCloseTo(0.0005, 4);
        expect(r.grade).toBe('HUMAN');
        expect(r.billedTokens).toBe(200);
        expect(d.billedTokens).toBe(200);
    });

    it('402 额度不足时给明确原因，不抛错', async () => {
        mockRequestJson.mockResolvedValue({
            ok: false, status: 402, text: async () => '{"error":{"code":"insufficient_remaining_quota"}}',
        });
        const d = new ZhuqueDetector({ enabled: true, apiKey: 'k' });
        const r = await d.detect('这是一段足够长的待检测文本，用于通过最短长度检查，需要超过五十个字符才能进入检测流程。这里再补一些内容确保长度足够，比如描写天气、人物动作、环境细节等等，总之要够长才行。');
        expect(r.available).toBe(false);
        expect(r.reason).toContain('额度');
    });

    it('同文本命中缓存，不重复消耗额度', async () => {
        mockRequestJson.mockResolvedValue(okBody(1, 0, 0, 0.0005, 100));
        const d = new ZhuqueDetector({ enabled: true, apiKey: 'k' });
        const text = '这是一段足够长的待检测文本，用于通过最短长度检查，需要超过五十个字符才能进入检测流程。这里再补一些内容确保长度足够，比如描写天气、人物动作、环境细节等等，总之要够长才行。';
        const r1 = await d.detect(text);
        const r2 = await d.detect(text);
        expect(mockRequestJson).toHaveBeenCalledTimes(1);
        expect(r2).toEqual(r1);
        expect(d.billedTokens).toBe(100); // 只计一次
    });

    it('超长文本按 maxChars 截断后再发', async () => {
        mockRequestJson.mockResolvedValue(okBody());
        const d = new ZhuqueDetector({ enabled: true, apiKey: 'k', maxChars: 100 });
        await d.detect('字'.repeat(5000));
        const body = JSON.parse((mockRequestJson.mock.calls[0][1] as { body: string }).body);
        expect(body.text.length).toBe(100);
    });

    it('网络异常时返回不可用，不抛错', async () => {
        mockRequestJson.mockRejectedValue(new Error('ECONNRESET'));
        const d = new ZhuqueDetector({ enabled: true, apiKey: 'k' });
        const r = await d.detect('这是一段足够长的待检测文本，用于通过最短长度检查，需要超过五十个字符才能进入检测流程。这里再补一些内容确保长度足够，比如描写天气、人物动作、环境细节等等，总之要够长才行。');
        expect(r.available).toBe(false);
        expect(r.reason).toContain('ECONNRESET');
    });
});

describe('设置默认值与路径', () => {
    it('includeZhuque 默认关闭（不消耗额度）', () => {
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.includeZhuque).toBe(false);
    });

    it('zhuqueMaxChars 默认 20000', () => {
        expect(DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.zhuqueMaxChars).toBe(20000);
    });

    it('朱雀结果写在独立文件，不与统计维度混存', () => {
        const p = kbBookZhuqueDetectionFile('斗破苍穹');
        expect(p).toContain('朱雀人味检测.md');
        expect(p).not.toContain('可读性分析');
    });
});
