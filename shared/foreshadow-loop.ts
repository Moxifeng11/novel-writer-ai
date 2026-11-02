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

/**
 * ForeshadowLoopCheck 类型定义。
 */
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
    // 中文弯引号/直角引号必须一起去掉：真实章纲写「裴无极“记下名字”」，
    // 只剥 ASCII 引号会让计划名与结算指令永远对不上（实测误报 missing）。
    // 用 \u 转义写引号，避免源码编码差异把正则里的引号吃掉。
    return String(name || '')
        .replace(/[\s【】\[\]«»《》“”‘’「」『』"]/g, '')
        .replace(/[\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f"']/g, '')
        .toLowerCase();
}

/**
 * 比较用名称：去掉「的/之/了」这类虚词，容忍「姜晚的断口」vs「姜晚剑柄缠绳断口」
 *
 * @param normalized - 规范化
 * @returns 文本结果
 */
function compareForm(normalized: string): string {
    return normalized.replace(/[的之了个着]/g, '');
}

/**
 * 计划名的 2-gram 被实际名覆盖的比例（容忍「姜晚的断口」vs「姜晚剑柄缠绳断口」）
 *
 * @param plan - 计划
 * @param actual - 实际
 * @returns 数值结果
 */
function bigramCoverage(plan: string, actual: string): number {
    if (plan.length < 2) return actual.includes(plan) ? 1 : 0;
    let hit = 0;
    let total = 0;
    for (let i = 0; i + 1 < plan.length; i++) {
        total += 1;
        if (actual.includes(plan.slice(i, i + 2))) hit += 1;
    }
    return total === 0 ? 0 : hit / total;
}

/** 相似名覆盖阈值：章纲名是人工简写，结算名是模型描述，允许一定差异 */
const NAME_COVERAGE_THRESHOLD = 0.6;

/**
 * 计划名是否被结算侧覆盖（双向包含 + 2-gram 覆盖，容忍人工简写与模型描述的差异）
 *
 * @param planName - 计划名称
 * @param actualNames - 实际名称列表
 * @returns 是否成功
 */
function nameCovered(planName: string, actualNames: string[]): boolean {
    const plan = normalizeName(planName);
    if (!plan) return true;
    const planCmp = compareForm(plan);
    return actualNames.some((actual) => {
        const value = normalizeName(actual);
        if (!value) return false;
        if (value.includes(plan) || plan.includes(value)) return true;
        const valueCmp = compareForm(value);
        if (valueCmp.includes(planCmp) || planCmp.includes(valueCmp)) return true;
        // 短名（≤2 字）不做覆盖率判断，避免「三个月」误配任意含「个月」的名称
        if (planCmp.length <= 2) return false;
        return bigramCoverage(planCmp, valueCmp) >= NAME_COVERAGE_THRESHOLD;
    });
}

/**
 * 核对本章伏笔闭环。
 * 计划为空（旧版信息规划没有伏笔操作小节）时只做数量核对。
 * @param params - 参数集合
  * @returns ForeshadowLoopCheck 实例
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
