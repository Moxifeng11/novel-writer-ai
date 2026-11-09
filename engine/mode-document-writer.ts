/**
 * mode-document-writer.ts — 短篇/剧本前置文档的 AI 生成
 *
 * 覆盖故事核、分节大纲（短篇）、场景圣经、分集大纲、分镜表（剧本）。
 * 只生成文本并返回，不写盘；保存仍由 ModeDocumentModal 的显式保存按钮完成。
 */
import type { App } from 'obsidian';
import type { CreationMode } from '@/shared/creation-mode';
import { modeUnitLabel } from '@/shared/mode-content';
import { loadModeRuntimeContext, type ModeRuntimeContext } from './mode-runtime';
import { collectModeInjection, type ModeInjectionDeps, type ModeInjectionResult } from './mode-injection';
import { estimateTokens, getModelContextWindow } from '@/shared/token-estimator';
import { recoverOverflow, type ContextCompressionMode } from './context/overflow-recovery';

/** 可生成的模式文档。 */
export type ModeDocumentKind = 'storyCore' | 'outline' | 'bible' | 'storyboard';

/** 生成选项。 */
export interface ModeDocumentGenerateOptions {
    model: string;
    maxTokens: number;
    /** 用户补充要求（例如“更偏悬疑”“每集 2 分钟”） */
    instruction?: string;
    /** 编辑区现有内容（重写时作为参考） */
    existingText?: string;
    /** 知识库/指纹注入依赖；传入时生成前先做 RAG 检索与指纹挑选，失败自动降级为空 */
    injectionDeps?: ModeInjectionDeps;
    signal?: AbortSignal;
    onDelta?: (chunk: string) => void;
    /** 上下文溢出策略；默认 extractive */
    compressionMode?: ContextCompressionMode;
}

/** 文档生成所需的 AI 端口。 */
export interface ModeDocumentAI {
    callAI(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature?: number,
        maxTokens?: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal },
    ): Promise<{ content: string; error?: string }>;
}

const DOC_LABEL: Record<CreationMode, Record<ModeDocumentKind, string>> = {
    long: { storyCore: '故事核', outline: '大纲', bible: '场景圣经', storyboard: '分镜表' },
    short: { storyCore: '故事核', outline: '分节大纲', bible: '场景圣经', storyboard: '分镜表' },
    script: { storyCore: '人物小传', outline: '分集大纲', bible: '场景圣经', storyboard: '分镜表' },
};

const KIND_RULES: Record<ModeDocumentKind, string> = {
    storyCore: [
        '输出故事核：一句话前提、核心冲突、主角欲望与阻力、情绪曲线、关键反转、结尾兑现。',
        '用 Markdown 小标题组织，不要写正文场景，不要写章节。',
    ].join('\n'),
    outline: [
        '输出可执行的分单元大纲；每个单元一行，格式：第N节/集：场景 + 冲突 + 结尾钩子。',
        '短篇按节推进，剧本按集推进；不要写正文，不要写泛泛的主题分析。',
    ].join('\n'),
    bible: [
        '输出场景圣经：主要人物（欲望/阻力/关系）、核心场景（空间/光线/声音）、视觉与表演规则、反复出现的意象。',
        '只写拍摄/写作可直接使用的设定，不要写剧情梗概。',
    ].join('\n'),
    storyboard: [
        '输出分镜表：按集/场拆分，每场写「场次标题（日/夜 内/外 地点）→ 画面 → 动作 → 台词/音效 → 时长」。',
        '画面必须可拍；不要写小说化心理描写。',
    ].join('\n'),
};

/**
 * 构造文档生成提示词。
 *
 * @param mode - 创作模式
 * @param kind - 文档类型
 * @param runtime - 模式上下文
 * @param options - 生成选项
 * @param injection - 可选的知识库/指纹注入文本；knowledge 已自带「参考知识」表头，直接原文追加
 * @returns system/user 提示词
 */
export function buildModeDocumentPrompt(
    mode: CreationMode,
    kind: ModeDocumentKind,
    runtime: ModeRuntimeContext,
    options: ModeDocumentGenerateOptions = { model: '', maxTokens: 0 },
    injection?: ModeInjectionResult,
): { system: string; user: string } {
    const label = DOC_LABEL[mode][kind];
    const unit = modeUnitLabel(mode);
    const system = [
        `你是${mode === 'script' ? '短剧剧本' : '短篇小说'}策划编辑，正在为《${runtime.project}》编写${label}。`,
        runtime.modeGuide,
        KIND_RULES[kind],
        mode === 'short' && kind === 'outline'
            ? '前 3 节按「开篇三屏」设计：第 1 屏立人物/困境，第 2 屏升级冲突，第 3 屏抛出主悬念。'
            : '',
        '只输出 Markdown 文档内容，不要解释，不要加代码块围栏，不要复述提示词。',
        options.instruction ? `本次额外要求：${options.instruction}` : '',
    ].filter(Boolean).join('\n');

    const targetUnits = runtime.meta.mode === mode ? runtime.meta.targetUnits : 0;
    const context = [
        runtime.preResearchDigest ? `【前期调研】\n${runtime.preResearchDigest}` : '',
        runtime.outlineDoc && kind !== 'outline' ? `【现有大纲】\n${runtime.outlineDoc.slice(0, 3000)}` : '',
        runtime.storyDoc && kind !== 'storyCore' ? `【${mode === 'script' ? '场景圣经' : '故事核'}】\n${runtime.storyDoc}` : '',
        runtime.storyboardDoc && kind !== 'storyboard' ? `【现有分镜】\n${runtime.storyboardDoc}` : '',
        runtime.entities ? `【实体状态】\n${runtime.entities}` : '',
        runtime.styleGuide ? `【文笔风格】\n${runtime.styleGuide}` : '',
        injection?.fingerprints ? `【文笔指纹】\n${injection.fingerprints}` : '',
        // knowledge 已由 formatRetrievalHits 带「参考知识」表头，这里直接追加原文，不再包一层
        injection?.knowledge || '',
        options.existingText && options.existingText.trim()
            ? `【编辑区现有内容（可重写/扩写）】\n${options.existingText.slice(0, 4000)}`
            : '',
    ].filter(Boolean).join('\n\n');

    const goal = kind === 'outline' && targetUnits > 0
        ? `【目标】生成约 ${targetUnits} 个${unit}的可执行大纲。`
        : `【目标】生成完整的${label}初稿。`;

    return { system, user: [context, goal].filter(Boolean).join('\n\n') };
}

/**
 * 生成模式文档。
 *
 * @param app - Obsidian 应用实例
 * @param ai - AI 端口
 * @param project - 项目 ID
 * @param mode - 创作模式
 * @param kind - 文档类型
 * @param options - 模型与生成选项；injectionDeps 传入时启用知识库/指纹注入
 * @returns 生成的 Markdown 文本
 */
export async function generateModeDocument(
    app: App,
    ai: ModeDocumentAI,
    project: string,
    mode: CreationMode,
    kind: ModeDocumentKind,
    options: ModeDocumentGenerateOptions,
): Promise<string> {
    const runtime = await loadModeRuntimeContext(app, project, mode);
    // 注入查询：优先用编辑区现有内容，其次前期调研，最后大纲；失败由 collectModeInjection 内部降级为空串
    let injection: ModeInjectionResult | undefined;
    if (options.injectionDeps) {
        const query = (options.existingText || runtime.preResearchDigest || runtime.outlineDoc || '').slice(0, 1200);
        injection = await collectModeInjection({ ...options.injectionDeps, project }, query);
    }
    const { system, user } = buildModeDocumentPrompt(mode, kind, runtime, options, injection);
    const contextWindow = getModelContextWindow(options.model) || 128_000;
    const maxInput = Math.max(512, contextWindow - options.maxTokens - 500);
    let effectiveUser = user;
    if (estimateTokens(system, options.model) + estimateTokens(user, options.model) > maxInput) {
        const recovered = await recoverOverflow({
            system,
            user,
            maxInputTokens: maxInput,
            modelId: options.model,
            mode: options.compressionMode ?? 'extractive',
        });
        effectiveUser = recovered.user;
    }
    const result = await ai.callAI(
        system,
        effectiveUser,
        options.model,
        kind === 'storyCore' ? 0.75 : 0.7,
        options.maxTokens,
        { isWritingTask: true, signal: options.signal },
    );
    if (result.error) throw new Error(result.error);
    const text = String(result.content || '').trim();
    if (!text) throw new Error('模型返回为空，请重试或换一个模型');
    return text.replace(/^```(?:markdown)?\s*/i, '').replace(/```\s*$/, '').trim();
}
