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

/**
 * 待迁移项目候选。
 */
export interface MigrationCandidate {
    projectId: string;
    displayName: string;
    mode: 'long' | 'short' | 'script';
    targetPath: string;
}

/**
 * 迁移计划。
 */
export interface MigrationPlan {
    candidates: MigrationCandidate[];
    skipped: Array<{ projectId: string; reason: string }>;
    conflicts: Array<{ projectId: string; reason: string }>;
}

/**
 * 迁移结果。
 */
export interface MigrationResult {
    moved: MigrationCandidate[];
    failed: Array<{ projectId: string; error: string }>;
    warnings: string[];
    /** 备份清单目录（仅 backup:true 时写入） */
    backupDir?: string;
}

/**
 * 回滚结果。
 */
export interface MigrationRollbackResult {
    restored: MigrationCandidate[];
    failed: Array<{ projectId: string; error: string }>;
}

/**
 * 项目迁移服务。
 */
export class ProjectMigrationService {
    constructor(private readonly app: import('obsidian').App) {}

    /**
     * 生成迁移计划。
     * @returns 迁移计划
     */
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

    /**
     * 执行迁移。
     *
     * @param options - 配置项
     * @returns 迁移结果
     */
    async migrate(options?: { backup?: boolean }): Promise<MigrationResult> {
        const plan = await this.plan();
        const moved: MigrationCandidate[] = [];
        const failed: MigrationResult['failed'] = [];
        const warnings: string[] = [];

        let backupDir: string | undefined;
        if (options?.backup) {
            const backupRoot = `.trash/project-migration-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
            backupDir = backupRoot;
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

        return { moved, failed, warnings, backupDir };
    }

    /**
     * 撤销一次迁移：按相反顺序把已移动的项目移回原路径。
     *
     * 注意：只回退「本次 moved 列表」；迁移后用户在新路径里做过的编辑会随目录一起移回，
     * 不会被丢弃。原路径若已被别的目录占用则跳过并报告，不覆盖。
     * @param moved - 是否移动
      * @returns MigrationRollbackResult 实例
     */
    async rollback(moved: MigrationCandidate[]): Promise<MigrationRollbackResult> {
        const restored: MigrationCandidate[] = [];
        const failed: MigrationRollbackResult['failed'] = [];
        for (const candidate of [...moved].reverse()) {
            try {
                const folder = this.app.vault.getAbstractFileByPath(candidate.targetPath);
                if (!(folder instanceof TFolder)) {
                    failed.push({ projectId: candidate.projectId, error: `目标不存在：${candidate.targetPath}` });
                    continue;
                }
                if (this.app.vault.getAbstractFileByPath(candidate.projectId)) {
                    failed.push({ projectId: candidate.projectId, error: `原路径已被占用：${candidate.projectId}` });
                    continue;
                }
                await this.app.fileManager.renameFile(folder, candidate.projectId);
                restored.push(candidate);
                log.info('项目迁移已撤销:', candidate.targetPath, '->', candidate.projectId);
            } catch (e) {
                failed.push({
                    projectId: candidate.projectId,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
        return { restored, failed };
    }

    /**
     * 回滚并提示结果。
     *
     * @param moved - 是否移动
     * @returns 回滚结果
     */
    async rollbackWithNotice(moved: MigrationCandidate[]): Promise<MigrationRollbackResult> {
        const result = await this.rollback(moved);
        if (result.restored.length > 0) {
            new Notice(`↩️ 已撤销 ${result.restored.length} 个项目的迁移`, 6000);
        }
        if (result.failed.length > 0) {
            new Notice(`⚠️ ${result.failed.length} 个项目未能撤销，详见控制台`, 10000);
        }
        return result;
    }

    /**
     * Convenience wrapper for settings UI
     *
     * @param options - 配置项
      * @returns MigrationResult 实例
     */
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
