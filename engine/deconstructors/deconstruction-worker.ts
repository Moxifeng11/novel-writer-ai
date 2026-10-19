/**
 * deconstruction-worker.ts — 拆解 Worker 入口脚本
 *
 * 功能：在 Web Worker 中运行所有 6 个拆解器的 analyze 和 analyzeWithVector 方法
 * 使用 worker-runtime.ts 中的注册机制注册 12 个任务处理器
 *
 * 注意：由于 esbuild 单文件打包，此文件通过内联方式加载到 Worker 中
 */

import { registerTaskHandler, startWorkerRuntime } from '../../services/worker-runtime';
import { StyleDeconstructor, StyleAnalysisResult } from './style-deconstructor';
import { RhythmDeconstructor, RhythmAnalysisResult } from './rhythm-deconstructor';
import { TechniqueDeconstructor, TechniqueAnalysisResult } from './technique-deconstructor';
import { StructureDeconstructor, StructureAnalysisResult } from './structure-deconstructor';
import { CharacterDeconstructor, CharacterAnalysisResult } from './character-deconstructor';
import { ForeshadowDeconstructor, ForeshadowAnalysisResult } from './foreshadow-deconstructor';
import { CommercialDeconstructor, CommercialAnalysisResult } from './commercial-deconstructor';
import { ReadabilityDeconstructor, ReadabilityAnalysisResult } from './readability-deconstructor';
import { VectorEnhancer } from '../vector-enhancer';
import { AntiAIDetector } from '../anti-ai-detector';

let styleDeconstructor: StyleDeconstructor | null = null;
let rhythmDeconstructor: RhythmDeconstructor | null = null;
let techniqueDeconstructor: TechniqueDeconstructor | null = null;
let structureDeconstructor: StructureDeconstructor | null = null;
let characterDeconstructor: CharacterDeconstructor | null = null;
let foreshadowDeconstructor: ForeshadowDeconstructor | null = null;
let commercialDeconstructor: CommercialDeconstructor | null = null;
let readabilityDeconstructor: ReadabilityDeconstructor | null = null;
let vectorEnhancer: VectorEnhancer | null = null;

interface DeconstructInput {
    text: string;
    vectorEnhancerConfig?: any;
    /** R2: 主线程下发的用户扩充 AI 味词表（Worker 独立模块实例，需显式同步） */
    antiAiWords?: string[];
}

/** 最近一次已应用的扩充词表指纹（避免每个任务重复重建拆解器） */
let appliedAiWordsKey = '';

function ensureDeconstructors(extraAiWords?: string[]): void {
    // R2: 扩充词变化时先同步词表并重建可读性拆解器（其连接词密度依赖词表）
    const key = (extraAiWords || []).join('|');
    if (key !== appliedAiWordsKey) {
        appliedAiWordsKey = key;
        AntiAIDetector.setExtraHighFreqWords(extraAiWords || []);
        readabilityDeconstructor = null;
    }
    if (!styleDeconstructor) {
        styleDeconstructor = new StyleDeconstructor(vectorEnhancer || undefined);
    }
    if (!rhythmDeconstructor) {
        rhythmDeconstructor = new RhythmDeconstructor(vectorEnhancer || undefined);
    }
    if (!techniqueDeconstructor) {
        techniqueDeconstructor = new TechniqueDeconstructor(vectorEnhancer || undefined);
    }
    if (!structureDeconstructor) {
        structureDeconstructor = new StructureDeconstructor(vectorEnhancer || undefined);
    }
    if (!characterDeconstructor) {
        characterDeconstructor = new CharacterDeconstructor(vectorEnhancer || undefined);
    }
    if (!foreshadowDeconstructor) {
        foreshadowDeconstructor = new ForeshadowDeconstructor(vectorEnhancer || undefined);
    }
    if (!commercialDeconstructor) {
        commercialDeconstructor = new CommercialDeconstructor(vectorEnhancer || undefined);
    }
    if (!readabilityDeconstructor) {
        readabilityDeconstructor = new ReadabilityDeconstructor(vectorEnhancer || undefined);
    }
}

registerTaskHandler('deconstruct:style', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始风格分析');
    ensureDeconstructors(input.antiAiWords);
    const result = await styleDeconstructor!.analyze(input.text);
    context.onProgress(100, '风格分析完成');
    return result as StyleAnalysisResult;
});

registerTaskHandler('deconstruct:style:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始风格分析（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await styleDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '风格分析完成（向量增强）');
    return result as StyleAnalysisResult;
});

registerTaskHandler('deconstruct:rhythm', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始节奏分析');
    ensureDeconstructors(input.antiAiWords);
    const result = await rhythmDeconstructor!.analyze(input.text);
    context.onProgress(100, '节奏分析完成');
    return result as RhythmAnalysisResult;
});

registerTaskHandler('deconstruct:rhythm:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始节奏分析（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await rhythmDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '节奏分析完成（向量增强）');
    return result as RhythmAnalysisResult;
});

registerTaskHandler('deconstruct:technique', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始写作技巧分析');
    ensureDeconstructors(input.antiAiWords);
    const result = await techniqueDeconstructor!.analyze(input.text);
    context.onProgress(100, '写作技巧分析完成');
    return result as TechniqueAnalysisResult;
});

registerTaskHandler('deconstruct:technique:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始写作技巧分析（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await techniqueDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '写作技巧分析完成（向量增强）');
    return result as TechniqueAnalysisResult;
});

registerTaskHandler('deconstruct:structure', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始结构拆解');
    ensureDeconstructors(input.antiAiWords);
    const result = await structureDeconstructor!.analyze(input.text);
    context.onProgress(100, '结构拆解完成');
    return result as StructureAnalysisResult;
});

registerTaskHandler('deconstruct:structure:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始结构拆解（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await structureDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '结构拆解完成（向量增强）');
    return result as StructureAnalysisResult;
});

registerTaskHandler('deconstruct:character', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始人设提取');
    ensureDeconstructors(input.antiAiWords);
    const result = await characterDeconstructor!.analyze(input.text);
    context.onProgress(100, '人设提取完成');
    return result as CharacterAnalysisResult;
});

registerTaskHandler('deconstruct:character:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始人设提取（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await characterDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '人设提取完成（向量增强）');
    return result as CharacterAnalysisResult;
});

registerTaskHandler('deconstruct:foreshadow', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始伏笔梳理');
    ensureDeconstructors(input.antiAiWords);
    const result = await foreshadowDeconstructor!.analyze(input.text);
    context.onProgress(100, '伏笔梳理完成');
    return result as ForeshadowAnalysisResult;
});

registerTaskHandler('deconstruct:foreshadow:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始伏笔梳理（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await foreshadowDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '伏笔梳理完成（向量增强）');
    return result as ForeshadowAnalysisResult;
});

registerTaskHandler('deconstruct:commercial', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始商业价值分析');
    ensureDeconstructors(input.antiAiWords);
    const result = await commercialDeconstructor!.analyze(input.text);
    context.onProgress(100, '商业价值分析完成');
    return result as CommercialAnalysisResult;
});

registerTaskHandler('deconstruct:commercial:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始商业价值分析（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await commercialDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '商业价值分析完成（向量增强）');
    return result as CommercialAnalysisResult;
});

registerTaskHandler('deconstruct:readability', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始可读性分析');
    ensureDeconstructors(input.antiAiWords);
    const result = await readabilityDeconstructor!.analyze(input.text);
    context.onProgress(100, '可读性分析完成');
    return result as ReadabilityAnalysisResult;
});

registerTaskHandler('deconstruct:readability:vector', async (input: DeconstructInput, context) => {
    context.onProgress(0, '开始可读性分析（向量增强）');
    ensureDeconstructors(input.antiAiWords);
    const result = await readabilityDeconstructor!.analyzeWithVector(input.text);
    context.onProgress(100, '可读性分析完成（向量增强）');
    return result as ReadabilityAnalysisResult;
});

startWorkerRuntime();
