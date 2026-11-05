import { registerTaskHandler, startWorkerRuntime } from '@/services/worker-runtime';
import { QualityScoreEngine, QualityScore, EvaluationContext } from './quality-score-engine';
import { getScopedPlotDivergenceEngine, getScopedWritingQualityEngine } from './quality-engine-factory';
import { DeviationDetector, DeviationReport, DeviationContext } from './deviation-detector';
import { CharacterConsistencyChecker } from '@/engine/character-consistency-checker';
import { createLogger } from '@/shared/logger';


const log = createLogger('QualityWorker');
let qualityScoreEngine: QualityScoreEngine | null = null;
let deviationDetector: DeviationDetector | null = null;

interface QualityEvaluateInput {
    text: string;
    context: EvaluationContext;
}

interface DeviationDetectInput {
    text: string;
    context: DeviationContext;
}

function ensureEngines(): void {
    if (!qualityScoreEngine) {
        // C1: QSE 只保留 V1 统一内核。六维与总分全部来自 WritingQualityEngine，
        // rhythmAnalyzer / emotionAnalyzer / characterChecker 在注入 v1Engine 后不生效，
        // 因此这里不再注入 characterChecker（人物逐条比对由 DeviationDetector 负责）。
        qualityScoreEngine = new QualityScoreEngine({
            v1Engine: getScopedWritingQualityEngine('quality-worker'),
        });
    }
    if (!deviationDetector) {
        // ── 注入纯计算分析器 ──
        // plotDivergenceEngine 与 characterChecker 在 Worker 内按 scope 构造（本线程独立实例）。
        // rhythmAnalyzer 依赖主线程 AI 能力，保持未注入。
        deviationDetector = new DeviationDetector({
            plotDivergenceEngine: getScopedPlotDivergenceEngine('quality-worker'),
            characterChecker: new CharacterConsistencyChecker(),
        });
        const dd = deviationDetector as any;
        const ddMissing = ['plotDivergenceEngine', 'characterChecker', 'rhythmAnalyzer'].filter((k) => !dd[k]);
        if (ddMissing.length > 0) {
            log.warn(
                `[偏离检测引擎] 条件分析器未注入: ${ddMissing.join(', ')}（依赖主线程 AI 能力），相关维度使用内置规则`
            );
            self.postMessage({
                type: 'worker:warning',
                payload: { code: 'INJECTION_PARTIAL', engine: 'DeviationDetector', missing: ddMissing, fallback: 'keyword_stats' },
            });
        }
    }
}

registerTaskHandler('quality:evaluate', async (input: QualityEvaluateInput, context) => {
    context.onProgress(0, '开始质量评分');
    ensureEngines();
    const result = await qualityScoreEngine!.evaluate(input.text, input.context);
    context.onProgress(100, '质量评分完成');
    return result as QualityScore;
});

registerTaskHandler('quality:evaluate:realtime', async (input: QualityEvaluateInput, context) => {
    context.onProgress(0, '开始实时质量评分');
    ensureEngines();
    const result = await qualityScoreEngine!.evaluate(input.text, input.context);
    context.onProgress(100, '实时质量评分完成');
    return result as QualityScore;
});

registerTaskHandler('deviation:detect', async (input: DeviationDetectInput, context) => {
    context.onProgress(0, '开始偏离检测');
    ensureEngines();
    const result = await deviationDetector!.detect(input.text, input.context);
    context.onProgress(100, '偏离检测完成');
    return result as DeviationReport;
});

registerTaskHandler('deviation:detect:realtime', async (input: DeviationDetectInput, context) => {
    context.onProgress(0, '开始实时偏离检测');
    ensureEngines();
    const result = await deviationDetector!.detect(input.text, input.context);
    context.onProgress(100, '实时偏离检测完成');
    return result as DeviationReport;
});

startWorkerRuntime();