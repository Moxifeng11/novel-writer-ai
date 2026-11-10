/**
 * ai-assisted-premise-service.ts - AI research + randomized creative brief.
 *
 * Combines three things:
 * 1) deterministic codified framework (creative-frameworks.ts)
 * 2) multi-layer true-random factors (creative-randomizer.ts)
 * 3) live/hot-topic research when a search provider is configured; otherwise
 *    an AI research draft explicitly marked as unverified.
 */
import type { AIEngine } from '@/engine/ai-engine';
import { creativeRandomizer, type RandomizedBrief } from './creative-randomizer';
import { frameworkPromptBlock } from './creative-frameworks';
import {
    TrendResearchService,
    normalizeTrendConfig,
    type TrendResearchConfig,
    type TrendResearchResult,
} from './trend-research-service';
import type { CreationMode } from '@/shared/creation-mode';
import { wrapUntrustedContent } from '@/shared/untrusted-content';

/**
 * AiPremiseInput 类型定义。
 */
export interface AiPremiseInput {
    mode: 'short' | 'script';
    project?: string;
    categoryOrGenre: string;
    audience?: string;
    researchConfig?: Partial<TrendResearchConfig>;
    signal?: AbortSignal;
}

/**
 * AiPremiseResult 类型定义。
 */
export interface AiPremiseResult {
    mode: 'short' | 'script';
    frameworkBlock: string;
    randomBrief: RandomizedBrief;
    trend: TrendResearchResult;
    premiseBlock: string;
    suggestions: {
        name: string;
        logline: string;
        coreConflict: string;
        emotionalPromise: string;
        hook: string;
        endingPayoff: string;
        characters: string;
        scenes: string;
    }[];
}

/**
 * AiAssistedPremiseService 类。
 */
export class AiAssistedPremiseService {
    constructor(
        private readonly ai: AIEngine,
        private readonly trendConfig?: Partial<TrendResearchConfig>,
    ) {}

    /**
     * 生成。
     * @param input - 输入
      * @returns AiPremiseResult 实例
     */
    async generate(input: AiPremiseInput): Promise<AiPremiseResult> {
        const frameworkBlock = frameworkPromptBlock(input.mode, input.project);
        const randomBrief = creativeRandomizer.brief(input.mode);

        const config = normalizeTrendConfig(this.trendConfig);
        const trendService = new TrendResearchService(config);
        let sources = await trendService.search(input.mode, input.categoryOrGenre, input.audience);
        let verified = sources.length > 0;
        const warnings: string[] = [];
        if (!verified) {
            warnings.push(config.provider === 'manual' || !config.apiKey
                ? '未配置搜索 API，热点内容改用 AI 调研草稿；需人工核实'
                : '联网检索失败，热点内容改用 AI 调研草稿；需人工核实');
        }

        const research = await this.research(modeToLabel(input.mode), input, randomBrief, sources);
        if (!verified) {
            sources = research.sources;
            verified = false;
        }

        const suggestions = research.suggestions;
        const premiseBlock = [
            frameworkBlock,
            randomBrief.promptBlock,
            '【前期调研素材】',
            research.summary,
            '',
            '【候选创作方向】',
            ...suggestions.map((item, index) => [
                `候选 ${index + 1}`,
                `- 名称：${item.name}`,
                `- 一句话故事/卖点：${item.logline}`,
                `- 核心冲突：${item.coreConflict}`,
                `- 情绪承诺/爽点：${item.emotionalPromise}`,
                `- 开篇/3 秒钩子：${item.hook}`,
                `- 结尾/兑现：${item.endingPayoff}`,
                `- 人物：${item.characters}`,
                `- 场景：${item.scenes}`,
            ].join('\n')),
        ].join('\n\n');

        return {
            mode: input.mode,
            frameworkBlock,
            randomBrief,
            trend: {
                provider: verified ? config.provider : 'manual',
                sources,
                summary: research.summary,
                verified,
                warnings,
                researchedAt: Date.now(),
            },
            premiseBlock,
            suggestions,
        };
    }

    private async research(
        modeLabel: string,
        input: AiPremiseInput,
        randomBrief: RandomizedBrief,
        sources: Array<{ title: string; url: string; snippet: string }>,
    ): Promise<{
        summary: string;
        sources: Array<{ title: string; url: string; snippet: string }>;
        suggestions: AiPremiseResult['suggestions'];
    }> {
        // S3-2（安全 r3）：联网检索片段属外部内容，围栏后再进 prompt
        const sourceBlock = sources.length > 0
            ? wrapUntrustedContent(sources.map((source, index) => `[T${index + 1}] ${source.title || '无标题'}\n${source.snippet.slice(0, 220)}`).join('\n'), '网络检索结果')
            : '（无联网来源；以下为模型调研草稿，必须标注“未经实时核实”）';

        const systemPrompt = `你是${modeLabel}领域的资深编辑与市场分析师。
任务：
1. 基于提供的素材与模型知识，梳理当前主流热点、题材趋势、常见结构与行业规范。
2. 固化可执行创作框架：阶段、输入、输出、交付标准、校验节点。
3. 结合多层随机因子，输出 3 个差异化候选创作方向。
4. 明确区分“实时来源依据”与“模型推断”；模型推断要标注“未经实时核实”。

输出严格 JSON，不解释。`;

        const userPrompt = `【创作类型】${modeLabel}
【分类/类型】${input.categoryOrGenre || '未选择'}
【目标读者】${input.audience || '未指定'}
【随机种子】${randomBrief.seed}
【随机因子】
${randomBrief.promptBlock}
【实时/参考素材】
${sourceBlock}

输出 JSON：
{
  "summary": "热点与行业分析（200-400字；若没有实时来源，开头写“未经实时核实：”）",
  "sources": [{"title":"来源标题","url":"来源URL或空","snippet":"来源摘要"}],
  "suggestions": [
    {
      "name": "项目名（2-10 个汉字，不含标点）",
      "logline": "一句话故事/卖点（40-80 字）",
      "coreConflict": "核心冲突",
      "emotionalPromise": "情绪承诺或爽点",
      "hook": "开篇 3 段钩子或 3 秒钩子",
      "endingPayoff": "结尾兑现/卡点",
      "characters": "2-4 个核心人物与关系",
      "scenes": "1-3 个主要场景"
    }
  ]
}
要求：3 个候选必须使用不同主角身份、不同冲突类型、不同情绪曲线；不得给出同类模板变体。`;

        const response = await this.ai.callAI(
            systemPrompt,
            userPrompt,
            undefined,
            0.95,
            4096,
            { bypassCache: true, signal: input.signal },
        );
        if (response.error || !response.content.trim()) {
            throw new Error(response.error || 'AI 调研返回为空');
        }

        const jsonText = response.content.replace(/```json|```/g, '');
        const match = jsonText.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('AI 调研返回格式异常');
        const parsed = JSON.parse(match[0]) as {
            summary?: string;
            sources?: Array<{ title?: string; url?: string; snippet?: string }>;
            suggestions?: Array<Partial<AiPremiseResult['suggestions'][number]>>;
        };

        const suggestions = (parsed.suggestions || []).slice(0, 3).map(item => ({
            name: String(item.name || '').trim(),
            logline: String(item.logline || '').trim(),
            coreConflict: String(item.coreConflict || '').trim(),
            emotionalPromise: String(item.emotionalPromise || '').trim(),
            hook: String(item.hook || '').trim(),
            endingPayoff: String(item.endingPayoff || '').trim(),
            characters: String(item.characters || '').trim(),
            scenes: String(item.scenes || '').trim(),
        }));

        return {
            summary: String(parsed.summary || '').trim() || '（AI 未返回分析摘要）',
            sources: (parsed.sources || []).slice(0, 6).map(item => ({
                title: String(item.title || ''),
                url: String(item.url || ''),
                snippet: String(item.snippet || ''),
            })),
            suggestions,
        };
    }
}

function modeToLabel(mode: 'short' | 'script'): string {
    return mode === 'short' ? '番茄短篇小说' : '红果短剧剧本';
}
