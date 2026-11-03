/**
 * chapter-target.ts — 命令层的章节上下文解析（纯函数）
 *
 * 快捷工具在工作台/项目页没有 activeFile，必须用界面当前章节作为上下文。
 * 解析优先级固定为：工作台上下文 > activeFile 标准正文 > activeFile 步骤结果目录。
 */

export interface WorkbenchChapterContext {
    project: string;
    volume: string;
    chapterName: string;
    chapterNum: number;
    chapDir: string;
}

/**
 * 活动章节目标结构定义。
 */
export interface ActiveChapterTarget extends WorkbenchChapterContext {
    bodyPath: string;
}

/**
 * 解析章节目标输入结构定义。
 */
export interface ResolveChapterTargetInput {
    /** 工作台写入的当前章节上下文 */
    workbench: WorkbenchChapterContext | null;
    /** 当前活动文件路径（无活动文件时为 null） */
    activeFilePath: string | null;
    /**
     * 可选：把「项目+卷+章」解析成已存在的正文文件路径。
     * 命令层传入 vault 查询，纯函数层保持无 Obsidian 依赖。
     */
    resolveBodyPath?: (project: string, volume: string, chapterNum: number) => string | null;
}

const BODY_PATH_RE = /^(.+?)\/03-大纲与章节\/正文\/(第\d+卷)\/(第\d+章)[^/]*_正文\.md$/;
const STEP_DIR_RE = /^(.+?)\/03-大纲与章节\/步骤结果\/(第\d+卷)\/(第\d+章)/;

/**
 * 从「第N章」中取章节号
 *
 * @param chapterName - 章节名
 * @returns 数值结果
 */
function chapterNumber(chapterName: string): number {
    return parseInt(chapterName.match(/\d+/)?.[0] || '0', 10);
}

/**
 * 从「第N卷」中取卷号
 *
 * @param volume - 卷
 * @returns 数值结果
 */
export function volumeNumber(volume: string): number {
    return parseInt(volume.match(/第(\d+)卷/)?.[1] || '0', 10);
}

/**
 * 解析活动章节目标。
 * @param input - 输入
  * @returns ActiveChapterTarget 或 null
 */
export function resolveActiveChapterTarget(input: ResolveChapterTargetInput): ActiveChapterTarget | null {
    const { workbench, activeFilePath } = input;

    if (workbench?.project && workbench.chapterNum > 0 && volumeNumber(workbench.volume) > 0) {
        return {
            ...workbench,
            bodyPath: input.resolveBodyPath?.(workbench.project, workbench.volume, workbench.chapterNum)
                ?? `${workbench.project}/03-大纲与章节/正文/${workbench.volume}/第${workbench.chapterNum}章_正文.md`,
        };
    }

    if (!activeFilePath) return null;

    const bodyMatch = activeFilePath.match(BODY_PATH_RE);
    if (bodyMatch) {
        const project = bodyMatch[1];
        const volume = bodyMatch[2];
        const chapterName = bodyMatch[3];
        const chapterNum = chapterNumber(chapterName);
        if (chapterNum > 0) {
            return {
                project,
                volume,
                chapterName,
                chapterNum,
                chapDir: `${project}/03-大纲与章节/步骤结果/${volume}/${chapterName}`,
                bodyPath: activeFilePath,
            };
        }
    }

    const stepMatch = activeFilePath.match(STEP_DIR_RE);
    if (stepMatch) {
        const project = stepMatch[1];
        const volume = stepMatch[2];
        const chapterName = stepMatch[3];
        const chapterNum = chapterNumber(chapterName);
        if (chapterNum > 0) {
            return {
                project,
                volume,
                chapterName,
                chapterNum,
                chapDir: `${project}/03-大纲与章节/步骤结果/${volume}/${chapterName}`,
                bodyPath: input.resolveBodyPath?.(project, volume, chapterNum)
                    ?? `${project}/03-大纲与章节/正文/${volume}/${chapterNum ? `第${chapterNum}章` : chapterName}_正文.md`,
            };
        }
    }

    return null;
}
