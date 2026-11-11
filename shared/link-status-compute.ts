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

/** 单个环节状态 */
export type LinkStageStatus = 'ok' | 'broken' | 'warn' | 'unknown';

/** 一个环节 */
export interface LinkStage {
    /** 环节名（拆解 / 向量化 / 检索 / 注入 …） */
    name: string;
    status: LinkStageStatus;
    /** 一句话说明（数量或原因） */
    detail: string;
}

/** 一条链路的整体状态 */
export interface LinkStatus {
    /** 链路名（知识流 / 风格流 / 约束流） */
    title: string;
    stages: LinkStage[];
    /** 整体状态：有 broken → broken；有 warn → warn；有 unknown → unknown；否则 ok */
    overall: LinkStageStatus;
    /** 第一处断点环节名；无断点为 null */
    breakpoint: string | null;
    /**
     * 该链路相关的运行时降级原因（阶段 B1：配置检查 + 实际发生过的降级）。
     *
     * 静态检查只能看「配了没有」，看不到「配了但在运行中降级了」——
     * 例如向量检索回退关键词、指纹筛选回退全量。这些必须一起呈现。
     */
    degradations?: string[];
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
 * @param title - 链路名
 * @param stages - 环节列表
 * @param degradations - 该链路的运行时降级原因（可选）
 * @returns 带整体结论的链路状态
 */
export function summarizeLink(
    title: string,
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
        title,
        stages,
        overall,
        breakpoint: firstBroken ? firstBroken.name : null,
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
        ? { name: '拆解', status: 'ok', detail: `${input.breakdownCompleted} 本已拆解` }
        : input.bookTotal > 0
            ? { name: '拆解', status: 'broken', detail: `${input.bookTotal} 本已导入但都未完成拆解` }
            : { name: '拆解', status: 'unknown', detail: '知识库为空' };

    const vectorize: LinkStage = input.vectorDone > 0
        ? {
            name: '向量化',
            status: input.vectorFailed > 0 ? 'warn' : 'ok',
            detail: input.vectorFailed > 0
                ? `${input.vectorDone} 本就绪，${input.vectorFailed} 本失败`
                : `${input.vectorDone} 本就绪`,
        }
        : input.breakdownCompleted > 0
            ? {
                name: '向量化',
                status: 'broken',
                detail: input.vectorFailed > 0
                    ? `${input.vectorFailed} 本全部失败（检查嵌入模型配置）`
                    : '已拆解但没有可用向量（检查嵌入模型）',
            }
            : { name: '向量化', status: 'unknown', detail: '等待拆解完成' };

    const embeddingStage: LinkStage = input.embeddingReady
        ? { name: '嵌入模型', status: 'ok', detail: '可用' }
        : {
            name: '嵌入模型',
            status: 'broken',
            detail: '不可用（检索会退化为关键词匹配）',
        };

    // 三态：尚未加载 → 无法判定；已加载有书 → 通；已加载无书 → 断
    // （「状态说向量就绪但库里没书」正是 B2 要暴露的不一致）
    const storeReady = input.storeReady !== false;
    const retrieve: LinkStage = !storeReady
        ? { name: '检索', status: 'unknown', detail: '向量库尚未加载，暂时无法判定' }
        : input.storeLoadedBooks > 0
            ? { name: '检索', status: 'ok', detail: `向量库已加载 ${input.storeLoadedBooks} 本` }
            : input.vectorDone > 0
                ? {
                    name: '检索',
                    status: 'broken',
                    detail: '状态显示向量就绪，但向量库里没有数据（可能文件丢失，建议重向量化）',
                }
                : { name: '检索', status: 'broken', detail: '向量库为空，检索无结果' };

    // 归因依赖运行时（写作后写 rag_sources），界面无法静态判定
    const attribute: LinkStage = {
        name: '归因',
        status: 'unknown',
        detail: '写作后可在统计页核对 rag_sources',
    };

    return summarizeLink('知识流', [breakdown, vectorize, embeddingStage, retrieve, attribute], input.degradations);
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
            name: '指纹库',
            status: injectable > 0 ? 'ok' : 'warn',
            detail: injectable > 0
                ? `可注入 ${injectable}（另有模板 ${input.templateCount} 仅作来源）`
                : `只有模板层 ${input.templateCount}（模板不参与注入，需复制到项目）`,
        }
        : { name: '指纹库', status: 'unknown', detail: '还没有指纹' };

    const enabled: LinkStage = input.enabledCount > 0
        ? { name: '启用', status: 'ok', detail: `${input.enabledCount} 枚已启用` }
        : injectable > 0
            ? { name: '启用', status: 'broken', detail: '指纹已存在但全部未启用' }
            : { name: '启用', status: 'unknown', detail: '等待创建指纹' };

    const intensity: LinkStage = input.enabledCount === 0
        ? { name: '强度', status: 'unknown', detail: '等待启用指纹' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                name: '强度',
                status: input.intensityDisabledCount > 0 ? 'warn' : 'ok',
                detail: input.intensityDisabledCount > 0
                    ? `${input.intensityDisabledCount} 枚强度为 0（等于禁用）`
                    : '全部 > 0',
            }
            : { name: '强度', status: 'broken', detail: '所有启用指纹强度都是 0，注入被禁用' };

    // enabledCount 为 0 时谈不上「注入断了」——那还在上游，注入只是无从判定
    const inject: LinkStage = input.enabledCount === 0
        ? { name: '注入', status: 'unknown', detail: '等待启用指纹' }
        : input.enabledCount - input.intensityDisabledCount > 0
            ? {
                name: '注入',
                status: input.embeddingReady ? 'ok' : 'warn',
                detail: input.embeddingReady
                    ? '特征与示例都会注入'
                    : '特征可注入；嵌入不可用，向量筛选/示例检索不可用',
            }
            : { name: '注入', status: 'broken', detail: '所有启用指纹强度都是 0，注入被禁用' };

    return summarizeLink('风格流', [library, enabled, intensity, inject], input.degradations);
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
        ? { name: '考据', status: 'ok', detail: `${input.sourceCount} 条来源` }
        : { name: '考据', status: 'warn', detail: '没有官方来源，设定只能写「待核实」' };

    const setting: LinkStage = input.settingExists
        ? { name: '设定', status: 'ok', detail: '文件存在' }
        : { name: '设定', status: 'broken', detail: '还没有同人设定文件' };

    const review: LinkStage = input.reviewStatus === 'approved'
        ? { name: '审核', status: 'ok', detail: '已通过人工审核' }
        : input.reviewStatus === 'legacy'
            ? { name: '审核', status: 'warn', detail: '旧文件无审核记录，建议重新审核' }
            : input.reviewStatus === 'pending'
                ? { name: '审核', status: 'broken', detail: '待审核，不能绑定到项目' }
                : input.reviewStatus === 'rejected'
                    ? { name: '审核', status: 'broken', detail: '已驳回，不能绑定到项目' }
                    : { name: '审核', status: 'unknown', detail: '没有可审核的设定' };

    const bind: LinkStage = input.bound
        ? { name: '绑定', status: 'ok', detail: '已绑定到当前项目' }
        : input.settingExists
            ? { name: '绑定', status: 'broken', detail: '设定未绑定到项目，写作时读不到' }
            : { name: '绑定', status: 'unknown', detail: '等待设定文件' };

    const inject: LinkStage = !input.bound
        ? { name: '注入', status: 'unknown', detail: '等待绑定' }
        : input.rulesHasContent
            ? { name: '注入', status: 'ok', detail: '约束会进入 prompt' }
            : { name: '注入', status: 'broken', detail: '绑定的设定没有实质内容（全是占位）' };

    return summarizeLink('约束流', [research, setting, review, bind, inject], input.degradations);
}

/** 链路类型 */
export type FlowKind = 'knowledge' | 'style' | 'constraint';

/**
 * 把链路状态转成给 agent 读的纯文本。
 *
 * agent 需要的是「断在哪、为什么、下一步做什么」，不是 JSON 结构。
 *
 * @param status - 链路状态
 * @returns 可读文本
 */
export function formatLinkStatusForAgent(status: LinkStatus): string {
    const lines = [`${status.title}：${status.overall === 'ok' ? '已通' : status.breakpoint ? `断在「${status.breakpoint}」` : status.overall === 'warn' ? '可运行但有降级/弱项' : '状态未知'}`];
    for (const stage of status.stages) {
        const icon = stage.status === 'ok' ? '✅' : stage.status === 'broken' ? '❌' : stage.status === 'warn' ? '⚠️' : '❔';
        lines.push(`  ${icon} ${stage.name}：${stage.detail}`);
    }
    if (status.breakpoint) {
        const stage = status.stages.find(s => s.name === status.breakpoint);
        lines.push(`结论：链路断在「${status.breakpoint}」——${stage?.detail ?? ''}。修好这一环，后面的环节才有意义。`);
    }
    if (status.degradations && status.degradations.length > 0) {
        lines.push(`运行时降级（${status.degradations.length}）：${status.degradations.slice(0, 3).join('；')}`);
    }
    return lines.join('\n');
}
