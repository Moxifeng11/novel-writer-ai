/**
 * platform-export.ts — 短篇/剧本平台投稿信息与敏感词预检
 *
 * 目标不是“替平台做审核”，而是导出前把平台真正需要的字段与明显风险
 * 摆到用户面前：平台名、标题、简介、标签、字数口径、单元数、敏感词命中。
 */
import type { PreResearchData } from './pre-research';

/** 平台导出配置。 */
export interface PlatformExportProfile {
    id: 'fanqie-short' | 'hongguo-script';
    name: string;
    /** 文件名前缀 */
    filenamePrefix: string;
    unitLabel: string;
    synopsisLabel: string;
    /** 平台常用标签（用户未填时的兜底） */
    defaultTags: string[];
}

/** 番茄短篇 / 红果短剧配置。 */
export const PLATFORM_EXPORT_PROFILES: Record<'short' | 'script', PlatformExportProfile> = {
    short: {
        id: 'fanqie-short',
        name: '番茄小说短篇',
        filenamePrefix: '番茄短篇',
        unitLabel: '节',
        synopsisLabel: '简介',
        defaultTags: ['短篇', '现代', '反转'],
    },
    script: {
        id: 'hongguo-script',
        name: '红果短剧',
        filenamePrefix: '红果短剧',
        unitLabel: '集',
        synopsisLabel: '故事简介',
        defaultTags: ['短剧', '都市', '强冲突'],
    },
};

/** 平台敏感词（只做提示，不自动改写）。 */
const SENSITIVE_TERMS: Array<{ term: string; category: string }> = [
    { term: '赌博', category: '涉赌' },
    { term: '毒品', category: '涉毒' },
    { term: '吸毒', category: '涉毒' },
    { term: '自杀', category: '自伤' },
    { term: '暴力', category: '暴力' },
    { term: '血腥', category: '暴力' },
    { term: '恐怖袭击', category: '暴力' },
    { term: '色情', category: '色情' },
    { term: '裸露', category: '色情' },
    { term: '政治立场', category: '政治' },
    { term: '宗教极端', category: '宗教' },
];

/** 一条敏感词命中。 */
export interface SensitiveHit {
    term: string;
    category: string;
    count: number;
}

/** 平台投稿包信息。 */
export interface PlatformPackageInfo {
    platform: PlatformExportProfile;
    title: string;
    synopsis: string;
    tags: string[];
    wordCount: number;
    unitCount: number;
    hits: SensitiveHit[];
    /** 导出的文本头（txt/markdown 用） */
    header: string;
}

function projectTitle(project: string): string {
    return String(project || '').split('/').filter(Boolean).pop() || project || '未命名';
}

function firstSubstantiveLine(text: string): string {
    for (const line of String(text || '').split('\n')) {
        const value = line.replace(/^#+\s*/, '').trim();
        if (value.length >= 8) return value;
    }
    return '';
}

function tagsOf(mode: 'short' | 'script', data: PreResearchData | null): string[] {
    if (!data) return [...PLATFORM_EXPORT_PROFILES[mode].defaultTags];
    if (data.mode === 'short') {
        return [data.primaryCategory, ...String(data.plotTags || '').split(/[，,、\s]+/)]
            .map(item => item.trim())
            .filter(Boolean)
            .slice(0, 8);
    }
    return [data.genre, ...String(data.audience || '').split(/[，,、\s]+/)]
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);
}

/**
 * 扫描平台敏感词。
 *
 * @param text - 待扫描文本
 * @returns 命中列表
 */
export function scanPlatformSensitive(text: string): SensitiveHit[] {
    const source = String(text || '');
    const hits: SensitiveHit[] = [];
    for (const item of SENSITIVE_TERMS) {
        let count = 0;
        let index = source.indexOf(item.term);
        while (index !== -1) {
            count += 1;
            index = source.indexOf(item.term, index + item.term.length);
        }
        if (count > 0) hits.push({ ...item, count });
    }
    return hits.sort((a, b) => b.count - a.count);
}

/**
 * 构造平台投稿包信息。
 *
 * @param options - 模式、项目、调研数据、正文与字数
 * @returns 平台包信息
 */
export function buildPlatformPackage(options: {
    mode: 'short' | 'script';
    project: string;
    preResearch: PreResearchData | null;
    storyDoc?: string;
    chapters: Array<{ content: string }>;
    wordCount: number;
}): PlatformPackageInfo {
    const { mode, project, preResearch, chapters, wordCount } = options;
    const platform = PLATFORM_EXPORT_PROFILES[mode];
    const title = projectTitle(project);
    const synopsis = preResearch?.mode === 'short'
        ? [preResearch.premise, preResearch.coreConflict].filter(Boolean).join('；')
        : preResearch?.mode === 'script'
            ? [preResearch.logline, preResearch.hook3s].filter(Boolean).join('；')
            : firstSubstantiveLine(options.storyDoc || '');
    const tags = tagsOf(mode, preResearch);
    const allText = chapters.map(chapter => chapter.content).join('\n');
    const hits = scanPlatformSensitive(`${synopsis}\n${allText}`);
    const header = [
        '【平台投稿信息】',
        `平台：${platform.name}`,
        `标题：${title}`,
        `${platform.synopsisLabel}：${synopsis || '（未填写前期调研，建议补一句故事简介）'}`,
        `标签：${(tags.length > 0 ? tags : platform.defaultTags).join('、')}`,
        `字数：${wordCount} 字`,
        `单元：${chapters.length} ${platform.unitLabel}`,
        hits.length > 0
            ? `风险提示：${hits.map(hit => `${hit.term}×${hit.count}（${hit.category}）`).join('、')}`
            : '风险提示：未命中内置敏感词',
        '---',
        '',
    ].join('\n');
    return {
        platform,
        title,
        synopsis,
        tags: tags.length > 0 ? tags : [...platform.defaultTags],
        wordCount,
        unitCount: chapters.length,
        hits,
        header,
    };
}
