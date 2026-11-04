/**
 * project-health-service.ts — 项目体检（M2 MVP）
 *
 * 只做四类能直接定位到文件的问题：
 * - 重复正文：同一卷/同一单元编号出现多份正文；
 * - 未结算：正文已写（>1500 字节）但 frontmatter 不是 settled/已结算/已完稿；
 * - frontmatter 异常：分隔符未闭合、重复顶层键；
 * - 正文目录里的非正文文件：可能是备份/手滑复制，容易被统计与导出漏掉。
 *
 * 不自动修复：体检只给路径与原因，修复动作由用户决定。
 */
import { App, TFile } from 'obsidian';
import { listProjectIds } from '@/shared/project-catalog';
import { resolveProjectMode } from '@/shared/project-mode';
import type { CreationMode } from '@/shared/creation-mode';
import { listFolderFiles } from '@/shared/vault-tree';
import { isChapterBodyPath } from '@/shared/body-path';
import { listModeUnits } from '@/shared/mode-content';
import { dedupeFrontmatterKeys } from '@/shared/frontmatter';
import { extractFrontmatter, isChapterSettledText } from '@/shared/chapter-status';

/** 体检问题类型。 */
export type ProjectHealthIssueKind = 'duplicate-body' | 'unsettled' | 'bad-frontmatter' | 'orphan-body';

/** 单条体检问题。 */
export interface ProjectHealthIssue {
    kind: ProjectHealthIssueKind;
    severity: 'warning' | 'error';
    path: string;
    label: string;
    detail: string;
}

/** 项目体检报告。 */
export interface ProjectHealthReport {
    project: string;
    mode: CreationMode;
    checkedBodies: number;
    issues: ProjectHealthIssue[];
    summary: Record<ProjectHealthIssueKind, number>;
}

interface BodyEntry {
    file: TFile;
    key: string;
    volume: string;
    number: number;
    label: string;
}

const WRITTEN_BYTES = 1500;

function volumeOf(path: string): string {
    const match = path.match(/\/(第\d+卷)\//);
    return match ? match[1] : '';
}

function chapterNumberOf(name: string): number | null {
    const match = name.match(/第(\d+)[章节集回幕]/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    return Number.isFinite(value) ? value : null;
}

function emptySummary(): Record<ProjectHealthIssueKind, number> {
    return { 'duplicate-body': 0, unsettled: 0, 'bad-frontmatter': 0, 'orphan-body': 0 };
}

function collectLongBodyEntries(app: App, project: string): BodyEntry[] {
    const dir = `${project}/03-大纲与章节/正文`;
    const files = listFolderFiles<TFile>(app.vault, dir, { recursive: true });
    const entries: BodyEntry[] = [];
    for (const file of files) {
        if (!(file instanceof TFile) || !isChapterBodyPath(file.path)) continue;
        const number = chapterNumberOf(file.name);
        if (number === null) continue;
        const volume = volumeOf(file.path);
        entries.push({
            file,
            key: `${volume || '正文'}/${number}`,
            volume,
            number,
            label: `${volume || '正文'} · 第${number}章`,
        });
    }
    return entries;
}

function collectModeBodyEntries(app: App, project: string, mode: CreationMode): BodyEntry[] {
    const units = listModeUnits(app, project, mode);
    return units.map(unit => ({
        file: unit.file,
        key: `${mode}/${unit.number}`,
        volume: '',
        number: unit.number,
        label: unit.unitName,
    }));
}

function collectOrphanBodies(app: App, project: string, mode: CreationMode): ProjectHealthIssue[] {
    const bodyDirs = mode === 'long'
        ? [`${project}/03-大纲与章节/正文`]
        : [`${project}/短篇创作/03-正文`, `${project}/剧本创作/03-剧本`, `${project}/03-大纲与章节/正文`];
    const issues: ProjectHealthIssue[] = [];
    for (const dir of bodyDirs) {
        const files = listFolderFiles<TFile>(app.vault, dir, { recursive: true });
        for (const file of files) {
            if (!(file instanceof TFile)) continue;
            if (!file.name.endsWith('.md')) continue;
            if (isChapterBodyPath(file.path)) continue;
            issues.push({
                kind: 'orphan-body',
                severity: 'warning',
                path: file.path,
                label: file.name,
                detail: '位于正文目录但不是可识别的章节正文（备份/复件？），导出与统计可能忽略。',
            });
        }
    }
    return issues;
}

/**
 * 体检单个项目。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目 ID（vault 相对路径）
 * @returns 体检报告
 */
export async function analyzeProjectHealth(app: App, project: string): Promise<ProjectHealthReport> {
    const mode = await resolveProjectMode(app, project);
    const entries = mode === 'long'
        ? collectLongBodyEntries(app, project)
        : collectModeBodyEntries(app, project, mode);
    const issues: ProjectHealthIssue[] = [];
    const summary = emptySummary();

    const byKey = new Map<string, BodyEntry[]>();
    for (const entry of entries) {
        const list = byKey.get(entry.key) ?? [];
        list.push(entry);
        byKey.set(entry.key, list);
    }
    for (const list of byKey.values()) {
        if (list.length < 2) continue;
        for (const entry of list) {
            issues.push({
                kind: 'duplicate-body',
                severity: 'error',
                path: entry.file.path,
                label: entry.label,
                detail: `${entry.label} 存在 ${list.length} 份正文，请确认哪一份是唯一来源。`,
            });
            summary['duplicate-body'] += 1;
        }
    }

    for (let i = 0; i < entries.length; i += 6) {
        const batch = entries.slice(i, i + 6);
        const contents = await Promise.all(batch.map(entry => Promise.resolve(app.vault.cachedRead(entry.file)).catch(() => '')));
        for (let j = 0; j < batch.length; j++) {
            const entry = batch[j];
            const content = contents[j];
            if (content && content.replace(/^\uFEFF/, '').startsWith('---')
                && extractFrontmatter(content) === null) {
                issues.push({
                    kind: 'bad-frontmatter',
                    severity: 'error',
                    path: entry.file.path,
                    label: entry.label,
                    detail: 'frontmatter 分隔符未闭合，属性/状态将无法被 Obsidian 解析。',
                });
                summary['bad-frontmatter'] += 1;
            } else if (content && dedupeFrontmatterKeys(content) !== content) {
                issues.push({
                    kind: 'bad-frontmatter',
                    severity: 'error',
                    path: entry.file.path,
                    label: entry.label,
                    detail: 'frontmatter 存在重复顶层键，结算写入可能失败。',
                });
                summary['bad-frontmatter'] += 1;
            }

            if (entry.file.stat.size > WRITTEN_BYTES && !isChapterSettledText(content)) {
                issues.push({
                    kind: 'unsettled',
                    severity: 'warning',
                    path: entry.file.path,
                    label: entry.label,
                    detail: '正文已写但未结算；人物状态、伏笔与连续性不会更新。',
                });
                summary.unsettled += 1;
            }
        }
    }

    for (const issue of collectOrphanBodies(app, project, mode)) {
        issues.push(issue);
        summary['orphan-body'] += 1;
    }

    return { project, mode, checkedBodies: entries.length, issues, summary };
}

/**
 * 体检所有项目（主页/批量入口用；项目多时可能较慢）。
 *
 * @param app - Obsidian 应用实例
 * @returns 报告数组
 */
export async function analyzeAllProjectHealth(app: App): Promise<ProjectHealthReport[]> {
    const reports: ProjectHealthReport[] = [];
    for (const project of listProjectIds(app)) {
        try {
            reports.push(await analyzeProjectHealth(app, project));
        } catch {
            // 单个项目读失败不应中断其它项目；报告里体现为没有数据
        }
    }
    return reports;
}
