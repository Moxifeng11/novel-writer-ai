/**
 * iterative-refine.ts — 迭代精修的调度与验收（纯函数 / 可单测）
 *
 * 旧实现的两个问题（实测取证）：
 * 1. UI 只调用一次 `refine`，`settings.refineRounds=3` 是死配置；
 * 2. 旧的三轮循环用 `content.includes('❌')` 判「有没有变好」，没有分数、没有对比、
 *    更没有回滚——改坏了也不会退回。
 *
 * 这里把「谁更好」变成可计算的事：每轮用 `score` 打分（AI 味 / 人味相似度 / 保真），
 * 只接受严格更高分的候选；保真不通过直接拒收；连续两轮无提升提前停（省调用）。
 */

export interface RefineRoundScore {
    /** AI 味 0–100（越低越好） */
    antiAI: number;
    /** 人味相似度 0–1（越高越好） */
    humanSim: number;
    /** 保真是否通过（长度/内容重合/数字） */
    fidelityOk: boolean;
    /** 综合分 0–1 */
    composite: number;
}

/**
 * RefineRoundRecord 类型定义。
 */
export interface RefineRoundRecord extends RefineRoundScore {
    round: number;
    accepted: boolean;
    /** 被拒绝的原因（保真不过 / 分数未提升） */
    rejectedReason?: string;
    chars: number;
    networkCalls: number;
}

/**
 * IterativeRefineOptions 类型定义。
 */
export interface IterativeRefineOptions {
    /** 原始正文（评分与保真的参照） */
    original: string;
    /** 最大轮数（0 = 直接返回原文） */
    rounds: number;
    /** 单轮改写：返回改写后的完整正文 */
    refine: (current: string) => Promise<{ content: string; networkCalls: number }>;
    /** 打分：由宿主注入（AntiAIDetector + human-similarity） */
    score: (candidate: string, original: string) => RefineRoundScore;
    /** 单轮回调（UI 展示逐轮结果） */
    onRound?: (record: RefineRoundRecord) => void;
    /** 连续多少轮无提升就提前停（默认 2） */
    patience?: number;
    signal?: AbortSignal;
}

/**
 * IterativeRefineResult 类型定义。
 */
export interface IterativeRefineResult {
    /** 最好的一版（可能是原文） */
    best: string;
    rounds: RefineRoundRecord[];
    /** 是否接受过至少一轮 */
    improved: boolean;
    stoppedReason: 'no-rounds' | 'max-rounds' | 'no-improvement' | 'aborted' | 'refine-failed';
    totalNetworkCalls: number;
}

/** 分数提升阈值：低于这个幅度视为「没变好」（避免噪声轮次） */
const MIN_GAIN = 0.005;

/**
 * runIterativeRefine 函数。
 * @param options - 配置项
  * @returns IterativeRefineResult 实例
 */
export async function runIterativeRefine(options: IterativeRefineOptions): Promise<IterativeRefineResult> {
    const rounds = Math.max(0, Math.min(5, Math.round(options.rounds)));
    const patience = Math.max(1, options.patience ?? 2);
    const records: RefineRoundRecord[] = [];
    let best = options.original;
    let bestScore = options.score(options.original, options.original);
    let totalNetworkCalls = 0;

    if (rounds === 0) {
        return { best, rounds: records, improved: false, stoppedReason: 'no-rounds', totalNetworkCalls };
    }

    let noImprovement = 0;
    let improved = false;

    for (let round = 1; round <= rounds; round++) {
        if (options.signal?.aborted) {
            return { best, rounds: records, improved, stoppedReason: 'aborted', totalNetworkCalls };
        }
        let candidate: { content: string; networkCalls: number };
        try {
            candidate = await options.refine(best);
        } catch {
            return { best, rounds: records, improved, stoppedReason: 'refine-failed', totalNetworkCalls };
        }
        totalNetworkCalls += candidate.networkCalls || 1;
        const content = String(candidate.content || '').trim();
        if (!content) {
            records.push({
                round, accepted: false, rejectedReason: '模型返回空内容',
                chars: 0, networkCalls: candidate.networkCalls || 1,
                antiAI: bestScore.antiAI, humanSim: bestScore.humanSim,
                fidelityOk: bestScore.fidelityOk, composite: bestScore.composite,
            });
            noImprovement += 1;
            if (noImprovement >= patience) {
                return { best, rounds: records, improved, stoppedReason: 'no-improvement', totalNetworkCalls };
            }
            continue;
        }

        const score = options.score(content, options.original);
        const accepted = score.fidelityOk && score.composite > bestScore.composite + MIN_GAIN;
        const record: RefineRoundRecord = {
            round,
            accepted,
            rejectedReason: accepted
                ? undefined
                : !score.fidelityOk
                    ? '保真校验未通过（字数/内容重合/数字）'
                    : '综合分未提升',
            chars: content.replace(/\s+/g, '').length,
            networkCalls: candidate.networkCalls || 1,
            antiAI: score.antiAI,
            humanSim: score.humanSim,
            fidelityOk: score.fidelityOk,
            composite: score.composite,
        };
        records.push(record);
        options.onRound?.(record);

        if (accepted) {
            best = content;
            bestScore = score;
            improved = true;
            noImprovement = 0;
        } else {
            noImprovement += 1;
            if (noImprovement >= patience) {
                return { best, rounds: records, improved, stoppedReason: 'no-improvement', totalNetworkCalls };
            }
        }
    }

    return { best, rounds: records, improved, stoppedReason: 'max-rounds', totalNetworkCalls };
}

/**
 * 一行摘要（执行登记表 / 日志用）
 *
 * @param records - 记录列表
 * @returns 文本结果
 */
export function formatRefineRounds(records: RefineRoundRecord[]): string {
    if (records.length === 0) return '无轮次';
    return records
        .map((record) => `R${record.round}: ${(record.composite * 100).toFixed(1)}${record.accepted ? '（接受）' : `（${record.rejectedReason}）`}`)
        .join(' · ');
}
