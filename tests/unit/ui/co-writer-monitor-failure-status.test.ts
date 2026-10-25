import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { RealtimeQualityController, type RealtimeQualityHost } from '../../../ui/cowrite/realtime-quality-controller';
import type { DeviationReport, DeviationType } from '../../../engine/quality/deviation-detector';
import type { QualityScore } from '../../../engine/quality/quality-score-engine';

const BODY_PATH = '03-大纲与章节/正文/第3章.md';

function makeDeviationReport(overallScore = 0): DeviationReport {
    const typeScores = {} as Record<DeviationType, number>;
    for (const type of [
        'mainline',
        'characterOOC',
        'contradiction',
        'foreshadowForgot',
        'rhythm',
        'emotionBreak',
    ] as DeviationType[]) {
        typeScores[type] = 0;
    }
    return {
        overallScore,
        overallSeverity: 'info',
        typeScores,
        unevaluatedTypes: [],
        issues: [],
        suggestions: [],
        evaluatedAt: Date.now(),
        wordCount: 200,
        evalTimeMs: 1,
        fromCache: false,
        incremental: false,
    };
}

function makeQualityScore(overallScore = 82): QualityScore {
    return {
        overallScore,
        dimensions: {} as QualityScore['dimensions'],
        issues: [],
        suggestions: [],
        evaluatedAt: Date.now(),
        wordCount: 200,
        evalTimeMs: 1,
        trend: 'stable',
        fromCache: false,
    };
}

interface StatusEl {
    setText: ReturnType<typeof vi.fn>;
    setAttribute: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
}

function createController(result: Record<string, unknown>) {
    const status: StatusEl = {
        setText: vi.fn(),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
    };
    const monitor = {
        evaluate: vi.fn().mockResolvedValue(result),
        isEvaluating: () => false,
        cancel: vi.fn(),
    };
    const host: RealtimeQualityHost = {
        app: {} as never,
        getText: () => '正文内容。'.repeat(40),
        getProject: () => 'A书',
        getVolume: () => '第1卷',
        getChapterNum: () => 3,
        getChapterName: () => '第3章',
        getBodyPath: () => BODY_PATH,
        getChapterBrief: () => null,
        getChapPlan: () => undefined,
        loadCharacterInfos: async () => [],
        loadForeshadows: async () => [],
        createMonitor: () => monitor as never,
    };
    const controller = new RealtimeQualityController(host);
    controller.attachStatus(status as never);
    (controller as unknown as { enabled: boolean }).enabled = true;
    (controller as unknown as { monitor: typeof monitor }).monitor = monitor;
    vi.spyOn(controller as unknown as { buildDeviationContext: () => Promise<object> }, 'buildDeviationContext')
        .mockResolvedValue({});
    vi.spyOn(controller as unknown as { persistLiveQualityIfDue: () => Promise<void> }, 'persistLiveQualityIfDue')
        .mockResolvedValue(undefined);
    return { controller, status };
}

/** 顶栏最后一次写入的文本（首帧是「质量评估中…」） */
function lastStatusText(status: StatusEl): string {
    const calls = status.setText.mock.calls;
    return calls[calls.length - 1]?.[0] as string;
}

describe('RealtimeQualityController — 顶栏的部分失败展示', () => {
    it('偏离检测失败时明确告知，不显示成「没有偏离」', async () => {
        const { controller, status } = createController({
            qualityScore: makeQualityScore(),
            deviations: undefined,
            failures: ['deviations: boom'],
            partialFailure: true,
            cancelled: false,
            fromCache: false,
        });

        await controller.evaluate();

        const text = lastStatusText(status);
        expect(text).toContain('偏离检测失败');
        expect(text).not.toContain('质量评估失败');
    });

    it('质量与偏离都失败时显示「质量评估失败」，而不是「质量 --」', async () => {
        const { controller, status } = createController({
            qualityScore: undefined,
            deviations: undefined,
            failures: ['quality: score boom', 'deviations: deviation boom'],
            partialFailure: false,
            cancelled: false,
            fromCache: false,
        });

        await controller.evaluate();

        const text = lastStatusText(status);
        expect(text).toContain('质量评估失败');
        expect(text).toContain('质量评分失败');
        expect(text).toContain('偏离检测失败');
        expect(text).not.toContain('质量 --');
    });

    it('两项都成功时不出现失败提示（守卫）', async () => {
        const { controller, status } = createController({
            qualityScore: makeQualityScore(82),
            deviations: makeDeviationReport(0),
            failures: undefined,
            partialFailure: false,
            cancelled: false,
            fromCache: false,
        });

        await controller.evaluate();

        const text = lastStatusText(status);
        expect(text).toContain('质量 82');
        expect(text).toContain('偏离 0');
        expect(text).not.toContain('失败');
    });
});
