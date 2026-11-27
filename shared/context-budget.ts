/**
 * context-budget.ts — 上下文模块计量 + 快捷预设（2026-11-27，T2 + T6）
 *
 * ## T2：先做「清单 + 计量」，不做开关
 *
 * 云笔有 32 个可开关模块，每个标 `预估tokens`，双模式（普通 23250 / 专注 3750）。
 * 本仓是变量平铺注入（`template-vars-builder` 一次填 40+ 变量），
 * 没有模块概念、无 token 计量、无按需裁剪。
 *
 * 直接做「可开关模块」成本极高（要改注入链路）。第一步只做**计量**：
 * 让「一次生成到底喂了多少 token」可见，跑一段时间拿到数据，再决定裁什么。
 *
 * ## T6：快捷预设
 *
 * 在模块清单基础上，提供三个预设组合（学云笔）：
 * - minimal：极简续写（只留核心+世界观）
 * - character-focus：角色聚焦（对话密集章）
 * - world-focus：世界观聚焦（设定密集章）
 */

/** 模块产出预算的记录 */
export interface ContextBudgetEntry {
    /** 变量名（对应 vars 的 key） */
    id: string;
    /** 汉字数 */
    chars: number;
    /** 预估 tokens（中文约 2.2 字/token） */
    tokens: number;
}

/** 预算报告 */
export interface ContextBudgetReport {
    /** 各模块按 tokens 降序 */
    entries: ContextBudgetEntry[];
    /** 总 tokens */
    totalTokens: number;
    /** 总汉字数 */
    totalChars: number;
}

/** 中文 token 估算比例（汉字数 / 该值 ≈ tokens） */
export const CHARS_PER_TOKEN = 2.2;

/**
 * 估算文本的 token 数（中文近似）。
 *
 * 为什么用 2.2：中文在主流 tokenizer 下约 1 token ≈ 1.5-2.5 个汉字，
 * 取 2.2 作为中间值。这是**估算**，用于相对比较而非精确计费。
 *
 * @param text - 文本
 * @returns 预估 token 数
 * @example
 * estimateTokens('一二三四五六七八九十十一') // 5
 */
export function estimateTokens(text: string): number {
    const chars = (text || '').length;
    return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * 汇总本次注入的模块与总 token。
 *
 * @param vars - 模板变量表
 * @param options - 选项（minChars 过滤掉短变量，默认 50）
 * @returns 预算报告
 * @example
 * const r = auditContextBudget(vars);
 * log.info(`上下文 ${r.totalTokens} tokens，Top3：${r.entries.slice(0,3).map(e=>e.id).join(',')}`);
 */
export function auditContextBudget(
    vars: Record<string, string>,
    options: { minChars?: number } = {},
): ContextBudgetReport {
    const minChars = options.minChars ?? 50;
    const entries: ContextBudgetEntry[] = [];
    for (const [id, v] of Object.entries(vars)) {
        if (typeof v !== 'string') continue;
        const chars = v.length;
        if (chars < minChars) continue;
        entries.push({ id, chars, tokens: estimateTokens(v) });
    }
    entries.sort((a, b) => b.tokens - a.tokens);
    return {
        entries,
        totalTokens: entries.reduce((n, e) => n + e.tokens, 0),
        totalChars: entries.reduce((n, e) => n + e.chars, 0),
    };
}

/**
 * 快捷预设：只列「额外保留」的模块 id（其余按默认全留）。
 *
 * 云笔的三个预设对应三种章节类型。本仓先只做「清单定义 + 计量对比」，
 * 不做实际裁剪——裁剪需要改注入链路，成本高。
 *
 * @example
 * CONTEXT_PRESETS.minimal.keepOnly // ['worldView', 'allChars']
 */
export const CONTEXT_PRESETS = {
    minimal: {
        name: '极简续写',
        note: '只留世界观+角色，最大化专注力。适合短章/快写。',
        /** 只保留这些模块（其余清空） */
        keepOnly: ['worldView', 'allChars', 'prevChapEnding', 'nextChapterHook'],
    },
    characterFocus: {
        name: '角色聚焦',
        note: '加故事核心+场景卡。适合对话密集章。',
        keepOnly: [
            'worldView', 'allChars', 'storyContextPack', 'sceneCardDigest',
            'prevChapEnding', 'nextChapterHook', 'triggeredMemories',
        ],
    },
    worldFocus: {
        name: '世界观聚焦',
        note: '加设定库+力量体系+地理。适合设定密集章。',
        keepOnly: [
            'worldView', 'settingLib', 'powerSystem', 'sceneCardDigest', 'allChars',
            'prevChapEnding', 'nextChapterHook',
        ],
    },
} as const;

/** 预设名 */
export type ContextPresetName = keyof typeof CONTEXT_PRESETS;

/**
 * 计算某预设相对完整上下文的「省了多少 token」。
 *
 * T2 阶段只做计量对比，不实际裁剪——让用户看到「用预设能省多少」，
 * 攒够数据再决定要不要真做裁剪。
 *
 * @param vars - 完整变量表
 * @param preset - 预设名
 * @returns 完整/预设/省下的 token 数
 * @example
 * const d = comparePreset(vars, 'minimal');
 * // { full: 23000, preset: 4200, saved: 18800, savedPct: 82 }
 */
export function comparePreset(
    vars: Record<string, string>,
    preset: ContextPresetName,
): { full: number; preset: number; saved: number; savedPct: number } {
    const keep = new Set<string>(CONTEXT_PRESETS[preset].keepOnly);
    const full = auditContextBudget(vars).totalTokens;
    const kept: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
        if (keep.has(k)) kept[k] = v;
    }
    const presetTokens = auditContextBudget(kept, { minChars: 0 }).totalTokens;
    const saved = Math.max(0, full - presetTokens);
    return {
        full,
        preset: presetTokens,
        saved,
        savedPct: full > 0 ? Math.round((saved / full) * 100) : 0,
    };
}

/**
 * 格式化预算报告为单行日志。
 *
 * @param report - 预算报告
 * @param topN - 列出前 N 大模块（默认 5）
 * @returns 日志文本
 * @example
 * formatBudgetLine(auditContextBudget(vars))
 * // '上下文 18432 tokens（Top5: allChars(2400), worldView(1800), ...)'
 */
export function formatBudgetLine(report: ContextBudgetReport, topN = 5): string {
    const top = report.entries.slice(0, topN).map(e => `${e.id}(${e.tokens})`).join(', ');
    return `上下文 ${report.totalTokens} tokens（Top${topN}: ${top}）`;
}
