/**
 * link-status-compute.ts — 三条数据流的链路判定（纯逻辑，无 DOM）
 *
 * 从 `ui/views/link-status.ts` 下沉而来（阶段 C1）。原因：
 * agent 诊断工具在 `engine/` 层，不能 import `ui/`（反向依赖），
 * 但**界面看到的断点**与**agent 诊断出的断点**必须是同一套口径。
 *
 * 现在两边都 import 本模块：ui 负责渲染，engine 工具负责给 agent 返回结构化结论。
 *
 * 判定语义见各函数注释。渲染见 `ui/views/link-status.ts#renderLinkStatus`。
 */
import { t, translate } from '@/i18n';

/**
 * agent 输出的固定语言。
 *
 * 不是 'zh-CN' 字面量硬编码进每个调用点，而是集中一个常量：
 * 将来若要把 agent 输出改成英文（需要重跑提示词基线），只改这一处。
 */
export const AGENT_LOCALE = 'zh-CN' as const;

/** 单个环节状态 */
export type LinkStageStatus = 'ok' | 'broken' | 'warn' | 'unknown';

/**
 * 一个环节。
 *
 * **key 是唯一真源**（i18n 跨层数据⑦，2026-11-19）：原 `name`/`detail` 中文双份字段已删除。
 * 删除依据是 DSH 复核时的查证：`formatLinkStatusForAgent()` 的两个消费点
 * （`diagnose-tools.ts` / `repair-tools.ts`）都是把文本**整段塞进 LLM**，
 * 没有任何代码去正则匹配这些措辞，动作选择走 `REPAIR_ACTIONS` 枚举 id。
 * 因此「保留中文原值供匹配」不成立；只剩「agent 输入不随语言漂移」——
 * 由 `formatLinkStatusForAgent()` 内部固定 zh 求值保证。
 */
export interface LinkStage {
    /** i18n 键（linkStatus.stage.<slug>） */
    nameKey: string;
    status: LinkStageStatus;
    /** i18n 键（linkStatus.detail.<slug>） */
    detailKey: string;
    /** detailKey 的插值参数（编号/数量等） */
    detailParams?: Record<string, string | number>;
}

/** 一条链路的整体状态 */
export interface LinkStatus {
    /** 链路名 i18n 键（linkStatus.title.<slug>） */
    titleKey: string;
    stages: LinkStage[];
    /** 整体状态：有 broken → broken；有 warn → warn；有 unknown → unknown；否则 ok */
    overall: LinkStageStatus;
    /**
     * 第一处断点的环节 i18n 键（等于该环节的 `nameKey`）；无断点为 null。
     *
     * 存 key 不存名字：名字随语言变，比较会失效（同 ZC-20261120-05 的教训）。
     */
    breakpointKey: string | null;
    /**
     * 该链路相关的运行时降级原因（阶段 B1：配置检查 + 实际发生过的降级）。
     *
     * 静态检查只能看「配了没有」，看不到「配了但在运行中降级了」——
     * 例如向量检索回退关键词、指纹筛选回退全量。这些必须一起呈现。
     *
     * 注意：这是运行时产生的自由文本，不是 i18n 资源，保持原样。
     */
    degradations?: string[];
}

/**
 * 环节展示名（当前语言）。
 *
 * key 为空时返回空串而不是让 `t(undefined)` 崩在 i18n 内部——
 * 上层（测试夹具、降级渲染路径）传不完整的对象时应当降级，不该抛。
 *
 * @param stage - 环节
 * @returns 展示名
 */
export function stageName(stage: LinkStage): string {
    return stage.nameKey ? t(stage.nameKey) : '';
}

/**
 * 环节说明（当前语言）。
 *
 * @param stage - 环节
 * @returns 说明
 */
export function stageDetail(stage: LinkStage): string {
    if (!stage.detailKey) return '';
    return stage.detailParams ? t(stage.detailKey, stage.detailParams) : t(stage.detailKey);
}

/**
 * 链路名（当前语言）。
 *
 * @param status - 链路状态
 * @returns 链路名；key 为空时返回空串
 */
export function linkTitle(status: LinkStatus): string {
    return status.titleKey ? t(status.titleKey) : '';
}

/**
 * 断点环节的展示名（当前语言）；无断点返回空串。
 *
 * @param status - 链路状态
 * @returns 断点环节名
 */
export function linkBreakpointName(status: LinkStatus): string {
    if (!status.breakpointKey) return '';
    const stage = status.stages.find(s => s.nameKey === status.breakpointKey);
    return stage ? stageName(stage) : t(status.breakpointKey);
}
/**
 * 面向 agent 的可读投影（固定中文，与 UI 语言无关）。
 *
 * 为什么需要它：`repair-tools` / `diagnose-tools` 会把 `data.status` 直接放进工具返回值，
 * agent 读的是**可读文本**而不是 i18n 键。删掉双份字段后 `LinkStatus` 里只有 key，
 * 直接塞给 agent 会变成 `{ titleKey: 'linkStatus.title.knowledge', ... }` —— 对模型无意义。
 *
 * 本函数把 key 求值成 zh 文本（固定语言，见 `AGENT_LOCALE`），字段名保持
 * `title` / `name` / `detail` / `breakpoint`，与改造前 agent 看到的一致。
 *
 * @param status - 链路状态
 * @returns 可读的链路状态（中文，字段名兼容旧 agent 契约）
 */
export function toAgentStatusView(status: LinkStatus): {
    title: string;
    overall: LinkStageStatus;
    breakpoint: string | null;
    stages: { name: string; status: LinkStageStatus; detail: string }[];
    degradations?: string[];
} {
    return {
        title: translate(AGENT_LOCALE, status.titleKey),
        overall: status.overall,
        breakpoint: status.breakpointKey ? translate(AGENT_LOCALE, status.breakpointKey) : null,
        stages: status.stages.map(stage => ({
            name: translate(AGENT_LOCALE, stage.nameKey),
            status: stage.status,
            detail: stage.detailParams
                ? translate(AGENT_LOCALE, stage.detailKey, stage.detailParams)
                : translate(AGENT_LOCALE, stage.detailKey),
        })),
        degradations: status.degradations,
    };
}
/**
 * 汇总整体状态与第一处断点。
 *
 * 优先级：broken > warn > unknown > ok，但有一条关键例外：
 * **`unknown` 不拉低整体**——只要存在可判定的环节（ok/warn/broken），
 * 就按它们判定；只有**全部**环节都 unknown 时才报 unknown。
 *
 * 理由：知识流的「归因」依赖运行时数据（写作后才写 rag_sources），
 * 界面永远无法静态判定。如果它把「全部就绪」拉成 unknown，用户会以为链路没通，
 * 反而掩盖了真实状态。
 *
 * 断点取**第一个** broken——修链路要从头修，后面的环节在断点修复前都无意义。
 *
 * @param titleKey - 链路名的 i18n 键（`linkStatus.title.<slug>`）
 * @param stages - 环节列表
 * @param degradations - 该链路的运行时降级原因（可选）
 * @returns 带整体结论的链路状态
 */
export function summarizeLink(
    titleKey: string,
    stages: LinkStage[],
    degradations?: string[],
): LinkStatus {
    const firstBroken = stages.find(stage => stage.status === 'broken');
    const hasWarn = stages.some(stage => stage.status === 'warn');
    const decidable = stages.filter(stage => stage.status !== 'unknown');
    const hasDegradation = Boolean(degradations && degradations.length > 0);
    const overall: LinkStageStatus = firstBroken
        ? 'broken'
        : hasWarn || hasDegradation
            ? 'warn'
            : decidable.length === 0
                ? 'unknown'
                : 'ok';
    return {
        titleKey,
        stages,
        overall,
        // 断点存 nameKey（稳定标识）；展示走 linkBreakpointName()
        breakpointKey: firstBroken ? firstBroken.nameKey : null,
        degradations,
    };
}

/** 知识流输入 */
export interface KnowledgeFlowInput {
    /** 知识库书籍总数 */
    bookTotal: number;
    /** 拆解完成的书数 */
    breakdownCompleted: number;
    /** 向量就绪的书数 */
    vectorDone: number;
    /** 向量化失败的书数 */
    vectorFailed: number;
    /** 嵌入模型是否可用 */
    embeddingReady: boolean;
    /** 向量库当前加载的书数 */
    storeLoadedBooks: number;
    /**
     * 已加载书里不在知识库索引的数量（孤儿向量，DSH-20261112-17）。
     *
     * >0 时「检索」环节降为 warn 且 detail 附注孤儿数——这是 -08 假绿的
     * 环节级呈现：用户扫环节图标就能看出「检索有问题」，而不是只在整体
     * warn 条里找被 slice 挤掉的降级文案。
     */
    orphanCount?: number;
    /**
     * 向量库是否已完成首次加载（阶段 B2）。
     *
     * 缺省按 `true` 处理（调用方没提供时视为「已知状态」）——
     * 但调用方应尽量传真实值，否则「尚未加载」会被误报成「库里没书」。
     */
    storeReady?: boolean;
    /** 该链路相关的运行时降级原因（可选，阶段 B1） */
    degradations?: string[];
}

/**
 * 知识流：拆解 → 向量化 → 检索 → 注入 → 归因。
 *
 * @param input - 书籍与嵌入状态
 * @returns 链路状态
 */
export function computeKnowledgeFlowStatus(input: KnowledgeFlowInput): LinkStatus {
    const breakdown: LinkStage = input.breakdownCompleted > 0
        ? { nameKey: 'linkStatus.stage.breakdown', status: 'ok', detailKey: 'linkStatus.detail.breakdownOk', detailParams: { count: input.breakdownCompleted } }
        : input.bookTotal > 0
            ? { nameKey: 'linkStatus.stage.breakdown', status: 'broken', detailKey: 'linkStatus.detail.breakdownAllPending', detailParams: { count: input.bookTotal } }
            : { nameKey: 'linkStatus.stage.breakdown', status: 'unknown', detailKey: 'linkStatus.detail.breakdownEmpty' };

    const vectorize: LinkStage = input.vectorDone > 0
        ? {
            nameKey: 'linkStatus.stage.vectorize',
            status: input.vectorFailed > 0 ? 'warn' : 'ok',
            detailKey: input.vectorFailed > 0 ? 'linkStatus.detail.vectorizePartial' : 'linkStatus.detail.vectorizeOk',
            detailParams: input.vectorFailed > 0
                ? { ok: input.vectorDone, failed: input.vectorFailed }
                : { ok: input.vectorDone },
        }
        : input.breakdownCompleted > 0
            ? {
                nameKey: 'linkStatus.stage.vectorize',
                status: 'broken',
                detailKey: input.vectorFailed > 0 ? 'linkStatus.detail.vectorizeAllFailed' : 'linkStatus.detail.vectorizeMissing',
                detailParams: input.vectorFailed > 0 ? { failed: input.vectorFailed } : undefined,
            }
            : { nameKey: 'linkStatus.stage.vectorize', status: 'unknown', detailKey: 'linkStatus.detail.vectorizeWaiting' };

    const embeddingStage: LinkStage = input.embeddingReady
        ? { nameKey: 'linkStatus.stage.embedding', status: 'ok', detailKey: 'linkStatus.detail.embeddingOk' }
        : {
            nameKey: 'linkStatus.stage.embedding',
            status: 'broken', detailKey: 'linkStatus.detail.embeddingBroken',
        };

    // 三态：尚未加载 → 无法判定；已加载有书 → 通；已加载无书 → 断
    // （「状态说向量就绪但库里没书」正是 B2 要暴露的不一致）
    const storeReady = input.storeReady !== false;
    const retrieve: LinkStage = !storeReady
        ? { nameKey: 'linkStatus.stage.retrieve', status: 'unknown', detailKey: 'linkStatus.detail.retrieveNotLoaded' }
        : input.storeLoadedBooks > 0
            ? {
                nameKey: 'linkStatus.stage.retrieve',
                // DSH-20261112-17：orphanCount>0 时环节级降为 warn——-08 假绿的本源
                // 就是这句 detail 只报「已加载 N 本」，环节图标看着是通的。
                status: input.orphanCount ? 'warn' : 'ok',
                detailKey: input.orphanCount ? 'linkStatus.detail.retrieveLoadedWithOrphans' : 'linkStatus.detail.retrieveLoaded',
                detailParams: input.orphanCount
                    ? { count: input.storeLoadedBooks, orphans: input.orphanCount }
                    : { count: input.storeLoadedBooks },
            }
            : input.vectorDone > 0
                ? {
                    nameKey: 'linkStatus.stage.retrieve',
                    status: 'broken', detailKey: 'linkStatus.detail.retrieveStoreEmpty',
                }
                : { nameKey: 'linkStatus.stage.retrieve', status: 'broken', detailKey: 'linkStatus.detail.retrieveEmpty' };

    // 归因依赖运行时（写作后写 rag_sources），界面无法静态判定
    const attribute: LinkStage = {
        nameKey: 'linkStatus.stage.attribute',
        status: 'unknown', detailKey: 'linkStatus.detail.attributeTodo',
    };

    return summarizeLink('linkStatus.title.knowledge', [breakdown, vectorize, embeddingStage, retrieve, attribute], input.degradations);
}

/** 风格流输入 */
export interface StyleFlowInput {
    templateCount: number;
    globalCount: number;
    projectCount: number;
    /** 实际参与注入的启用数（project + global 按项目启用） */
    enabledCount: number;
    /** 启用但强度为 0 的指纹数 */
    intensityDisabledCount: number;
    /** 嵌入是否可用（影响 V2 相似度选择，不影响纯文本特征注入） */
    embeddingReady: boolean;
    /** 该链路相关的运行时降级原因（可选，阶段 B1） */
    degradations?: string[];
}

/**
 * 风格流：指纹库 → 启用 → 强度 → 注入。
 *
 * 注意 template 层是**来源库**，不参与注入——链路里不出现它，
 * 但数量在「指纹库」环节里以备注形式给出，避免用户以为模板层坏了。
 *
 * @param input - 三层数量与启用/强度状态
 * @returns 链路状态
 */
export function computeStyleFlowStatus(input: StyleFlowInput): LinkStatus {
    const total = input.templateCount + input.globalCount + input.projectCount;
    const injectable = input.globalCount + input.projectCount;

    const library: LinkStage = total > 0
        ? {
            nameKey: 'linkStatus.stage.fingerprintLib',
            status: injectable > 0 ? 'ok' : 'warn',
            detailKey: injectable > 0 ? 'linkStatus.detail.fpInjectable' : 'linkStatus.detail.fpTemplateOnly',
            detailParams: injectable > 0
                ? { count: injectable, templates: input.templateCount }
                : { templates: input.templateCount },
        }
        : { nameKey: 'linkStatus.stage.fingerprintLib', status: 'unknown', detailKey: 'linkStatus.detail.fpEmpty' };

    const enabled: LinkStage = input.enabledCount > 0
        ? { nameKey: 'linkStatus.stage.enabled', status: 'ok', detailKey: 'linkStatus.detail.enabledOk', detailParams: { count: input.enabledCount } }
        : injectable > 0
            ? { nameKey: 'linkStatus.stage.enabled', status: 'broken', detailKey: 'linkStatus.detail.enabledNone' }
            : { nameKey: 'linkStatus.stage.enabled', status: 'unknown', detailKey: 'linkStatus.detail.enabledWaiting' };

    const intensity: LinkStage = input.enabledCount === 0
        ? { nameKey: 'linkStatus.stage.intensity', status: 'unknown', detailKey: 'linkStatus.detail.waitingEnabled' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                nameKey: 'linkStatus.stage.intensity',
                status: input.intensityDisabledCount > 0 ? 'warn' : 'ok',
                detailKey: input.intensityDisabledCount > 0 ? 'linkStatus.detail.intensityPartialZero' : 'linkStatus.detail.intensityAllPositive',
                detailParams: input.intensityDisabledCount > 0 ? { count: input.intensityDisabledCount } : undefined,
            }
            : { nameKey: 'linkStatus.stage.intensity', status: 'broken', detailKey: 'linkStatus.detail.intensityZero' };

    // enabledCount 为 0 时谈不上「注入断了」——那还在上游，注入只是无从判定
    const inject: LinkStage = input.enabledCount === 0
        ? { nameKey: 'linkStatus.stage.inject', status: 'unknown', detailKey: 'linkStatus.detail.waitingEnabled' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                nameKey: 'linkStatus.stage.inject',
                status: input.embeddingReady ? 'ok' : 'warn',
                detailKey: input.embeddingReady ? 'linkStatus.detail.styleInjectOk' : 'linkStatus.detail.styleInjectNoEmbedding',
            }
            : { nameKey: 'linkStatus.stage.inject', status: 'broken', detailKey: 'linkStatus.detail.intensityZero' };

    return summarizeLink('linkStatus.title.style', [library, enabled, intensity, inject], input.degradations);
}

/** 约束流输入 */
export interface ConstraintFlowInput {
    /** 考据来源条数 */
    sourceCount: number;
    /** 同人设定文件是否存在 */
    settingExists: boolean;
    /** 审核状态；none = 未绑定或文件缺失 */
    reviewStatus: 'approved' | 'pending' | 'rejected' | 'legacy' | 'none';
    /** 项目是否已绑定同人设定 */
    bound: boolean;
    /** 解析出的规则是否有实质内容（占位不算） */
    rulesHasContent: boolean;
    /** 该链路相关的运行时降级原因（可选，阶段 B1） */
    degradations?: string[];
}

/**
 * 约束流：考据 → 设定 → 审核 → 绑定 → 注入。
 *
 * @param input - 来源/设定/审核/绑定状态
 * @returns 链路状态
 */
export function computeConstraintFlowStatus(input: ConstraintFlowInput): LinkStatus {
    const research: LinkStage = input.sourceCount > 0
        ? { nameKey: 'linkStatus.stage.research', status: 'ok', detailKey: 'linkStatus.detail.researchOk', detailParams: { count: input.sourceCount } }
        : { nameKey: 'linkStatus.stage.research', status: 'warn', detailKey: 'linkStatus.detail.researchMissing' };

    const setting: LinkStage = input.settingExists
        ? { nameKey: 'linkStatus.stage.setting', status: 'ok', detailKey: 'linkStatus.detail.settingOk' }
        : { nameKey: 'linkStatus.stage.setting', status: 'broken', detailKey: 'linkStatus.detail.settingMissing' };

    const review: LinkStage = input.reviewStatus === 'approved'
        ? { nameKey: 'linkStatus.stage.review', status: 'ok', detailKey: 'linkStatus.detail.reviewApproved' }
        : input.reviewStatus === 'legacy'
            ? { nameKey: 'linkStatus.stage.review', status: 'warn', detailKey: 'linkStatus.detail.reviewLegacy' }
            : input.reviewStatus === 'pending'
                ? { nameKey: 'linkStatus.stage.review', status: 'broken', detailKey: 'linkStatus.detail.reviewPending' }
                : input.reviewStatus === 'rejected'
                    ? { nameKey: 'linkStatus.stage.review', status: 'broken', detailKey: 'linkStatus.detail.reviewRejected' }
                    : { nameKey: 'linkStatus.stage.review', status: 'unknown', detailKey: 'linkStatus.detail.reviewNone' };

    const bind: LinkStage = input.bound
        ? { nameKey: 'linkStatus.stage.bind', status: 'ok', detailKey: 'linkStatus.detail.bindOk' }
        : input.settingExists
            ? { nameKey: 'linkStatus.stage.bind', status: 'broken', detailKey: 'linkStatus.detail.bindMissing' }
            : { nameKey: 'linkStatus.stage.bind', status: 'unknown', detailKey: 'linkStatus.detail.bindWaiting' };

    const inject: LinkStage = !input.bound
        ? { nameKey: 'linkStatus.stage.inject', status: 'unknown', detailKey: 'linkStatus.detail.constraintInjectWaiting' }
        : input.rulesHasContent
            ? { nameKey: 'linkStatus.stage.inject', status: 'ok', detailKey: 'linkStatus.detail.constraintInjectOk' }
            : { nameKey: 'linkStatus.stage.inject', status: 'broken', detailKey: 'linkStatus.detail.constraintInjectPlaceholder' };

    return summarizeLink('linkStatus.title.constraint', [research, setting, review, bind, inject], input.degradations);
}

/** 链路类型 */
export type FlowKind = 'knowledge' | 'style' | 'constraint';

/**
 * 把链路状态转成给 agent 读的纯文本。
 *
 * agent 需要的是「断在哪、为什么、下一步做什么」，不是 JSON 结构。
 *
 * **语言策略（i18n 跨层数据⑦，2026-11-19）**：本函数输出是 **agent/LLM 的输入**，
 * 因此**内部固定按 zh-CN 求值**——即使 UI 切到 en-US，agent 拿到的仍是同一份中文文本。
 * 这样「agent 输入分布不随用户语言漂移」由代码保证，而不是靠字段里存双份中文。
 * 界面渲染请用 `ui/views/link-status.ts`（走 `stageName()/stageDetail()/linkTitle()`）。
 *
 * @param status - 链路状态
 * @returns 可读文本（始终中文）
 */
export function formatLinkStatusForAgent(status: LinkStatus): string {
    // 固定 zh：不用 t()（它跟 activeLocale 走），改用 translate(固定 locale, ...)
    const title = translate(AGENT_LOCALE, status.titleKey);
    const bpName = status.breakpointKey
        ? translate(AGENT_LOCALE, status.breakpointKey)
        : null;
    const lines = [`${title}：${status.overall === 'ok' ? '已通' : bpName ? `断在「${bpName}」` : status.overall === 'warn' ? '可运行但有降级/弱项' : '状态未知'}`];
    for (const stage of status.stages) {
        const icon = stage.status === 'ok' ? '✅' : stage.status === 'broken' ? '❌' : stage.status === 'warn' ? '⚠️' : '❔';
        const detail = stage.detailParams
            ? translate(AGENT_LOCALE, stage.detailKey, stage.detailParams)
            : translate(AGENT_LOCALE, stage.detailKey);
        lines.push(`  ${icon} ${translate(AGENT_LOCALE, stage.nameKey)}：${detail}`);
    }
    if (status.breakpointKey) {
        const stage = status.stages.find(s => s.nameKey === status.breakpointKey);
        const detail = stage
            ? (stage.detailParams
                ? translate(AGENT_LOCALE, stage.detailKey, stage.detailParams)
                : translate(AGENT_LOCALE, stage.detailKey))
            : '';
        lines.push(`结论：链路断在「${bpName}」——${detail}。修好这一环，后面的环节才有意义。`);
    }
    if (status.degradations && status.degradations.length > 0) {
        // DSH-20261112-17：取末 3 条——事件按 push 序保留，slice(0,3) 取的是最旧的，
        // 与「最近」语义相反，还会把新出现的孤儿/降级提示挤掉。
        lines.push(`运行时降级（${status.degradations.length}）：${status.degradations.slice(-3).join('；')}`);
    }
    return lines.join('\n');
}
