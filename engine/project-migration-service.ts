/**
 * project-migration-service.ts - legacy project migration into mode libraries.
 *
 * Dry-run by default. A real move uses Obsidian fileManager so links update.
 */
import { Notice, TFolder } from 'obsidian';
import { detectProjects } from './context-manager';
import { readProjectMeta } from '../shared/paths';
import { parseCreationModeMeta } from '../shared/creation-mode';
import {
    MODE_LIBRARY_ROOTS,
    modeFromLibraryPath,
    projectDisplayName,
} from '../domains/kernel/project-locator';
import { createLogger } from '../shared/logger';

const log = createLogger('ProjectMigration');

export interface MigrationCandidate {
    projectId: string;
    displayName: string;
    mode: 'long' | 'short' | 'script';
    targetPath: string;
}

export interface MigrationPlan {
    candidates: MigrationCandidate[];
    skipped: Array<{ projectId: string; reason: string }>;
    conflicts: Array<{ projectId: string; reason: string }>;
}

export interface MigrationResult {
    moved: MigrationCandidate[];
    failed: Array<{ projectId: string; error: string }>;
    warnings: string[];
}

export class ProjectMigrationService {
    constructor(private readonly app: import('obsidian').App) {}

    async plan(): Promise<MigrationPlan> {
        const projects = detectProjects(this.app);
        const candidates: MigrationCandidate[] = [];
        const skipped: MigrationPlan['skipped'] = [];
        const conflicts: MigrationPlan['conflicts'] = [];
        const targetSeen = new Set<string>();

        for (const projectId of projects) {
            if (modeFromLibraryPath(projectId)) {
                skipped.push({ projectId, reason: '已在模式库中' });
                continue;
            }
            let mode: 'long' | 'short' | 'script' = 'long';
            try {
                const meta = await readProjectMeta(this.app, projectId);
                mode = parseCreationModeMeta(meta || '').mode;
            } catch (e) {
                skipped.push({ projectId, reason: `读取 .project 失败：${e instanceof Error ? e.message : String(e)}` });
                continue;
            }

            const displayName = projectDisplayName(projectId);
            const targetPath = `${MODE_LIBRARY_ROOTS[mode]}/${displayName}`;
            if (targetSeen.has(targetPath)) {
                conflicts.push({ projectId, reason: `目标路径冲突：${targetPath}` });
                continue;
            }
            if (this.app.vault.getAbstractFileByPath(targetPath)) {
                conflicts.push({ projectId, reason: `目标已存在：${targetPath}` });
                continue;
            }
            targetSeen.add(targetPath);
            candidates.push({ projectId, displayName, mode, targetPath });
        }

        return { candidates, skipped, conflicts };
    }

    async migrate(options?: { backup?: boolean }): Promise<MigrationResult> {
        const plan = await this.plan();
        const moved: MigrationCandidate[] = [];
        const failed: MigrationResult['failed'] = [];
        const warnings: string[] = [];

        if (options?.backup) {
            const backupRoot = `.trash/project-migration-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
            try {
                const adapter = this.app.vault.adapter;
                if (!(await adapter.exists('.trash'))) await adapter.mkdir('.trash');
                if (!(await adapter.exists(backupRoot))) await adapter.mkdir(backupRoot);
                await adapter.write(`${backupRoot}/manifest.json`, JSON.stringify(plan, null, 2));
            } catch (e) {
                warnings.push(`备份清单写入失败：${e instanceof Error ? e.message : String(e)}`);
            }
        }

        for (const candidate of plan.candidates) {
            const folder = this.app.vault.getAbstractFileByPath(candidate.projectId);
            if (!(folder instanceof TFolder)) {
                failed.push({ projectId: candidate.projectId, error: '项目文件夹不存在' });
                continue;
            }
            if (this.app.vault.getAbstractFileByPath(candidate.targetPath)) {
                failed.push({ projectId: candidate.projectId, error: `目标已存在：${candidate.targetPath}` });
                continue;
            }
            try {
                await this.app.fileManager.renameFile(folder, candidate.targetPath);
                moved.push(candidate);
                log.info('项目已迁移:', candidate.projectId, '->', candidate.targetPath);
            } catch (e) {
                failed.push({
                    projectId: candidate.projectId,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        return { moved, failed, warnings };
    }

    /** Convenience wrapper for settings UI */
    async migrateWithNotice(options?: { backup?: boolean }): Promise<MigrationResult> {
        const result = await this.migrate(options);
        if (result.moved.length > 0) {
            new Notice(`✅ 已迁移 ${result.moved.length} 个项目到模式库`, 6000);
        } else {
            new Notice('ℹ️ 没有需要迁移的项目', 4000);
        }
        if (result.failed.length > 0) {
            new Notice(`❌ 迁移失败 ${result.failed.length} 项，详见控制台`, 10000);
        }
        return result;
    }
}
