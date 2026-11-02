/**
 * project-utils.ts — 项目/章节查询工具函数 (v3.4.9 提取自 full-writer-view.ts)
 *
 * 提取:
 *   - sortChaptersByNumber (L1702)
 *   - getNextChapter (L1711)
 *   - getProjectCover (L1538)
 */

import { App, TFile, TFolder, Notice } from 'obsidian';
import { readTitle, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { ensureWritingStyleFolder, findWritingStyleFile, getWritingStyleWritePath } from './writing-style-paths';
import { readProjectMeta } from '../shared/paths';
import { readMergedVolumeOutline, extractVolumeFromPath } from '../utils/helpers';
import { RE_VOLUME_RANGE, FIELD_TOTAL_WORDS, FIELD_TOTAL_CHAPTERS } from '../shared/format-constants';
import { createLogger } from '../shared/logger';
import { CREATION_MODE_SPECS, getCreationModeLabel, parseCreationModeMeta, type CreationMode } from '../shared/creation-mode';
import { isChapterWritten } from '../shared/chapter-progress';
import { getStoryStructure } from '../shared/story-structure';
import { coverMediaTypeForExt, type BookCover } from '../engine/export/epub-builder';


const log = createLogger('ProjectUtils');
/**
 * 按章号数字排序
 *
 * @param chapters - 章节列表
 * @returns 结果数组
 */
export function sortChaptersByNumber<T extends { chapter: string }>(chapters: T[]): T[] {
    return chapters.sort((a, b) => {
        const numA = parseInt(a.chapter.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.chapter.match(/\d+/)?.[0] || '0');
        return numA - numB;
    });
}

/**
 * 获取下一章待写章节
 *
 * @param sortedChapters - 排序后的章节
  * @returns T 或 null
 */
export function getNextChapter<T extends { chapter: string; status: string }>(
    sortedChapters: T[],
): T | null {
    const next = sortedChapters.find(c => c.status !== '已完稿' && c.status !== 'written' && c.status !== 'settled');
    return next || (sortedChapters.length > 0 ? sortedChapters[sortedChapters.length - 1] : null);
}

/**
 * 获取项目封面资源路径
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
  * @returns 文本结果 或 null
 */
export function getProjectCover(app: App, project: string): string | null {
    const extensions = ['png', 'jpg', 'jpeg', 'webp'];
    for (const ext of extensions) {
        const path = `${project}/封面/cover.${ext}`;
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            return app.vault.getResourcePath(file);
        }
    }
    return null;
}

/**
 * 找到项目封面文件本体（getProjectCover 只给资源 URL，读二进制需要 TFile）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
  * @returns string } 结果 或 null
 */
export function findProjectCoverFile(app: App, project: string): { file: TFile; ext: string } | null {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
        const file = app.vault.getAbstractFileByPath(`${project}/封面/cover.${ext}`);
        if (file instanceof TFile) return { file, ext };
    }
    return null;
}

/**
 * 读取项目封面为 EPUB 封面数据；无封面或读取失败返回 undefined（导出降级为无封面）。
 * webp 不是 EPUB 核心媒体类型，但主流阅读器（Apple Books / Calibre / 微信读书）均已支持。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
  * @returns BookCover 或 undefined
 */
export async function loadProjectCover(app: App, project: string): Promise<BookCover | undefined> {
    const found = findProjectCoverFile(app, project);
    if (!found) return undefined;
    const mediaType = coverMediaTypeForExt(found.ext);
    if (!mediaType) return undefined;
    try {
        const buffer = await app.vault.readBinary(found.file);
        return { data: new Uint8Array(buffer), mediaType, fileExt: found.ext };
    } catch (e) {
        log.warn('[project-utils] 读取封面失败，EPUB 将不含封面:', e);
        return undefined;
    }
}

/**
 * 更新项目的文笔风格模板——从最新模板合并缺失的"零、参考样本"章节
 *
 * @param app - Obsidian 应用实例
 * @param projectName - 项目名
 */
export async function updateWritingStyleTemplate(app: App, projectName: string): Promise<void> {
    const wsPath = getWritingStyleWritePath(projectName);
    const templatePath = '元文件/00-系统模板/文笔风格模板.md';

    const wsFile = await findWritingStyleFile(app, projectName, { allowPlaceholder: true });
    if (!wsFile) {
        try {
            const tplContent = await app.vault.adapter.read(templatePath);
            await ensureWritingStyleFolder(app, projectName);
            await app.vault.create(wsPath, tplContent);
            new Notice(`✅ 已为「${projectName}」创建文笔风格模板`, 4000);
        } catch (e) {
            new Notice(`❌ 创建失败: ${(e as Error).message}`, 5000);
        }
        return;
    }

    const wsContent = await app.vault.read(wsFile as TFile);
    if (wsContent.includes('## 零、参考样本')) {
        new Notice('ℹ️ 文笔风格已包含参考样本，无需更新', 3000);
        return;
    }

    const tplContent = await app.vault.adapter.read(templatePath);
    const sampleMatch = tplContent.match(/## 零、参考样本[\s\S]*?(?=## 一、叙事视角)/);
    if (!sampleMatch) {
        new Notice('❌ 无法从模板中提取参考样本章节', 5000);
        return;
    }

    const insertMarker = '# 文笔风格';
    const markerIndex = wsContent.indexOf(insertMarker);
    if (markerIndex === -1) {
        new Notice('❌ 文笔风格文件格式异常，无法更新', 5000);
        return;
    }

    const afterMarker = markerIndex + insertMarker.length;
    let insertPos = wsContent.indexOf('\n', afterMarker);
    if (insertPos === -1) insertPos = afterMarker;

    const newContent = wsContent.slice(0, insertPos + 1) + '\n' + sampleMatch[0] + '\n\n' + wsContent.slice(insertPos + 1);
    await app.vault.modify(wsFile as TFile, newContent);
    new Notice(`✅ 已为「${projectName}」添加参考样本章节`, 4000);
}

/** 递归删除项目目录（不可逆）
 * v73: 修复「删除未真正生效」——.project 等点文件不入 vault 索引。
 * 旧实现遗留两个隐患：① 残留点文件时 rmdir 可能失败被静默吞掉；② 删除后无校验，UI 直接提示成功。
 * 现改为：逐项删除 adapter.list 返回的全部文件（含点文件），递归删子目录后删目录本身，
 * @param app - Obsidian 应用实例
 * @param projectName - 项目名
 * 最后校验目录确已消失，否则抛出明确错误，杜绝「假删除」。 */
export async function deleteProject(app: App, projectName: string): Promise<void> {
    // 防线：空串/根路径会让 adapter.list('') 列出 vault 根并递归删光整库
    const target = String(projectName || '').trim().replace(/^\/+|\/+$/g, '');
    if (!target || target === '.' || target === '..' || target.split('/').some(seg => seg === '..' || seg === '.')) {
        throw new Error(`拒绝删除非法项目路径：${JSON.stringify(projectName)}`);
    }
    const adapter = app.vault.adapter;
    const removeDir = async (dirPath: string) => {
        const list = await adapter.list(dirPath);
        for (const f of list.files) await adapter.remove(f);
        for (const d of list.folders) await removeDir(d);
        await adapter.rmdir(dirPath, true);
    };
    await removeDir(target);
    if (await adapter.exists(target)) {
        throw new Error(`项目「${target}」删除后仍存在，可能有文件被占用或权限不足`);
    }
    new Notice(`✅ 项目「${target}」已删除`);
}

/** 章节列表条目：正文 ∪ 步骤结果骨架 */
export interface ChapterListEntry {
    chapter: string;
    volume: string;
    title: string;
    status: string;
    /** 正文文件；仅有骨架目录时为 null */
    file: TFile | null;
    /** 是否存在正文文件（骨架占位文件也算存在） */
    hasBody: boolean;
    /** 是否已写（status=written/settled，或旧文件按体量判定）；骨架 false */
    written: boolean;
    /** 正文文件字节数；无文件时 0 */
    size: number;
}

/**
 * 章节列表构建的唯一实现：正文 ∪ 步骤结果骨架目录。
 * files/folders 由调用方提供（单项目传全集，批量扫描传按项目分桶后的子集），
 * 保证「单项目查询」与「多项目一次扫描」口径完全一致。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param files - 文件列表
 * @param folders - 文件夹列表
 * @returns 结果数组
 */
function buildChapterEntries(app: App, project: string, files: TFile[], folders: TFolder[]): ChapterListEntry[] {
    const result: ChapterListEntry[] = [];
    const seenChapters = new Set<string>();

    const candidateFiles = files.filter(file =>
        file.path.startsWith(project + '/03-大纲与章节/') &&
        file.name.includes(CHAPTER_FILE_TYPES.body) &&
        file.name.endsWith('.md')
    );

    const chaptersData = candidateFiles.map(file => {
        const chapMatch = file.path.match(/(第\d+章)/);
        // v4.0：正文位于 正文/第N卷/，用统一工具提取卷名
        const volName = extractVolumeFromPath(file.path);
        if (!chapMatch) return null;
        let title = '';
        let status = '';
        try {
            title = readTitle(app, file);
            const cache = app.metadataCache.getFileCache(file);
            status = (typeof cache?.frontmatter?.['status'] === 'string' ? cache.frontmatter['status'] : '').trim();
        } catch (e) {
            log.warn('[project-utils] getChaptersForProject:', e);
        }
        return { chapMatch: chapMatch[1], volName, title, status, file };
    });

    for (const d of chaptersData) {
        if (d && !seenChapters.has(d.chapMatch)) {
            seenChapters.add(d.chapMatch);
            const size = d.file.stat?.size ?? 0;
            result.push({
                chapter: d.chapMatch,
                volume: d.volName || '',
                title: d.title,
                status: d.status,
                file: d.file,
                hasBody: true,
                written: isChapterWritten(d.status, true, size),
                size,
            });
        }
    }

    // 骨架章节：只建了 步骤结果/第N卷/第M章 目录、尚未写正文的章
    // 去重键沿用章名（全书连续章号），正文优先于骨架。
    const escapedProject = project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const skeletonRe = new RegExp(`^${escapedProject}/03-大纲与章节/步骤结果/(第\\d+卷)/(第\\d+章)$`);
    for (const entry of folders) {
        const match = entry.path.match(skeletonRe);
        if (!match) continue;
        const chapter = match[2];
        if (seenChapters.has(chapter)) continue;
        seenChapters.add(chapter);
        result.push({
            chapter,
            volume: match[1],
            title: '',
            status: '',
            file: null,
            hasBody: false,
            written: false,
            size: 0,
        });
    }

    // 出口统一排序：调用方不再各自 sort（正文扫描序 + 骨架遍历序都不可靠）
    return sortChaptersByNumber(result);
}

/**
 * 获取项目所有章节列表（正文 ∪ 步骤结果骨架目录），含标题、状态、卷信息
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export function getChaptersForProject(app: App, project: string): ChapterListEntry[] {
    return buildChapterEntries(
        app,
        project,
        app.vault.getFiles(),
        app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder),
    );
}

/**
 * 一次扫描产出多个项目的章节列表（项目选择页批量渲染用）。
 *
 * 旧实现每个项目各调一次 getChaptersForProject，等于对全库文件/目录遍历 N 次；
 * 这里只遍历一次，按 `项目/03-大纲与章节/` 前缀分桶后交给同一个构建函数。
 * 仅影响"遍历轮次"，章节口径与 getChaptersForProject 逐项一致。
 * @param app - Obsidian 应用实例
 * @param projects - 项目列表
 * @returns 映射结果
 */
export function scanProjectChapters(app: App, projects: string[]): Map<string, ChapterListEntry[]> {
    const result = new Map<string, ChapterListEntry[]>();
    if (projects.length === 0) return result;

    const prefixes = projects.map(project => [`${project}/03-大纲与章节/`, project] as const);
    const buckets = new Map<string, { files: TFile[]; folders: TFolder[] }>();
    for (const project of projects) buckets.set(project, { files: [], folders: [] });

    const bucketOf = (path: string) => {
        const hit = prefixes.find(([prefix]) => path.startsWith(prefix));
        return hit ? buckets.get(hit[1]) : undefined;
    };

    for (const file of app.vault.getFiles()) {
        bucketOf(file.path)?.files.push(file);
    }
    for (const entry of app.vault.getAllLoadedFiles()) {
        if (!(entry instanceof TFolder)) continue;
        bucketOf(entry.path)?.folders.push(entry);
    }

    for (const project of projects) {
        const bucket = buckets.get(project)!;
        result.set(project, buildChapterEntries(app, project, bucket.files, bucket.folders));
    }
    return result;
}

/**
 * 读取项目元信息（题材/描述 来自 .project；字数/章节/分卷 来自合并分卷大纲）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
  * @returns string }> 结果
 */
export async function getProjectMeta(app: App, project: string): Promise<{ genre: string; description: string; volumes: Array<{ name: string; range: string }>; totalWordsTarget: string; totalChapters: number; creationMode: CreationMode; creationModeLabel: string; shortCategory: string; scriptGenre: string; modeTargetWords: number; modeTargetUnits: number; unitLabel: string; storyStructure: string; storyStructureName: string }> {
    const result: { genre: string; description: string; volumes: Array<{ name: string; range: string }>; totalWordsTarget: string; totalChapters: number; creationMode: CreationMode; creationModeLabel: string; shortCategory: string; scriptGenre: string; modeTargetWords: number; modeTargetUnits: number; unitLabel: string; storyStructure: string; storyStructureName: string } = { genre: '', description: '', volumes: [], totalWordsTarget: '', totalChapters: 0, creationMode: 'long', creationModeLabel: '长篇小说', shortCategory: '', scriptGenre: '', modeTargetWords: CREATION_MODE_SPECS.long.targetWords.default, modeTargetUnits: CREATION_MODE_SPECS.long.targetUnits.default, unitLabel: '章', storyStructure: '', storyStructureName: '' };
    const dotContent = await readProjectMeta(app, project);
    if (dotContent) {
        const genreMatch = dotContent.match(/##\s*题材\s*\n(.+)/);
        if (genreMatch) result.genre = genreMatch[1].trim();
        const descMatch = dotContent.match(/##\s*描述\s*\n([\s\S]+?)(?=\n##|$)/);
        if (descMatch) result.description = descMatch[1].trim();
        const mode = parseCreationModeMeta(dotContent);
        result.creationMode = mode.mode;
        result.creationModeLabel = getCreationModeLabel(mode.mode);
        result.shortCategory = mode.shortCategory;
        result.scriptGenre = mode.scriptGenre;
        result.modeTargetWords = mode.targetWords;
        result.modeTargetUnits = mode.targetUnits;
        result.unitLabel = CREATION_MODE_SPECS[mode.mode].unitLabel;
        result.storyStructure = mode.storyStructure || '';
        result.storyStructureName = mode.storySettings ? getStoryStructure(mode.storySettings.structureId).name : '';
    }
    const content = await readMergedVolumeOutline(app, project);
    if (content) {
        const wordsMatch = content.match(new RegExp(FIELD_TOTAL_WORDS + '[：:]\\s*(.+)'));
        if (wordsMatch) result.totalWordsTarget = wordsMatch[1].trim();
        const totalMatch = content.match(new RegExp(FIELD_TOTAL_CHAPTERS + '[：:]\\s*(.+)'));
        if (totalMatch) result.totalChapters = parseInt(totalMatch[1]) || 0;
        const volRegex = new RegExp(`###\\s*第(\\d+)卷[\\s\\S]*?` + RE_VOLUME_RANGE.source, 'g');
        let volMatch: RegExpExecArray | null;
        while ((volMatch = volRegex.exec(content)) !== null) {
            result.volumes.push({ name: `第${volMatch[1]}卷`, range: volMatch[2].trim() });
        }
    }
    return result;
}
