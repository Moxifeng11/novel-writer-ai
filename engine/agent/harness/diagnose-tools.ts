/**
 * diagnose-tools.ts — agent 自诊断工具（阶段 C1）
 *
 * 长期目标阶段 C：agent 要能回答「**我的设定为什么没进正文**」并自主定位到具体环节。
 *
 * 设计要点：
 * - 判定逻辑复用 `shared/link-status-compute`——**界面看到的断点**与
 *   **agent 诊断出的断点**必须是同一套口径，否则用户和 agent 会各说各话。
 * - 采集器（`collect*`）由宿主注入：engine 层拿不到
 *   knowledgeBaseManager / vectorStore / fingerprintLibrary，也不应该拿。
 * - 工具只读（`sideEffect: 'none'`），可重复调用。
 */

import type { HarnessTool } from './harness-types';
import {
    computeKnowledgeFlowStatus,
    computeStyleFlowStatus,
    computeConstraintFlowStatus,
    formatLinkStatusForAgent,
    type ConstraintFlowInput,
    type FlowKind,
    type KnowledgeFlowInput,
    type LinkStatus,
    type StyleFlowInput,
} from '@/shared/link-status-compute';

/** 三条链路的采集器（由宿主注入） */
export interface FlowDiagnosisDeps {
    /** 采集知识流输入 */
    collectKnowledge(): Promise<KnowledgeFlowInput>;
    /** 采集风格流输入 */
    collectStyle(): Promise<StyleFlowInput>;
    /** 采集约束流输入 */
    collectConstraint(): Promise<ConstraintFlowInput>;
}

/** 工具名（供 UI/测试引用，避免字符串散落） */
export const DIAGNOSE_FLOW_TOOL = 'diagnose_flow';

/**
 * 按链路类型计算状态。
 *
 * @param flow - 链路类型
 * @param deps - 采集器
 * @returns 链路状态
 */
async function computeByKind(flow: FlowKind, deps: FlowDiagnosisDeps): Promise<LinkStatus> {
    switch (flow) {
        case 'knowledge': return computeKnowledgeFlowStatus(await deps.collectKnowledge());
        case 'style': return computeStyleFlowStatus(await deps.collectStyle());
        case 'constraint': return computeConstraintFlowStatus(await deps.collectConstraint());
    }
}

/**
 * 创建诊断工具集。
 *
 * @param deps - 采集器
 * @returns 工具数组
 */
export function createDiagnoseTools(deps: FlowDiagnosisDeps): HarnessTool[] {
    return [{
        name: DIAGNOSE_FLOW_TOOL,
        description: '诊断创作链路为什么没生效。flow 可选 knowledge（拆解→向量→检索→注入）、'
            + 'style（指纹→启用→强度→注入）、constraint（考据→设定→审核→绑定→注入）或 all。'
            + '返回每个环节的通/断与第一处断点，用于回答「我配了/拆解了，为什么写作时没用上」。'
            + '这是只读诊断，不会修改任何数据。',
        parameters: {
            flow: {
                type: 'string',
                description: '要诊断的链路；all 会逐条诊断三条',
                enum: ['knowledge', 'style', 'constraint', 'all'],
                required: true,
            },
        },
        required: ['flow'],
        sideEffect: 'none',
        execute: async (args) => {
            const flow = String(args.flow ?? '').trim() as FlowKind | 'all';
            const valid: Array<FlowKind | 'all'> = ['knowledge', 'style', 'constraint', 'all'];
            if (!valid.includes(flow)) {
                return { ok: false, content: `flow 必须是 ${valid.join(' / ')} 之一` };
            }
            try {
                if (flow === 'all') {
                    const statuses = await Promise.all([
                        computeByKind('knowledge', deps),
                        computeByKind('style', deps),
                        computeByKind('constraint', deps),
                    ]);
                    const broken = statuses.filter(s => s.breakpoint);
                    const content = statuses.map(s => formatLinkStatusForAgent(s)).join('\n\n');
                    return {
                        ok: true,
                        content: broken.length === 0
                            ? `三条链路都没有断点。\n\n${content}`
                            : `发现 ${broken.length} 条链路有断点：${broken.map(s => `${s.title}断在「${s.breakpoint}」`).join('；')}\n\n${content}`,
                        data: { statuses },
                    };
                }
                const status = await computeByKind(flow, deps);
                return {
                    ok: true,
                    content: formatLinkStatusForAgent(status),
                    data: { status },
                };
            } catch (error) {
                // 采集失败要如实报，不能假装「链路没问题」
                return {
                    ok: false,
                    content: `诊断失败：${error instanceof Error ? error.message : String(error)}。`
                        + '这通常说明相关服务未初始化，请确认已打开项目且插件加载完成。',
                };
            }
        },
    }];
}
