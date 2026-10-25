/**
 * co-writer-quality-persist-guard.test.ts — 实时质量落盘只允许复用本次评估结果
 *
 * 原实现用 `qualityScore?.v1Result ?? this.qualityKernel.evaluate(text)` 兜底：
 * quality 子任务失败 / 评估被取消时，会再跑一次 WQE，往内核 scoreHistory 多记一条，
 * 并写入一条与顶栏「质量 --」不一致的历史记录。这里锁定「没有本次结果就跳过」。
 * D2 后落盘逻辑位于 RealtimeQualityController。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { appendQualityHistory } = vi.hoisted(() => ({
    appendQualityHistory: vi.fn(
        async (_app: unknown, _project: string, _record: Record<string, unknown>) => undefined,
    ),
}));

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

vi.mock('../../../services/quality-history-store', () => ({
    appendQualityHistory,
}));

import { RealtimeQualityController, type RealtimeQualityHost } from '../../../ui/cowrite/realtime-quality-controller';
import { QUALITY_LIVE_PERSIST_MIN_CHARS } from '../../../shared/thresholds';

const LONG_TEXT = '这是一段足够长的正文，用来触发实时质量落盘。'.repeat(30);

function makeController() {
    const host: RealtimeQualityHost = {
        app: {} as never,
        getText: () => LONG_TEXT,
        getProject: () => '测试书',
        getVolume: () => '第1卷',
        getChapterNum: () => 1,
        getChapterName: () => '第1章',
        getBodyPath: () => '/测试书/第1卷/第1章.md',
        getChapterBrief: () => null,
        getChapPlan: () => undefined,
        loadCharacterInfos: async () => [],
        loadForeshadows: async () => [],
        createMonitor: () => {
            throw new Error('persist 测试不应创建 monitor');
        },
    };
    return new RealtimeQualityController(host);
}

function persist(controller: RealtimeQualityController, text: string, qualityScore?: unknown): Promise<void> {
    return (controller as unknown as {
        persistLiveQualityIfDue: (text: string, qualityScore?: unknown) => Promise<void>;
    }).persistLiveQualityIfDue(text, qualityScore);
}

function dimension(score: number) {
    return { score, level: 'good' };
}

function v1Result(overallScore = 82) {
    return {
        evaluatedAt: 1_700_000_000_000,
        wordCount: 420,
        overallScore,
        languageQuality: dimension(80),
        rhythmQuality: dimension(81),
        characterQuality: dimension(82),
        plotQuality: dimension(83),
        atmosphereQuality: dimension(84),
        structureQuality: dimension(85),
        grade: 'B',
        trend: 'stable',
    };
}

describe('RealtimeQualityController — 实时质量落盘不得二次评估', () => {
    beforeEach(() => {
        appendQualityHistory.mockClear();
    });

    it('本次评估没有 WQE 结果时跳过落盘', async () => {
        const controller = makeController();

        await persist(controller, LONG_TEXT, { overallScore: 0, v1Result: undefined });
        await persist(controller, LONG_TEXT, undefined);

        expect(appendQualityHistory).not.toHaveBeenCalled();
        expect((controller as unknown as { lastLiveQualityPersist: unknown }).lastLiveQualityPersist).toBeNull();
    });

    it('有本次 WQE 结果时按该结果落盘', async () => {
        const controller = makeController();

        await persist(controller, LONG_TEXT, { overallScore: 82, v1Result: v1Result(82) });

        expect(appendQualityHistory).toHaveBeenCalledTimes(1);
        const [, project, record] = appendQualityHistory.mock.calls[0];
        expect(project).toBe('测试书');
        expect(record).toMatchObject({
            chapterKey: '第1章',
            overallScore: 82,
            wordCount: 420,
            languageScore: 80,
            structureScore: 85,
        });
    });

    it('同章 10 分钟窗口内的第二次成功评估不再重复落盘', async () => {
        const controller = makeController();

        await persist(controller, LONG_TEXT, { overallScore: 82, v1Result: v1Result(82) });
        await persist(controller, LONG_TEXT, { overallScore: 83, v1Result: v1Result(83) });

        expect(appendQualityHistory).toHaveBeenCalledTimes(1);
    });

    it('低于落盘门槛的短文本即使有 WQE 结果也不写入', async () => {
        const controller = makeController();
        const shortText = '短'.repeat(QUALITY_LIVE_PERSIST_MIN_CHARS - 1);

        await persist(controller, shortText, { overallScore: 82, v1Result: v1Result(82) });

        expect(appendQualityHistory).not.toHaveBeenCalled();
    });
});
