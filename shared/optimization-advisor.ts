/**
 * optimization-advisor.ts — 自动化优化方向判断纯函数核心
 *
 * 把 Trae/ZCode 双自动化台账里的「候选池 → EV 评分 → 决策阶梯」固化成
 * 可执行、可单测、可复现的规则；CLI（scripts/optimization-advisor.mjs）
 * 只负责采集事实与渲染，不在这里做 IO。
 *
 * 设计约束：
 * - 零外部依赖、零 `any`，可直接被 Node 类型擦除运行与 vitest 导入；
 * - 判断完全确定：随机探索只读取台账里的 explorationRoll，不调用 Math.random；
 * - 新增优化方向只需在 detectAdvisorCandidates 里注册一个探测器并补类型权重。
 */

/** 优化动作类型（与 canonical 台账 params.typeWeights 的键对齐） */
export type AdvisorType =
    | 'gate-fix'
    | 'test-hardening'
    | 'perf'
    | 'docs-correction'
    | 'audit-only'
    | 'v5-product'
    | 'notice'
    | 'slice';

/** 一轮历史记录（来自台账 rounds，只保留评分需要的字段） */
export interface AdvisorRoundRecord {
    /** 轮次序号 */
    round: number;
    /** 动作类型（允许复合描述，如 test-hardening + docs-correction） */
    type: string;
    /** 该轮是否回退 */
    reverted?: boolean;
    /** 该轮是否失败 */
    failed?: boolean;
    /** 该轮新增用例数 */
    testsAdded?: number;
}

/** 评分参数（来自 canonical 台账 params；缺失字段用默认值补齐） */
export interface AdvisorParams {
    /** 各动作类型的权重 */
    typeWeights: Record<string, number>;
    /** 同型连续轮次的多样性惩罚系数 */
    diversityPenalty: number;
    /** 连续同型达到该轮数后强制换型（派工除外） */
    forcedTypeSwitchAfter: number;
    /** 失败/超时/回退的惩罚系数 */
    failurePenalty: {
        fail: number;
        timeout: number;
        revert: number;
    };
    /** 同型连续成功后开始收益递减的轮数 */
    diminishingReturnsAfter: number;
    /** 探索触发概率 */
    explorationRate: number;
    /** 台账给定的探索掷值（0–1，保证可复现） */
    explorationRoll: number;
    /** 单轮最多推荐动作数 */
    maxActionsPerRound: number;
    /** gate:any 可动面低于该值时自动降权，避免按总存量虚高、连续刷长尾 */
    anyMovableDownweightThreshold: number;
}

/** 判断所需事实（由 CLI 从 git、台账、门禁、信箱与文档采集） */
export interface AdvisorFacts {
    /** 当前轮次 */
    round: number;
    /** 评分参数 */
    params: AdvisorParams;
    /** 最近若干轮历史（建议 6 轮） */
    recentRounds: AdvisorRoundRecord[];
    /** 工作树状态 */
    worktree: {
        modified: number;
        untracked: number;
        /** 其中未在台账登记的路径数；缺省（undefined）视为全部未登记，保持旧语义 */
        unrecorded?: number;
        /** 未在台账登记的脏路径清单；提供时按既定分工红线前缀过滤（缺省沿用 unrecorded 计数） */
        unrecordedPaths?: string[];
    };
    /** 门禁与体积压力 */
    gates: {
        /** preflight 是否通过 */
        preflightOk: boolean;
        /** any 基线存量（采集自 .any-baseline.json total，缺失时回退台账 gateMargins 存量；0 表示无待收口存量） */
        anyRemaining: number;
        /** any 存量按可动性分桶（缺省时按历史口径把 total 全视为可动） */
        anyBuckets?: {
            /** 分工红线：engine/ 与 ui/views/ 前缀，由 ZCode 接手 */
            redline: number;
            /** 设计性：shared/types.ts 刻意索引签名 */
            design: number;
            /** 可动：其余单点长尾（含冻结子集） */
            movable: number;
            /** 冻结：可动桶中已由用户冻结、拍板前双方不动的处数（计入 movable，判分前扣除） */
            frozen?: number;
        };
        /** 当前 main.js 体积（采集自实文件 stat，缺失时回退 .bundle-baseline.json 基线值） */
        bundleBytes: number;
        /** 台账记录的启动体积基线 */
        startupBaselineBytes: number;
    };
    /** 文档漂移信号 */
    docs: {
        /** package.json 版本与交接快照版本是否不一致 */
        versionMismatch: boolean;
        /** 交接快照是否超过 24 小时未更新 */
        handoffStale: boolean;
    };
    /** 测试规模（仅用于展示与停滞判断） */
    tests: {
        files: number;
        cases: number;
    };
    /** 信箱里最近一条明确派工（无派工则不填） */
    dispatch?: {
        subject: string;
        hintType?: AdvisorType;
        sourceId?: string;
    };
}

/** 未评分候选 */
export interface AdvisorCandidate {
    /** 稳定 id，用于去重与输出排序 */
    id: string;
    /** 动作类型 */
    type: AdvisorType;
    /** 一句话方向 */
    title: string;
    /** 为什么现在做 */
    reason: string;
    /** 数据证据（带数值/路径，便于人工复核） */
    evidence: string;
    /** 影响面 1–3 */
    impact: number;
    /** 风险降低 1–3 */
    riskReduction: number;
    /** 可验证性 1–5 */
    verifiability: number;
    /** 成本 1–3 */
    cost: number;
    /** 是否为明确派工（决策阶梯第 1 级） */
    dispatchPriority?: boolean;
    /** 是否为在途收口候选 */
    backlog?: boolean;
    /** 候选自带降权系数（缺省 1）；用于按可动面收紧虚高分数 */
    downweight?: number;
}

/** 评分明细，便于解释为什么推荐它 */
export interface AdvisorScoreFactors {
    /** 影响 × 风险降低 × 可验证性 / 成本 */
    base: number;
    /** 类型权重 */
    weight: number;
    /** 同型多样性系数 */
    diversity: number;
    /** 失败/回退系数 */
    failure: number;
    /** 收益递减系数 */
    diminishing: number;
    /** 探索加成系数 */
    exploration: number;
    /** 可动面降权系数 */
    downweight: number;
}

/** 评分后的候选 */
export interface ScoredAdvisorCandidate extends AdvisorCandidate {
    /** 最终分数（保留 2 位小数） */
    score: number;
    /** 评分明细 */
    factors: AdvisorScoreFactors;
    /** 是否因连续同型被判强制换型 */
    forcedSwitch: boolean;
}

/** 决策层级（对应自动化提示词里的决策阶梯） */
export type AdvisorTier = 'dispatch' | 'backlog' | 'gate' | 'score' | 'idle';

/** 判断结果 */
export interface AdvisorDecision {
    /** 最高优先级层级 */
    tier: AdvisorTier;
    /** 层级中文说明 */
    tierLabel: string;
    /** 推荐动作（1–2 个） */
    recommended: ScoredAdvisorCandidate[];
    /** 备选动作 */
    alternatives: ScoredAdvisorCandidate[];
    /** 数据缺口或并发提醒 */
    warnings: string[];
}

/** 已知动作类型 */
const KNOWN_TYPES: readonly AdvisorType[] = [
    'gate-fix',
    'test-hardening',
    'perf',
    'docs-correction',
    'audit-only',
    'v5-product',
    'notice',
    'slice',
];

/** 台账缺失时的默认评分参数 */
export const DEFAULT_ADVISOR_PARAMS: AdvisorParams = {
    typeWeights: {
        'gate-fix': 1.76,
        'test-hardening': 2,
        'perf': 1.49,
        'docs-correction': 1.2,
        'audit-only': 1.3,
        'v5-product': 1.15,
        'notice': 0.75,
        'slice': 0.7,
    },
    diversityPenalty: 0.2,
    forcedTypeSwitchAfter: 3,
    failurePenalty: {
        fail: 0.15,
        timeout: 0.15,
        revert: 0.25,
    },
    diminishingReturnsAfter: 2,
    explorationRate: 0.15,
    explorationRoll: 0.58,
    maxActionsPerRound: 2,
    anyMovableDownweightThreshold: 10,
};

/** 采集回退：主源数值缺失/非法时回退基线值，不抛错
 * @param primary 主源采集值（bundle=main.js 实文件 stat；any=.any-baseline.json total），缺失/非法时为 undefined 或 NaN
 * @param fallback 基线回退值（bundle=.bundle-baseline.json 基线；any=台账 gateMargins 存量旧口径）
 * @returns 主源值；主源缺失时返回基线值
 * @example
 * resolveMetricWithFallback(4870903, 4870663) // 4870903（main.js 实文件优先）
 * resolveMetricWithFallback(undefined, 144) // 144（回退 .any-baseline.json total）
 */
export function resolveMetricWithFallback(primary: number | undefined, fallback: number): number {
    return typeof primary === 'number' && Number.isFinite(primary) ? primary : fallback;
}

/** 把任意台账类型描述归一到已知动作类型
 * @param value 台账里的 type 文本
 * @returns 匹配到的已知类型；无法识别时归为 audit-only
 * @example
 * normalizeAdvisorType('test-hardening + docs-correction') // 'test-hardening'
 */
export function normalizeAdvisorType(value: string): AdvisorType {
    const normalized = value.toLowerCase();
    let matched: { type: AdvisorType; index: number } | null = null;
    for (const type of KNOWN_TYPES) {
        const index = normalized.indexOf(type);
        if (index >= 0 && (matched === null || index < matched.index)) matched = { type, index };
    }
    if (matched !== null) return matched.type;
    if (normalized.includes('v5')) return 'v5-product';
    if (normalized.includes('doc')) return 'docs-correction';
    if (normalized.includes('test') || normalized.includes('coverage')) return 'test-hardening';
    if (normalized.includes('gate') || normalized.includes('any')) return 'gate-fix';
    if (normalized.includes('perf') || normalized.includes('bundle')) return 'perf';
    if (normalized.includes('slice') || normalized.includes('notice')) return normalized.includes('slice') ? 'slice' : 'notice';
    return 'audit-only';
}

/** 统计最近连续同型轮次数
 * @param rounds 历史轮次（按时间正序）
 * @param type 目标动作类型
 * @returns 从最后一轮往前连续命中的轮数
 */
function countConsecutiveType(rounds: AdvisorRoundRecord[], type: AdvisorType): number {
    let count = 0;
    for (let index = rounds.length - 1; index >= 0; index -= 1) {
        const record = rounds[index];
        if (!record.type.toLowerCase().includes(type)) break;
        count += 1;
    }
    return count;
}

/** 判断一条信箱派工是否仍然新鲜
 *
 * 主题里的「第 N 轮」不小于当前台账轮次即视为新派工（跨方「上一轮 + 1」编号
 * 会与台账同号，故用 `>=`）；同一消息 id 已在台账 `lastDispatchId` 记录时不再执行。
 * 主题无轮次时仍按 6 小时时效。
 * @param subject 信箱主题
 * @param currentRound 当前台账轮次
 * @param messageTs 消息时间（ISO 字符串）
 * @param now 当前毫秒时间戳
 * @param dedupe 去重信息：消息 id 与台账最近一次已执行派工 id
 * @returns 是否应作为待执行派工
 * @example
 * isFreshDispatch('第 87 轮派工：补测试', 86, '', Date.now()) // true
 * @example
 * isFreshDispatch('第 92 轮派工：补测试', 92, '', Date.now()) // true
 * @example
 * isFreshDispatch('第 92 轮派工：补测试', 92, '', Date.now(), { messageId: 'm-1', lastDispatchId: 'm-1' }) // false
 */
export function isFreshDispatch(
    subject: string,
    currentRound: number,
    messageTs: string,
    now: number,
    dedupe: { messageId?: string; lastDispatchId?: string } = {},
): boolean {
    if (dedupe.messageId && dedupe.lastDispatchId === dedupe.messageId) return false;
    const matches = [...subject.matchAll(/第\s*(\d+)\s*轮/g)].map(match => Number(match[1]));
    const targetRound = matches.length > 0 ? Math.max(...matches) : 0;
    if (targetRound > 0) return targetRound >= currentRound;
    const parsed = Date.parse(messageTs);
    return !Number.isNaN(parsed) && now - parsed <= 6 * 60 * 60 * 1000;
}

/** 既定分工红线：这些前缀的脏路径由 ZCode 负责，不计入 Trae 的在途收口。 */
const ZCODE_OWNED_PREFIXES = ['engine/', 'ui/views/'];

/**
 * 未登记且需要 Trae 收口的路径数。
 *
 * 提供路径清单时按分工红线前缀过滤；缺省时沿用 unrecorded / 脏路径总数，保持旧语义。
 */
function countActionableUnrecorded(worktree: AdvisorFacts['worktree']): number {
    if (worktree.unrecordedPaths) {
        return worktree.unrecordedPaths.filter(
            path => !ZCODE_OWNED_PREFIXES.some(prefix => path.startsWith(prefix)),
        ).length;
    }
    return worktree.unrecorded ?? worktree.modified + worktree.untracked;
}

/** 生成候选方向
 *
 * 内置探测器：派工、在途收口、preflight 红灯、any 存量、体积膨胀、
 * 文档漂移、测试停滞、无候选时探索审计。新增方向在此注册。
 * @param facts 判断事实
 * @returns 去重后的候选列表
 * @example
 * detectAdvisorCandidates({
 *     round: 87,
 *     params: DEFAULT_ADVISOR_PARAMS,
 *     recentRounds: [],
 *     worktree: { modified: 0, untracked: 0 },
 *     gates: { preflightOk: true, anyRemaining: 0, bundleBytes: 4869777, startupBaselineBytes: 4869777 },
 *     docs: { versionMismatch: false, handoffStale: false },
 *     tests: { files: 592, cases: 6500 },
 * }).map(candidate => candidate.type) // ['audit-only']
 */
export function detectAdvisorCandidates(facts: AdvisorFacts): AdvisorCandidate[] {
    const candidates: AdvisorCandidate[] = [];
    const add = (candidate: AdvisorCandidate): void => {
        if (!candidates.some(existing => existing.id === candidate.id)) candidates.push(candidate);
    };

    if (facts.dispatch) {
        add({
            id: `dispatch:${facts.dispatch.sourceId ?? 'latest'}`,
            type: facts.dispatch.hintType ?? 'v5-product',
            title: `执行派工：${facts.dispatch.subject}`,
            reason: '决策阶梯第 1 级：ZCode 明确派工优先，不参与评分竞争',
            evidence: `信箱消息 ${facts.dispatch.sourceId ?? 'latest'}`,
            impact: 3,
            riskReduction: 2,
            verifiability: 5,
            cost: 1,
            dispatchPriority: true,
        });
    }

    const actionable = countActionableUnrecorded(facts.worktree);
    if (actionable > 0) {
        const lastRound = facts.recentRounds[facts.recentRounds.length - 1];
        add({
            id: 'backlog:worktree',
            type: normalizeAdvisorType(lastRound ? lastRound.type : 'docs-correction'),
            title: `在途收口：工作树 ${actionable} 路径未登记`,
            reason: '决策阶梯第 2 级：先确认在途改动归属并收口，避免与对方提交互相覆盖',
            evidence: `git status：${facts.worktree.modified} modified + ${facts.worktree.untracked} untracked（未台账登记 ${actionable} 条；engine/** 与 ui/views/** 属 ZCode 分工红线，已排除）`,
            impact: 3,
            riskReduction: 3,
            verifiability: 4,
            cost: 1,
            backlog: true,
        });
    }

    if (!facts.gates.preflightOk) {
        add({
            id: 'gate:preflight',
            type: 'gate-fix',
            title: '修复 preflight 红灯',
            reason: '门禁失败优先于任何收益型动作，避免带病提交',
            evidence: '台账 gateMargins.preflight 未标记 EXIT=0',
            impact: 3,
            riskReduction: 3,
            verifiability: 5,
            cost: 1,
        });
    } else if (facts.gates.anyRemaining > 0) {
        const buckets = facts.gates.anyBuckets;
        const frozen = buckets?.frozen ?? 0;
        const movable = buckets
            ? Math.max(0, buckets.movable - frozen)
            : facts.gates.anyRemaining;
        if (movable > 0) {
            const threshold = facts.params.anyMovableDownweightThreshold;
            const downweighted = movable < threshold;
            add({
                id: 'gate:any',
                type: 'gate-fix',
                title: `收口 any 长尾（可动 ${movable}/${facts.gates.anyRemaining}）`,
                reason: downweighted
                    ? `any 总存量 ${facts.gates.anyRemaining} 中可动面仅 ${movable}（< ${threshold}），按可动面降权，避免连续刷长尾`
                    : 'any 存量大于 0 时做纯类型收口，零运行时、可逐字节验证体积不变',
                evidence: buckets
                    ? `any 存量 ${facts.gates.anyRemaining} = 红线 ${buckets.redline}（engine/**、ui/views/**，ZCode 接手）`
                        + ` + 设计性 ${buckets.design}（shared/types.ts 索引签名）`
                        + ` + 可动 ${movable}`
                        + (frozen > 0 ? ` + 冻结 ${frozen}（用户冻结路径，拍板前双方不动）` : '')
                        + `${downweighted ? `（低于阈值 ${threshold}，已降权）` : ''}`
                    : `any 存量 ${facts.gates.anyRemaining}（.any-baseline.json total，缺失回退台账）`,
                impact: downweighted ? 1 : 2,
                riskReduction: downweighted ? 1 : 2,
                verifiability: 5,
                cost: 2,
                downweight: downweighted ? 0.5 : 1,
            });
        }
    }

    if (facts.gates.startupBaselineBytes > 0 && facts.gates.bundleBytes > facts.gates.startupBaselineBytes) {
        const delta = facts.gates.bundleBytes - facts.gates.startupBaselineBytes;
        const percent = Math.round((delta / facts.gates.startupBaselineBytes) * 10000) / 100;
        const significant = delta > 20_000 || percent >= 1;
        if (significant) {
            add({
                id: 'perf:bundle',
                type: 'perf',
                title: '核对体积增长并定位可拆模块',
                reason: '体积相对启动基线上涨超过阈值，需确认是功能增量还是重构开销',
                evidence: `main.js ${facts.gates.bundleBytes}B，较启动基线 +${delta}B（${percent}%）`,
                impact: 2,
                riskReduction: 1,
                verifiability: 3,
                cost: 2,
            });
        }
    }

    if (facts.docs.versionMismatch) {
        add({
            id: 'docs:version',
            type: 'docs-correction',
            title: '对齐版本戳',
            reason: '版本漂移会污染下一轮基线判断',
            evidence: 'package.json 版本与交接快照版本不一致',
            impact: 2,
            riskReduction: 1,
            verifiability: 5,
            cost: 1,
        });
    }

    if (facts.docs.handoffStale) {
        add({
            id: 'docs:handoff',
            type: 'docs-correction',
            title: '刷新交接快照',
            reason: '快照超过 24 小时未更新，对方恢复会话会读到过期状态',
            evidence: 'PROJECT-RULES.md HANDOFF 更新时间超过 24 小时',
            impact: 2,
            riskReduction: 1,
            verifiability: 5,
            cost: 1,
        });
    }

    const recent = facts.recentRounds.slice(-3);
    if (recent.length === 3 && recent.every(record => (record.testsAdded ?? 0) === 0)) {
        add({
            id: 'test:flat',
            type: 'test-hardening',
            title: '找真实未覆盖语义补测',
            reason: '连续三轮无新增用例，覆盖可能在退坡；只补有生产调用点的分支',
            evidence: `最近三轮新增用例 0（${recent.map(record => record.round).join('/')}）`,
            impact: 2,
            riskReduction: 1,
            verifiability: 4,
            cost: 2,
        });
    }

    if (candidates.length < 2) {
        add({
            id: 'audit:explore',
            type: 'audit-only',
            title: '低风险审计或文档纠偏',
            reason: '无高置信方向时，做只读取证并给下一轮留下可验证建议',
            evidence: '当前高置信候选不足 2 个',
            impact: 1,
            riskReduction: 1,
            verifiability: 4,
            cost: 1,
        });
    }

    return candidates;
}

/** 给候选打分
 *
 * EV = 影响 × 风险降低 × 可验证性 / 成本 × 类型权重，
 * 再叠加多样性、失败惩罚、收益递减与探索加成。
 * @param candidates 未评分候选
 * @param facts 判断事实
 * @returns 按分数降序的候选；连续同型且非派工者标记 forcedSwitch
 * @example
 * scoreAdvisorCandidates(detectAdvisorCandidates(facts), facts)[0].score
 */
export function scoreAdvisorCandidates(
    candidates: AdvisorCandidate[],
    facts: AdvisorFacts
): ScoredAdvisorCandidate[] {
    const params = facts.params;
    const lastRound = facts.recentRounds[facts.recentRounds.length - 1];
    const scored = candidates.map(candidate => {
        const base = (candidate.impact * candidate.riskReduction * candidate.verifiability) / candidate.cost;
        const weight = params.typeWeights[candidate.type] ?? 1;
        const consecutive = countConsecutiveType(facts.recentRounds, candidate.type);
        const diversity = consecutive > 0
            ? Math.max(1 - params.diversityPenalty * Math.min(consecutive, 3), 0.4)
            : 1;
        let failure = 1;
        if (lastRound && lastRound.type.toLowerCase().includes(candidate.type)) {
            if (lastRound.reverted) failure = 1 - params.failurePenalty.revert;
            else if (lastRound.failed) failure = 1 - params.failurePenalty.fail;
        }
        const diminishing = consecutive >= params.diminishingReturnsAfter
            ? Math.max(0.9 ** (consecutive - params.diminishingReturnsAfter + 1), 0.7)
            : 1;
        const exploration = params.explorationRoll < params.explorationRate && consecutive === 0 ? 1.15 : 1;
        const forcedSwitch = !candidate.dispatchPriority && consecutive >= params.forcedTypeSwitchAfter;
        const downweight = candidate.downweight ?? 1;
        const multiplier = weight * diversity * failure * diminishing * exploration * downweight * (forcedSwitch ? 0.5 : 1);
        const score = Math.round(base * multiplier * 100) / 100;
        return {
            ...candidate,
            score,
            forcedSwitch,
            factors: { base, weight, diversity, failure, diminishing, exploration, downweight },
        };
    });
    return scored.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

/** 生成最终建议
 *
 * 决策阶梯：派工 > 在途收口 > 门禁红灯 > 评分选择 > 不动手轮。
 * @param facts 判断事实
 * @returns 层级、推荐与备选
 * @example
 * decideOptimizationAdvice(facts).tier // 'backlog'
 */
export function decideOptimizationAdvice(facts: AdvisorFacts): AdvisorDecision {
    const candidates = scoreAdvisorCandidates(detectAdvisorCandidates(facts), facts);
    const worktreeCount = facts.worktree.modified + facts.worktree.untracked;
    const unrecorded = facts.worktree.unrecorded ?? worktreeCount;
    const actionable = countActionableUnrecorded(facts.worktree);
    const tier: AdvisorTier = facts.dispatch
        ? 'dispatch'
        : actionable > 0
            ? 'backlog'
            : !facts.gates.preflightOk
                ? 'gate'
                : candidates.length > 0
                    ? 'score'
                    : 'idle';
    const tierLabels: Record<AdvisorTier, string> = {
        dispatch: '明确派工（决策阶梯第 1 级）',
        backlog: '在途收口（决策阶梯第 2 级）',
        gate: '门禁红灯（必须先修复）',
        score: '评分选择',
        idle: '不动手轮（只审计/文档纠偏）',
    };
    const eligible = facts.dispatch
        ? candidates
        : candidates.filter(candidate => !candidate.forcedSwitch || candidate.dispatchPriority);
    const ranked = (eligible.length > 0 ? eligible : candidates).sort((left, right) => {
        const rank = (item: ScoredAdvisorCandidate): number => {
            if (item.dispatchPriority) return 0;
            if (item.backlog) return 1;
            if (item.id === 'gate:preflight') return 2;
            return 3;
        };
        return rank(left) - rank(right) || right.score - left.score || left.id.localeCompare(right.id);
    });
    const limit = Math.max(1, Math.min(2, facts.params.maxActionsPerRound || 2));
    const warnings: string[] = [];
    if (worktreeCount > 0) {
        warnings.push(unrecorded > 0
            ? `工作树有 ${worktreeCount} 条在途路径，执行前先确认归属`
            : `工作树 ${worktreeCount} 条在途路径均已在台账登记，待收单不锁定层级`);
    }
    if (facts.gates.anyRemaining <= 0) warnings.push('any 存量为 0，暂无合规收口批次');
    if (facts.params.explorationRoll < facts.params.explorationRate) warnings.push('探索掷值命中，本轮允许一个异类动作');
    return {
        tier,
        tierLabel: tierLabels[tier],
        recommended: ranked.slice(0, limit),
        alternatives: ranked.slice(limit),
        warnings,
    };
}
