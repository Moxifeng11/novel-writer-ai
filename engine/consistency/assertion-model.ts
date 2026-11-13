/**
 * assertion-model.ts — 一致性审核的断言与证据链模型
 *
 * 设计依据：ConStory-Bench（arXiv 2603.05890）§2.2 的 5 类 19 子类分类学。
 * 本批（DSH 一致性 MVP 第一批）只实现其中 **9 个子类**，即论文实测的
 * 两大主导失效模式：
 *  - Factual & Detail（事实与细节）：命名混淆 / 数量不符 / 外貌不符
 *  - Timeline & Plot Logic（时间线与情节逻辑）：绝对时间 / 时长 / 同时性 /
 *    无因之果 / 因果违规 / 废弃情节元素
 *
 * 核心概念：
 *  - **断言（Assertion）**：把散落在章节摘要、人物档案、台账、事实索引里的事实
 *    归一化成「主语 + 谓语 + 值」的可比较结构；
 *  - **矛盾（Contradiction）**：两条断言（或断言与正文）互斥，且**必须**给出
 *    双侧原文引文与位置——没有证据的判定一律丢弃（论文 §2.3 Stage 3 的要求）。
 */

/**
 * 断言种类：映射 ConStory-Bench 的子类。
 *
 * 命名与论文保持一一对应，便于后续扩展与对外解释。
 */
export type AssertionKind =
    // —— Factual & Detail Consistency（事实与细节）——
    /** 命名混淆：同一实体在不同章节被叫成不同名字 */
    | 'nomenclature'
    /** 数量不符：年龄 / 距离 / 金额 / 人数 前后不一致 */
    | 'quantitative'
    /** 外貌不符：与人物档案中的外貌特征冲突 */
    | 'appearance'
    // —— Timeline & Plot Logic（时间线与情节逻辑）——
    /** 绝对时间矛盾：明确的时间点互相冲突 */
    | 'absolute-time'
    /** 时长矛盾：「三日」与「两个月」不相容 */
    | 'duration'
    /** 同时性矛盾：同一时刻在不同章节被描述为不同地点/状态 */
    | 'simultaneity'
    /** 无因之果：结果出现但前文没有触发原因 */
    | 'causeless-effect'
    /** 因果逻辑违规：因果链方向或条件冲突 */
    | 'causal-violation'
    /** 废弃情节元素：伏笔被标记废弃/长期未回收 */
    | 'abandoned-plot'
    // —— Characterization（人物刻画）——
    /** 记忆矛盾：同一角色对同一事既记得又忘了 */
    | 'memory'
    /** 知识矛盾：角色使用了尚未获得的知情 */
    | 'knowledge'
    /** 能力波动：能力/修为前后跃迁缺少过程 */
    | 'skill-fluctuation'
    /** 遗忘能力：曾展示的能力后文消失 */
    | 'forgotten-ability'
    // —— World-building & Setting（世界观设定）——
    /** 核心规则违规：设定中「不能/无法」的事被做成 */
    | 'core-rule'
    /** 社会规范违规：礼法/身份秩序被违背且无解释 */
    | 'social-norm'
    /** 地理矛盾：距离/方位与已建立地理不符 */
    | 'geographical'
    // —— Narrative & Style（叙事与文风）——
    /** 视角混乱：同章人称视角混用 */
    | 'perspective'
    /** 语气不一致：叙述语气突变 */
    | 'tone'
    /** 文风漂移：相邻章文风显著跳变 */
    | 'style-shift';

/** 断言所属的五大类（对应论文顶层分类） */
export type AssertionCategory = 'factual' | 'timeline';

/** 断言来源：决定可信度排序 */
export type AssertionSource =
    /** 人物档案 frontmatter（结构化、人工/AI 维护，可信度最高） */
    | 'frontmatter'
    /** 章节摘要的 facts[]（LLM 抽取，自由文本） */
    | 'digest-fact'
    /** 章节摘要的 timeSpan */
    | 'digest-time'
    /** LLM 知识库拆解（带引文校验与有效区间） */
    | 'llm-decompose'
    /** 事实库（结构化事实的唯一持久源，可人工修正） */
    | 'fact-store'
    /** 结构化台账 EventRecord（含行号） */
    | 'ledger-event'
    /** 事实索引里已人工确认的事实（命名基准） */
    | 'fact-index';

/**
 * 事实断言。
 *
 * `chapterKey` / `quote` 是**证据**的最小要求；`offset` 由配对阶段用引文在正文里
 * 定位后回填（不在抽取阶段做，避免抽取依赖全文）。
 */
export interface FactAssertion {
    /** 稳定 id：由 kind + subject + predicate + chapterKey 派生，便于增量去重 */
    id: string;
    /** 断言种类 */
    kind: AssertionKind;
    /** 主语：人物名 / 地名 / 物件名 / 事件名 */
    subject: string;
    /** 谓语：年龄 / 距离 / 位置 / 修为等级 / 时间点 / 称呼 … */
    predicate: string;
    /** 归一化后的值（数值型为数字字符串，可直接比较） */
    value: string;
    /** 数值型断言的原生数值（用于容差比较）；非数值为 undefined */
    numericValue?: number;
    /** 单位（如「岁」「里」「日」） */
    unit?: string;
    /** 所属章节 key（项目内唯一，如「第1卷/第3章」） */
    chapterKey: string;
    /** 章节序号；未知为 null */
    chapterNum: number | null;
    /** 原文引文（用于展示与定位） */
    quote: string;
    /** 是否描述当前状态（false = 回溯；缺省视为 true，兼容旧数据） */
    isCurrentState?: boolean;
    /** 正文中的字符偏移；定位前为 undefined */
    offset?: number;
    /** 来源 */
    source: AssertionSource;
    /** 抽取时间戳（增量合并用） */
    extractedAt: number;
}

/** 证据：一条引文 + 出处 */
export interface ConsistencyEvidence {
    /** 原文引文 */
    quote: string;
    /** 所属章节 key */
    chapterKey: string;
    /** 正文字符偏移（已定位时填充） */
    offset?: number;
}

/** 判定来源：规则层免费全量，LLM 层只判疑似 */
export type ContradictionDecision = 'rule' | 'llm';

/**
 * 矛盾判定结果（证据链）。
 *
 * 严格遵循论文 §2.3 的三要素：Reasoning（为何矛盾）+ Evidence（双侧引文与位置）
 * + Conclusion（错误类型）。缺 reasoning 或任一侧引文的判定**不得**产出。
 */
export interface ConsistencyContradiction {
    /** 稳定 id */
    id: string;
    /** 错误类型 */
    kind: AssertionKind;
    /** 顶层分类 */
    category: AssertionCategory;
    /** 主语 */
    subject: string;
    /** 谓语 */
    predicate: string;
    /** 为何是矛盾（人类可读） */
    reasoning: string;
    /** 证据 A（通常是较早的章节 / 权威档案） */
    evidenceA: ConsistencyEvidence;
    /** 证据 B（较新的章节 / 正文） */
    evidenceB: ConsistencyEvidence;
    /** 由规则层还是 LLM 判定 */
    decidedBy: ContradictionDecision;
    /** 置信度 0–1（规则层按命中强度给分） */
    confidence: number;
}

/**
 * 断言种类的元信息：中文标签、所属大类、默认严重度。
 *
 * 导出成常量便于 UI 与报告复用，避免各处散落映射表。
 */
export const ASSERTION_KIND_META: Record<
    AssertionKind,
    { category: AssertionCategory; label: string; severity: 'high' | 'medium' }
> = {
    nomenclature: { category: 'factual', label: '命名混淆', severity: 'high' },
    quantitative: { category: 'factual', label: '数量不符', severity: 'high' },
    appearance: { category: 'factual', label: '外貌不符', severity: 'medium' },
    'absolute-time': { category: 'timeline', label: '绝对时间矛盾', severity: 'high' },
    duration: { category: 'timeline', label: '时长矛盾', severity: 'high' },
    simultaneity: { category: 'timeline', label: '同时性矛盾', severity: 'high' },
    'causeless-effect': { category: 'timeline', label: '无因之果', severity: 'medium' },
    'causal-violation': { category: 'timeline', label: '因果逻辑违规', severity: 'medium' },
    'abandoned-plot': { category: 'timeline', label: '废弃情节元素', severity: 'medium' },
    memory: { category: 'factual', label: '记忆矛盾', severity: 'high' },
    knowledge: { category: 'factual', label: '知识矛盾', severity: 'high' },
    'skill-fluctuation': { category: 'factual', label: '能力波动', severity: 'medium' },
    'forgotten-ability': { category: 'factual', label: '遗忘能力', severity: 'medium' },
    'core-rule': { category: 'factual', label: '核心规则违规', severity: 'high' },
    'social-norm': { category: 'factual', label: '社会规范违规', severity: 'medium' },
    geographical: { category: 'factual', label: '地理矛盾', severity: 'medium' },
    perspective: { category: 'timeline', label: '视角混乱', severity: 'medium' },
    tone: { category: 'timeline', label: '语气不一致', severity: 'medium' },
    'style-shift': { category: 'timeline', label: '文风漂移', severity: 'medium' },
};

/** 本批实现的全部断言种类（顺序稳定，用于遍历与测试） */
export const ASSERTION_KINDS: AssertionKind[] = [
    'nomenclature',
    'quantitative',
    'appearance',
    'absolute-time',
    'duration',
    'simultaneity',
    'causeless-effect',
    'causal-violation',
    'abandoned-plot',
    'memory',
    'knowledge',
    'skill-fluctuation',
    'forgotten-ability',
    'core-rule',
    'social-norm',
    'geographical',
    'perspective',
    'tone',
    'style-shift',
];

/**
 * 生成断言 id。
 *
 * 用 kind + subject + predicate + chapterKey 组合，保证同一章内同类断言重复抽取
 * 时得到同一个 id（幂等合并），不同章则不同。
 *
 * @param kind - 断言种类
 * @param subject - 主语
 * @param predicate - 谓语
 * @param chapterKey - 章节 key
 * @returns 稳定 id
 */
export function makeAssertionId(
    kind: AssertionKind,
    subject: string,
    predicate: string,
    chapterKey: string,
): string {
    return `${kind}|${subject}|${predicate}|${chapterKey}`;
}

/**
 * 生成矛盾 id。
 *
 * @param kind - 错误类型
 * @param subject - 主语
 * @param predicate - 谓语
 * @param evidenceA - 证据 A 的章节 key
 * @param evidenceB - 证据 B 的章节 key
 * @returns 稳定 id
 */
export function makeContradictionId(
    kind: AssertionKind,
    subject: string,
    predicate: string,
    evidenceA: string,
    evidenceB: string,
): string {
    const [first, second] = [evidenceA, evidenceB].sort();
    return `c|${kind}|${subject}|${predicate}|${first}|${second}`;
}

/**
 * 断言是否满足「可作为比较基准」的最小要求。
 *
 * 空主语 / 空值 / 空引文的断言没有证据价值，直接丢弃（宁少不脏）。
 *
 * @param assertion - 待检查断言
 * @returns 是否有效
 */
export function isValidAssertion(assertion: FactAssertion): boolean {
    return Boolean(
        assertion.subject.trim()
        && assertion.predicate.trim()
        && assertion.value.trim()
        && assertion.quote.trim(),
    );
}

/**
 * 矛盾是否满足「必须有证据链」的要求。
 *
 * 对应论文 Stage 3：没有 reasoning 或任一侧引文的判定一律不算命中。
 *
 * @param contradiction - 待检查矛盾
 * @returns 是否合格
 */
export function hasCompleteEvidence(contradiction: ConsistencyContradiction): boolean {
    return Boolean(
        contradiction.reasoning.trim()
        && contradiction.evidenceA.quote.trim()
        && contradiction.evidenceB.quote.trim()
        && contradiction.evidenceA.chapterKey
        && contradiction.evidenceB.chapterKey,
    );
}
