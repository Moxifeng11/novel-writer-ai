/**
 * chapter-version-service.ts — 章节/大纲/设定版本管理服务
 *
 * 提供版本保存、查询、对比、回滚等核心功能
 * 版本存储在项目目录下的 _versions/ 文件夹中
 */
import { App, TFile, Notice } from 'obsidian';
import type {
    VersionMeta,
    VersionIndex,
    VersionType,
    ContentType,
    RollbackRecord,
    DiffStats,
} from '../shared/version-types';
import {
    pjContentVersionsDir,
    pjVersionIndexFile,
    pjVersionContentFile,
    pjRollbackHistoryFile,
    pjVersionsDir,
} from '../shared/paths';
import {
    lineDiff,
    charDiff,
    computeDiffStats,
    countWords,
    generateVersionId,
} from '../shared/diff-utils';
import { withWriteLock } from '../shared/write-lock';

export interface SaveVersionOptions {
    /** 版本类型 */
    type: VersionType;
    /** 版本标签（可选） */
    tags?: string[];
    /** 版本备注（可选） */
    note?: string;
}

export class ChapterVersionService {
    constructor(private app: App) {}

    // ============================================================
    // 1. 保存版本
    // ============================================================

    /**
     * 保存内容的一个新版本
     * @param project 项目名
     * @param contentType 内容类型
     * @param contentKey 内容标识（章节名/大纲名等）
     * @param sourcePath 源文件路径
     * @param content 当前内容
     * @param options 保存选项
     * @returns 保存的版本元数据
     */
    async saveVersion(
        project: string,
        contentType: ContentType,
        contentKey: string,
        sourcePath: string,
        content: string,
        options: SaveVersionOptions,
    ): Promise<VersionMeta> {
        // 索引是「读—改—写」：并发保存会各自读到 latestVersion=N 都写 N+1，丢版本条目。
        // 锁键用索引文件路径，保证同一 contentKey 的保存/删除串行。
        const indexPath = pjVersionIndexFile(project, contentType, contentKey);
        return withWriteLock(indexPath, () => this.saveVersionUnlocked(project, contentType, contentKey, sourcePath, content, options));
    }

    private async saveVersionUnlocked(
        project: string,
        contentType: ContentType,
        contentKey: string,
        sourcePath: string,
        content: string,
        options: SaveVersionOptions,
    ): Promise<VersionMeta> {
        const versionId = generateVersionId();
        const now = new Date().toISOString();
        const wordCount = countWords(content);
        const lineCount = content.split('\n').length;

        const index = await this.getVersionIndex(project, contentType, contentKey, sourcePath);
        const latestVersion = index.versions.length > 0 ? index.versions[0] : null;
        const versionNum = index.latestVersion + 1;
        const wordCountDelta = latestVersion ? wordCount - latestVersion.wordCount : wordCount;

        const versionPath = pjVersionContentFile(project, contentType, contentKey, versionId);

        const meta: VersionMeta = {
            id: versionId,
            version: versionNum,
            createdAt: now,
            type: options.type,
            contentType,
            wordCount,
            wordCountDelta,
            lineCount,
            tags: options.tags || [],
            note: options.note || '',
            project,
            contentKey,
            sourcePath,
            versionPath,
        };

        await this.ensureDir(pjContentVersionsDir(project, contentType, contentKey));
        await this.writeFile(versionPath, content);

        index.latestVersion = versionNum;
        index.versions.unshift(meta);
        await this.saveVersionIndex(project, contentType, contentKey, index);

        return meta;
    }

    // ============================================================
    // 2. 版本查询
    // ============================================================

    /**
     * 获取版本索引
     */
    async getVersionIndex(
        project: string,
        contentType: ContentType,
        contentKey: string,
        sourcePath: string,
    ): Promise<VersionIndex> {
        const indexPath = pjVersionIndexFile(project, contentType, contentKey);
        const exists = await this.fileExists(indexPath);

        if (!exists) {
            return {
                contentType,
                project,
                contentKey,
                sourcePath,
                latestVersion: 0,
                versions: [],
            };
        }

        try {
            const content = await this.readFile(indexPath);
            const index = JSON.parse(content) as VersionIndex;
            return index;
        } catch {
            return {
                contentType,
                project,
                contentKey,
                sourcePath,
                latestVersion: 0,
                versions: [],
            };
        }
    }

    /**
     * 获取版本列表（按版本号倒序）
     */
    async getVersions(
        project: string,
        contentType: ContentType,
        contentKey: string,
        sourcePath: string,
    ): Promise<VersionMeta[]> {
        const index = await this.getVersionIndex(project, contentType, contentKey, sourcePath);
        return index.versions;
    }

    /**
     * 获取指定版本的内容
     */
    async getVersionContent(version: VersionMeta): Promise<string> {
        return await this.readFile(version.versionPath);
    }

    /**
     * 获取最新版本
     */
    async getLatestVersion(
        project: string,
        contentType: ContentType,
        contentKey: string,
        sourcePath: string,
    ): Promise<VersionMeta | null> {
        const versions = await this.getVersions(project, contentType, contentKey, sourcePath);
        return versions.length > 0 ? versions[0] : null;
    }

    // ============================================================
    // 3. 版本对比
    // ============================================================

    /**
     * 对比两个版本的内容
     * @param oldVersion 旧版本
     * @param newVersion 新版本
     * @returns 行级 diff 结果和统计信息
     */
    async compareVersions(
        oldVersion: VersionMeta,
        newVersion: VersionMeta,
    ): Promise<{ lineDiffs: ReturnType<typeof lineDiff>; stats: DiffStats }> {
        const oldContent = await this.getVersionContent(oldVersion);
        const newContent = await this.getVersionContent(newVersion);
        const diffs = lineDiff(oldContent, newContent);
        const stats = computeDiffStats(diffs, oldContent, newContent);
        return { lineDiffs: diffs, stats };
    }

    /**
     * 对比版本与当前内容
     */
    async compareVersionWithCurrent(
        version: VersionMeta,
        currentContent: string,
    ): Promise<{ lineDiffs: ReturnType<typeof lineDiff>; stats: DiffStats }> {
        const oldContent = await this.getVersionContent(version);
        const diffs = lineDiff(oldContent, currentContent);
        const stats = computeDiffStats(diffs, oldContent, currentContent);
        return { lineDiffs: diffs, stats };
    }

    /**
     * 字符级 diff 对比
     */
    async compareChars(oldText: string, newText: string): Promise<ReturnType<typeof charDiff>> {
        return charDiff(oldText, newText);
    }

    // ============================================================
    // 4. 回滚功能
    // ============================================================

    /**
     * 回滚到指定版本
     * @param targetVersion 目标版本
     * @param currentContent 当前内容（用于自动保存）
     * @returns 回滚结果：{ success, rolledBackContent, autoSavedVersion }
     */
    async rollbackToVersion(
        targetVersion: VersionMeta,
        currentContent: string,
    ): Promise<{
        success: boolean;
        rolledBackContent: string;
        autoSavedVersion: VersionMeta | null;
    }> {
        const { project, contentType, contentKey, sourcePath } = targetVersion;

        let autoSavedVersion: VersionMeta | null = null;

        if (currentContent && currentContent.trim().length > 0) {
            autoSavedVersion = await this.saveVersion(
                project,
                contentType,
                contentKey,
                sourcePath,
                currentContent,
                {
                    type: 'rollback',
                    note: `回滚前自动保存（回滚到 v${targetVersion.version}）`,
                },
            );
        }

        const rolledBackContent = await this.getVersionContent(targetVersion);

        // P1-2（v4.27）：回滚与协同自动保存/流水线写正文共用同一路径，必须走同一把锁，
        // 否则回滚刚写完就被并行的自动保存覆盖。
        await withWriteLock(sourcePath, async () => {
            await this.writeFile(sourcePath, rolledBackContent);
        });

        await this.addRollbackRecord({
            id: generateVersionId(),
            rolledBackAt: new Date().toISOString(),
            fromVersion: autoSavedVersion ? autoSavedVersion.version : targetVersion.version + 1,
            toVersion: targetVersion.version,
            autoSavedVersionId: autoSavedVersion?.id || '',
            contentType,
            project,
            contentKey,
            sourcePath,
        });

        return {
            success: true,
            rolledBackContent,
            autoSavedVersion,
        };
    }

    /**
     * 部分回滚：只回滚选定的行
     * @param targetVersion 目标版本
     * @param currentContent 当前内容
     * @param lineIndices 要回滚的行号（当前内容中的行号，从 0 开始）
     */
    async partialRollback(
        targetVersion: VersionMeta,
        currentContent: string,
        lineIndices: number[],
    ): Promise<{
        success: boolean;
        newContent: string;
        autoSavedVersion: VersionMeta | null;
    }> {
        const { project, contentType, contentKey, sourcePath } = targetVersion;

        const autoSavedVersion = await this.saveVersion(
            project,
            contentType,
            contentKey,
            sourcePath,
            currentContent,
            {
                type: 'rollback',
                note: `部分回滚前自动保存（回滚到 v${targetVersion.version}）`,
            },
        );

        const targetContent = await this.getVersionContent(targetVersion);
        const targetLines = targetContent.split('\n');
        const currentLines = currentContent.split('\n');

        const { lineDiffs } = await this.compareVersionWithCurrent(targetVersion, currentContent);

        const targetToCurrentMap = new Map<number, number>();
        let targetLine = 0;
        let currentLine = 0;

        for (const diff of lineDiffs) {
            if (diff.op === 'equal' || diff.op === 'replace') {
                targetToCurrentMap.set(diff.oldLine, diff.newLine);
                targetLine++;
                currentLine++;
            } else if (diff.op === 'delete') {
                targetLine++;
            } else if (diff.op === 'insert') {
                currentLine++;
            }
        }

        const newLines = [...currentLines];
        for (const currentIdx of lineIndices) {
            let targetIdx = -1;
            for (const [tIdx, cIdx] of targetToCurrentMap) {
                if (cIdx === currentIdx) {
                    targetIdx = tIdx;
                    break;
                }
            }
            if (targetIdx >= 0 && targetIdx < targetLines.length) {
                newLines[currentIdx] = targetLines[targetIdx];
            }
        }

        const newContent = newLines.join('\n');
        await this.writeFile(sourcePath, newContent);

        return {
            success: true,
            newContent,
            autoSavedVersion,
        };
    }

    // ============================================================
    // 5. 回滚历史
    // ============================================================

    /**
     * 获取回滚历史记录
     */
    async getRollbackHistory(project: string): Promise<RollbackRecord[]> {
        const historyPath = pjRollbackHistoryFile(project);
        const exists = await this.fileExists(historyPath);

        if (!exists) {
            return [];
        }

        try {
            const content = await this.readFile(historyPath);
            const history = JSON.parse(content) as RollbackRecord[];
            return history;
        } catch {
            return [];
        }
    }

    /**
     * 添加回滚记录
     */
    async addRollbackRecord(record: RollbackRecord): Promise<void> {
        const history = await this.getRollbackHistory(record.project);
        history.unshift(record);
        await this.ensureDir(pjVersionsDir(record.project));
        await this.writeFile(pjRollbackHistoryFile(record.project), JSON.stringify(history, null, 2));
    }

    // ============================================================
    // 6. 版本元数据管理
    // ============================================================

    /**
     * 更新版本标签
     */
    async updateVersionTags(
        project: string,
        contentType: ContentType,
        contentKey: string,
        versionId: string,
        tags: string[],
    ): Promise<boolean> {
        const index = await this.getVersionIndex(project, contentType, contentKey, '');
        const version = index.versions.find(v => v.id === versionId);
        if (!version) return false;

        version.tags = tags;
        await this.saveVersionIndex(project, contentType, contentKey, index);
        return true;
    }

    /**
     * 更新版本备注
     */
    async updateVersionNote(
        project: string,
        contentType: ContentType,
        contentKey: string,
        versionId: string,
        note: string,
    ): Promise<boolean> {
        const index = await this.getVersionIndex(project, contentType, contentKey, '');
        const version = index.versions.find(v => v.id === versionId);
        if (!version) return false;

        version.note = note;
        await this.saveVersionIndex(project, contentType, contentKey, index);
        return true;
    }

    /**
     * 删除指定版本
     */
    async deleteVersion(
        project: string,
        contentType: ContentType,
        contentKey: string,
        versionId: string,
    ): Promise<boolean> {
        const indexPath = pjVersionIndexFile(project, contentType, contentKey);
        return withWriteLock(indexPath, () => this.deleteVersionUnlocked(project, contentType, contentKey, versionId));
    }

    private async deleteVersionUnlocked(
        project: string,
        contentType: ContentType,
        contentKey: string,
        versionId: string,
    ): Promise<boolean> {
        const index = await this.getVersionIndex(project, contentType, contentKey, '');
        const versionIdx = index.versions.findIndex(v => v.id === versionId);
        if (versionIdx === -1) return false;

        const version = index.versions[versionIdx];

        try {
            await this.deleteFile(version.versionPath);
        } catch {
        }

        index.versions.splice(versionIdx, 1);
        if (index.versions.length > 0) {
            index.latestVersion = index.versions[0].version;
        } else {
            index.latestVersion = 0;
        }

        await this.saveVersionIndex(project, contentType, contentKey, index);
        return true;
    }

    // ============================================================
    // 7. 私有辅助方法
    // ============================================================

    private async saveVersionIndex(
        project: string,
        contentType: ContentType,
        contentKey: string,
        index: VersionIndex,
    ): Promise<void> {
        const indexPath = pjVersionIndexFile(project, contentType, contentKey);
        await this.ensureDir(pjContentVersionsDir(project, contentType, contentKey));
        await this.writeFile(indexPath, JSON.stringify(index, null, 2));
    }

    private async fileExists(path: string): Promise<boolean> {
        return this.app.vault.adapter.exists(path);
    }

    private async readFile(path: string): Promise<string> {
        return await this.app.vault.adapter.read(path);
    }

    private async writeFile(path: string, content: string): Promise<void> {
        const exists = await this.app.vault.adapter.exists(path);
        if (exists) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                await this.app.vault.modify(file, content);
            } else {
                await this.app.vault.adapter.write(path, content);
            }
        } else {
            await this.app.vault.adapter.write(path, content);
        }
    }

    private async ensureDir(dirPath: string): Promise<void> {
        const exists = await this.app.vault.adapter.exists(dirPath);
        if (!exists) {
            await this.app.vault.adapter.mkdir(dirPath);
        }
    }

    private async deleteFile(path: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file) {
            await this.app.vault.delete(file);
        }
    }
}
