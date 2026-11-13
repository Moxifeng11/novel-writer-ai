/**
 * project-standard-service.ts — 项目标准校验（结构 / 文件 / 命名 / 派生数据完整性）
 *
 * 与 `services/project-health-service.ts` 的分工：
 *  - 体检（health）= 章节内容层：重复正文、未结算、坏 frontmatter、孤立正文
 *  - 标准（standard）= **项目结构层**：缺目录、缺文件、命名不符、摘要缺失、事实库损坏、标准过期
 *
 * 设计要点：
 *  - **只读**：本服务只报告问题，绝不自动修改用户文件（修复由调用方显式决定）；
 *  - 通过 `StandardFs` 端口取数据，便于单测（Mock）与 Node 脚本复用；
 *  - 问题形状复用 `ProjectHealthIssueKind` 的风格（kind/severity/path/label/detail）。
 */

import type { ProjectHealthIssueKind } from './project-health-service';
import {
    PROJECT_STANDARD,
    PROJECT_STANDARD_VERSION,
    isStandardOutdated,
    namingRuleFor,
    type ProjectStandard,
} from '@/shared/project-standard';

/** 标准校验的问题类型（在体检类型基础上扩展） */
export type StandardIssueKind =
    | ProjectHealthIssueKind
    | 'missing-dir'
    | 'missing-file'
    | 'bad-naming'
    | 'digest-missing'
    | 'fact-store-invalid'
    | 'fact-store-version'
    | 'standard-outdated';

/** 单条标准问题 */
export interface StandardIssue {
    /** 问题类型 */
    kind: StandardIssueKind;
    /** 严重度 */
    severity: 'warning' | 'error';
    /** 相关路径 */
    path: string;
    /** 简短标签 */
    label: string;
    /** 详细说明（含"怎么修"） */
    detail: string;
}

/** 标准校验报告 */
export interface StandardReport {
    /** 项目路径 */
    project: string;
    /** 项目声明的标准版本（取不到为 undefined） */
    declaredVersion?: number;
    /** 当前插件标准版本 */
    currentVersion: number;
    /** 检查过的目录数 */
    checkedDirs: number;
    /** 检查过的正文数 */
    checkedBodies: number;
    /** 问题列表 */
    issues: StandardIssue[];
    /** 按类型汇总 */
    summary: Record<string, number>;
}

/** 目录列表 */
export interface DirListing {
    /** 文件路径（含目录前缀） */
    files: string[];
    /** 子目录路径 */
    folders: string[];
}

/** 标准校验所需的文件系统端口（最小集合） */
export interface StandardFs {
    /** 路径是否存在 */
    exists(path: string): Promise<boolean>;
    /** 列目录 */
    list(path: string): Promise<DirListing>;
    /** 读文本 */
    read(path: string): Promise<string>;
}

/** 事实库路径（与 paths.ts 的 pjFactStoreFile 保持一致） */
export const FACT_STORE_REL_PATH = '04-项目总控/一致性审核/事实库.json';

/** 项目元数据文件 */
export const PROJECT_META_REL_PATH = '.project';

/**
 * 校验单个项目是否满足标准。
 *
 * @param fs - 文件端口
 * @param project - 项目路径（相对 vault 根）
 * @param standard - 标准（默认当前标准，便于测试替换）
 * @returns 报告
 */
export async function validateProjectStandard(
    fs: StandardFs,
    project: string,
    standard: ProjectStandard = PROJECT_STANDARD,
): Promise<StandardReport> {
    const issues: StandardIssue[] = [];
    let checkedDirs = 0;
    let checkedBodies = 0;

    // ① 必备目录
    for (const dir of standard.requiredDirs) {
        checkedDirs += 1;
        const path = `${project}/${dir.path}`;
        const exists = await fs.exists(path);
        if (!exists) {
            issues.push({
                kind: 'missing-dir',
                severity: 'error',
                path,
                label: '缺少必备目录',
                detail: `${dir.purpose}。修复：创建目录「${dir.path}」${dir.autoCreate ? '（可由初始化流程自动创建）' : ''}`,
            });
        }
    }

    // ② 必备文件 + 标准版本
    let declaredVersion: number | undefined;
    for (const file of standard.requiredFiles) {
        const path = `${project}/${file.path}`;
        const exists = await fs.exists(path);
        if (!exists) {
            if (!file.optional) {
                issues.push({
                    kind: 'missing-file',
                    severity: 'error',
                    path,
                    label: '缺少必备文件',
                    detail: `${file.purpose}。修复：重建项目元数据文件「${file.path}」`,
                });
            }
            continue;
        }
        if (file.path === PROJECT_META_REL_PATH) {
            declaredVersion = await readStandardVersion(fs, path);
        }
    }
    if (isStandardOutdated(declaredVersion)) {
        issues.push({
            kind: 'standard-outdated',
            severity: 'warning',
            path: `${project}/${PROJECT_META_REL_PATH}`,
            label: '项目标准版本落后',
            detail: `项目标准版本 ${declaredVersion ?? '未声明'}，当前 ${PROJECT_STANDARD_VERSION}。`
                + '修复：按体检清单补齐缺失目录/文件后，把 .project 的 standardVersion 更新为当前版本',
        });
    }

    // ③ 命名规范 + 摘要缺失（正文与摘要按章号配对）
    const bodyDir = `${project}/03-大纲与章节/正文`;
    const bodyFiles = await listFilesRecursive(fs, bodyDir);
    checkedBodies = bodyFiles.length;
    const bodyRule = namingRuleFor('03-大纲与章节/正文');
    if (bodyRule) {
        for (const file of bodyFiles) {
            if (!new RegExp(bodyRule.pattern).test(file)) {
                issues.push({
                    kind: 'bad-naming',
                    severity: 'warning',
                    path: `${bodyDir}/${file}`,
                    label: '正文命名不符规范',
                    detail: `${bodyRule.description}。修复：重命名为「第N章_正文.md」`,
                });
            }
        }
    }

    const digestDir = `${project}/04-项目总控/剧情记忆`;
    const digestFiles = await listFilesRecursive(fs, digestDir);
    const digestRule = namingRuleFor('04-项目总控/剧情记忆');
    if (digestRule) {
        for (const file of digestFiles) {
            if (!new RegExp(digestRule.pattern).test(file)) {
                issues.push({
                    kind: 'bad-naming',
                    severity: 'warning',
                    path: `${digestDir}/${file}`,
                    label: '摘要命名不符规范',
                    detail: `${digestRule.description}。修复：重命名为「第N章_摘要.md」`,
                });
            }
        }
    }
    // 摘要缺失：有正文但无对应摘要（本会话踩过的坑：无摘要 → 一致性审核 0 产出）
    const digestChapters = new Set(digestFiles.map(chapterNumOfFile).filter(n => n > 0));
    for (const file of bodyFiles) {
        const num = chapterNumOfFile(file);
        if (num <= 0) continue;
        if (digestChapters.has(num)) continue;
        issues.push({
            kind: 'digest-missing',
            severity: 'warning',
            path: `${digestDir}/第${num}章_摘要.md`,
            label: '章节摘要缺失',
            detail: `第 ${num} 章有正文但没有摘要，一致性审核会漏掉该章的事实。`
                + '修复：重新结算该章，或手动补摘要',
        });
    }

    // ④ 事实库完整性
    const factStorePath = `${project}/${FACT_STORE_REL_PATH}`;
    if (await fs.exists(factStorePath)) {
        try {
            const text = await fs.read(factStorePath);
            const parsed = JSON.parse(text) as { version?: number; facts?: unknown };
            if (!parsed || !Array.isArray(parsed.facts)) {
                issues.push({
                    kind: 'fact-store-invalid',
                    severity: 'error',
                    path: factStorePath,
                    label: '事实库结构非法',
                    detail: '事实库缺少 facts 数组。修复：删除该文件后重新结算（会重建）',
                });
            } else if (!Number.isFinite(parsed.version) || (parsed.version as number) < 1) {
                issues.push({
                    kind: 'fact-store-version',
                    severity: 'warning',
                    path: factStorePath,
                    label: '事实库版本缺失',
                    detail: '事实库缺少 version 字段。修复：由维护流程自动补齐（不影响读取）',
                });
            }
        } catch (error) {
            issues.push({
                kind: 'fact-store-invalid',
                severity: 'error',
                path: factStorePath,
                label: '事实库无法解析',
                detail: `JSON 解析失败（${error instanceof Error ? error.message : String(error)}）。`
                    + '修复：从备份恢复，或删除后重新结算重建',
            });
        }
    }

    const summary: Record<string, number> = {};
    for (const issue of issues) summary[issue.kind] = (summary[issue.kind] ?? 0) + 1;

    return {
        project,
        declaredVersion,
        currentVersion: PROJECT_STANDARD_VERSION,
        checkedDirs,
        checkedBodies,
        issues,
        summary,
    };
}

/**
 * 读 `.project` 里的 standardVersion（支持 frontmatter 与 `## key: value` 两种写法）。
 *
 * @param fs - 文件端口
 * @param path - 文件路径
 * @returns 版本号；读不到返回 undefined
 */
async function readStandardVersion(fs: StandardFs, path: string): Promise<number | undefined> {
    try {
        const text = await fs.read(path);
        const match = /standardVersion\s*[:：]\s*(\d+)/.exec(text);
        return match ? Number(match[1]) : undefined;
    } catch {
        // silent-ok: 元数据读失败按"未声明版本"处理，由 standard-outdated 提示
        return undefined;
    }
}

/**
 * 递归列目录下的文件（相对路径，不含目录前缀）。
 *
 * @param fs - 文件端口
 * @param dir - 目录路径
 * @returns 文件名列表
 */
async function listFilesRecursive(fs: StandardFs, dir: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (current: string, prefix: string): Promise<void> => {
        let listing: DirListing;
        try {
            listing = await fs.list(current);
        } catch {
            // silent-ok: 目录不存在等价于无文件，缺失目录已由 missing-dir 报告
            return;
        }
        for (const file of listing.files) {
            const name = file.startsWith(`${current}/`) ? file.slice(current.length + 1) : file.split('/').pop() ?? file;
            out.push(prefix + name);
        }
        for (const folder of listing.folders) {
            const name = folder.startsWith(`${current}/`) ? folder.slice(current.length + 1) : folder.split('/').pop() ?? folder;
            await walk(folder, `${prefix}${name}/`);
        }
    };
    await walk(dir, '');
    return out;
}

/**
 * 从文件名取章号（「第12章_正文.md」→ 12）。
 *
 * @param file - 文件名
 * @returns 章号；取不到返回 0
 */
export function chapterNumOfFile(file: string): number {
    const match = /第(\d+)章/.exec(file ?? '');
    return match ? Number(match[1]) : 0;
}
