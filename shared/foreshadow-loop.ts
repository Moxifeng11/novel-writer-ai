/**
 * foreshadow-loop.ts — 每章伏笔闭环核对（回收≥1 + 埋设≥1）
 *
 * 来源：云笔 AI「去AI味」实战规则——每章必须回收至少 1 个前文伏笔、
 * 埋下至少 1 个后续伏笔，否则章节是"孤立情节"，长线张力会断。
 *
 * 数据源都是结算链路已有的结构：
 * - 回收 = 分析报告的 UPDATE_FORESHADOW 指令（推进/揭示已有伏笔）
 * - 埋设 = NEW_FORESHADOW 指令
 * - 计划 = 信息规划「伏笔操作」小节（需回收/需埋下）
 *
 * 纯函数，不依赖 Obsidian；结算引擎负责读文件与提示。
 */

export interface ForeshadowPlan {
    /** 章纲计划回收的旧伏笔名 */
    recycle: string[];
    /** 章纲计划埋下的新伏笔名 */
    plant: string[];
}

export interface ForeshadowLoopCheck {
    /** 结算指令中推进/揭示的伏笔数（回收侧） */
    recycledCount: number;
    /** 结算指令中新增的伏笔数（埋设侧） */
    plantedCount: number;
    /** 计划回收但结算未出现的名称 */
    missingRecycle: string[];
    /** 计划埋设但结算未出现的名称 */
    missingPlant: string[];
    /** 回收≥1 且 埋设≥1 且计划项全覆盖（计划为空时只查数量） */
    pass: boolean;
    /** 一行结论，用于结算提示与执行日志 */
    summary: string;
    /** 不通过时的具体问题 */
    issues: string[];
}

const RECYCLE_VALUE_RE = /揭示|推进|回收|触发|兑现/;

function normalizeName(name: string): string {
    return String(name || '').replace(/[\s【】\[\]«»《》"]/g, '').toLowerCase();
}

/** 计划名是否被结算侧覆盖（双向包含，容忍「黑色石头」vs「石头」这类差异） */
function nameCovered(planName: string, actualNames: string[]): boolean {
    const plan = normalizeName(planName);
    if (!plan) return true;
    return actualNames.some((actual) => {
        const value = normalizeName(actual);
        return value.includes(plan) || plan.includes(value);
    });
}

/**
 * 核对本章伏笔闭环。
 * 计划为空（旧版信息规划没有伏笔操作小节）时只做数量核对。
 */
export function verifyForeshadowLoop(params: {
    /** UPDATE_FORESHADOW 指令（name + value） */
    updates: Array<{ name: string; value: string }>;
    /** NEW_FORESHADOW 指令的内容/名称列表 */
    newForeshadows: string[];
    /** 信息规划「伏笔操作」解析出的计划；缺失传空数组 */
    plan?: ForeshadowPlan;
}): ForeshadowLoopCheck {
    const updates = params.updates || [];
    const newForeshadows = params.newForeshadows || [];
    const plan = params.plan || { recycle: [], plant: [] };

    // UPDATE_FORESHADOW 本身就代表该伏笔在本章被推进/揭示（状态更新），
    // 因此只要出现指令即计入回收侧；value 关键字仅用于统计「明确推进」。
    const recycledCount = updates.filter((u) => String(u.name || '').trim().length > 0).length;
    const explicitlyAdvanced = updates.filter((u) => RECYCLE_VALUE_RE.test(u.value || '')).length;
    const plantedCount = newForeshadows.filter((name) => String(name || '').trim().length > 0).length;

    const updateNames = updates.map((u) => u.name);
    const missingRecycle = plan.recycle.filter((name) => !nameCovered(name, updateNames));
    const missingPlant = plan.plant.filter((name) => !nameCovered(name, newForeshadows));

    const issues: string[] = [];
    if (recycledCount === 0) {
        issues.push('本章没有回收任何旧伏笔（无 UPDATE_FORESHADOW 指令）；长线张力会断，建议在下一章补上，或确认本章确实是全新场景。');
    }
    if (plantedCount === 0) {
        issues.push('本章没有埋设任何新伏笔（无 NEW_FORESHADOW 指令）；连续多章无埋设会让后续无牌可打。');
    }
    for (const name of missingRecycle) {
        issues.push(`章纲计划回收「${name}」，但结算指令里没有出现它的推进/揭示。`);
    }
    for (const name of missingPlant) {
        issues.push(`章纲计划埋设「${name}」，但结算指令里没有对应的新伏笔。`);
    }

    const pass = issues.length === 0;
    const summary = pass
        ? `伏笔闭环通过：回收 ${recycledCount}${explicitlyAdvanced < recycledCount ? `（明确推进 ${explicitlyAdvanced}）` : ''}、埋设 ${plantedCount}`
        : `伏笔闭环未通过：回收 ${recycledCount}、埋设 ${plantedCount}，${issues.length} 项待处理`;

    return { recycledCount, plantedCount, missingRecycle, missingPlant, pass, summary, issues };
}
