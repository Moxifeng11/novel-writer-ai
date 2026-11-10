/**
 * backup-center-service.ts — 版本与备份中心的数据聚合
 *
 * 项目里已有三类“历史”：`_versions/`（正文/大纲等版本快照）、
 * `03-大纲与章节/步骤结果/`（步骤/结算/质检产物）、插件目录的 `data.json.bak`。
 * 这里把它们聚合成一个只读清单；恢复动作仍走 ChapterVersionService / 用户确认。
 */
import { App, TFile } from 'obsidian';
import { listFolderFiles } from '@/shared/vault-tree';
import { pjVersionsDir, pluginSettingsBackupFile } from '@/shared/paths';
import type { VersionMeta } from '@/shared/version-types';
import { detectSecretStorageModeFromJson, type SecretStorageMode } from '@/shared/secret-redaction';
import { isSafeVersionEntry } from './chapter-version-service';

/** 备份条目类型。 */
export type BackupEntryKind = 'version' | 'step-result' | 'settings-backup';

/** 备份中心条目。 */
export interface BackupCenterEntry {
    kind: BackupEntryKind;
    path: string;
    label: string;
    detail: string;
    updatedAt?: number;
    size?: number;
    /** version 条目携带完整元数据，供回滚 */
    version?: VersionMeta;
}

/** 备份中心报告。 */
export interface BackupCenterReport {
    project: string;
    entries: BackupCenterEntry[];
    rollbackCount: number;
    summary: Record<BackupEntryKind, number>;
}

const CONTENT_TYPES: Array<VersionMeta['contentType']> = ['chapter', 'outline', 'worldview', 'character', 'setting'];
/** 插件配置备份路径：与写入方共用插件根目录单源（不是 data/ 子目录） */
function pluginBackupPath(): string {
    return pluginSettingsBackupFile();
}

function emptySummary(): Record<BackupEntryKind, number> {
    return { version: 0, 'step-result': 0, 'settings-backup': 0 };
}

async function collectVersions(app: App, project: string): Promise<BackupCenterEntry[]> {
    const entries: BackupCenterEntry[] = [];
    for (const contentType of CONTENT_TYPES) {
        const dir = `${pjVersionsDir(project)}/${contentType}`;
        const indexFiles = listFolderFiles<TFile>(app.vault, dir, { recursive: true, extensions: ['json'] })
            .filter(file => file.name === 'versions.json');
        for (const indexFile of indexFiles) {
            try {
                const raw = await app.vault.cachedRead(indexFile);
                const parsed = JSON.parse(raw) as { versions?: VersionMeta[] };
                const versions = [...(parsed.versions ?? [])].reverse();
                for (const version of versions.slice(0, 50)) {
                    // SEC-1 残留：过滤伪造索引条目——未过滤的话 modal 会拿 sourcePath
                    // 直接 adapter.read（vault 内任意文件内容进入对比 UI，读取泄漏），
                    // onSaveVersion 还会把 contentKey 透传进 _versions 写路径。
                    if (!isSafeVersionEntry(project, version)) continue;
                    entries.push({
                        kind: 'version',
                        path: version.versionPath,
                        label: `${version.contentKey} · v${version.version}`,
                        detail: `${version.type} · ${version.wordCount} 字${version.note ? ` · ${version.note}` : ''}`,
                        updatedAt: Date.parse(version.createdAt) || undefined,
                        size: version.wordCount,
                        version,
                    });
                }
            } catch {
                // 单个索引损坏不影响其它内容类型
            }
        }
    }
    return entries;
}

async function collectStepArtifacts(app: App, project: string): Promise<BackupCenterEntry[]> {
    const stepRoot = project ? `${project}/03-大纲与章节/步骤结果` : '';
    if (!stepRoot) return [];
    const files = listFolderFiles<TFile>(app.vault, stepRoot, { recursive: true });
    const entries: BackupCenterEntry[] = [];
    for (const file of files) {
        if (!(file instanceof TFile)) continue;
        const isArtifact = /结算表|质量控制|分析报告|连贯性审查|修正记录|最终修正/.test(file.name);
        if (!isArtifact) continue;
        entries.push({
            kind: 'step-result',
            path: file.path,
            label: file.name,
            detail: '步骤/结算产物（当前版本）',
            updatedAt: file.stat?.mtime,
            size: file.stat?.size,
        });
    }
    return entries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 80);
}

/**
 * 备份条目的密钥形态说明。
 *
 * SEC-11：旧文案固定写「含密文」，但未启用会话口令时 data.json 本身就是明文，
 * .bak 逐字节复制后同样是明文密钥副本。文案必须说真话，并提示分享风险。
 */
function settingsBackupDetail(mode: SecretStorageMode): string {
    switch (mode) {
        case 'encrypted':
            return '设置迁移/回写前的插件配置备份（密钥为密文，不进 vault 索引）';
        case 'plaintext':
            return '设置迁移/回写前的插件配置备份（⚠ 含明文 API Key：未启用会话口令，请勿分享或同步此文件）';
        case 'empty':
            return '设置迁移/回写前的插件配置备份（当前无密钥字段，不进 vault 索引）';
        default:
            return '设置迁移/回写前的插件配置备份（无法判定密钥存储方式，不进 vault 索引）';
    }
}

async function collectSettingsBackup(app: App): Promise<BackupCenterEntry[]> {
    try {
        const adapter = app.vault.adapter;
        const backupPath = pluginBackupPath();
        if (!(await adapter.exists(backupPath))) return [];
        const stat = await adapter.stat(backupPath).catch(() => null);
        // 只读取用于判定「密文/明文」，内容不落日志、不进 UI
        const mode = detectSecretStorageModeFromJson(await adapter.read(backupPath).catch(() => ''));
        return [{
            kind: 'settings-backup',
            path: backupPath,
            label: mode === 'plaintext' ? 'data.json.bak（含明文密钥）' : 'data.json.bak',
            detail: settingsBackupDetail(mode),
            updatedAt: stat?.mtime,
            size: stat?.size,
        }];
    } catch {
        return [];
    }
}

async function countRollbacks(app: App, project: string): Promise<number> {
    try {
        const path = `${pjVersionsDir(project)}/rollback-history.json`;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return 0;
        const parsed = JSON.parse(await app.vault.cachedRead(file)) as { records?: unknown[] };
        return Array.isArray(parsed.records) ? parsed.records.length : 0;
    } catch {
        return 0;
    }
}

/**
 * 聚合一个项目的版本与备份。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目 ID
 * @returns 备份中心报告
 *
 * @example
 * ```ts
 * const report = await collectBackupCenter(app, project);
 * console.log(report.summary);
 * ```
 */
export async function collectBackupCenter(app: App, project: string): Promise<BackupCenterReport> {
    const [versions, artifacts, settings, rollbackCount] = await Promise.all([
        collectVersions(app, project),
        collectStepArtifacts(app, project),
        collectSettingsBackup(app),
        countRollbacks(app, project),
    ]);
    const entries = [...versions, ...artifacts, ...settings];
    const summary = emptySummary();
    for (const entry of entries) summary[entry.kind] += 1;
    return { project, entries, rollbackCount, summary };
}
