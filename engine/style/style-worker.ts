import { registerTaskHandler, startWorkerRuntime } from '../../services/worker-runtime';
import { StyleDeconstructor, StyleAnalysisResult } from '../deconstructors/style-deconstructor';
import { StyleDeconstructorV2, StyleAnalysisResultV2 } from './style-deconstructor-v2';
import { VectorEnhancer } from '../vector-enhancer';

let styleDeconstructor: StyleDeconstructor | null = null;
let styleDeconstructorV2: StyleDeconstructorV2 | null = null;
let vectorEnhancer: VectorEnhancer | null = null;

interface StyleAnalyzeInput {
    text: string;
}

function ensureDeconstructors(): void {
    if (!styleDeconstructor) {
        styleDeconstructor = new StyleDeconstructor(vectorEnhancer || undefined);
    }
    if (!styleDeconstructorV2) {
        styleDeconstructorV2 = new StyleDeconstructorV2(vectorEnhancer || undefined);
    }
}

registerTaskHandler('style:analyze', async (input: StyleAnalyzeInput, context) => {
    context.onProgress(0, '开始风格分析');
    ensureDeconstructors();
    const result = styleDeconstructor!.analyze(input.text);
    context.onProgress(100, '风格分析完成');
    return result as unknown as StyleAnalysisResult;
});

registerTaskHandler('style:analyze:vector', async (input: StyleAnalyzeInput, context) => {
    context.onProgress(0, '开始风格分析（向量增强）');
    ensureDeconstructors();
    const result = await styleDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '风格分析完成（向量增强）');
    return result as StyleAnalysisResult;
});

registerTaskHandler('style:analyze:v2', async (input: StyleAnalyzeInput, context) => {
    context.onProgress(0, '开始风格分析 V2');
    ensureDeconstructors();
    const result = styleDeconstructorV2!.analyze(input.text);
    context.onProgress(100, '风格分析 V2 完成');
    return result as unknown as StyleAnalysisResultV2;
});

startWorkerRuntime();