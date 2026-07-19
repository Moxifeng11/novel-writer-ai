/**
 * index.ts — 题材自适应框架模块导出
 *
 * 对外暴露：GenreConfig / BehaviorTrait / GenreDetectionResult 类型，
 * GenreConfigRegistry 注册表，GenreDetector 识别器。
 */

export type { BehaviorTrait, GenreConfig, GenreDetectionResult, TensionKeywords, WaveRhythmKeywords } from './types';
export { GenreConfigRegistry } from './genre-config-registry';
export type { CustomConfigLoader } from './genre-config-registry';
export { GenreDetector } from './genre-detector';
