/**
 * query-plan.ts — RAG 查询规划（纯函数）
 *
 * 旧实现每段注入都用 `outline || emotionPlan` 同一段文本检索，多段结果高度重叠。
 * 这里按「这一节到底需要什么」拆成多条带标签的查询，再由检索服务并行执行、
 * 合并去重。
 */

export interface RagQuery {
    /** 查询用途标签（遥测与 citation 用） */
    label: string;
    text: string;
    /** 相对权重（合并排序时乘算；1 = 普通） */
    weight: number;
}

export interface RagQuerySource {
    outline?: string;
    emotionPlan?: string;
    sceneObjective?: string;
    previousSceneEnding?: string;
    characterNames?: string[];
    currentText?: string;
}

/**
 * 归一化：压缩空白、去掉重复标点，避免同义查询被当成不同文本
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
export function normalizeQuery(text: string): string {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/[。，、；：！？…—]{2,}/g, '。')
        .trim();
}

/** 查询文本的最小有效长度（太短的关键词检索噪声大） */
const MIN_QUERY_CHARS = 4;
/** 单条查询上限（避免整章正文喂进 embed） */
const MAX_QUERY_CHARS = 1200;

function clip(text: string): string {
    const normalized = normalizeQuery(text);
    if (normalized.length <= MAX_QUERY_CHARS) return normalized;
    return normalized.slice(0, MAX_QUERY_CHARS);
}

/**
 * 构造查询计划：
 * - 场景目标 + 上一场景结尾（当前这一幕最相关）
 * - 情绪规划（情绪/节奏维度）
 * - 章纲（设定/结构维度）
 * - 出场人物名单（角色维度）
 * 文本相同的查询只保留权重最高的一条。
 * @param source - 来源
 * @returns 结果数组
 */
export function buildQueryPlan(source: RagQuerySource): RagQuery[] {
    const candidates: RagQuery[] = [];

    const sceneFocus = [source.sceneObjective, source.previousSceneEnding].filter(Boolean).join(' ');
    if (sceneFocus) candidates.push({ label: '当前场景', text: clip(sceneFocus), weight: 1.2 });
    if (source.emotionPlan) candidates.push({ label: '情绪弧', text: clip(source.emotionPlan), weight: 1.0 });
    if (source.outline) candidates.push({ label: '章纲', text: clip(source.outline), weight: 1.0 });
    if (source.currentText) candidates.push({ label: '正在写的正文', text: clip(source.currentText.slice(-800)), weight: 1.1 });
    const names = (source.characterNames || []).map((name) => String(name || '').trim()).filter(Boolean);
    if (names.length > 0) {
        candidates.push({ label: '出场人物', text: clip(names.slice(0, 8).join('、')), weight: 0.8 });
    }

    const byText = new Map<string, RagQuery>();
    for (const candidate of candidates) {
        if (candidate.text.length < MIN_QUERY_CHARS) continue;
        const existing = byText.get(candidate.text);
        if (!existing || candidate.weight > existing.weight) {
            byText.set(candidate.text, candidate);
        }
    }
    return [...byText.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * 查询计划是否为空（调用方据此跳过检索）
 *
 * @param plan - 计划
 * @returns 是否成功
 */
export function isQueryPlanEmpty(plan: RagQuery[]): boolean {
    return plan.length === 0;
}