import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';
import { RealtimeQualityController, type RealtimeQualityHost } from '../../../ui/cowrite/realtime-quality-controller';
import { WritingQualityEngine } from '../../../engine/writing-quality-engine';
import { PlotDivergenceEngine } from '../../../engine/plot-divergence-engine';
import { CharacterConsistencyChecker } from '../../../engine/character-consistency-checker';

function createMonitor(): {
    deviationDetector: { plotDivergenceEngine?: unknown; characterChecker?: unknown };
    scoreEngine: { v1Engine?: unknown };
} {
    return (CoWritingView.prototype as unknown as {
        createRealtimeQualityMonitor: () => {
            deviationDetector: { plotDivergenceEngine?: unknown; characterChecker?: unknown };
            scoreEngine: { v1Engine?: unknown };
        };
    }).createRealtimeQualityMonitor.call({});
}

function makeController(createMonitorFactory: () => unknown) {
    const host: RealtimeQualityHost = {
        app: {} as never,
        getText: () => '',
        getProject: () => '测试书',
        getVolume: () => '第1卷',
        getChapterNum: () => 1,
        getChapterName: () => '第1章',
        getBodyPath: () => '/测试书/第1卷/第1章.md',
        getChapterBrief: () => null,
        getChapPlan: () => undefined,
        loadCharacterInfos: async () => [],
        loadForeshadows: async () => [],
        createMonitor: () => createMonitorFactory() as never,
    };
    return new RealtimeQualityController(host);
}

describe('实时质量监控引擎接线', () => {
    it('创建监控时注入纯计算偏离引擎，与 worker 路径同口径', () => {
        const monitor = createMonitor();

        expect(monitor).toBeTruthy();
        expect(monitor.deviationDetector.plotDivergenceEngine).toBeInstanceOf(PlotDivergenceEngine);
        expect(monitor.deviationDetector.characterChecker).toBeInstanceOf(CharacterConsistencyChecker);
        // 质量分与协同顶栏共用同一个 WQE 内核，避免同一文本两套分
        expect(monitor.scoreEngine.v1Engine).toBeInstanceOf(WritingQualityEngine);
    });

    it('已有监控实例时再次开启不重建，保留缓存与历史', () => {
        const existing = {
            marker: 'existing',
            isEvaluating: () => false,
            evaluate: vi.fn(),
            cancel: vi.fn(),
            dispose: vi.fn(),
        };
        const factory = vi.fn(() => {
            throw new Error('不应重建 monitor');
        });
        const controller = makeController(factory);
        (controller as unknown as { monitor: typeof existing }).monitor = existing;

        expect(controller.toggle()).toBe(true);

        expect((controller as unknown as { monitor: typeof existing }).monitor).toBe(existing);
        expect(factory).not.toHaveBeenCalled();
    });
});
