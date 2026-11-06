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

    if (!facts.title.trim()) {
        issues.push({ level: 'blocker', code: 'missing-title', message: '书名不能为空' });
    }
    const needAuthor = profile.requiresAuthor && (facts.format === 'epub' || facts.format === 'docx');
    if (needAuthor && !(facts.author || '').trim()) {
        issues.push({ level: 'blocker', code: 'missing-author', message: 'EPUB/DOCX 需要填写作者元数据' });
    }
    if (facts.writtenCount <= 0) {
        issues.push({ level: 'blocker', code: 'no-body', message: `没有可导出的正文${unit}` });
    }
    if (facts.emptyUnits.length > 0) {
        issues.push({
            level: 'blocker',
            code: 'empty-units',
            message: `存在 ${facts.emptyUnits.length} 个空正文${unit}（${facts.emptyUnits.slice(0, 5).join('、')}）`,
        });
    }

    const halfMin = Math.floor(profile.targetWords.min / 2);
    if (facts.wordCount < halfMin) {
        issues.push({
            level: 'blocker',
            code: 'word-count-too-low',
            message: `总字数 ${facts.wordCount}，低于出版下限 ${profile.targetWords.min} 的一半`,
        });
    } else if (facts.wordCount < profile.targetWords.min) {
        issues.push({
            level: 'warning',
            code: 'word-count-low',
            message: `总字数 ${facts.wordCount}，低于建议下限 ${profile.targetWords.min}`,
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
