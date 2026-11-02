/**
 * humanness-scorer.ts — 改写打分的宿主封装
 *
 * 把「AI 味（AntiAIDetector）+ 人味相似度（human-similarity，需本地真人基线）
 * + 保真」组合成迭代精修能用的 `score()`。基线来自 `npm run sample:human`
 * 落在插件 data 目录的 `human-samples/baseline.json`；没有基线时返回 null，
 * 调用方退化为「不评分、只跑单次」的旧行为（绝不因此报错）。
 */
import type { App } from 'obsidian';
import { AntiAIDetector } from '../../engine/anti-ai-detector';
import { analyzeDistribution, scoreHumanity, type DistributionHistogram } from '../../shared/human-similarity';
import type { RefineRoundScore } from '../../shared/iterative-refine';
import { createLogger } from '../../shared/logger';

const log = createLogger('HumannessScorer');

const BASELINE_PATH = '.obsidian/plugins/novel-writer-ai/data/human-samples/baseline.json';

interface BaselineFile {
    distribution?: DistributionHistogram;
}

/**
 * HumannessScorer 类型定义。
 */
export interface HumannessScorer {
    /**
     * 对话占比（引号内字符 / 全文；判断是否要补一轮对话改写）
     *
     * @param text - 文本内容
     * @returns 数值结果
     */
    dialogueRatio(text: string): number;
    /**
     * 打分；始终返回（无基线时 humanSim 记 0，composite 只由 AI 味与保真构成）
     *
     * @param candidate - 候选
     * @param original - 原始
      * @returns RefineRoundScore 实例
     */
    score(candidate: string, original: string): RefineRoundScore;
    /**
     * 是否有真人基线（决定 composite 是否包含 humanSim 权重）
     *
     * @returns 是否成功
     */
    hasBaseline(): boolean;
}

let cachedBaseline: DistributionHistogram | null = null;
let baselineLoaded = false;

async function loadBaseline(app: App): Promise<DistributionHistogram | null> {
    if (baselineLoaded) return cachedBaseline;
    baselineLoaded = true;
    try {
        const adapter = app.vault.adapter;
        if (!(await adapter.exists(BASELINE_PATH))) return null;
        const raw = await adapter.read(BASELINE_PATH);
        const parsed = JSON.parse(raw) as BaselineFile;
        const dist = parsed.distribution;
        if (dist && Array.isArray(dist.sentence) && Array.isArray(dist.paragraph) && dist.punctuation) {
            cachedBaseline = dist;
            log.info('[HumannessScorer] 已加载本地真人分布基线');
        }
    } catch (e) {
        log.warn('[HumannessScorer] 读取基线失败（退化为不含 humanSim 的评分）:', e);
    }
    return cachedBaseline;
}

/**
 * 测试用：直接注入基线
 *
 * @param distribution - 分布
 */
export function setHumannessBaseline(distribution: DistributionHistogram | null): void {
    cachedBaseline = distribution;
    baselineLoaded = true;
}

/**
 * 创建打分器。
 * 无基线时 composite = 0.55×(100−antiAI)/100 + 0.45×fidelity，
 * 有基线时为 0.40/0.45/0.15（见 human-similarity.scoreHumanity）。
 * @param app - Obsidian 应用实例
  * @returns HumannessScorer 实例
 */
export async function createHumannessScorer(app: App): Promise<HumannessScorer> {
    const baseline = await loadBaseline(app);
    const detector = new AntiAIDetector();
    return {
        dialogueRatio: (text) => analyzeDistribution(text).dialogueRatio,
        hasBaseline: () => Boolean(baseline),
        score: (candidate, original) => {
            const antiAI = detector.detect(candidate).score;
            if (baseline) {
                const result = scoreHumanity({ original, candidate, antiAI, baseline });
                return {
                    antiAI: result.antiAI,
                    humanSim: result.humanSim,
                    fidelityOk: result.fidelity.ok,
                    composite: result.composite,
                };
            }
            const fidelity = scoreHumanity({
                original, candidate, antiAI,
                baseline: {
                    sentence: [], paragraph: [], punctuation: {
                        period: 0, comma: 0, semicolon: 0, ellipsis: 0, dash: 0, exclamation: 0, question: 0,
                    },
                    dialogueRatio: 0,
                },
            }).fidelity;
            return {
                antiAI,
                humanSim: 0,
                fidelityOk: fidelity.ok,
                composite: fidelity.ok ? 0.55 * ((100 - antiAI) / 100) + 0.45 * fidelity.score : 0,
            };
        },
    };
}
