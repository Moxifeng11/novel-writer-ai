/**
 * publication-profile.ts — 商业化出版检查（纯函数）
 *
 * 只做「事实 → 出版阻断/建议」的判定与文案组装，不读写 Obsidian、不生成文件。
 * 目标区间复用 `shared/creation-mode.ts` 的 CREATION_MODE_SPECS，避免第二套规格。
 */
import { CREATION_MODE_SPECS, type CreationMode } from './creation-mode';
import { countCjkChars } from './word-count';

/**
 * 导出格式（与导出弹窗保持一致，但本模块不依赖 UI）。
 */
export type PublicationFormat = 'markdown' | 'text' | 'html' | 'epub' | 'docx';

/**
 * 出版检查事项目录。
 */
export type PublicationIssueLevel = 'blocker' | 'warning';

/**
 * 单条出版检查事项。
 */
export interface PublicationIssue {
    level: PublicationIssueLevel;
    code: string;
    message: string;
}

/**
 * 交付级别：决定检查强度（草稿只提示 / 成品阻断空单元 / 平台投稿全格式作者+字数）。
 */
export type PublicationLevel = 'draft' | 'finished' | 'submission';

/**
 * 导出范围：full 为整包；written-only 表示调用方已排除空单元。
 */
export type PublicationScope = 'full' | 'written-only';

/**
 * 交付级别文案（UI 下拉与报告复用，避免第二套）。
 */
export const PUBLICATION_LEVEL_LABELS: Record<PublicationLevel, string> = {
    draft: '草稿导出（仅提示）',
    finished: '成品导出（推荐）',
    submission: '平台投稿（严格）',
};

/**
 * 出版检查输入事实。
 */
export interface PublicationFacts {
    mode: CreationMode;
    /** 书名（项目名） */
    title: string;
    /** 作者（EPUB/DOCX 元数据） */
    author?: string;
    /** 单元标签：章/节/集 */
    unitLabel: string;
    /** 正文单元总数 */
    unitCount: number;
    /** 有正文内容的单元数 */
    writtenCount: number;
    /** 总字数（CJK 字数口径，与导出统计一致） */
    wordCount: number;
    /** 空正文单元名（最多展示由调用方截断） */
    emptyUnits: string[];
    /** 重复标题数量（可选；0 或未提供表示未发现） */
    duplicateTitleCount?: number;
    /** 导出时是否包含单元标题 */
    includeChapterTitles: boolean;
    format: PublicationFormat;
    /**
     * 交付级别。缺省时不传 → 沿用 v4.58.0 旧矩阵（向后兼容）；
     * 新 UI 必须显式传入。
     */
    level?: PublicationLevel;
    /** 导出范围（缺省 full） */
    scope?: PublicationScope;
    /** 是否已排除空单元（finished 档豁免空单元阻断；submission 不豁免） */
    excludeEmptyUnits?: boolean;
}

/**
 * 导出正文单元（与 `collectModeManuscript` / 长篇章节收集结果对齐）。
 */
export interface PublicationUnitInput {
    /** 单元名（第3章 / 第2节 / 第5集） */
    unit: string;
    /** 单元标题（用于重复标题统计） */
    title?: string;
    /** 原始正文（可含 frontmatter，空正文判定前会剥离） */
    content: string;
}

/**
 * 出版事实中由导出单元推导的部分之外的基础字段。
 */
export type PublicationFactsBase = Omit<
    PublicationFacts,
    'unitCount' | 'writtenCount' | 'wordCount' | 'emptyUnits' | 'duplicateTitleCount'
>;

/**
 * 从导出正文单元推导出版检查事实（剥离 frontmatter 判空、重复标题统计、CJK 字数）。
 *
 * 与导出弹窗口径一致：字数统计包含原始正文（含 frontmatter），空正文只看剥离后的正文。
 *
 * @param units - 导出正文单元
 * @param base - 模式、书名、作者、单元标签、格式等基础字段
 * @returns 可直接交给 `checkPublicationReadiness` 的完整事实
 * @example
 * buildPublicationFacts(
 *   [{ unit: '第1章', title: '开端', content: '---\nstatus: written\n---\n正文内容' }],
 *   { mode: 'long', title: '示例书', author: '作者', unitLabel: '章', includeChapterTitles: true, format: 'epub' },
 * )
 */
export function buildPublicationFacts(
    units: ReadonlyArray<PublicationUnitInput>,
    base: PublicationFactsBase,
): PublicationFacts {
    const bodyOf = (content: string) => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
    const emptyUnits = units
        .filter(unit => bodyOf(unit.content).length === 0)
        .map(unit => `${unit.unit}${unit.title ? ` ${unit.title}` : ''}`);
    const titleCounts = new Map<string, number>();
    for (const unit of units) {
        const title = (unit.title || '').trim();
        if (title) titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
    }
    const duplicateTitleCount = Array.from(titleCounts.values()).filter(count => count > 1).length;
    return {
        ...base,
        unitCount: units.length,
        writtenCount: units.length - emptyUnits.length,
        wordCount: units.reduce((sum, unit) => sum + countCjkChars(unit.content), 0),
        emptyUnits,
        duplicateTitleCount,
    };
}

/**
 * 把导出单元按「正文是否为空」拆分（frontmatter 剥离后判空）。
 *
 * 供「仅已写单元」导出使用：调用方按 nonEmptyIndexes 过滤实际导出内容，
 * 再以 excludeEmptyUnits=true 交给出版检查。
 *
 * @param units - 导出单元
 * @returns nonEmptyIndexes：有正文的下标；emptyLabels：空单元显示名
 * @example
 * splitUnitsByBody([{ unit: '第1章', content: '正文' }, { unit: '第2章', content: '---\nstatus: pending\n---' }])
 * // { nonEmptyIndexes: [0], emptyLabels: ['第2章'] }
 */
export function splitUnitsByBody(
    units: ReadonlyArray<PublicationUnitInput>,
): { nonEmptyIndexes: number[]; emptyLabels: string[] } {
    const bodyOf = (content: string) => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
    const nonEmptyIndexes: number[] = [];
    const emptyLabels: string[] = [];
    units.forEach((unit, index) => {
        if (bodyOf(unit.content).length > 0) nonEmptyIndexes.push(index);
        else emptyLabels.push(`${unit.unit}${unit.title ? ` ${unit.title}` : ''}`);
    });
    return { nonEmptyIndexes, emptyLabels };
}

/**
 * 出版参数档位。
 */
export interface PublicationProfile {
    mode: CreationMode;
    targetWords: { min: number; max: number };
    targetUnits: { min: number; max: number };
    /** EPUB/DOCX 是否要求作者元数据 */
    requiresAuthor: boolean;
    /** EPUB 是否依赖单元标题生成目录 */
    requiresTitlesForEpub: boolean;
}

/**
 * 取模式的出版参数档位。
 *
 * @param mode - 创作模式
 * @returns 出版参数档位
 * @example
 * resolvePublicationProfile('long').targetWords.min
 */
export function resolvePublicationProfile(mode: CreationMode): PublicationProfile {
    const spec = CREATION_MODE_SPECS[mode] ?? CREATION_MODE_SPECS.long;
    return {
        mode,
        targetWords: { min: spec.targetWords.min, max: spec.targetWords.max },
        targetUnits: { min: spec.targetUnits.min, max: spec.targetUnits.max },
        requiresAuthor: true,
        requiresTitlesForEpub: true,
    };
}

/**
 * 检查商业化导出是否就绪。
 *
 * 分级口径：
 * - blocker：缺书名/缺作者（EPUB/DOCX）/无正文/存在空单元/字数低于下限的一半；
 * - warning：字数低于下限但未到一半/单元数低于下限/EPUB 未包含标题/重复标题。
 * @param facts - 出版检查事实
 * @returns 事项列表（空数组表示通过）
 * @example
 * checkPublicationReadiness({ mode: 'long', title: '示例', unitLabel: '章', unitCount: 10, writtenCount: 10, wordCount: 120000, emptyUnits: [], includeChapterTitles: true, format: 'epub' })
 */
export function checkPublicationReadiness(facts: PublicationFacts): PublicationIssue[] {
    const profile = resolvePublicationProfile(facts.mode);
    const issues: PublicationIssue[] = [];
    const unit = facts.unitLabel || '章';
    // level 缺省 = v4.58.0 旧矩阵（向后兼容）；新调用方显式传入三档级别
    const legacy = facts.level === undefined;
    const level: PublicationLevel = facts.level ?? 'finished';
    const excludedEmpty = facts.excludeEmptyUnits === true || facts.scope === 'written-only';

    if (!facts.title.trim()) {
        issues.push({ level: 'blocker', code: 'missing-title', message: '书名不能为空' });
    }

    // 作者：投稿档全格式必填；成品档 EPUB/DOCX 必填、其它仅提示；草稿仅提示
    const needAuthor = level === 'submission'
        ? true
        : (facts.format === 'epub' || facts.format === 'docx');
    if (needAuthor && !(facts.author || '').trim()) {
        const message = level === 'submission'
            ? '平台投稿需要填写作者（所有格式）'
            : 'EPUB/DOCX 需要填写作者元数据';
        issues.push({ level: level === 'draft' ? 'warning' : 'blocker', code: 'missing-author', message });
    } else if (!legacy && level !== 'submission' && !(facts.author || '').trim()) {
        issues.push({ level: 'warning', code: 'missing-author', message: '未填写作者：平台/编辑器可能无法识别署名' });
    }

    if (facts.writtenCount <= 0) {
        issues.push({ level: 'blocker', code: 'no-body', message: `没有可导出的正文${unit}` });
    }

    // 空单元：旧调用始终阻断；草稿仅提示；成品可在「仅已写单元」范围下豁免；投稿必须整包
    if (facts.emptyUnits.length > 0 && !(!legacy && level === 'finished' && excludedEmpty)) {
        issues.push({
            level: level === 'draft' ? 'warning' : 'blocker',
            code: 'empty-units',
            message: `存在 ${facts.emptyUnits.length} 个空正文${unit}（${facts.emptyUnits.slice(0, 5).join('、')}）`,
        });
    }

    const halfMin = Math.floor(profile.targetWords.min / 2);
    if ((legacy || level === 'submission') && facts.wordCount < halfMin) {
        issues.push({
            level: 'blocker',
            code: 'word-count-too-low',
            message: `总字数 ${facts.wordCount}，低于出版下限 ${profile.targetWords.min} 的一半`,
        });
    } else if (facts.wordCount < profile.targetWords.min) {
        issues.push({
            level: 'warning',
            code: 'word-count-low',
            message: legacy || level === 'submission'
                ? `总字数 ${facts.wordCount}，低于建议下限 ${profile.targetWords.min}`
                : `总字数 ${facts.wordCount}，低于建议下限 ${profile.targetWords.min}（草稿/成品档仅提示）`,
        });
    }

    if (facts.unitCount < profile.targetUnits.min) {
        issues.push({
            level: 'warning',
            code: 'unit-count-low',
            message: `共 ${facts.unitCount} ${unit}，低于建议下限 ${profile.targetUnits.min} ${unit}`,
        });
    }
    if (profile.requiresTitlesForEpub && facts.format === 'epub' && !facts.includeChapterTitles) {
        issues.push({
            level: 'warning',
            code: 'epub-no-titles',
            message: 'EPUB 未包含单元标题，阅读器目录可能不完整',
        });
    }
    if ((facts.duplicateTitleCount ?? 0) > 0) {
        issues.push({
            level: 'warning',
            code: 'duplicate-titles',
            message: `存在 ${facts.duplicateTitleCount} 组重复标题`,
        });
    }
    return issues;
}

/**
 * 组装出版检查文案。
 *
 * @param issues - 事项列表
 * @returns 文案；无事项时返回 null
 * @example
 * formatPublicationReport(checkPublicationReadiness(facts))
 */
export function formatPublicationReport(issues: PublicationIssue[]): string | null {
    if (issues.length === 0) return null;
    const blockers = issues.filter(issue => issue.level === 'blocker').map(issue => issue.message);
    const warnings = issues.filter(issue => issue.level === 'warning').map(issue => issue.message);
    const parts: string[] = [];
    if (blockers.length > 0) parts.push(`⛔ 出版阻断：${blockers.join('；')}`);
    if (warnings.length > 0) parts.push(`⚠️ 出版建议：${warnings.join('；')}`);
    return `📚 出版检查\n${parts.join('\n')}`;
}
