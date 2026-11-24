/**
 * chapter-four-checks-model.ts — 正文「四项校验」软聚合模型
 *
 * 背景：三模式工作流规格第 7 步要求交付前校验「字数 / 格式 / 视角 / 钩子」。
 * 实际链路里只有字数是第 7 步硬门禁（engine/step-definitions.ts postCheckWordCount），
 * 格式在落盘时被静默规整（shared/body-format.ts），视角在一致性审核
 * （engine/consistency/extended-rules.ts），钩子在正文保存后的 QualityGate
 * （engine/quality-gate.ts）。三处结果各自为政，用户拿不到一份合并结论。
 *
 * 本模型只做「聚合与措辞」，不新增判定规则、不阻断流程：
 *  - 输入全部来自各链路的既有产出（不重新扫正文猜结论）；
 *  - 输出只用于诊断事件与质量面板展示。
 */

import type { BodyFormatDeviationSample } from './body-format';

/** 单项校验结论：pass 通过 / warn 待关注 / fail 硬门禁未过 / skip 缺依据 */
export type FourCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

/** 四项校验的固定顺序 */
export type FourCheckId = 'wordCount' | 'format' | 'perspective' | 'hook';

/**
 * 单项校验结果。
 */
export interface FourCheckItem {
    id: FourCheckId;
    /** 面向作者的短标签（字数 / 格式 / 视角 / 钩子） */
    label: string;
    status: FourCheckStatus;
    /** 一句话说明（含具体数字） */
    message: string;
}

/** 格式偏离输入（由 shared/body-format.ts#analyzeBodyFormat 产出） */
export interface FourCheckFormatInput {
    /** 偏离行占比 0–1 */
    ratio: number;
    indentMissing: number;
    blankLineBreaks: number;
    titleStripped: number;
    metaStripped: number;
    /** 偏离行定位（shared/body-format.ts#analyzeBodyFormat 产出，可选） */
    samples?: BodyFormatDeviationSample[];
}

/** 视角输入（由 engine/consistency/extended-rules.ts#detectPerspectiveMix 产出） */
export interface FourCheckPerspectiveInput {
    first: number;
    third: number;
    mixed: boolean;
    /** min/max 比例 0–1 */
    ratio: number;
}

/** 钩子输入（章纲声明 + QualityGate 结构层结果） */
export interface FourCheckHookInput {
    /** 章纲声明的钩子数量（0 表示本章没有可判定的钩子要求） */
    required: number;
    /** 章纲钩子类型（悬念 / 反转 / 危机 …），用于提示措辞 */
    hookType?: string;
    /** QualityGate 是否在结尾窗口检出钩子；null 表示声明了钩子但没写内容，无法判定 */
    present: boolean | null;
}

/**
 * 聚合输入。
 */
export interface FourCheckInput {
    chapterName: string;
    wordCount: number;
    /** 本章目标字数（settings.defaultWordCount 或章节计划） */
    targetWords: number;
    /** 硬门禁下限比例（shared/thresholds.ts#getBusinessThreshold('wordMinRatio')） */
    wordMinRatio: number;
    format?: FourCheckFormatInput | null;
    perspective?: FourCheckPerspectiveInput | null;
    hook?: FourCheckHookInput | null;
    now?: number;
}

/**
 * 聚合报告。
 */
export interface FourCheckReport {
    chapterName: string;
    checkedAt: number;
    items: FourCheckItem[];
    /** warn + fail 的项数 */
    warnCount: number;
    /** 单行摘要，直接用于诊断事件 */
    summary: string;
}

/** 格式偏离提示阈值：偏离行占比 ≥ 该值才提示（0.15 ≈ 每 7 行 1 行） */
export const FORMAT_DEVIATION_WARN_RATIO = 0.15;

/** 质量面板区块标题（放在 shared：ui/** 有中文棘轮，新增文案不放界面层） */
export const FOUR_CHECK_SECTION_TITLE = '本章四项校验';

/** 质量面板区块说明 */
export const FOUR_CHECK_SECTION_HINT =
    '正文保存时自动聚合「字数 / 格式 / 视角 / 钩子」；字数超下限是硬门禁，其余只提示不阻断。';

/**
 * 无记录时的占位说明。
 *
 * @param chapter - 当前章节名（空串时用「当前章节」）
 * @returns 单行说明
 */
export function describeFourCheckEmpty(chapter: string): string {
    return `暂无「${chapter || '当前章节'}」的四项校验结果：生成并保存正文后自动记录。`;
}

/**
 * 报告首行：摘要 + 检查时间。
 *
 * @param report - 聚合报告
 * @param checkedAtText - 已本地化的时间文本
 * @returns 单行标题
 */
export function describeFourCheckHeader(report: FourCheckReport, checkedAtText: string): string {
    return `${report.summary}（${checkedAtText}）`;
}

/** 质量面板「按磁盘正文重算」按钮文案 */
export const FOUR_CHECK_REFRESH_LABEL = '按磁盘正文重算';

/** 「按磁盘正文重算」进行中的按钮文案 */
export const FOUR_CHECK_REFRESH_BUSY_LABEL = '重算中…';

/** 「按磁盘正文重算」按钮说明 */
export const FOUR_CHECK_REFRESH_HINT =
    '协同写作、场景循环、续写、定向修订写出的正文不经过步骤 7，可在这里按磁盘正文重算；口径与自动记录一致。';

/**
 * 重算进行中的状态文案。
 *
 * @returns 单行状态提示
 */
export function describeFourCheckRefreshStarted(): string {
    return '⌛ 正在按磁盘正文重算四项校验…';
}

/**
 * 重算成功的提示文案。
 *
 * @param report - 重算后的报告
 * @returns 单行提示
 */
export function describeFourCheckRefreshed(report: FourCheckReport): string {
    return `${report.chapterName} 四项校验已重算：${report.summary}`;
}

/**
 * 重算失败的提示文案。
 *
 * @param reason - 失败原因
 * @returns 单行提示
 */
export function describeFourCheckRefreshFailed(reason: string): string {
    return `四项校验重算失败：${reason}`;
}

const STATUS_ICON: Record<FourCheckStatus, string> = {
    pass: '✅',
    warn: '⚠️',
    fail: '❌',
    skip: '⏭',
};

const pct = (ratio: number): string => `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;

function wordCountItem(input: FourCheckInput): FourCheckItem {
    const target = Math.max(1, Math.floor(input.targetWords || 3000));
    const min = Math.max(1, Math.floor(target * (input.wordMinRatio > 0 ? input.wordMinRatio : 1)));
    if (input.wordCount < min) {
        return {
            id: 'wordCount', label: '字数', status: 'fail',
            message: `${input.wordCount} 字，低于硬门禁下限 ${min} 字（目标 ${target} 字）`,
        };
    }
    if (input.wordCount < target) {
        return {
            id: 'wordCount', label: '字数', status: 'pass',
            message: `${input.wordCount} 字，高于下限 ${min} 字、略低于目标 ${target} 字`,
        };
    }
    return {
        id: 'wordCount', label: '字数', status: 'pass',
        message: `${input.wordCount} 字，达到目标 ${target} 字`,
    };
}

const FORMAT_SAMPLE_LABEL: Record<BodyFormatDeviationSample['kind'], string> = {
    indent: '缺缩进',
    blank: '多余空行',
    title: '标题行',
    meta: '元叙述',
};

function describeFormatSamples(samples: BodyFormatDeviationSample[] | undefined): string {
    if (!samples || samples.length === 0) return '';
    const located = samples.map(sample => `第 ${sample.line} 行（${FORMAT_SAMPLE_LABEL[sample.kind]}）`);
    return `；偏离定位：${located.join('、')}`;
}

function formatItem(format: FourCheckFormatInput | null | undefined): FourCheckItem {
    if (!format) {
        return { id: 'format', label: '格式', status: 'skip', message: '未取得格式分析结果' };
    }
    const details: string[] = [];
    if (format.indentMissing > 0) details.push(`缺段首缩进 ${format.indentMissing} 行`);
    if (format.blankLineBreaks > 0) details.push(`多余空行 ${format.blankLineBreaks} 处`);
    if (format.titleStripped > 0) details.push(`剥离标题 ${format.titleStripped} 行`);
    if (format.metaStripped > 0) details.push(`剥离模型元叙述 ${format.metaStripped} 行`);
    const suffix = details.length > 0 ? `（${details.join('、')}）` : '';
    const sampleText = describeFormatSamples(format.samples);
    if (format.ratio >= FORMAT_DEVIATION_WARN_RATIO) {
        return {
            id: 'format', label: '格式', status: 'warn',
            message: `${pct(format.ratio)} 的行偏离格式契约${suffix}；落盘已按契约自动规整${sampleText}`,
        };
    }
    return {
        id: 'format', label: '格式', status: 'pass',
        message: `符合格式契约（偏离 ${pct(format.ratio)}）${suffix}${sampleText}`,
    };
}

function perspectiveItem(mix: FourCheckPerspectiveInput | null | undefined): FourCheckItem {
    if (!mix) {
        return { id: 'perspective', label: '视角', status: 'skip', message: '未取得人称统计' };
    }
    const detail = `第一人称 ${mix.first} 处 / 第三人称 ${mix.third} 处（比例 ${pct(mix.ratio)}，已剔除对话）`;
    if (mix.mixed) {
        return {
            id: 'perspective', label: '视角', status: 'warn',
            message: `${detail}，同章人称混用，建议确认是否叙事需要`,
        };
    }
    return { id: 'perspective', label: '视角', status: 'pass', message: `${detail}，未达混用阈值` };
}

function hookItem(hook: FourCheckHookInput | null | undefined): FourCheckItem {
    if (!hook || hook.required <= 0) {
        return { id: 'hook', label: '钩子', status: 'skip', message: '本章章纲没有指定章末钩子，跳过判定（补齐「章末钩子」小节后自动启用）' };
    }
    const type = hook.hookType ? `（类型：${hook.hookType}）` : '';
    if (hook.present === null) {
        return {
            id: 'hook', label: '钩子', status: 'skip',
            message: `章纲声明了章末钩子${type}，但未写钩子内容，无法判定`,
        };
    }
    if (hook.present) {
        return { id: 'hook', label: '钩子', status: 'pass', message: `章末钩子已在末段落笔${type}` };
    }
    return {
        id: 'hook', label: '钩子', status: 'warn',
        message: `章纲要求章末钩子${type}，末段 200 字内未检出钩子内容的关键词，建议人工复核结尾`,
    };
}

/**
 * 聚合四项校验。
 *
 * @param input - 各链路既有产出
 * @returns 报告（顺序固定：字数 → 格式 → 视角 → 钩子）
 */
export function buildFourCheckReport(input: FourCheckInput): FourCheckReport {
    const items: FourCheckItem[] = [
        wordCountItem(input),
        formatItem(input.format),
        perspectiveItem(input.perspective),
        hookItem(input.hook),
    ];
    const warnCount = items.filter(item => item.status === 'warn' || item.status === 'fail').length;
    const summary = `四项校验：${items.map(item => `${item.label} ${STATUS_ICON[item.status]}`).join(' / ')}`
        + (warnCount > 0 ? `（${warnCount} 项待关注）` : '（全部通过）');
    return {
        chapterName: input.chapterName,
        checkedAt: input.now ?? Date.now(),
        items,
        warnCount,
        summary,
    };
}

/**
 * 渲染为多行文本（诊断事件 / 面板详情共用）。
 *
 * @param report - 聚合报告
 * @returns Markdown 文本
 */
export function renderFourCheckReport(report: FourCheckReport): string {
    const lines = [`本章四项校验 · ${report.chapterName}`, report.summary];
    for (const item of report.items) {
        lines.push(`- ${STATUS_ICON[item.status]} [${item.label}] ${item.message}`);
    }
    return lines.join('\n');
}

/**
 * 只取待关注项（诊断/面板按这个决定是否升级为 warning）。
 *
 * @param report - 聚合报告
 * @returns warn 与 fail 项
 */
export function fourCheckAttentionItems(report: FourCheckReport): FourCheckItem[] {
    return report.items.filter(item => item.status === 'warn' || item.status === 'fail');
}

/** 四项的固定顺序（趋势行按此排列图标；与 buildFourCheckReport 的构造顺序一致） */
export const FOUR_CHECK_ORDER: readonly FourCheckId[] = ['wordCount', 'format', 'perspective', 'hook'];

/** 状态图标（面板与趋势共用；放在 shared 避免 ui 层重复维护一份） */
export const FOUR_CHECK_STATUS_ICONS: Record<FourCheckStatus, string> = {
    pass: '✅',
    warn: '⚠️',
    fail: '❌',
    skip: '⏭',
};

/** 趋势最多展示的章数（面板用） */
export const FOUR_CHECK_TREND_LIMIT = 10;

/** 趋势中的一章 */
export interface FourCheckTrendRow {
    chapterName: string;
    checkedAt: number;
    /** 按 FOUR_CHECK_ORDER 排列的状态；报告缺项时补 skip */
    statuses: FourCheckStatus[];
    warnCount: number;
}

/**
 * 构建「最近 N 章」趋势。
 *
 * 输入约定：`view` 为 `FourCheckStore.view()` 的返回值 —— 按章名自然序排好
 * （`第1章, 第2章, …, 第10章`），本函数按插入序取**末尾 N 章**，即书内进度最新的 N 章。
 * 每章展开为四项固定顺序的状态序列，便于面板一行一章对齐比较。
 *
 * 为什么取末尾而不是按 checkedAt 取最新写入：趋势的意义是「随章节推进的变化」，
 * 按章序对齐才能看出某项是持续恶化还是偶发；按写入时间会把乱序重算的章插进来。
 *
 * @param view - 章名 → 报告（已按自然序）
 * @param maxChapters - 最多取几章（默认 FOUR_CHECK_TREND_LIMIT）
 * @returns 趋势行（章序与输入一致）
 */
export function buildFourCheckTrend(
    view: Record<string, FourCheckReport>,
    maxChapters: number = FOUR_CHECK_TREND_LIMIT,
): FourCheckTrendRow[] {
    const limit = Math.max(1, Math.floor(maxChapters || FOUR_CHECK_TREND_LIMIT));
    const names = Object.keys(view);
    const tail = names.slice(Math.max(0, names.length - limit));
    return tail.map(name => {
        const report = view[name];
        const statuses = FOUR_CHECK_ORDER.map(id => {
            const item = report?.items?.find(entry => entry.id === id);
            return item ? item.status : 'skip';
        });
        return {
            chapterName: report?.chapterName || name,
            checkedAt: report?.checkedAt || 0,
            statuses,
            warnCount: report?.warnCount ?? statuses.filter(s => s === 'warn' || s === 'fail').length,
        };
    });
}

/**
 * 趋势区块标题。
 *
 * @param count - 实际展示的章数
 * @returns 标题文本
 */
export function describeFourCheckTrendTitle(count: number): string {
    return `最近 ${count} 章四项校验`;
}

/** 趋势区块说明 */
export const FOUR_CHECK_TREND_HINT =
    '按章序对齐四项（字数 / 格式 / 视角 / 钩子），用来判断某一项是持续恶化还是偶发；只统计已记录过的章。';

/** 无任何记录时的占位 */
export const FOUR_CHECK_TREND_EMPTY = '暂无已记录的四项校验结果：生成并保存正文后自动记录。';

/**
 * 趋势单行：`第3章  ✅⚠️✅✅  1 项待关注（11-24 10:05）`。
 *
 * @param row - 趋势行
 * @param checkedAtText - 已本地化的检查时间（空串则不显示）
 * @returns 单行文本
 */
export function describeFourCheckTrendRow(row: FourCheckTrendRow, checkedAtText: string): string {
    const icons = row.statuses.map(status => FOUR_CHECK_STATUS_ICONS[status]).join('');
    const attention = row.warnCount > 0 ? `${row.warnCount} 项待关注` : '全部通过';
    const when = checkedAtText ? `（${checkedAtText}）` : '';
    return `${row.chapterName}  ${icons}  ${attention}${when}`;
}
