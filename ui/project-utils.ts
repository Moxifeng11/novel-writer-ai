/**
 * project-utils.ts — 项目/章节查询工具函数 (v3.4.9 提取自 full-writer-view.ts)
 *
 * 提取:
 *   - sortChaptersByNumber (L1702)
 *   - getNextChapter (L1711)
 *   - getProjectCover (L1538)
 */

import { App, TFile, Notice } from 'obsidian';
import { readTitle, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { ensureWritingStyleFolder, findWritingStyleFile, getWritingStyleWritePath } from './writing-style-paths';
import { readProjectMeta } from '../shared/paths';
import { readMergedVolumeOutline, extractVolumeFromPath } from '../utils/helpers';
import { RE_VOLUME_RANGE, FIELD_TOTAL_WORDS, FIELD_TOTAL_CHAPTERS } from '../shared/format-constants';

/** 按章号数字排序 */
export function sortChaptersByNumber<T extends { chapter: string }>(chapters: T[]): T[] {
    return chapters.sort((a, b) => {
        const numA = parseInt(a.chapter.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.chapter.match(/\d+/)?.[0] || '0');
        return numA - numB;
    });
}

/** 获取下一章待写章节 */
export function getNextChapter<T extends { chapter: string; status: string }>(
    sortedChapters: T[],
): T | null {
    const next = sortedChapters.find(c => c.status !== '已完稿' && c.status !== 'written' && c.status !== 'settled');
    return next || (sortedChapters.length > 0 ? sortedChapters[sortedChapters.length - 1] : null);
}

/** 获取项目封面资源路径 */
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

/** 更新项目的文笔风格模板——从最新模板合并缺失的"零、参考样本"章节 */
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
 * 最后校验目录确已消失，否则抛出明确错误，杜绝「假删除」。 */
export async function deleteProject(app: App, projectName: string): Promise<void> {
    const adapter = app.vault.adapter;
    const removeDir = async (dirPath: string) => {
        const list = await adapter.list(dirPath);
        for (const f of list.files) await adapter.remove(f);
        for (const d of list.folders) await removeDir(d);
        await adapter.rmdir(dirPath, true);
    };
    await removeDir(projectName);
    if (await adapter.exists(projectName)) {
        throw new Error(`项目「${projectName}」删除后仍存在，可能有文件被占用或权限不足`);
    }
    new Notice(`✅ 项目「${projectName}」已删除`);
}

/** 获取项目所有章节列表（含标题、状态、卷信息） */
export function getChaptersForProject(app: App, project: string): Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }> {
    const result: Array<{ chapter: string; volume: string; title: string; status: string; file: TFile }> = [];
    const seenChapters = new Set<string>();

    const candidateFiles = app.vault.getFiles().filter(file =>
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
            console.warn('[project-utils] getChaptersForProject:', e);
        }
        return { chapMatch: chapMatch[1], volName, title, status, file };
    });

    for (const d of chaptersData) {
        if (d && !seenChapters.has(d.chapMatch)) {
            seenChapters.add(d.chapMatch);
            result.push({
                chapter: d.chapMatch,
                volume: d.volName || '',
                title: d.title,
                status: d.status,
                file: d.file,
            });
        }
    }
    return result;
}

/** 读取项目元信息（题材/描述 来自 .project；字数/章节/分卷 来自合并分卷大纲） */
export async function getProjectMeta(app: App, project: string): Promise<{ genre: string; description: string; volumes: Array<{ name: string; range: string }>; totalWordsTarget: string; totalChapters: number }> {
    const result: { genre: string; description: string; volumes: Array<{ name: string; range: string }>; totalWordsTarget: string; totalChapters: number } = { genre: '', description: '', volumes: [], totalWordsTarget: '', totalChapters: 0 };
    const dotContent = await readProjectMeta(app, project);
    if (dotContent) {
        const genreMatch = dotContent.match(/##\s*题材\s*\n(.+)/);
        if (genreMatch) result.genre = genreMatch[1].trim();
        const descMatch = dotContent.match(/##\s*描述\s*\n([\s\S]+?)(?=\n##|$)/);
        if (descMatch) result.description = descMatch[1].trim();
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
