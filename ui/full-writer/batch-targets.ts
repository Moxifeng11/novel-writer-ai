/**
 * batch-targets.ts — 批量生成的目标与步骤定义（纯函数，无运行时依赖）
 *
 * 单独拆出以便单元测试：不引入 main / UI 依赖，避免测试链条触达 main.js。
 */
import { isChapterSettledText } from '../../shared/chapter-status';


/**
 * 批量流水线执行的 7 个 AI 步骤。
 * 角色灵魂（自动步骤）与质量控制（可选步骤）不在批量链路中；结算由批量 runner 单独执行。
 * 新增/删除步骤时必须同步更新命令描述、弹窗文案与 batch-targets-contract 测试。
 */
export const BATCH_STEP_KEYS = [
    'infoPlan',
    'plotDistill',
    'outline',
    'emotionPlan',
    'sceneExpand',
    'bodyGeneration',
    'analysisReport',
] as const;

export interface BatchChapterTarget {
    volume: string;
    volumeNum: number;
    chapterNum: number;
    chapterName: string;
}

/** 依据起始章号与数量生成目标列表 */
export function buildBatchTargets(
    volume: string,
    volumeNum: number,
    startChapter: number,
    count: number,
): BatchChapterTarget[] {
    const targets: BatchChapterTarget[] = [];
    const safeStart = Math.max(1, Math.floor(startChapter));
    const safeCount = Math.max(0, Math.floor(count));
    for (let i = 0; i < safeCount; i++) {
        const chapterNum = safeStart + i;
        targets.push({ volume, volumeNum, chapterNum, chapterName: `第${chapterNum}章` });
    }
    return targets;
}

/**
 * 正文是否已结算（B4：统一走 shared/chapter-status）。
 * 结算写入是追加语义，批量续跑必须据 frontmatter.status 跳过整章。
 */
export function isBodySettled(bodyText: string | undefined | null): boolean {
    return isChapterSettledText(bodyText);
}
