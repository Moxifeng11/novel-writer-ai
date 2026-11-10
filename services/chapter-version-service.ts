/**
 * chapter-version-service.ts — 章节/大纲/设定版本管理服务
 *
 * 提供版本保存、查询、对比、回滚等核心功能
 * 版本存储在项目目录下的 _versions/ 文件夹中
 */
import { App, TFile, TFolder, Notice } from 'obsidian';
import { writeVaultText } from '@/shared/file-system-port';
import type {
    VersionMeta,
    VersionIndex,
    VersionType,
    ContentType,
    RollbackRecord,
    DiffStats,
} from '@/shared/version-types';
import {
    pjContentVersionsDir,
    pjVersionIndexFile,
    pjVersionContentFile,
    pjRollbackHistoryFile,
    pjVersionsDir,
    sanitizeName,
} from '@/shared/paths';
import {
    lineDiff,
    charDiff,
    computeDiffStats,
    countWords,
    generateVersionId,
} from '@/shared/diff-utils';
import { withWriteLock } from '@/shared/write-lock';

/**
 * 保存版本选项列表结构定义。
 */
export interface SaveVersionOptions {
    /** 版本类型 */
    type: VersionType;
    /** 版本标签（可选） */
    tags?: string[];
    /** 版本备注（可选） */
    note?: string;
}

/**
 * contentKey 安全校验：单段、无 `..`、无控制字符，且经 sanitizeName 后保持原样。
 * contentKey 会拼进 _versions 目录路径（pjContentVersionsDir），必须严于一般文件名。
 *
 * @param contentKey - 内容键
 * @returns 是否安全
 */
export function isSafeContentKey(contentKey: string): boolean {
    const key = String(contentKey || '');
    if (!key || key.includes('/') || key.includes('\\') || key.includes('..')) return false;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(key)) return false;
    return sanitizeName(key) === key;
}

/**
 * SEC-1 残留（2026-11-10 审计）：备份中心聚合 versions.json 时过滤伪造条目。
 * 未过滤的话，伪造索引可让 vault 内任意文件经 sourcePath 进入备份对比 UI（读取泄漏），
 * 并经 onSaveVersion 把 contentKey 透传进 _versions 写路径（穿越写）。
 *
 * @param project - 项目
 * @param meta - 版本元数据
 * @returns 条目是否安全
 */
export function isSafeVersionEntry(project: string, meta: VersionMeta): boolean {
    if (!meta || typeof meta !== 'object') return false;
    const contentType = String(meta.contentType || '');
    const contentKey = String(meta.contentKey || '');
    if (!contentType || contentType.includes('/') || contentType.includes('..')) return false;
    if (!isSafeContentKey(contentKey)) return false;
    const expectedDir = pjContentVersionsDir(project, contentType, contentKey).replace(/\\/g, '/');
    const versionPath = String(meta.versionPath || '').replace(/\\/g, '/');
    if (!versionPath.startsWith(`${expectedDir}/`) || versionPath.includes('..')) return false;
    const sourcePath = String(meta.sourcePath || '').replace(/\\/g, '/');
    if (!sourcePath.startsWith(`${project}/`) || sourcePath.includes('..')
        || sourcePath.startsWith('/') || /^[A-Za-z]:/.test(sourcePath)) {
        return false;
    }
    return true;
}

/**
 * 章节版本服务。
 */
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
        // SEC-1 残留（2026-11-10 审计）：contentKey 直通 pjContentVersionsDir，
        // 伪造索引/伪造调用可写穿越目录（备份中心 onSaveVersion 会透传旧索引里的键）。
        // 入口即拒；sourcePath 同步校验（同样来自可能被伪造的上游）。
        if (!isSafeContentKey(contentKey)) {
            throw new Error('版本键非法（不允许路径分隔符、.. 或特殊字符）');
        }
        const normalizedSource = String(sourcePath || '').replace(/\\/g, '/');
        if (!normalizedSource.startsWith(`${project}/`) || normalizedSource.includes('..')
            || normalizedSource.startsWith('/') || /^[A-Za-z]:/.test(normalizedSource)) {
            throw new Error('源路径非法（必须位于本项目内）');
        }
        // D-4：sourcePath 必须是文件。旧调用方把 chapDir（步骤目录）传进来，
        // 备份中心/回滚随后对目录 read/write 必然失败——这类记录不可回滚。
        if (this.app.vault.getAbstractFileByPath(normalizedSource) instanceof TFolder) {
            throw new Error('源路径必须是正文文件，不能是目录');
        }
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
     * 校验索引条目：版本路径必须落在本内容的 _versions 目录，源路径必须是本项目内相对路径。
     * v4.80.0 安全审计：versions.json 可随 vault 同步/共享，不能信任其中的路径字段，
     * 否则回滚可读写/删除 vault 内任意文件（含插件 main.js/data.json）。
     */
    private isSafeVersionMeta(
        meta: VersionMeta,
        project: string,
        contentType: ContentType,
        contentKey: string,
    ): boolean {
        if (!meta || typeof meta !== 'object') return false;
        if (meta.project !== project || meta.contentType !== contentType || meta.contentKey !== contentKey) return false;
        const expectedDir = pjContentVersionsDir(project, contentType, contentKey);
        const versionPath = String(meta.versionPath || '').replace(/\\/g, '/');
        if (!versionPath.startsWith(`${expectedDir}/`) || versionPath.includes('..')) return false;
        const sourcePath = String(meta.sourcePath || '').replace(/\\/g, '/');
        if (!sourcePath.startsWith(`${project}/`) || sourcePath.includes('..') || sourcePath.startsWith('/') || /^[A-Za-z]:/.test(sourcePath)) {
            return false;
        }
        return true;
    }

    /**
     * 获取版本索引
     * @param project - 项目（路径或对象）
     * @param contentType - 内容类型
     * @param contentKey - 内容键
     * @param sourcePath - 源路径
      * @returns VersionIndex 实例
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
            const parsed = JSON.parse(content) as VersionIndex;
            const versions = Array.isArray(parsed.versions)
                ? parsed.versions.filter(v => this.isSafeVersionMeta(v, project, contentType, contentKey))
                : [];
            return {
                contentType,
                project,
                contentKey,
                sourcePath,
                latestVersion: versions.reduce((max, v) => Math.max(max, v.version), 0),
                versions,
            };
        } catch {
            // D3-5（维度② r3）：索引损坏时先留档再返回空索引；否则下一次 saveVersion
            // 会用空索引覆盖原文件，全部版本元数据永久丢失。
            await this.archiveCorruptFile(indexPath);
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
     * @param project - 项目（路径或对象）
     * @param contentType - 内容类型
     * @param contentKey - 内容键
     * @param sourcePath - 源路径
     * @returns 结果数组
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
     * @param version - 版本
     * @returns 文本结果
     */
    async getVersionContent(version: VersionMeta): Promise<string> {
        if (!this.isSafeVersionMeta(version, version.project, version.contentType, version.contentKey)) {
            throw new Error('版本索引路径非法，已拒绝读取');
        }
        return await this.readFile(version.versionPath);
    }

    /**
     * 获取最新版本
     * @param project - 项目（路径或对象）
     * @param contentType - 内容类型
     * @param contentKey - 内容键
     * @param sourcePath - 源路径
      * @returns VersionMeta 或 null
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
     * @param version - 版本
     * @param currentContent - 当前内容
      * @returns DiffStats }> 实例
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
     * @param oldText - 旧文本
     * @param newText - 新文本
      * @returns ReturnType<typeof charDiff> 实例
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
        if (!this.isSafeVersionMeta(targetVersion, project, contentType, contentKey)) {
            throw new Error('版本索引路径非法，已拒绝回滚');
        }

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
      * @returns Promise< 实例
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
        if (!this.isSafeVersionMeta(targetVersion, project, contentType, contentKey)) {
            throw new Error('版本索引路径非法，已拒绝回滚');
        }

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
        // C-2（覆盖率审计）：与 rollbackToVersion 保持一致，正文写入必须持文件锁；
        // 否则与协同自动保存/流水线并发时互相覆盖，且部分回滚无任何回归测试。
        await withWriteLock(sourcePath, () => this.writeFile(sourcePath, newContent));

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
     * @param project - 项目（路径或对象）
     * @returns 结果数组
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
            // D3-5：损坏的回滚历史同样留档，避免下一次写入把旧记录永久覆盖
            await this.archiveCorruptFile(historyPath);
            return [];
        }
    }

    /**
     * 添加回滚记录
     * @param record - 记录
     */
    async addRollbackRecord(record: RollbackRecord): Promise<void> {
        const historyPath = pjRollbackHistoryFile(record.project);
        // D3-5：历史是读—改—写，与回滚并发时按同一路径锁串行，避免丢记录
        await withWriteLock(historyPath, async () => {
            const history = await this.getRollbackHistory(record.project);
            history.unshift(record);
            await this.ensureDir(pjVersionsDir(record.project));
            await this.writeFile(historyPath, JSON.stringify(history, null, 2));
        });
    }

    // ============================================================
    // 6. 版本元数据管理
    // ============================================================

    /**
     * 更新版本标签
     * @param project - 项目（路径或对象）
     * @param contentType - 内容类型
     * @param contentKey - 内容键
     * @param versionId - 版本ID
     * @param tags - 标签列表
     * @returns 是否成功
     */
    async updateVersionTags(
        project: string,
        contentType: ContentType,
        contentKey: string,
        versionId: string,
        tags: string[],
    ): Promise<boolean> {
        const indexPath = pjVersionIndexFile(project, contentType, contentKey);
        // D3-5：标签/备注是索引的读—改—写，与保存/删除共用同一把索引锁
        return withWriteLock(indexPath, async () => {
            const index = await this.getVersionIndex(project, contentType, contentKey, '');
            const version = index.versions.find(v => v.id === versionId);
            if (!version) return false;

            version.tags = tags;
            await this.saveVersionIndex(project, contentType, contentKey, index);
            return true;
        });
    }

    /**
     * 更新版本备注
     * @param project - 项目（路径或对象）
     * @param contentType - 内容类型
     * @param contentKey - 内容键
     * @param versionId - 版本ID
     * @param note - 笔记
     * @returns 是否成功
     */
    async updateVersionNote(
        project: string,
        contentType: ContentType,
        contentKey: string,
        versionId: string,
        note: string,
    ): Promise<boolean> {
        const indexPath = pjVersionIndexFile(project, contentType, contentKey);
        // D3-5：备注写入同样与保存/删除串行
        return withWriteLock(indexPath, async () => {
            const index = await this.getVersionIndex(project, contentType, contentKey, '');
            const version = index.versions.find(v => v.id === versionId);
            if (!version) return false;

            version.note = note;
            await this.saveVersionIndex(project, contentType, contentKey, index);
            return true;
        });
    }

    /**
     * 删除指定版本
     * @param project - 项目（路径或对象）
     * @param contentType - 内容类型
     * @param contentKey - 内容键
     * @param versionId - 版本ID
     * @returns 是否成功
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
        if (!this.isSafeVersionMeta(version, project, contentType, contentKey)) return false;

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

    /**
     * 把损坏的索引/历史文件改名为 `.corrupt-<时间戳>.bak` 留档（D3-5）。
     *
     * 与 knowledge-tags / preference-memory 的损坏留档口径一致；归档失败不阻断读取，
     * 由后续写入继续（至少不会静默删除原文）。
     *
     * @param path - 损坏文件路径
     */
    private async archiveCorruptFile(path: string): Promise<void> {
        try {
            const adapter = this.app.vault.adapter;
            if (typeof adapter.rename !== 'function') return;
            if (!(await adapter.exists(path))) return;
            await adapter.rename(path, `${path}.corrupt-${Date.now()}.bak`);
        } catch {
            // 归档失败时保持原文件不动，调用方返回空索引
        }
    }

    private async fileExists(path: string): Promise<boolean> {
        return this.app.vault.adapter.exists(path);
    }

    private async readFile(path: string): Promise<string> {
        return await this.app.vault.adapter.read(path);
    }

    private async writeFile(path: string, content: string): Promise<void> {
        // 回滚正文是用户可见 Markdown：走索引写入；版本索引等 JSON 保持 adapter。
        if (path.endsWith('.md')) {
            await writeVaultText(this.app, path, content);
            return;
        }
        const exists = await this.app.vault.adapter.exists(path);
        if (exists) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                await this.app.vault.modify(file, content);
            } else {
                // write-entry-allow: 非 .md 版本索引/内容 JSON，不在 vault 索引。
                await this.app.vault.adapter.write(path, content);
            }
        } else {
            // write-entry-allow: 非 .md 版本索引/内容 JSON，不在 vault 索引。
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
