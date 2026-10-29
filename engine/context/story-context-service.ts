/**
 * story-context-service.ts — 故事上下文总线的编排层
 *
 * 把 GatheredContext 变成一张图，再按一次请求装配成信息包；
 * 同时提供两个适配器：
 *   - applyStoryContextToVars：一键生成（模板变量）；
 *   - attachStoryContextToSnapshot：协同写作（PromptSnapshot）。
 */
import type { SceneCardFields } from '../../shared/scene-card';
import { createLogger } from '../../shared/logger';
import type { StoryLinkage } from '../story-linkage';
import type { GatheredContext } from './context-types';
import {
    assembleStoryContextBundle,
    buildStoryContextGraph,
    formatStoryContextLegacyVars,
} from './story-context-graph';
import type {
    StoryContextBundle,
    StoryContextGraph,
    StoryContextMode,
    StoryContextTier,
} from './story-context-types';

const log = createLogger('StoryContext');

export interface StoryContextTierSettings {
    storyContextTier?: 'auto' | 'local' | 'cloud';
    coWriteModelMode?: 'local' | 'cloud';
    defaultModel?: string;
    apiEndpoint?: string;
    customProviderName?: string;
}

const LOCAL_MODEL_HINTS = [
    'qwen', 'llama', 'mistral', 'gemma', 'phi-', 'deepseek-r1:', 'ollama',
    ':7b', ':8b', ':14b', ':32b', 'local',
];

/**
 * 解析上下文档位。
 * - 显式 storyContextTier 优先；
 * - 协同写作按 coWriteModelMode（本地 Ollama / 云端 API）；
 * - 一键生成按默认模型/端点推断，无法判断时按云端处理（云端预算更大，不会静默丢信息）。
 */
export function resolveStoryContextTier(
    settings: StoryContextTierSettings | null | undefined,
    mode: StoryContextMode,
): StoryContextTier {
    if (settings?.storyContextTier === 'local' || settings?.storyContextTier === 'cloud') {
        return settings.storyContextTier;
    }
    if (mode === 'co-write') {
        return settings?.coWriteModelMode === 'cloud' ? 'cloud' : 'local';
    }
    const endpoint = String(settings?.apiEndpoint || '').toLowerCase();
    if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.includes('ollama')) {
        return 'local';
    }
    const model = String(settings?.defaultModel || '').toLowerCase();
    if (LOCAL_MODEL_HINTS.some(hint => model.includes(hint))) return 'local';
    return 'cloud';
}

export interface BuildStoryContextOptions {
    context: GatheredContext;
    chapterName: string;
    chapterNum: number;
    volume?: string;
    mode: StoryContextMode;
    tier: StoryContextTier;
    maxInputTokens?: number;
    modelId?: string;
    scene?: SceneCardFields;
    precedingText?: string;
    queryText?: string;
    sceneExpansionText?: string;
    emotionPlanText?: string;
    storyLinkage?: StoryLinkage | null;
}

export interface StoryContextResult {
    graph: StoryContextGraph;
    bundle: StoryContextBundle;
}

export function buildStoryContext(options: BuildStoryContextOptions): StoryContextResult {
    const graph = buildStoryContextGraph({
        project: options.context.project,
        chapterName: options.chapterName,
        chapterNum: options.chapterNum,
        volume: options.volume,
        context: options.context,
        sceneExpansionText: options.sceneExpansionText,
        emotionPlanText: options.emotionPlanText,
        storyLinkage: options.storyLinkage ?? options.context.data.story_linkage ?? null,
        precedingText: options.precedingText,
    });
    const bundle = assembleStoryContextBundle(graph, {
        mode: options.mode,
        tier: options.tier,
        chapterNum: options.chapterNum,
        scene: options.scene,
        precedingText: options.precedingText,
        queryText: options.queryText,
        maxInputTokens: options.maxInputTokens,
        modelId: options.modelId,
    });
    return { graph, bundle };
}

/**
 * 一键生成适配：只覆盖既有模板变量，不改模板契约。
 * 结构化信息包本身放进 storyContextPack（关联摘要），避免与模板里的完整字段重复。
 */
export function applyStoryContextToVars(
    vars: Record<string, string>,
    bundle: StoryContextBundle,
    fallback?: Record<string, string>,
): void {
    const legacy = formatStoryContextLegacyVars(bundle);
    const keys = [
        'worldView', 'settingLib', 'allChars', 'allFactions', 'allLocs', 'allItems',
        'timelineEvents', 'unrevealedForeshadow', 'emotionPlan', 'sceneCardDigest',
    ];
    for (const key of keys) {
        const next = (legacy[key] || '').trim();
        const previous = (fallback?.[key] || vars[key] || '').trim();
        if (next) {
            vars[key] = legacy[key];
        } else if (!previous && fallback?.[key]) {
            vars[key] = fallback[key];
        }
    }
    vars['storyContextPack'] = bundle.formattedCrossLink;
    vars['_storyContextTelemetry'] = JSON.stringify(bundle.telemetry);
    vars['_storyContextTier'] = bundle.tier;
    vars['_storyContextTokens'] = String(bundle.telemetry.estimatedTokens);
}

/**
 * 协同写作适配：把选中的实体/设定/时间线/情绪写回 snapshot，
 * 并把完整信息包与压缩信息包挂到 snapshot 上供 PromptBuilder 使用。
 */
export function attachStoryContextToSnapshot(
    snapshot: Record<string, unknown>,
    result: StoryContextResult,
): void {
    const { bundle } = result;
    const legacy = formatStoryContextLegacyVars(bundle);
    const setIfPresent = (key: string, value: string) => {
        if (value.trim()) snapshot[key] = value;
    };
    setIfPresent('allChars', legacy.allChars);
    setIfPresent('allFactions', legacy.allFactions);
    setIfPresent('allLocs', legacy.allLocs);
    setIfPresent('allItems', legacy.allItems);
    setIfPresent('timeline', legacy.timelineEvents);
    setIfPresent('settingLib', legacy.settingLib);
    setIfPresent('emotionPlan', legacy.emotionPlan);
    snapshot.storyContextPack = bundle.formattedFull;
    snapshot.storyContextPackCompact = bundle.formattedCrossLink;
    snapshot.storyContextTelemetry = bundle.telemetry;
}

export function logStoryContextSummary(
    result: StoryContextResult,
    label: string,
): void {
    const { bundle, graph } = result;
    const t = bundle.telemetry;
    log.info(
        `[StoryContext] ${label} | tier=${t.tier} | tokens=${t.estimatedTokens}/${t.budgetTokens} | ` +
        `items=${t.included}/${graph.nodes.size} | required=${t.requiredIncluded}/${t.requiredTotal} | ` +
        `dropped=${t.dropped} | truncated=${t.truncated}`,
    );
    if (t.missingRequired.length > 0) {
        log.warn('[StoryContext] 必含项缺失:', t.missingRequired);
    }
    if (t.warnings.length > 0) {
        log.warn('[StoryContext] 警告:', t.warnings);
    }
    log.debug('[StoryContext] 分类统计:', t.byKind);
}
