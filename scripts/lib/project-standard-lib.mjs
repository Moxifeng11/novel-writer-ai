/**
 * project-standard-lib.mjs — 项目标准的单一实现（Node + TS 共用）
 *
 * 为什么放在 scripts/lib：门禁脚本是纯 node（不能直接 import TS），
 * 而 TS 侧（shared/project-standard.ts、services/project-standard-service.ts）
 * 需要同一份数据与校验逻辑。仓库既有模式（prod-smoke-lib）就是 lib.mjs + .d.mts，
 * 这里照做：**运行时真相在 .mjs，TS 侧只做类型化再导出**。
 */

/** 当前标准版本（升级标准时递增） */
export const PROJECT_STANDARD_VERSION = 1;

/** 当前生效的项目标准 */
export const PROJECT_STANDARD = {
    version: PROJECT_STANDARD_VERSION,
    requiredDirs: [
        { path: '01-世界架构', purpose: '世界观与实体档案总目录', autoCreate: true },
        { path: '01-世界架构/人物', purpose: '人物档案', autoCreate: true },
        { path: '01-世界架构/势力', purpose: '势力档案', autoCreate: true },
        { path: '01-世界架构/地点', purpose: '地点档案', autoCreate: true },
        { path: '01-世界架构/物品', purpose: '物品档案', autoCreate: true },
        { path: '02-时间线与伏笔', purpose: '时间线与伏笔库', autoCreate: true },
        { path: '03-大纲与章节', purpose: '大纲与正文总目录', autoCreate: true },
        { path: '03-大纲与章节/正文', purpose: '章节正文', autoCreate: true },
        { path: '03-大纲与章节/分卷大纲', purpose: '分卷大纲', autoCreate: true },
        { path: '04-项目总控', purpose: '项目元数据与派生数据', autoCreate: true },
        { path: '04-项目总控/剧情记忆', purpose: '章节摘要（一致性审核与事实拆解的输入）', autoCreate: true },
        { path: '04-项目总控/故事台账', purpose: '故事台账（事件/伏笔状态）', autoCreate: true },
    ],
    requiredFiles: [
        { path: '.project', purpose: '项目元数据（类型/标题等）', optional: false },
    ],
    naming: [
        { scope: '03-大纲与章节/正文', pattern: '第\\d+章_正文\\.md$', description: '正文文件名应为「第N章_正文.md」' },
        { scope: '04-项目总控/剧情记忆', pattern: '第\\d+章_摘要\\.md$', description: '摘要文件名应为「第N章_摘要.md」' },
    ],
    chapterStatuses: ['draft', 'written', 'settled'],
};

/** 事实库相对路径（与 paths.ts 的 pjFactStoreFile 一致） */
export const FACT_STORE_REL_PATH = '04-项目总控/一致性审核/事实库.json';

/** 项目元数据相对路径 */
export const PROJECT_META_REL_PATH = '.project';

/**
 * 必备目录路径列表。
 *
 * @returns 路径数组
 */
export function requiredDirPaths() {
    return PROJECT_STANDARD.requiredDirs.map(item => item.path);
}

/**
 * 取某目录的命名规则。
 *
 * @param scope - 相对项目根的目录
 * @returns 规则或 null
 */
export function namingRuleFor(scope) {
    return PROJECT_STANDARD.naming.find(rule => rule.scope === scope) ?? null;
}

/**
 * 判断标准是否落后。
 *
 * @param version - 项目声明版本
 * @returns 是否落后
 */
export function isStandardOutdated(version) {
    if (!Number.isFinite(version)) return true;
    return version < PROJECT_STANDARD_VERSION;
}

/**
 * 从文件名取章号。
 *
 * @param file - 文件名
 * @returns 章号；取不到 0
 */
export function chapterNumOfFile(file) {
    const match = /第(\d+)章/.exec(file ?? '');
    return match ? Number(match[1]) : 0;
}

/**
 * 读 `.project` 的 standardVersion。
 *
 * @param fs - 端口
 * @param path - 文件路径
 * @returns 版本或 undefined
 */
async function readStandardVersion(fs, path) {
    try {
        const text = await fs.read(path);
        const match = /standardVersion\s*[:：]\s*(\d+)/.exec(text);
        return match ? Number(match[1]) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * 递归列文件（相对路径）。
 *
 * @param fs - 端口
 * @param dir - 目录
 * @returns 文件名列表
 */
async function listFilesRecursive(fs, dir) {
    const out = [];
    const walk = async (current, prefix) => {
        let listing;
        try {
            listing = await fs.list(current);
        } catch {
            return;
        }
        for (const file of listing.files ?? []) {
            const name = file.startsWith(`${current}/`) ? file.slice(current.length + 1) : String(file).split('/').pop() ?? file;
            out.push(prefix + name);
        }
        for (const folder of listing.folders ?? []) {
            const name = folder.startsWith(`${current}/`) ? folder.slice(current.length + 1) : String(folder).split('/').pop() ?? folder;
            await walk(folder, `${prefix}${name}/`);
        }
    };
    await walk(dir, '');
    return out;
}

/**
 * 校验单个项目是否满足标准（只读，不修改任何文件）。
 *
 * @param fs - 文件端口 { exists, read, list }
 * @param project - 项目路径（相对 vault 根）
 * @param standard - 标准（默认当前，便于测试替换）
 * @returns 报告
 */
export async function validateProjectStandard(fs, project, standard = PROJECT_STANDARD) {
    const issues = [];
    let checkedDirs = 0;
    let checkedBodies = 0;
    const push = (issue) => issues.push(issue);

    for (const dir of standard.requiredDirs) {
        checkedDirs += 1;
        const path = `${project}/${dir.path}`;
        if (!(await fs.exists(path))) {
            push({
                kind: 'missing-dir',
                severity: 'error',
                path,
                label: '缺少必备目录',
                detail: `${dir.purpose}。修复：创建目录「${dir.path}」${dir.autoCreate ? '（可由初始化流程自动创建）' : ''}`,
            });
        }
    }

    let declaredVersion;
    for (const file of standard.requiredFiles) {
        const path = `${project}/${file.path}`;
        if (!(await fs.exists(path))) {
            if (!file.optional) {
                push({
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
        push({
            kind: 'standard-outdated',
            severity: 'warning',
            path: `${project}/${PROJECT_META_REL_PATH}`,
            label: '项目标准版本落后',
            detail: `项目标准版本 ${declaredVersion ?? '未声明'}，当前 ${PROJECT_STANDARD_VERSION}。`
                + '修复：按体检清单补齐缺失目录/文件后，把 .project 的 standardVersion 更新为当前版本',
        });
    }

    const bodyDir = `${project}/03-大纲与章节/正文`;
    const bodyFiles = await listFilesRecursive(fs, bodyDir);
    checkedBodies = bodyFiles.length;
    const bodyRule = namingRuleFor('03-大纲与章节/正文');
    if (bodyRule) {
        for (const file of bodyFiles) {
            if (!new RegExp(bodyRule.pattern).test(file)) {
                push({
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
                push({
                    kind: 'bad-naming',
                    severity: 'warning',
                    path: `${digestDir}/${file}`,
                    label: '摘要命名不符规范',
                    detail: `${digestRule.description}。修复：重命名为「第N章_摘要.md」`,
                });
            }
        }
    }
    const digestChapters = new Set(digestFiles.map(chapterNumOfFile).filter(n => n > 0));
    for (const file of bodyFiles) {
        const num = chapterNumOfFile(file);
        if (num <= 0 || digestChapters.has(num)) continue;
        push({
            kind: 'digest-missing',
            severity: 'warning',
            path: `${digestDir}/第${num}章_摘要.md`,
            label: '章节摘要缺失',
            detail: `第 ${num} 章有正文但没有摘要，一致性审核会漏掉该章的事实。修复：重新结算该章，或手动补摘要`,
        });
    }

    const factStorePath = `${project}/${FACT_STORE_REL_PATH}`;
    if (await fs.exists(factStorePath)) {
        try {
            const text = await fs.read(factStorePath);
            const parsed = JSON.parse(text);
            if (!parsed || !Array.isArray(parsed.facts)) {
                push({
                    kind: 'fact-store-invalid',
                    severity: 'error',
                    path: factStorePath,
                    label: '事实库结构非法',
                    detail: '事实库缺少 facts 数组。修复：删除该文件后重新结算（会重建）',
                });
            } else if (!Number.isFinite(parsed.version) || parsed.version < 1) {
                push({
                    kind: 'fact-store-version',
                    severity: 'warning',
                    path: factStorePath,
                    label: '事实库版本缺失',
                    detail: '事实库缺少 version 字段。修复：由维护流程自动补齐（不影响读取）',
                });
            }
        } catch (error) {
            push({
                kind: 'fact-store-invalid',
                severity: 'error',
                path: factStorePath,
                label: '事实库无法解析',
                detail: `JSON 解析失败（${error instanceof Error ? error.message : String(error)}）。修复：从备份恢复，或删除后重新结算重建`,
            });
        }
    }

    const summary = {};
    for (const issue of issues) summary[issue.kind] = (summary[issue.kind] ?? 0) + 1;

    return { project, declaredVersion, currentVersion: PROJECT_STANDARD_VERSION, checkedDirs, checkedBodies, issues, summary };
}
