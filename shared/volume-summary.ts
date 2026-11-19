/**
 * volume-summary.ts — 分卷大纲 → 提示词摘要的唯一解析器。
 *
 * 此前 `ui/novel-tags-modal.ts` 与 `ui/volume-intro-modal.ts` 各写了一份几乎逐行相同的
 * 解析器（卷头 / KV 行 / 章节表格三段正则），任一侧调整字段就会与另一侧漂移。
 * 本模块把解析与摘要拼装收敛成一份，两个弹窗都只调 {@link parseVolumeSummary} /
 * {@link formatVolumePromptSummary}。
 *
 * @see shared/format-constants.ts —— 字段名与正则常量（本模块不硬编码字段名）
 */

import {
    FIELD_CHAPTER_RANGE,
    FIELD_TOTAL_CHAPTERS,
    FIELD_TOTAL_WORDS,
    FIELD_VOLUME_COUNT,
    FIELD_VOLUME_NAME,
    RE_OUTLINE_KEY_LINE,
    RE_OUTLINE_SUMMARY_FIELD,
    RE_OUTLINE_TABLE_ROW,
    RE_VOLUME_HEADER,
} from './format-constants';

/** 全书总览字段（`## 全书总览` 下的三行） */
export interface VolumeBookSummary {
    /** 总章节数（原样字符串，可能是「120」或空） */
    totalChapters: string;
    /** 总字数目标（原样字符串，可能是「120万」或空） */
    totalWords: string;
    /** 分卷数（原样字符串） */
    totalVolumes: string;
}

/** 一卷的解析结果 */
export interface VolumeEntry {
    /** 卷标签，如「第1卷」 */
    name: string;
    /** 该卷所有 KV 行（键 → 值，键名保持原文，用 FIELD_* 常量读取） */
    sections: Record<string, string>;
    /** 章节分配表里的行 */
    chapters: { num: number; conflict: string }[];
}

/** 解析结果 */
export interface VolumeSummaryParseResult {
    bookSummary: VolumeBookSummary;
    volumes: VolumeEntry[];
}

/** 摘要拼装选项 */
export interface VolumePromptSummaryOptions {
    /** 全书总览；无卷时用它兜底（novel-tags 不传，volume-intro 传） */
    bookSummary?: VolumeBookSummary;
    /** 章节冲突行前缀，默认「关键冲突示例」 */
    conflictLabel?: string;
    /** 截断长度，默认不截断（volume-intro 传 6000） */
    maxChars?: number;
    /** 未命名卷的占位文案，默认「未命名」 */
    unnamedVolumeLabel?: string;
}

/**
 * 解析分卷大纲合并文本（多卷 `### 第N卷` 拼接）。
 *
 * @param content - 合并后的分卷大纲文本（可含 frontmatter 与全书总览）
 * @returns 全书总览字段 + 每卷的 KV 与章节表
 *
 * @example
 * ```ts
 * const { bookSummary, volumes } = parseVolumeSummary('### 第1卷\n- **卷名**：《初入宗门》');
 * volumes[0].sections['卷名']; // '《初入宗门》'
 * ```
 */
export function parseVolumeSummary(content: string): VolumeSummaryParseResult {
    const lines = content.split('\n');

    const bookSummary: VolumeBookSummary = { totalChapters: '', totalWords: '', totalVolumes: '' };
    const summaryFields: Array<[keyof VolumeBookSummary, string]> = [
        ['totalWords', FIELD_TOTAL_WORDS],
        ['totalChapters', FIELD_TOTAL_CHAPTERS],
        ['totalVolumes', FIELD_VOLUME_COUNT],
    ];
    for (const line of lines) {
        for (const [key, field] of summaryFields) {
            const m = line.match(RE_OUTLINE_SUMMARY_FIELD(field));
            if (m) bookSummary[key] = m[1];
        }
    }

    const volumes: VolumeEntry[] = [];
    let currentVol: VolumeEntry | null = null;
    for (const line of lines) {
        const volMatch = line.match(RE_VOLUME_HEADER);
        if (volMatch) {
            if (currentVol) volumes.push(currentVol);
            currentVol = { name: volMatch[1], sections: {}, chapters: [] };
            continue;
        }
        if (!currentVol) continue;

        const keyMatch = line.match(RE_OUTLINE_KEY_LINE);
        if (keyMatch) {
            currentVol.sections[keyMatch[1].trim()] = keyMatch[2].trim();
            continue;
        }

        const chapMatch = line.match(RE_OUTLINE_TABLE_ROW);
        if (chapMatch && currentVol.sections[FIELD_CHAPTER_RANGE]) {
            currentVol.chapters.push({ num: parseInt(chapMatch[1]), conflict: chapMatch[2].trim() });
        }
    }
    if (currentVol) volumes.push(currentVol);

    return { bookSummary, volumes };
}

/**
 * 把解析结果拼成给 AI 的分卷摘要（提示词片段）。
 *
 * @param volumes - {@link parseVolumeSummary} 的卷列表
 * @param options - 拼装选项（全书总览兜底 / 冲突行前缀 / 截断长度）
 * @returns 摘要文本；无卷且未传 bookSummary 时返回空串
 *
 * @example
 * ```ts
 * const { volumes } = parseVolumeSummary(text);
 * formatVolumePromptSummary(volumes, { maxChars: 6000 });
 * ```
 */
export function formatVolumePromptSummary(
    volumes: readonly VolumeEntry[],
    options: VolumePromptSummaryOptions = {},
): string {
    const label = options.conflictLabel ?? '关键冲突示例';
    const unnamed = options.unnamedVolumeLabel ?? '未命名';
    const parts: string[] = [];

    for (const vol of volumes) {
        parts.push(`\n=== ${vol.name}：${vol.sections[FIELD_VOLUME_NAME] || unnamed} ===`);
        if (vol.sections[FIELD_CHAPTER_RANGE]) parts.push(`章节：${vol.sections[FIELD_CHAPTER_RANGE]}`);
        if (vol.sections['核心剧情']) parts.push(`剧情：${vol.sections['核心剧情']}`);
        if (vol.sections['主线推进']) parts.push(`主线：${vol.sections['主线推进']}`);
        if (vol.sections['本卷高潮']) parts.push(`高潮：${vol.sections['本卷高潮']}`);
        if (vol.sections['结尾过渡']) parts.push(`结尾：${vol.sections['结尾过渡']}`);
        if (vol.chapters.length > 0) {
            const hints = [...vol.chapters.slice(0, 3), ...vol.chapters.slice(-3)].map(c => c.conflict);
            parts.push(`${label}：${hints.join(' / ')}`);
        }
    }

    if (parts.length === 0 && options.bookSummary) {
        parts.push(`${FIELD_TOTAL_WORDS}：${options.bookSummary.totalWords || '未设定'}`);
        parts.push(`${FIELD_TOTAL_CHAPTERS}：${options.bookSummary.totalChapters || '未设定'}`);
        parts.push(`${FIELD_VOLUME_COUNT}：${options.bookSummary.totalVolumes || '未设定'}`);
    }

    const joined = parts.join('\n');
    return options.maxChars && options.maxChars > 0 ? joined.slice(0, options.maxChars) : joined;
}
