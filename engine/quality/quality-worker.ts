import { registerTaskHandler, startWorkerRuntime } from '../../services/worker-runtime';
import { QualityScoreEngine, QualityScore, EvaluationContext } from './quality-score-engine';
import { DeviationDetector, DeviationReport, DeviationContext } from './deviation-detector';
import { CharacterConsistencyChecker } from '../character-consistency-checker';
import { PlotDivergenceEngine } from '../plot-divergence-engine';
import { createLogger } from '../../shared/logger';


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
        // ── 注入纯计算分析器 ──
        // characterChecker（CharacterConsistencyChecker）是纯计算，可在 Worker 内构造。
        // rhythmAnalyzer / emotionAnalyzer 依赖 Obsidian App + AIEngine，无法在 Worker 内运行，
        // 保持未注入并由主线程路径处理，此处上报剩余降级维度。
        qualityScoreEngine = new QualityScoreEngine({
            characterChecker: new CharacterConsistencyChecker(),
        });
        const qe = qualityScoreEngine as any;
        const qeMissing = ['rhythmAnalyzer', 'emotionAnalyzer', 'characterChecker'].filter((k) => !qe[k]);
        if (qeMissing.length > 0) {
            log.warn(
                `[质量引擎] 条件分析器未注入: ${qeMissing.join(', ')}（依赖主线程 AI 能力），相关维度使用内置规则`
            );
            self.postMessage({
                type: 'worker:warning',
                payload: { code: 'INJECTION_PARTIAL', engine: 'QualityScoreEngine', missing: qeMissing, fallback: 'keyword_stats' },
            });
        }
    }
    if (!deviationDetector) {
        // ── 注入纯计算分析器 ──
        // plotDivergenceEngine 与 characterChecker 均为纯计算，可在 Worker 内构造。
        // rhythmAnalyzer 依赖主线程 AI 能力，保持未注入。
        deviationDetector = new DeviationDetector({
            plotDivergenceEngine: new PlotDivergenceEngine(),
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