import { requestJson } from '@/shared/http-transport';

/**
 * zhuque-detector.ts — 朱雀 AIGC 检测（腾讯 EdgeOne Makers API）
 *
 * ## 为什么知识库要接朱雀
 *
 * 本仓现有 8 个拆解器全是**本地统计/规则**（句长、标点、词表）。
 * 实测证明这些指标与「人味」的相关性很弱（长句 r=0.150），
 * 用它们做「这文像不像 AI 写的」的判断，会得出误导性结论。
 *
 * 朱雀是腾讯的专用 AIGC 检测模型，判别力实测极强：
 * - 真人网文中段 7 部 → 全部 100% 人工（softmax 0.0002–0.0204）
 * - AI 模板文本 → 0% 人工（softmax 0.9999）
 * - 云笔 6153 全 10 章 → 全部 0%（softmax 0.9999）
 * - 云笔 5570 → 均值 42.3%，单章最高 100%（softmax 0.0895）
 *
 * 且**完全确定性**（同文本两次 softmax 差 0.0000），可做稳定判据。
 *
 * ## 额度约束
 *
 * Makers 每月 500,000 tokens 免费。约 1.67 token/字，即约 30 万字/月。
 * 拆解一本 15 万字的书会消耗约一半额度——**必须做缓存 + 采样**。
 *
 * ## 失败语义
 *
 * **不降级、不编造**：调用失败时返回 `available: false` + 原因，
 * 由调用方决定「跳过该维度」而不是「用统计代理指标冒充朱雀结论」。
 */


const ENDPOINT = 'https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify';

/** 朱雀判定档位 */
export type ZhuqueGrade = 'HUMAN' | 'LIKELY_HUMAN' | 'MIXED' | 'LIKELY_AI' | 'AI';

/** 朱雀检测结果 */
export interface ZhuqueResult {
    /** 是否成功拿到结果（false 时其余字段无意义） */
    available: boolean;
    /** 不可用原因 */
    reason?: string;
    /** 人工占比 0-100 */
    humanRate: number;
    /** AI 占比 0-100 */
    aiRate: number;
    /** 疑似 AI 占比 0-100 */
    suspectedRate: number;
    /** 整体置信度（越高越像 AI） */
    softmax: number;
    /** 档位 */
    grade: ZhuqueGrade;
    /** 本次消耗的 Makers token */
    billedTokens: number;
    /** 被检测文本字数 */
    textLength: number;
    /** 分段结果（多段时提供，用于定位 AI 味集中的段落） */
    segments?: Array<{ order: number; label: number; conf: number; text: string }>;
}

/** 不可用结果构造 */
function unavailable(reason: string, textLength = 0): ZhuqueResult {
    return {
        available: false,
        reason,
        humanRate: 0,
        aiRate: 0,
        suspectedRate: 0,
        softmax: 0,
        grade: 'MIXED',
        billedTokens: 0,
        textLength,
    };
}

/**
 * 把 labels_ratio 映射为档位。
 *
 * 阈值来源：4 组对照实测
 * - 真人 100% / softmax ≤0.02
 * - 云笔 5570 均值 42.3%
 * - 云笔 6153 / AI 模板 0% / softmax ≈0.9999
 *
 * @param humanRate - 人工占比 0-100
 * @param softmax - 置信度
 * @returns 档位
 * @example
 * gradeOf(100, 0.0005) // 'HUMAN'
 * gradeOf(0, 0.9999)   // 'AI'
 */
export function gradeOf(humanRate: number, softmax: number): ZhuqueGrade {
    if (humanRate >= 80) return 'HUMAN';
    if (humanRate >= 50) return 'LIKELY_HUMAN';
    if (humanRate >= 20) return 'MIXED';
    if (humanRate > 0) return 'LIKELY_AI';
    return softmax > 0.99 ? 'AI' : 'LIKELY_AI';
}

/** 检测器选项 */
export interface ZhuqueDetectorOptions {
    /** 是否启用（默认 false，需用户在设置里显式开启——会消耗额度） */
    enabled: boolean;
    /** API Key（来自 MAKERS_MODELS_KEY） */
    apiKey: string;
    /** 单次检测的最大字符数（超出则截断，省额度） */
    maxChars?: number;
    /** 超时毫秒（默认 30s） */
    timeoutMs?: number;
}

/**
 * 朱雀检测器。
 *
 * 设计原则：
 * - **失败不降级**：拿不到结果就说拿不到，不用统计指标冒充
 * - **内置缓存**：同文本哈希命中直接返回（朱雀确定性，缓存安全）
 * - **按需截断**：超长文本截断到 maxChars，避免单次消耗过多额度
 */
export class ZhuqueDetector {
    private readonly options: Required<Omit<ZhuqueDetectorOptions, 'apiKey'>> & { apiKey: string };
    /** 文本哈希 → 结果（朱雀确定性，可安全缓存） */
    private readonly cache = new Map<string, ZhuqueResult>();
    /** 累计消耗 token（本进程内） */
    private billedTotal = 0;

    constructor(options: ZhuqueDetectorOptions) {
        this.options = {
            enabled: options.enabled,
            apiKey: options.apiKey,
            maxChars: options.maxChars ?? 20_000,
            timeoutMs: options.timeoutMs ?? 30_000,
        };
    }

    /** 本进程累计消耗的 Makers token */
    get billedTokens(): number {
        return this.billedTotal;
    }

    /** 简易哈希（FNV-1a，够用于缓存键） */
    private hash(text: string): string {
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i += 1) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(36);
    }

    /**
     * 检测一段文本的 AI 味。
     *
     * @param text - 待检测文本
     * @returns 检测结果（失败时 available=false）
     * @example
     * const r = await detector.detect(chapterText);
     * if (r.available) log.info(`人工率 ${r.humanRate}%`);
     */
    async detect(text: string): Promise<ZhuqueResult> {
        if (!this.options.enabled) return unavailable('朱雀检测未启用（设置 → 拆解引擎 → 朱雀检测）', text.length);
        if (!this.options.apiKey) return unavailable('缺少 MAKERS_MODELS_KEY', text.length);
        const trimmed = text.trim();
        if (trimmed.length < 50) return unavailable('文本过短（<50 字），检测无意义', trimmed.length);

        const input = trimmed.length > this.options.maxChars
            ? trimmed.slice(0, this.options.maxChars)
            : trimmed;

        const key = this.hash(input);
        const cached = this.cache.get(key);
        if (cached) return cached;

        try {
            // 走 http-transport：移动端自动切 requestUrl（无 CORS 限制），桌面端用 fetch
            const res = await requestJson(ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.options.apiKey}`,
                },
                body: JSON.stringify({ text: input, is_merge: true }),
                timeoutMs: this.options.timeoutMs,
            });
            const body = await res.text();
            if (!res.ok) {
                // 402 = 额度耗尽，这是最常见的失败，给明确提示
                if (res.status === 402) {
                    return unavailable('朱雀额度不足（Makers 每月 50 万 tokens），本次跳过', input.length);
                }
                return unavailable(`朱雀请求失败 HTTP ${res.status}: ${body.slice(0, 120)}`, input.length);
            }
            const json = JSON.parse(body) as {
                status?: string;
                labels_ratio?: Record<string, number>;
                softmax_confidence?: number;
                segment_labels?: Array<{ order: number; label: number; conf: number; text: string }>;
                makers_models_usage?: { total_tokens?: number };
            };
            if (json.status !== 'success') {
                return unavailable(`朱雀返回非成功状态: ${body.slice(0, 120)}`, input.length);
            }
            const ratio = json.labels_ratio || {};
            const humanRate = Math.round(Number(ratio['0'] ?? 0) * 1000) / 10;
            const aiRate = Math.round(Number(ratio['1'] ?? 0) * 1000) / 10;
            const suspectedRate = Math.round(Number(ratio['2'] ?? 0) * 1000) / 10;
            const softmax = Number(json.softmax_confidence ?? 0);
            const billed = Number(json.makers_models_usage?.total_tokens ?? 0);
            this.billedTotal += billed;

            const result: ZhuqueResult = {
                available: true,
                humanRate,
                aiRate,
                suspectedRate,
                softmax,
                grade: gradeOf(humanRate, softmax),
                billedTokens: billed,
                textLength: input.length,
                segments: (json.segment_labels || []).map(s => ({
                    order: s.order, label: s.label, conf: s.conf,
                    text: String(s.text || '').slice(0, 80),
                })),
            };
            this.cache.set(key, result);
            return result;
        } catch (e) {
            const msg = e instanceof Error && e.name === 'AbortError'
                ? '朱雀请求超时'
                : String(e).slice(0, 120);
            return unavailable(msg, input.length);
        }
    }

    /**
     * 批量检测（逐条串行，避免并发打爆限流）。
     *
     * @param texts - 文本列表
     * @returns 结果列表（顺序一致）
     * @example
     * const results = await detector.detectBatch(chapters);
     */
    async detectBatch(texts: string[]): Promise<ZhuqueResult[]> {
        const out: ZhuqueResult[] = [];
        for (const t of texts) out.push(await this.detect(t));
        return out;
    }

    /** 清缓存（测试用） */
    clearCache(): void {
        this.cache.clear();
    }
}
