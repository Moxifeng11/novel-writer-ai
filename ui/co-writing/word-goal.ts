/**
 * word-goal.ts — 本章字数目标解析（2026-11-16，E-03 / D1）
 *
 * 背景：协同视图的字数目标此前只读全局 settings.defaultWordCount，
 * 而分卷大纲里的「每章字数」（FIELD_WORDS_PER_CHAPTER）定义了却零消费，
 * 导致「计划 3000 字/章」的书显示 2600 目标、进度百分比失真。
 *
 * 优先级（用户确认 D1）：分卷大纲「每章字数」→ 项目配置（模式目标字数/单元数）→ 全局默认。
 * 纯函数，不读 Obsidian；I/O 在视图里做。
 */
import { FIELD_WORDS_PER_CHAPTER } from '@/shared/format-constants';
import { t } from '@/i18n';

/** 目标来源 */
export type WordGoalSource = 'outline' | 'project' | 'global';

/** 解析结果 */
export interface ChapterWordGoal {
    /** 本章目标字数（>0） */
    goal: number;
    /** 来源，用于在界面上标注「目标来源」 */
    source: WordGoalSource;
    /** 人类可读的来源说明 */
    detail: string;
}

/**
 * 解析分卷大纲里的「每章字数」。
 *
 * 支持 `每章字数：2500-3000 字`（取上限作为目标）、`每章字数：约 3000 字`、
 * `每章字数: 3000` 等写法；解析不出或非法时返回 null。
 *
 * @param outlineContent - 合并后的分卷大纲全文
 * @returns 目标字数；无法解析返回 null
 * @example
 * parseWordsPerChapter('- **每章字数**：2500-3000 字'); // 3000
 * parseWordsPerChapter('没有这个字段');                  // null
 */
export function parseWordsPerChapter(outlineContent: string | null | undefined): number | null {
    if (!outlineContent) return null;
    const line = String(outlineContent)
        .split('\n')
        .find(text => text.includes(FIELD_WORDS_PER_CHAPTER));
    if (!line) return null;
    // 只取该行冒号之后的数字，避免把章号等误当字数
    const colonIndex = line.search(/[：:]/);
    const afterColon = colonIndex >= 0 ? line.slice(colonIndex + 1) : line;
    const numbers = (afterColon.match(/\d+/g) ?? [])
        .map(text => parseInt(text, 10))
        .filter(value => Number.isFinite(value) && value > 0);
    if (numbers.length === 0) return null;
    // 区间写法取上限（目标=写满规划区间）；单一数字直接用
    const goal = Math.max(...numbers);
    return goal > 0 ? goal : null;
}

/**
 * 按 D1 优先级解析本章字数目标。
 *
 * @param input - 大纲原文、项目模式目标字数/单元数、全局默认值
 * @returns 目标与来源说明（永远返回合法目标）
 * @example
 * resolveChapterWordGoal({ outlineContent: '每章字数：2500-3000 字' }).goal; // 3000
 */
export function resolveChapterWordGoal(input: {
    /** 合并后的分卷大纲全文（可为空） */
    outlineContent?: string | null;
    /** 项目配置：模式目标总字数（短篇/剧本用） */
    modeTargetWords?: number;
    /** 项目配置：模式目标单元数（短篇/剧本用） */
    modeTargetUnits?: number;
    /** 全局默认每章字数 */
    defaultWordCount?: number;
}): ChapterWordGoal {
    const fromOutline = parseWordsPerChapter(input.outlineContent ?? null);
    if (fromOutline) {
        return {
            goal: fromOutline,
            source: 'outline',
            detail: `分卷大纲「` + FIELD_WORDS_PER_CHAPTER + `」`,
        };
    }

    const targetWords = Number(input.modeTargetWords) || 0;
    const targetUnits = Number(input.modeTargetUnits) || 0;
    if (targetWords > 0 && targetUnits > 0) {
        const perUnit = Math.max(1, Math.round(targetWords / targetUnits));
        return {
            goal: perUnit,
            source: 'project',
            detail: t('cowrite.goal.projectDetail'),
        };
    }

    const fallback = Math.max(1, Number(input.defaultWordCount) || 3000);
    return {
        goal: fallback,
        source: 'global',
        detail: t('cowrite.goal.globalDetail'),
    };
}

/**
 * 目标来源的短标签（状态栏/概览用）。
 *
 * @param source - 来源
 * @returns 短标签
 * @example
 * describeWordGoalSource('outline'); // '大纲'
 */
export function describeWordGoalSource(source: WordGoalSource): string {
    if (source === 'outline') return t('cowrite.goal.srcOutline');
    if (source === 'project') return t('cowrite.goal.srcProject');
    return t('cowrite.goal.srcDefault');
}
