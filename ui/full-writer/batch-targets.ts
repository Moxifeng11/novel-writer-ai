/**
 * batch-targets.ts — 批量生成的目标与步骤定义（纯函数，无运行时依赖）
 *
 * 单独拆出以便单元测试：不引入 main / UI 依赖，避免测试链条触达 main.js。
 */

/** 批量流水线默认执行的步骤（与工作台 11 步对齐，去掉可选的 fix / 质量控制） */
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

/** frontmatter 里表示「已结算」的状态值（新值 settled，旧值兼容） */
const SETTLED_STATUS_PATTERN = /^\s*status:\s*['"]?(settled|已结算|已完稿)['"]?\s*$/m;

/**
 * 正文是否已结算（读 frontmatter 的 `status`）。
 *
 * 结算会在正文 frontmatter 写入 `status: settled`，而结算的伏笔/关系/时间线写入都是**追加**语义：
 * 对已结算的章节再结算一次，会在伏笔库与实体互信息章节里产生重复行。
 * 批量断点续跑必须据此跳过整章，而不是「步骤都在 → 再结算一遍」。
 * 只在 frontmatter 区域匹配，避免正文里出现同名字样造成误判。
 */
export function isBodySettled(bodyText: string | undefined | null): boolean {
    if (!bodyText) return false;
    const head = bodyText.slice(0, 4000);
    // 状态只写在 frontmatter 里；没有 frontmatter 就不能判定为已结算
    if (!head.startsWith('---')) return false;
    const end = head.indexOf('\n---', 3);
    const frontmatter = end > 0 ? head.slice(0, end) : head;
    return SETTLED_STATUS_PATTERN.test(frontmatter);
}
