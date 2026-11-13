/**
 * project-standard.ts — 小说项目的标准声明（单一真相源）
 *
 * 为什么需要它：目录与文件约定此前散落在 `shared/paths.ts` 的 20+ 个 `pj*Dir` 函数里，
 * 各模块各自引用、没有单一声明；新功能很容易写第二套约定，项目一旦缺目录/缺文件
 * 也没有任何地方能发现（本会话就踩过「无摘要项目审核 0 产出」）。
 *
 * 本模块只做**声明**，不做 IO；校验在 `services/project-standard-service.ts`。
 * 红线：不新增第二套目录约定——这里的路径必须与 `paths.ts` 保持一致。
 */

/** 标准版本（升级标准时递增，用于判断项目是否"过期"） */
export const PROJECT_STANDARD_VERSION = 1;

/** 必备目录声明 */
export interface RequiredDir {
    /** 相对项目根的路径 */
    path: string;
    /** 人类可读用途 */
    purpose: string;
    /** 缺失时能否自动创建（false 表示需用户确认/初始化） */
    autoCreate: boolean;
}

/** 必备文件声明 */
export interface RequiredFile {
    /** 相对项目根的路径 */
    path: string;
    /** 人类可读用途 */
    purpose: string;
    /** 是否允许缺失（缺失只提示，不算 error） */
    optional: boolean;
}

/** 命名规范声明 */
export interface NamingRule {
    /** 适用目录（相对项目根） */
    scope: string;
    /** 文件名必须匹配的正则（字符串形式，便于序列化与报告） */
    pattern: string;
    /** 人类可读说明 */
    description: string;
}

/** 项目标准 */
export interface ProjectStandard {
    /** 标准版本 */
    version: number;
    /** 必备目录 */
    requiredDirs: RequiredDir[];
    /** 必备文件 */
    requiredFiles: RequiredFile[];
    /** 命名规范 */
    naming: NamingRule[];
    /** 章节状态机允许值 */
    chapterStatuses: string[];
}

/**
 * 当前生效的项目标准。
 *
 * 目录/文件路径与 `shared/paths.ts` 的约定保持一致（不新造第二套）。
 */
export const PROJECT_STANDARD: ProjectStandard = {
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

/**
 * 取标准中的必备目录路径列表（便捷函数）。
 *
 * @returns 路径数组
 */
export function requiredDirPaths(): string[] {
    return PROJECT_STANDARD.requiredDirs.map(item => item.path);
}

/**
 * 取标准中某目录的命名规则。
 *
 * @param scope - 相对项目根的目录
 * @returns 规则；无则 null
 */
export function namingRuleFor(scope: string): NamingRule | null {
    return PROJECT_STANDARD.naming.find(rule => rule.scope === scope) ?? null;
}

/**
 * 判断给定标准是否落后于当前版本。
 *
 * @param version - 项目声明的标准版本（可为 undefined）
 * @returns 是否落后
 */
export function isStandardOutdated(version: number | undefined): boolean {
    if (!Number.isFinite(version)) return true;
    return (version as number) < PROJECT_STANDARD_VERSION;
}
