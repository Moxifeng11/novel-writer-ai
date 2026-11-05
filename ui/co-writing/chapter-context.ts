/**
 * chapter-context.ts — 协同写作视图的章节上下文工具
 *
 * 从 `ui/co-writing-view.ts` 抽出：正文/步骤结果路径构建、章节标题提取、
 * 章节身份比对与 vault 目录确保。纯函数不依赖视图实例，便于单元测试。
 */
import { SUBDIR_BODY_ROOT, SUBDIR_STEP_ROOT } from '@/shared/paths';

/** 章节身份：项目 + 卷 + 章号 */
export interface ChapterIdentity {
    project: string;
    volume: string;
    chapterNum: number;
}

/** vault 目录操作端口（避免模块直接依赖 App/Vault 类型）。 */
export interface VaultFolderPort {
    getAbstractFileByPath(path: string): unknown;
    createFolder(path: string): Promise<unknown>;
}

/**
 * 构建正文目录路径。
 *
 * @param project - 项目路径
 * @param volume - 卷名
 * @returns 正文目录
 * @example
 * ```ts
 * buildBodyDir('我的项目', '第1卷');
 * ```
 */
export function buildBodyDir(project: string, volume: string): string {
    return `${project}/${SUBDIR_BODY_ROOT}/${volume}`;
}

/**
 * 构建步骤结果目录候选列表（步骤结果目录 + 卷根目录）。
 *
 * @param project - 项目路径
 * @param volume - 卷名
 * @param chapterNum - 章号
 * @returns 目录数组
 * @example
 * ```ts
 * buildStepResultDirs('我的项目', '第1卷', 3);
 * ```
 */
export function buildStepResultDirs(project: string, volume: string, chapterNum: number): string[] {
    // v4.5.1 fix: 步骤结果目录也用 "第N章" 前缀，与 checkChaptersComplete 正则一致
    const chapterPrefix = `第${chapterNum}章`;
    return [
        `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapterPrefix}`,
        `${project}/03-大纲与章节/${volume}/${chapterPrefix}`
    ];
}

/**
 * 构建单个步骤结果文件路径。
 *
 * @param project - 项目路径
 * @param volume - 卷名
 * @param chapterNum - 章号
 * @param stepType - 步骤类型（如「信息规划」）
 * @returns 文件路径
 * @example
 * ```ts
 * buildStepFilePath('我的项目', '第1卷', 1, '信息规划');
 * ```
 */
export function buildStepFilePath(
    project: string,
    volume: string,
    chapterNum: number,
    stepType: string,
): string {
    // 与 pjStepFile 规范一致：目录和文件名都要带「第N章」前缀。
    // 之前文件名漏了前缀（.../第1章/信息规划.md），而磁盘上永远是 .../第1章/第1章_信息规划.md，
    // 导致 getChapterTitle 恒为空、保存后 H1 丢标题。
    const chapterPrefix = `第${chapterNum}章`;
    const stepDir = `${project}/${SUBDIR_STEP_ROOT}/${volume}/${chapterPrefix}`;
    return `${stepDir}/${chapterPrefix}_${stepType}.md`;
}

/**
 * 去掉 markdown 文件头部的 YAML frontmatter。
 *
 * @param content - 原始内容
 * @returns 去头内容
 * @example
 * ```ts
 * stripFrontmatter('---\ntags: []\n---\n## 章名\n风起');
 * ```
 */
export function stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?---\s*/, '');
}

/**
 * 从「信息规划」正文提取章名。
 *
 * @param content - 文件内容
 * @returns 章名，未命中返回空串
 * @example
 * ```ts
 * extractChapterTitleFromInfoPlan('## 章名\n风起');
 * ```
 */
export function extractChapterTitleFromInfoPlan(content: string): string {
    const body = stripFrontmatter(content);
    const chapterNameMatch = body.match(/##\s*章名\s*\n+([^\n#]+)/i);
    if (chapterNameMatch && chapterNameMatch[1].trim()) {
        return chapterNameMatch[1].trim();
    }
    // 步骤生成器实际写的是「**章名**：九脉逆行」，不匹配上面的 ## 标题格式，
    // 结果保存时 H1 丢标题（只剩「# 第1章」）。
    const boldChapterName = body.match(/^\*\*章名\*\*\s*[：:]\s*(.+)$/m);
    if (boldChapterName && boldChapterName[1].trim()) {
        return boldChapterName[1].trim();
    }
    return '';
}

/**
 * 从「大纲摘要」首行提取章名。
 *
 * @param content - 文件内容
 * @returns 章名，未命中返回空串
 * @example
 * ```ts
 * extractChapterTitleFromOutline('# 《风起》');
 * ```
 */
export function extractChapterTitleFromOutline(content: string): string {
    const body = stripFrontmatter(content);
    const firstLine = body.split('\n')[0] || '';
    const titleMatch1 = firstLine.match(/^#\s*《([^》]+)》/);
    if (titleMatch1 && titleMatch1[1].trim()) {
        return titleMatch1[1].trim();
    }
    const titleMatch2 = firstLine.match(/^#\s*第\d+章\s+(.+?)\s*(大纲摘要|大纲|章节大纲)?\s*$/);
    if (titleMatch2 && titleMatch2[1].trim()) {
        return titleMatch2[1].trim();
    }
    return '';
}

/**
 * 按优先级合并「信息规划」与「大纲摘要」的章名。
 *
 * @param infoPlan - 信息规划内容（null = 文件不存在）
 * @param outline - 大纲摘要内容（null = 文件不存在）
 * @returns 章名，全部未命中返回空串
 * @example
 * ```ts
 * resolveChapterTitle(infoPlanContent, outlineContent);
 * ```
 */
export function resolveChapterTitle(infoPlan: string | null, outline: string | null): string {
    if (infoPlan) {
        const title = extractChapterTitleFromInfoPlan(infoPlan);
        if (title) return title;
    }
    if (outline) {
        const title = extractChapterTitleFromOutline(outline);
        if (title) return title;
    }
    return '';
}

/** 快照/当前章节的最小身份信息（不含卷名）。 */
export interface ChapterSnapshotIdentity {
    project: string;
    chapterNum: number;
    bodyPath: string;
}

/**
 * 判断快照章节与当前章节是否同一身份。
 *
 * @param a - 快照身份
 * @param b - 当前身份
 * @returns 是否同一章
 * @example
 * ```ts
 * isSameChapterIdentity(snapshot, { project, chapterNum: 3, bodyPath });
 * ```
 */
export function isSameChapterIdentity(
    a: ChapterSnapshotIdentity,
    b: ChapterSnapshotIdentity,
): boolean {
    return a.project === b.project
        && a.chapterNum === b.chapterNum
        && a.bodyPath === b.bodyPath;
}

/**
 * 确保 vault 目录逐级存在。
 *
 * @param vault - vault 目录端口
 * @param dirPath - 目录路径
 * @example
 * ```ts
 * await ensureVaultFolder(app.vault, '项目/03-大纲与章节/正文/第1卷');
 * ```
 */
export async function ensureVaultFolder(vault: VaultFolderPort, dirPath: string): Promise<void> {
    if (!dirPath) {
        return;
    }
    const parts = dirPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!vault.getAbstractFileByPath(current)) {
            await vault.createFolder(current);
        }
    }
}

/** 章节位置：章号 + 卷名（不含项目）。 */
export interface ChapterLocation {
    chapterNum: number;
    volume: string;
}

/**
 * 推定章节位置：缺参时按章名解析章号，再按章号反查正文实际所在卷。
 *
 * 只传项目与章名时旧默认值是「第1卷/第1章」，会把第 3 卷第 12 章绑定成第 1 卷第 1 章，
 * 保存直接写错文件。优先级：显式章号 > 章名解析 > 1；显式卷名 > 反查卷 > 第1卷。
 *
 * @param chapterName - 章节名，形如「第12章 夜袭」
 * @param volume - 显式卷名（优先级最高）
 * @param chapterNum - 显式章号（优先于章名解析）
 * @param resolveVolume - 按章号反查正文实际所在卷；返回 null/undefined 表示查不到
 * @returns 章号与卷名
 * @example
 * ```ts
 * resolveChapterLocation('第12章 夜袭', undefined, undefined, () => '第3卷');
 * // => { chapterNum: 12, volume: '第3卷' }
 * ```
 */
export function resolveChapterLocation(
    chapterName: string,
    volume?: string,
    chapterNum?: number,
    resolveVolume?: (chapterNum: number) => string | null | undefined,
): ChapterLocation {
    const parsed = parseInt(chapterName.match(/第(\d+)章/)?.[1] || '', 10) || 1;
    const resolvedChapterNum = chapterNum && chapterNum > 0 ? chapterNum : parsed;
    const resolvedVolume = volume || resolveVolume?.(resolvedChapterNum) || '第1卷';
    return { chapterNum: resolvedChapterNum, volume: resolvedVolume };
}

/**
 * 去掉正文文件的章节标题行与「正文区域」标记，只留正文（frontmatter 复用 stripFrontmatter）。
 *
 * @param raw - 磁盘上的完整正文
 * @returns 仅正文（含原始换行）
 * @example
 * ```ts
 * stripChapterBody('---\ntitle: x\n---\n# 第1章 起\n<!-- 正文区域 -->\n正文');
 * // => '正文'
 * ```
 */
export function stripChapterBody(raw: string): string {
    return stripFrontmatter(raw)
        .replace(/^#\s+第\d+章[^\n]*\n+/, '')
        .replace(/<!--\s*正文区域.*?-->\s*/g, '');
}
