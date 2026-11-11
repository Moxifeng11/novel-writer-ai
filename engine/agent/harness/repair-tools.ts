/**
 * repair-tools.ts — agent 链路自愈工具（阶段 E：从「能诊断」到「能修复」）
 *
 * 诊断（`diagnose-tools.ts`）只回答「断在哪一环」；本模块回答「就地修一环」。
 * 第一批只做两个**低风险、可验证**的修复：
 *   - `revectorize_book`：单本知识库重向量化（不重新拆解、不调用生成模型）
 *   - `reload_fingerprints`：指纹库重载（丢掉陈旧内存缓存，按磁盘重读三层）
 *
 * 安全契约（逐条对应任务验收）：
 * 1. `sideEffect: 'write'`——不是只读，必须进审批通道；
 * 2. **fail-closed**：没有审批回调一律拒绝（哪怕 `ctx.approvalGranted` 为真也不放行，
 *    因为那说明宿主没有能力弹审批，而不是用户批准了）；审批回调返回 false 同样拒绝；
 * 3. 修复依赖缺失 / 抛错 / 返回失败 → 一律 `ok:false` 并说明原因，**绝不静默成功**；
 * 4. 成功后用**诊断采集器重新采集**，把修复后的链路状态一起返回（可观测性：
 *    agent 与用户都能看到「修完到底通没通」，而不是只看「命令执行了」）。
 *
 * engine 层不持有知识库/指纹库实例：修复能力由宿主以函数注入。
 */

import type { HarnessApprovalRequest, HarnessTool, HarnessToolContext, HarnessToolResult } from './harness-types';
import { computeKnowledgeFlowStatus, computeStyleFlowStatus, formatLinkStatusForAgent, type LinkStatus } from '@/shared/link-status-compute';
import type { FlowDiagnosisDeps } from './diagnose-tools';

/** 工具名 */
export const REPAIR_FLOW_TOOL = 'repair_flow';

/** 支持的修复动作 */
export type RepairAction = 'revectorize_book' | 'reload_fingerprints';

/** 修复动作清单（非法动作的报错文案与参数校验共用一份） */
export const REPAIR_ACTIONS: readonly RepairAction[] = ['revectorize_book', 'reload_fingerprints'];

/** 重向量化结果（宿主返回；失败必须带原因） */
export interface RevectorizeBookResult {
    ok: boolean;
    /** 失败原因或成功补充说明 */
    detail?: string;
}

/** 指纹库重载结果（三层条数） */
export interface ReloadFingerprintsResult {
    template: number;
    global: number;
    project: number;
}

/**
 * 修复能力依赖（全部由宿主注入）。
 */
export interface FlowRepairDeps {
    /**
     * 审批回调。**未提供即拒绝**（fail-closed）——修复是写操作，不能靠「默认放行」。
     */
    requestApproval?: (request: HarnessApprovalRequest) => Promise<boolean>;
    /** 单本重向量化；宿主通常桥到 deconstructionScheduler.revectorizeBook(id, name) */
    revectorizeBook?: (bookId: string) => Promise<RevectorizeBookResult>;
    /** 指纹库重载；宿主通常桥到 StyleFingerprintLibrary 的 reload */
    reloadFingerprints?: () => Promise<ReloadFingerprintsResult>;
    /** 修复后复诊用的采集器（与 diagnose_flow 同一套，保证口径一致） */
    diagnose: FlowDiagnosisDeps;
}

/** 书籍 id 白名单形态：与知识库 `isSafeBookId` 同口径（字母数字下划线连字符，1–64） */
const BOOK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 参数校验：返回错误文案，通过则返回 null。
 *
 * @param action - 已识别的动作
 * @param args - 原始参数
 * @returns 错误文案或 null
 */
function validateArgs(action: RepairAction, args: Record<string, unknown>): string | null {
    if (action === 'revectorize_book') {
        const bookId = typeof args.bookId === 'string' ? args.bookId.trim() : '';
        if (!bookId) return 'revectorize_book 需要 bookId（知识库书籍 id，可从 diagnose_flow 的「向量化」环节详情里找）';
        if (!BOOK_ID_PATTERN.test(bookId)) {
            return `bookId 不合法：${bookId}（只允许字母数字下划线连字符，1–64 字）`;
        }
    }
    return null;
}

/**
 * 审批：fail-closed。
 *
 * - 没有回调 → 拒绝（宿主没能力弹审批，不能默认放行）；
 * - 有回调但抛错 → 拒绝（审批链路故障按未批准处理）；
 * - 返回非 true → 拒绝。
 *
 * @param deps - 修复依赖
 * @param request - 审批请求
 * @returns 是否批准
 */
async function requestRepairApproval(deps: FlowRepairDeps, request: HarnessApprovalRequest): Promise<boolean> {
    if (!deps.requestApproval) return false;
    try {
        return (await deps.requestApproval(request)) === true;
    } catch {
        return false;
    }
}

/** 审批请求里的可读目标（用户要在弹窗里看清「修哪一本」） */
function describeTarget(action: RepairAction, args: Record<string, unknown>): string {
    if (action === 'revectorize_book') return `重新计算书籍 ${String(args.bookId).trim()} 的向量`;
    return '按磁盘重载指纹库（模板 / 全局 / 项目三层）';
}

/** 复诊：修完再采集一次，返回格式化文本 */
async function recheck(action: RepairAction, deps: FlowRepairDeps): Promise<{ status: LinkStatus; text: string }> {
    const status = action === 'revectorize_book'
        ? computeKnowledgeFlowStatus(await deps.diagnose.collectKnowledge())
        : computeStyleFlowStatus(await deps.diagnose.collectStyle());
    return { status, text: formatLinkStatusForAgent(status) };
}

/**
 * 创建修复工具集。
 *
 * @param deps - 修复能力与复诊采集器
 * @returns 工具数组（当前 1 个：repair_flow）
 */
export function createRepairTools(deps: FlowRepairDeps): HarnessTool[] {
    return [{
        name: REPAIR_FLOW_TOOL,
        description: '修复创作链路中的单个环节（写操作，需用户批准）。action 可选：'
            + 'revectorize_book（对单本书重新计算向量，不重新拆解、不调用生成模型；'
            + '需要参数 bookId）、reload_fingerprints（按磁盘重载指纹库三层，用于「刚改过指纹但没生效」）。'
            + '修复后会重新诊断并把修复后的链路状态一并返回；修复失败会如实说明原因。',
        parameters: {
            action: {
                type: 'string',
                description: '修复动作',
                enum: [...REPAIR_ACTIONS],
                required: true,
            },
            bookId: {
                type: 'string',
                description: 'revectorize_book 必填：知识库书籍 id（字母数字下划线连字符，1–64 字）',
                required: false,
            },
        },
        required: ['action'],
        sideEffect: 'write',
        execute: async (args: Record<string, unknown>, ctx: HarnessToolContext): Promise<HarnessToolResult> => {
            const action = String(args.action ?? '').trim() as RepairAction;
            if (!REPAIR_ACTIONS.includes(action)) {
                return {
                    ok: false,
                    content: `action 必须是 ${REPAIR_ACTIONS.join(' / ')} 之一（收到「${String(args.action ?? '')}」）`,
                };
            }
            const invalid = validateArgs(action, args);
            if (invalid) return { ok: false, content: invalid };

            // 审批：即使回合层已批准（approvalGranted），也要求宿主确实提供审批回调——
            // 否则「批准」可能只是默认策略，不是用户点的确认。
            if (!ctx.approvalGranted) {
                const approved = await requestRepairApproval(deps, {
                    tool: REPAIR_FLOW_TOOL,
                    args,
                    sideEffect: 'write',
                    reason: describeTarget(action, args),
                });
                if (!approved) {
                    return {
                        ok: false,
                        content: deps.requestApproval
                            ? '用户未批准该修复，已取消；数据未被修改。'
                            : '未提供审批回调，按 fail-closed 拒绝执行修复（数据未被修改）。请让宿主接入确认弹窗后重试。',
                    };
                }
            } else if (!deps.requestApproval) {
                return {
                    ok: false,
                    content: '未提供审批回调，按 fail-closed 拒绝执行修复（数据未被修改）。即使回合层标记已批准，写操作也必须有宿主审批能力。',
                };
            }

            try {
                if (action === 'revectorize_book') {
                    if (!deps.revectorizeBook) {
                        return { ok: false, content: '宿主未提供单本重向量化能力（revectorizeBook），无法执行。' };
                    }
                    const bookId = String(args.bookId).trim();
                    const result = await deps.revectorizeBook(bookId);
                    if (!result || result.ok !== true) {
                        return {
                            ok: false,
                            content: `重向量化失败：${result?.detail || '宿主未返回成功结果'}。数据可能仍是旧状态，请重试或到设置页检查嵌入模型。`,
                            data: { action, bookId },
                        };
                    }
                    const recheckResult = await recheck(action, deps);
                    return {
                        ok: true,
                        content: `已重新计算书籍 ${bookId} 的向量${result.detail ? `（${result.detail}）` : ''}。\n\n修复后链路状态：\n${recheckResult.text}`,
                        data: { action, bookId, status: recheckResult.status },
                    };
                }

                if (!deps.reloadFingerprints) {
                    return { ok: false, content: '宿主未提供指纹库重载能力（reloadFingerprints），无法执行。' };
                }
                const counts = await deps.reloadFingerprints();
                const total = (counts?.template ?? 0) + (counts?.global ?? 0) + (counts?.project ?? 0);
                if (!counts || !Number.isFinite(total)) {
                    return { ok: false, content: '指纹库重载失败：宿主未返回三层条数，无法确认重载结果。', data: { action } };
                }
                const recheckResult = await recheck(action, deps);
                return {
                    ok: true,
                    content: `已重载指纹库：模板 ${counts.template} / 全局 ${counts.global} / 项目 ${counts.project}。\n\n修复后链路状态：\n${recheckResult.text}`,
                    data: { action, counts, status: recheckResult.status },
                };
            } catch (error) {
                // 修复失败必须如实报，不得静默成功
                return {
                    ok: false,
                    content: `修复执行异常：${error instanceof Error ? error.message : String(error)}。数据可能只改了一半，请重新诊断确认当前状态。`,
                    data: { action },
                };
            }
        },
    }];
}
