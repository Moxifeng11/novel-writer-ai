/**
 * id-migration-service.ts — 旧项目补 ID/属性迁移执行
 *
 * 流程：索引 → 生成计划 → dry-run 预览 → 执行（逐文件补 frontmatter，只补空缺）。
 * 幂等：已补过的条目下次会被跳过；正文内容不动。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type { ProjectIndexService } from './project-index-service';
import type { IdRegistryService } from './id-registry-service';
import {
    buildMigrationPlan,
    describeMigrationPlan,
    suggestedTags,
    type MigrationPlan,
} from '@/shared/id-migration-model';
import type { EntityType } from '@/shared/project-index-model';

const log = createLogger('IdMigration');

/** 迁移结果 */
export interface MigrationResult {
    /** 是否 dry-run */
    dryRun: boolean;
    /** 计划摘要 */
    summary: string;
    /** 实际写入的文件数 */
    applied: number;
    /** 失败项 */
    failures: Array<{ path: string; reason: string }>;
    /** 分配的 ID（dry-run 时为建议） */
    assignments: Array<{ path: string; id: string; type: EntityType }>;
}

/**
 * 迁移服务。
 */
export class IdMigrationService {
    /**
     * @param app - Obsidian 应用
     * @param indexService - 项目索引服务
     * @param registryService - ID 登记表服务
     */
    constructor(
        private readonly app: App,
        private readonly indexService: ProjectIndexService,
        private readonly registryService: IdRegistryService,
        ) {}

    /**
     * 生成迁移计划（dry-run 预览）。
     *
     * @param project - 项目路径
     * @returns 计划与摘要
     */
    async plan(project: string): Promise<{ plan: MigrationPlan; summary: string }> {
        const index = await this.indexService.ensure(project);
        const plan = buildMigrationPlan(index.entries);
        return { plan, summary: describeMigrationPlan(plan) };
    }

    /**
     * 执行迁移（dryRun=true 只返回计划，不写文件）。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 迁移结果
     */
    async migrate(project: string, dryRun = true): Promise<MigrationResult> {
        const { plan, summary } = await this.plan(project);
        const failures: MigrationResult['failures'] = [];
        const assignments: MigrationResult['assignments'] = [];
        let applied = 0;

        for (const action of plan.actions) {
            const file = this.app.vault.getAbstractFileByPath(action.path);
            if (!(file instanceof TFile)) {
                failures.push({ path: action.path, reason: '文件不存在' });
                continue;
            }
            let id = action.existingId;
            if (!id) {
                id = await this.registryService.ensureId(project, action.type, action.path);
            }
            assignments.push({ path: action.path, id, type: action.type });
            if (dryRun) continue;
            try {
                await this.fillFrontmatter(file, action.type, id);
                applied += 1;
            } catch (error) {
                failures.push({ path: action.path, reason: error instanceof Error ? error.message : String(error) });
            }
        }

        if (!dryRun) this.indexService.invalidate(project);
        log.info(`迁移完成（dryRun=${dryRun}）：计划 ${plan.actions.length}，写入 ${applied}，失败 ${failures.length}`);
        return { dryRun, summary, applied, failures, assignments };
    }

    /** 补 frontmatter（只填空缺键，正文不动） */
    private async fillFrontmatter(
        file: TFile,
        type: EntityType,
        id: string,
    ): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
            if (!frontmatter.id) frontmatter.id = id;
            if (!frontmatter.type) frontmatter.type = type;
            const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [];
            const suggested = suggestedTags(type);
            if (tags.length === 0) {
                frontmatter.tags = suggested;
            } else {
                frontmatter.tags = Array.from(new Set([...tags, ...suggested]));
            }
            if (!frontmatter.aliases && !frontmatter['别称'] && !frontmatter['别名']) {
                frontmatter.aliases = [];
            }
        });
    }
}
