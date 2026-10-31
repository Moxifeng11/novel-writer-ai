import { App, TFile, TFolder } from 'obsidian';
import { ChapterFrontmatter } from '../shared/types';
import { pjBodyDir } from '../shared/paths';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import { createLogger } from '../shared/logger';


const log = createLogger('ChapterUtils');
export const CHAPTER_FILE_TYPES = {
    body: '正文',
    outline: '大纲摘要',
    infoPlan: '信息规划',
    analysisReport: '分析报告',
    settlement: '结算表',
    continuityReview: '连贯性审查',
    selfCheck: '自检报告',
    fix: '修正记录',
    finalFix: '最终修正',
    plotDistill: '情节蒸馏',
    qualityControl: '质量控制',
    emotionPlan: '情绪规划',       // V2
    sceneExpand: 'Scene展开',     // V2
    characterSoul: '角色灵魂',    // V2
} as const;

/**
 * 构造标准章节文件名（写/创建操作）
 * 格式: 第X章_类型.md 或 第X章_标题_类型.md
 */
export function getChapterFileName(chapterName: string, type: string): string {
    return `${chapterName}_${type}.md`;
}

/**
 * 判断文件名是否符合标准格式
 * 标准格式: 第X章_类型.md 或 第X章_标题_类型.md
 */
export function isStandardChapterFileName(fileName: string, chapterName: string, type: string): boolean {
    // 精确匹配: 第1章_正文.md
    if (fileName === `${chapterName}_${type}.md`) return true;
    // 带标题匹配: 第1章_棋手落子_正文.md
    const pattern = new RegExp(`^${chapterName}_.+?_${type}\\.md$`);
    if (pattern.test(fileName)) return true;
    return false;
}

/**
 * 检测旧格式（非标准）的章节文件
 * 旧格式特征: 以下划线开头、无章节前缀等
 */
export function detectLegacyFiles(folder: TFolder, chapterName: string): TFile[] {
    const legacy: TFile[] = [];
    const allTypes = Object.values(CHAPTER_FILE_TYPES) as unknown as string[];
    for (const child of folder.children) {
        if (!(child instanceof TFile) || !child.name.endsWith('.md')) continue;
        // 如果已经是标准格式，跳过
        let isStandard = false;
        for (const type of allTypes) {
            if (isStandardChapterFileName(child.name, chapterName, type)) {
                isStandard = true;
                break;
            }
        }
        if (!isStandard) {
            legacy.push(child);
        }
    }
    return legacy;
}

/**
 * 尝试将旧格式文件识别并迁移为标准格式
 * @returns 迁移后的新文件，无法识别则返回 null
 */
export async function migrateLegacyFile(
    app: App,
    file: TFile,
    chapterName: string,
    typeHint?: string
): Promise<TFile | null> {
    const allTypes = Object.values(CHAPTER_FILE_TYPES) as unknown as string[];
    const fs = new ObsidianFileSystem(app);
    const vaultMeta = new ObsidianVaultMeta(app);
    let detectedType: string | null = typeHint || null;

    // 从文件名内容推断类型
    if (!detectedType) {
        for (const type of allTypes) {
            if (file.name.includes(type)) {
                detectedType = type;
                break;
            }
        }
    }

    // 如果文件名完全无法推断，尝试读取 frontmatter
    if (!detectedType) {
        try {
            const content = await fs.read(file.path);
            const fm = content.match(/^---\n[\s\S]*?\n---/);
            if (fm) {
                const tagsMatch = fm[0].match(/tags:\s*\n((?:\s+-\s*.*\n?)+)/);
                if (tagsMatch) {
                    const tags = tagsMatch[1].split('\n').map(t => t.trim().replace(/^-\s*/, '')).filter(Boolean);
                    for (const tag of tags) {
                        const cleanTag = tag.replace(/[\[\]"']/g, '');
                        if (allTypes.includes(cleanTag)) {
                            detectedType = cleanTag;
                            break;
                        }
                    }
                }
            }
            // 从内容关键词推断（字数不再作为正文判断依据——大纲等信息规划文件也可能很长）
            if (!detectedType) {
                if (content.includes('核心冲突') || content.includes('关键场景')) detectedType = '大纲摘要';
                else if (content.includes('status: 已完稿') || content.includes('status: written') || content.includes('status: settled')) detectedType = '正文';
                else if (content.includes('字数')) detectedType = '正文';
                else if (content.includes('信息规划') || content.includes('章节编号')) detectedType = '信息规划';
                else if (content.includes('UPDATE_') || content.includes('NEW_')) detectedType = '分析报告';
                else if (content.includes('结算表') || content.includes('更新状态')) detectedType = '结算表';
                else if (content.includes('连贯性') || content.includes('互信息断裂')) detectedType = '连贯性审查';
            }
        } catch { log.warn('[chapter-utils] 章节类型检测失败:', file?.path); }
    }

    if (!detectedType) return null;

    // 检查 frontmatter 中是否有标题字段
    let title = '';
    try {
        const content = await fs.read(file.path);
        const fm = content.match(/^---\n[\s\S]*?\n---/);
        if (fm) {
            const titleMatch = fm[0].match(/标题:\s*(.+)/);
            if (titleMatch) title = titleMatch[1].trim();
        }
        // 从旧文件名提取标题（如 _棋手落子_正文.md）
        if (!title) {
            const legacyTitleMatch = file.name.match(/^[\s_]*(.+?)_(正文|大纲摘要|信息规划|分析报告|结算表|连贯性审查)\.md$/);
            if (legacyTitleMatch) {
                const extracted = legacyTitleMatch[1].trim();
                if (extracted && !extracted.match(/^第\d+章$/)) {
                    title = extracted;
                }
            }
        }
    } catch { /* ignore */ }

    const newName = title
        ? getChapterFileName(chapterName, `${title.slice(0, 15)}_${detectedType}`)
        : getChapterFileName(chapterName, detectedType);
    const newPath = file.path.replace(/\/[^/]+$/, '/' + newName);

    // 如果目标已存在：正文不覆盖（内容太敏感），其他类型保留更丰富的
    const existing = vaultMeta.getAbstractFileByPath(newPath);
    if (existing instanceof TFile) {
        if (detectedType !== '正文') {
            try {
                const oldContent = await fs.read(file.path);
                const newContent = await fs.read(newPath);
                const oldBody = oldContent.replace(/^---[\s\S]*?---/, '').trim();
                const newBody = newContent.replace(/^---[\s\S]*?---/, '').trim();
                if (oldBody.length > newBody.length) {
                    await fs.write(newPath, oldContent);
                }
            } catch { log.warn('[chapter-utils] 章节类型检测失败:', file?.path); }
        }
        // 删除旧文件
        try { await fs.delete(file.path); } catch { /* ignore */ }
        return existing;
    }

    try {
        await fs.rename(file.path, newPath);
        const migrated = vaultMeta.getFiles().find(f => f.path === newPath);
        return migrated || null;
    } catch (e) {
        log.warn('[小说工坊] 迁移旧格式文件失败:', file.path, e);
        return null;
    }
}

/**
 * 规范化章节文件夹内的所有文件
 * 将旧格式文件统一迁移为标准格式
 */
export async function normalizeChapterFiles(app: App, folder: TFolder, chapterName: string): Promise<void> {
    const legacyFiles = detectLegacyFiles(folder, chapterName);
    if (legacyFiles.length === 0) return;

    for (const file of legacyFiles) {
        await migrateLegacyFile(app, file, chapterName);
    }
}

/**
 * 异步版本：先规范化再查找标准格式
 */
export async function getChapterFileAsync(app: App, folder: TFolder, type: string): Promise<TFile | null> {
    const chapterName = folder.name;
    await normalizeChapterFiles(app, folder, chapterName);
    return getChapterFile(folder, type);
}

/**
 * 在 TFolder 内查找章节文件（读操作）
 * 只匹配标准格式：第X章_类型.md 或 第X章_标题_类型.md
 * 不兼容旧格式——调用前必须先 normalizeChapterFiles()
 */
export function getChapterFile(folder: TFolder, type: string): TFile | null {
    const chapterName = folder.name;
    for (const child of folder.children) {
        if (child instanceof TFile && child.name.endsWith('.md')) {
            if (isStandardChapterFileName(child.name, chapterName, type)) {
                return child;
            }
        }
    }
    return null;
}

/**
 * 列出某卷已建骨架的章节号（并集：步骤结果目录 + 正文文件）。
 *
 * Rev 184：旧版章节生成工具原先只把「已有正文」当候选章，导致尚未写正文的新章
 * 永远无法被选中（输入范围后仍得到 0 目标）。章范围必须以骨架为准，
 * 骨架由「批量建章」创建。
 */
export function listChapterNumbers(app: App, project: string, volN: number): number[] {
    const nums = new Set<number>();
    const stepVolDir = `${project}/03-大纲与章节/步骤结果/第${volN}卷`;
    const stepVol = app.vault.getAbstractFileByPath(stepVolDir);
    if (stepVol instanceof TFolder) {
        for (const child of stepVol.children) {
            const m = child.name.match(/^第(\d+)章/);
            if (m) nums.add(parseInt(m[1], 10));
        }
    }
    const bodyDir = pjBodyDir(project, volN) + '/';
    for (const f of app.vault.getFiles()) {
        if (!f.path.startsWith(bodyDir)) continue;
        const m = f.name.match(/^第(\d+)章.*_正文\.md$/);
        if (m) nums.add(parseInt(m[1], 10));
    }
    return Array.from(nums).sort((a, b) => a - b);
}

/**
 * 在「卷正文目录」里按章号定位正文文件。
 *
 * 与 findChapterFile 的区别：后者的 chapDir 语义是「章目录」（最后一段是章名），
 * 传卷目录时标准名匹配必然失败，frontmatter 兜底会返回该卷第一个正文——
 * 实测会把新章写进旧章文件（数据损坏）。卷目录请用本函数：按 `第N章` 前缀匹配。
 */
export function findBodyFileByChapterNum(files: TFile[], bodyDir: string, chapterNum: number, chapterName?: string): TFile | undefined {
    const prefix = `第${chapterNum}章`;
    const bare = `第${chapterNum}章_正文.md`;
    // 同章可能同时存在「带章名」与「历史无章名」两个文件（旧版落盘缺陷的遗留物）。
    // 命中优先级：带章名 > 裸文件名。注意 chapterName 恰为「第N章」时，
    // `${chapterName}_正文.md` 就是裸文件名——不能当作更高优先级的精确匹配，
    // 否则幂等守卫会读到遗留文件的 settled，把整章结算永远跳过。
    const candidates = files.filter(f => f.path.startsWith(bodyDir)
        && f.name.endsWith('.md')
        && f.name.startsWith(prefix));
    if (candidates.length === 0) return undefined;
    if (chapterName && chapterName !== `第${chapterNum}章`) {
        const exact = candidates.find(f => f.name === `${chapterName}_正文.md`);
        if (exact) return exact;
    }
    return candidates.find(f => f.name !== bare) ?? candidates[0];
}

/**
 * 在文件列表中跨目录查找章节文件（读操作）
 * 只匹配标准格式：第X章_类型.md 或 第X章_标题_类型.md
 * 不兼容旧格式——调用前必须先 normalizeChapterFiles()
 */
export function findChapterFile(files: TFile[], chapDir: string, type: string, app?: App): TFile | undefined {
    const chapterName = chapDir.split('/').pop() || '';
    const found = files.find(f =>
        f.path.startsWith(chapDir)
        && f.name.endsWith('.md')
        && isStandardChapterFileName(f.name, chapterName, type)
    );
    if (found) return found;

    // v3.4.9 P1-5: 文件名不匹配时（用户重命名后），用 frontmatter 回退识别
    // 仅对「正文」类型启用——其他类型（大纲/修正等）重命名风险低
    if (app && type === '正文') {
        const chapFiles = files.filter(f =>
            f.path.startsWith(chapDir) && f.name.endsWith('.md')
        );
        for (const f of chapFiles) {
            try {
                const cache = app.metadataCache.getFileCache(f);
                const tags = cache?.frontmatter?.['tags'];
                const hasBodyTag = Array.isArray(tags) ? tags.includes('正文') : String(tags || '').includes('正文');
                const hasStatus = !!cache?.frontmatter?.['status'];
                if (hasBodyTag || hasStatus) {
                    log.info(`[findChapterFile] frontmatter 回退找到正文: ${f.path} (tags=${String(tags)}, status=${String(cache?.frontmatter?.['status'] || '')})`);
                    return f;
                }
            } catch { /* skip unreadable files */ }
        }
    }
    return undefined;
}

/**
 * 检查章节文件夹是否存在且包含至少一个类型文件
 */
export function chapterHasAnyFile(folder: TFolder): boolean {
    for (const child of folder.children) {
        if (child instanceof TFile && child.name.endsWith('.md')) return true;
    }
    return false;
}

// ============================================================
// v4.0: 新目录结构支持
// ============================================================

/**
 * v4.0: 按卷号+章号查找正文文件
 * 路径格式: {project}/03-大纲与章节/正文/第{volN}卷/第{chapNum}章_*_正文.md
 */
export function findBodyFileV4(app: App, project: string, volN: number, chapNum: number): TFile | undefined {
    const bodyDir = pjBodyDir(project, volN);
    const prefix = `第${chapNum}章`;
    const vaultMeta = new ObsidianVaultMeta(app);
    return vaultMeta.getFiles().find(f =>
        f.path.startsWith(bodyDir)
        && f.name.startsWith(prefix)
        && f.name.endsWith('_正文.md')
    );
}

/** 正文文件类型（不与步骤文件混在一处） */
export const BODY_FILE_TYPES = ['body'] as const;

/** 步骤文件类型（存放在 步骤结果/ 目录下） */
export const STEP_FILE_TYPES = {
    infoPlan: '信息规划',
    plotDistill: '情节蒸馏',
    outline: '大纲摘要',
    analysisReport: '分析报告',
    settlement: '结算表',
    continuityReview: '连贯性审查',
    selfCheck: '自检报告',
    fix: '修正记录',
    finalFix: '最终修正',
    qualityControl: '质量控制',
    emotionPlan: '情绪规划',
    sceneExpand: 'Scene展开',
    characterSoul: '角色灵魂',
} as const;

/** 判断某类型是否为正文（非步骤文件） */
export function isBodyType(type: string): boolean {
    return type === '正文' || type === 'body';
}

/** 判断某类型是否为步骤文件 */
export function isStepType(type: string): boolean {
    return (Object.values(STEP_FILE_TYPES) as string[]).includes(type);
}

/**
 * v4.0: 构造步骤文件名（匹配元文件命名：第X章_类型.md）
 */
export function getStepFileName(chapterName: string, stepType: string): string {
    return `${chapterName}_${stepType}.md`;
}


/**
 * 提取章节标题：通过 metadataCache 读取正文文件 frontmatter 中的 标题: 字段（零 I/O）
 * @param app Obsidian App 实例
 * @param file 正文 TFile
 * @returns 章节标题字符串，未找到则返回空串
 */
export function readTitle(app: App, file: TFile): string {
    const cache = app.metadataCache.getFileCache(file);
    const title = cache?.frontmatter?.['标题'];
    if (typeof title === 'string' && title.trim()) return title.trim();
    // 回退：从文件名提取标题
    const nameMatch = file.name.match(/第\d+章_+(.+?)_正文\.md$/);
    if (nameMatch) return nameMatch[1].trim();
    return '';
}
