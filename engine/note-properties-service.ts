/**
 * note-properties-service.ts — 笔记属性的三类维护动作
 *
 * 1. 生成/刷新项目 Bases 看板（写 `.看板/*.base`）；
 * 2. 补齐分层标签（存量文件追加 `nw/*`，只加不删）；
 * 3. 补齐缺失属性（按 frontmatter-schema 的 required，只补空值）。
 *
 * 后两者都提供 **dry-run 计划**（纯函数），UI 先预览再执行。
 */
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import {
    findMissingProperties,
    resolveFileKind,
    FRONTMATTER_SCHEMAS,
    readTagList,
    type NotebookFileKind,
} from '@/shared/frontmatter-schema';
import { formatTagArray, missingNamespaceTags, withNamespaceTags } from '@/shared/tag-taxonomy';
import { BASE_DIR, baseFilePath, buildProjectBases } from './bases-generator';
import { withWriteLock } from '@/shared/write-lock';
import { createLogger } from '@/shared/logger';

import { ObsidianFrontmatter } from '@/shared/file-system-port';
const log = createLogger('NoteProperties');

/**
 * 标签迁移变更结构定义。
 */
export interface TagMigrationChange {
    path: string;
    kind: NotebookFileKind;
    /** 现有标签 */
    tags: string[];
    /** 需要追加的层级标签 */
    add: string[];
}

/**
 * PropertyCompletionChange 类型定义。
 */
export interface PropertyCompletionChange {
    path: string;
    kind: NotebookFileKind;
    /** 缺失属性 → 将写入的默认值 */
    fill: Array<{ key: string; value: string | number | string[] }>;
}

/**
 * ProjectFilesScan 类型定义。
 */
export interface ProjectFilesScan {
    files: TFile[];
    skipped: number;
}

/**
 * 扫描项目内所有 markdown（排除模板/导出/看板目录）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
  * @returns ProjectFilesScan 实例
 */
export function listProjectNotes(app: App, project: string): ProjectFilesScan {
    const excluded = ['/00-系统模板/', '/.看板/', '/05-导出/', '/06-导出/', '/04-质检/'];
    const files: TFile[] = [];
    let skipped = 0;
    for (const file of app.vault.getFiles()) {
        if (!file.path.startsWith(`${project}/`) || !file.path.endsWith('.md')) continue;
        if (excluded.some((segment) => file.path.includes(segment))) {
            skipped++;
            continue;
        }
        files.push(file);
    }
    return { files, skipped };
}

/**
 * 纯函数：给一个文件的 frontmatter 算标签迁移变更
 *
 * @param path - 路径
 * @param frontmatter - frontmatter
  * @returns TagMigrationChange 或 null
 */
export function planTagMigrationForFile(
    path: string,
    frontmatter: Record<string, unknown> | null | undefined,
): TagMigrationChange | null {
    const tags = readTagList(frontmatter?.['tags']);
    const add = missingNamespaceTags(tags);
    if (add.length === 0) return null;
    return { path, kind: resolveFileKind(frontmatter, path), tags, add };
}

/**
 * 扫描项目，生成标签迁移计划（不写文件）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export function scanTagMigration(app: App, project: string): TagMigrationChange[] {
    const changes: TagMigrationChange[] = [];
    for (const file of listProjectNotes(app, project).files) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        const plan = planTagMigrationForFile(file.path, fm);
        if (plan) changes.push(plan);
    }
    return changes;
}

/**
 * 纯函数：属性补齐计划（只补必填且缺失的属性）
 *
 * @param path - 路径
 * @param frontmatter - frontmatter
  * @returns PropertyCompletionChange 或 null
 */
export function planPropertyCompletionForFile(
    path: string,
    frontmatter: Record<string, unknown> | null | undefined,
): PropertyCompletionChange | null {
    const kind = resolveFileKind(frontmatter, path);
    if (kind === 'unknown') return null;
    const missing = findMissingProperties(kind, frontmatter);
    if (missing.length === 0) return null;
    const fill = missing.map((spec) => ({
        key: spec.key,
        value: spec.defaultValue ?? (spec.type === 'number' ? 0 : spec.type === 'list' ? [] : ''),
    }));
    return { path, kind, fill };
}

/**
 * 扫描项目，生成属性补齐计划
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export function scanPropertyCompletion(app: App, project: string): PropertyCompletionChange[] {
    const changes: PropertyCompletionChange[] = [];
    for (const file of listProjectNotes(app, project).files) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        const plan = planPropertyCompletionForFile(file.path, fm);
        if (plan) changes.push(plan);
    }
    return changes;
}

function processFrontmatter(app: App, file: TFile, mutate: (fm: Record<string, unknown>) => void): Promise<void> {
    // 唯一 frontmatter 入口：重复键自愈（旧实现直接 fileManager.processFrontMatter，
    // 历史文件有重复顶层键时会抛 Map keys must be unique，属性补齐整体失败）。
    return new ObsidianFrontmatter(app).processFrontmatter(file, mutate);
}

/**
 * 无 fileManager 时的文本级兜底：只在已有 frontmatter 上改 `tags`/简单标量
 *
 * @param raw - 原始
 * @param mutate - 变更函数
 * @returns 文本结果
 */
function applyFrontmatterTextPatch(raw: string, mutate: (fm: Record<string, unknown>) => Record<string, unknown>): string {
    const matched = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!matched) return raw;
    const fm: Record<string, unknown> = {};
    for (const line of matched[1].split(/\r?\n/)) {
        const pair = line.match(/^([^:]+):\s*(.*)$/);
        if (!pair) continue;
        const key = pair[1].trim();
        const value = pair[2].trim();
        if (!key) continue;
        if (value.startsWith('[') && value.endsWith(']')) {
            fm[key] = value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
        } else {
            fm[key] = value;
        }
    }
    const next = mutate(fm);
    const lines: string[] = [];
    for (const [key, value] of Object.entries(next)) {
        if (Array.isArray(value)) lines.push(`${key}: ${formatTagArray(value.map(String))}`);
        else if (typeof value === 'number') lines.push(`${key}: ${value}`);
        else lines.push(`${key}: ${String(value)}`);
    }
    return raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${lines.join('\n')}\n---`);
}

/**
 * 执行标签迁移（写锁 + 幂等）
 *
 * @param app - Obsidian 应用实例
 * @param changes - 变更
  * @returns number }> 结果
 */
export async function applyTagMigration(app: App, changes: TagMigrationChange[]): Promise<{ written: number; added: number }> {
    let written = 0;
    let added = 0;
    for (const change of changes) {
        const file = app.vault.getAbstractFileByPath(change.path);
        if (!(file instanceof TFile)) continue;
        try {
            let actualAdded = 0;
            await withWriteLock(change.path, () =>
                processFrontmatter(app, file, (fm) => {
                    const before = readTagList(fm['tags']).length;
                    const next = withNamespaceTags(fm['tags'], change.add);
                    fm['tags'] = next;
                    // 只统计真正新增的标签：请求里已存在的标签不能虚报
                    actualAdded = Math.max(0, readTagList(next).length - before);
                }),
            );
            written++;
            added += actualAdded;
        } catch (e) {
            log.warn('[NoteProperties] 标签迁移失败:', change.path, e);
        }
    }
    return { written, added };
}

/**
 * 执行属性补齐（只补缺失键，不覆盖已有值）
 *
 * @param app - Obsidian 应用实例
 * @param changes - 变更
  * @returns number }> 结果
 */
export async function applyPropertyCompletion(app: App, changes: PropertyCompletionChange[]): Promise<{ written: number; filled: number }> {
    let written = 0;
    let filled = 0;
    for (const change of changes) {
        const file = app.vault.getAbstractFileByPath(change.path);
        if (!(file instanceof TFile)) continue;
        try {
            let actualFilled = 0;
            await withWriteLock(change.path, () =>
                processFrontmatter(app, file, (fm) => {
                    for (const item of change.fill) {
                        const current = fm[item.key];
                        if (current === undefined || current === null || (typeof current === 'string' && current.trim() === '')) {
                            fm[item.key] = item.value;
                            actualFilled++;
                        }
                    }
                }),
            );
            written++;
            filled += actualFilled;
        } catch (e) {
            log.warn('[NoteProperties] 属性补齐失败:', change.path, e);
        }
    }
    return { written, filled };
}

/**
 * 生成/刷新项目看板；返回写出的文件路径
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export async function writeProjectBases(app: App, project: string): Promise<string[]> {
    const adapter = app.vault.adapter;
    const dir = `${project}/${BASE_DIR}`;
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);

    const written: string[] = [];
    for (const spec of buildProjectBases(project)) {
        const path = baseFilePath(project, spec.relativePath);
        // 必须走 adapter.write：`.看板/` 是以点开头的隐藏目录，Obsidian 的 vault 索引
        // 不收录它，`getAbstractFileByPath` 永远返回 null → 第二次生成会走 vault.create
        // 并以「File already exists」失败（实测：同一项目连跑两次必挂）。
        // adapter 层不受 vault 索引限制，且 write 自带覆盖语义，天然幂等。
        // write-entry-allow: `.看板/` 点目录不在 vault 索引，只能走 adapter。
        await adapter.write(path, spec.content);
        written.push(path);
    }
    return written;
}

/**
 * 供面板显示：某类型有多少必填属性（0 表示无需补齐）
 *
 * @param kind - 种类
 * @returns 数值结果
 */
export function schemaSizeOf(kind: NotebookFileKind): number {
    return (FRONTMATTER_SCHEMAS[kind] || []).length;
}