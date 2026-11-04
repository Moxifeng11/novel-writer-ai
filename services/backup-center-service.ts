/**
 * backup-center-service.ts — 版本与备份中心的数据聚合
 *
 * 项目里已有三类“历史”：`_versions/`（正文/大纲等版本快照）、
 * `03-大纲与章节/步骤结果/`（步骤/结算/质检产物）、插件目录的 `data.json.bak`。
 * 这里把它们聚合成一个只读清单；恢复动作仍走 ChapterVersionService / 用户确认。
 */
import { App, TFile } from 'obsidian';
import { listFolderFiles } from '@/shared/vault-tree';
import { pjVersionsDir } from '@/shared/paths';
import type { VersionMeta } from '@/shared/version-types';

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
/** 插件配置备份路径（configDir 可能被用户改过） */
function pluginBackupPath(app: App): string {
    const configDir = app.vault.configDir;
    return `${configDir}/plugins/novel-writer-ai/data/data.json.bak`;
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

async function collectSettingsBackup(app: App): Promise<BackupCenterEntry[]> {
    try {
        const adapter = app.vault.adapter;
        const backupPath = pluginBackupPath(app);
        if (!(await adapter.exists(backupPath))) return [];
        const stat = await adapter.stat(backupPath).catch(() => null);
        return [{
            kind: 'settings-backup',
            path: backupPath,
            label: 'data.json.bak',
            detail: '设置迁移/回写前的插件配置备份（含密文，不进 vault 索引）',
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
