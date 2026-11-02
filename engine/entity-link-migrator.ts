/**
 * entity-link-migrator.ts — 存量实体 frontmatter 链接化迁移（dry-run 默认）
 *
 * 背景：v4.20 起结算回写把归属类字段（所属势力/当前位置/所属/归属…）写成
 * `[[wiki-link]]`，但**存量**实体文件还是纯字符串——图谱里老关系不可见。
 * 本模块扫描四类实体目录，按 shared/entity-links 的 LINK_FIELD_POLICY
 * 生成迁移计划（dry-run），确认后逐文件写回（带写锁）。
 *
 * 读取侧容忍一切旧格式（parseLinkValue），所以迁移永远安全：已链接的跳过。
 */
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import {
    LINK_FIELD_POLICY,
    formatListLinkValue,
    formatSingleLinkValue,
    parseLinkValue,
} from '../shared/entity-links';
import { ObsidianFileSystem, ObsidianFrontmatter, ObsidianVaultMeta } from '../shared/file-system-port';
import { withWriteLock } from '../shared/write-lock';
import { pjCharsDir, pjFactionsDir, pjItemsDir, pjLocsDir } from '../shared/paths';
import { createLogger } from '../shared/logger';

const log = createLogger('EntityLinkMigrator');

/**
 * EntityLinkChange 类型定义。
 */
export interface EntityLinkChange {
    path: string;
    entity: string;
    category: string;
    field: string;
    from: string;
    to: string | string[];
}

/**
 * EntityLinkMigrationPlan 类型定义。
 */
export interface EntityLinkMigrationPlan {
    /** 扫描的实体文件数 */
    scanned: number;
    changes: EntityLinkChange[];
}

const CATEGORY_DIRS: Array<{ category: string; dir: (project: string) => string }> = [
    { category: 'character', dir: pjCharsDir },
    { category: 'location', dir: pjLocsDir },
    { category: 'faction', dir: pjFactionsDir },
    { category: 'item', dir: pjItemsDir },
];

function policiesForCategory(category: string): Array<{ field: string; cardinality: 'single' | 'list' }> {
    // v4.20：LINK_FIELD_POLICY 的 map 键是 `${category}.${field}`；value.key 只是裸字段名
    return Object.entries(LINK_FIELD_POLICY)
        .filter(([mapKey]) => mapKey.startsWith(`${category}.`))
        .map(([, policy]) => ({ field: policy.key, cardinality: policy.cardinality }));
}

/**
 * 纯函数：单个实体 frontmatter 的迁移计划（供单测直接验证）
 *
 * @param category - 分类
 * @param frontmatter - frontmatter
  * @returns 结果
 */
export function planEntityLinkChanges(
    category: string,
    frontmatter: Record<string, unknown>,
): Array<{ field: string; from: string; to: string | string[] }> {
    const changes: Array<{ field: string; from: string; to: string | string[] }> = [];
    for (const policy of policiesForCategory(category)) {
        const raw = frontmatter[policy.field];
        if (raw === undefined || raw === null) continue;

        if (policy.cardinality === 'single') {
            const text = String(raw).trim();
            if (!text) continue;
            // 已是链接（或含链接）→ 跳过
            if (text.includes('[[')) continue;
            const names = parseLinkValue(text);
            if (names.length === 0) continue;
            changes.push({ field: policy.field, from: text, to: formatSingleLinkValue(names) });
            continue;
        }

        // list：数组或分隔串；全部项已是链接则跳过
        const items = Array.isArray(raw) ? raw.map((item) => String(item)) : [String(raw)];
        if (items.length === 0 || items.every((item) => item.trim().startsWith('[['))) continue;
        const names = parseLinkValue(items.join('、'));
        if (names.length === 0) continue;
        changes.push({ field: policy.field, from: items.join(', '), to: formatListLinkValue(names) });
    }
    return changes;
}

/**
 * 扫描项目四类实体，生成迁移计划（不写任何文件）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
  * @returns EntityLinkMigrationPlan 实例
 */
export function scanEntityLinkMigration(app: App, project: string): EntityLinkMigrationPlan {
    const vaultMeta = new ObsidianVaultMeta(app);
    const plan: EntityLinkMigrationPlan = { scanned: 0, changes: [] };

    for (const { category, dir } of CATEGORY_DIRS) {
        const dirPath = dir(project);
        for (const file of app.vault.getFiles()) {
            if (!file.path.startsWith(`${dirPath}/`) || !file.path.endsWith('.md')) continue;
            plan.scanned++;
            const fm = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
            if (!fm) continue;
            for (const change of planEntityLinkChanges(category, fm)) {
                plan.changes.push({ path: file.path, entity: file.basename, category, ...change });
            }
        }
    }
    return plan;
}

/**
 * 执行迁移：按计划逐文件写 frontmatter（写锁）。返回成功写入的文件数
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param plan - 计划
 * @returns 数值结果
 */
export async function applyEntityLinkMigration(
    app: App,
    project: string,
    plan: EntityLinkMigrationPlan,
): Promise<number> {
    const fs = new ObsidianFileSystem(app);
    const frontmatter = new ObsidianFrontmatter(app);
    const vaultMeta = new ObsidianVaultMeta(app);

    const byPath = new Map<string, EntityLinkChange[]>();
    for (const change of plan.changes) {
        const list = byPath.get(change.path) || [];
        list.push(change);
        byPath.set(change.path, list);
    }

    let written = 0;
    for (const [path, changes] of byPath) {
        const file = vaultMeta.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        try {
            await withWriteLock(path, async () => {
                await frontmatter.processFrontmatter(file, (fm: Record<string, unknown>) => {
                    for (const change of changes) {
                        fm[change.field] = change.to;
                    }
                });
            });
            written++;
        } catch (e) {
            log.warn('[EntityLinkMigrator] 迁移写入失败:', path, e);
        }
    }
    void fs;
    return written;
}
