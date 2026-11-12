/**
 * link-status.ts — 三条数据流的链路状态**渲染**（阶段 A4）
 *
 * 判定逻辑已下沉到 `shared/link-status-compute.ts`（阶段 C1）：
 * agent 诊断工具在 `engine/` 层不能 import `ui/`，但两边必须用同一套口径。
 * 本文件只保留 DOM 渲染，并 re-export 判定函数，现有调用方无需改动。
 *
 * 与 `knowledge-capability` / `fingerprint-capability` 的分工：
 * - 那两个回答「当前能力处于什么阶段」（empty / accumulating / ready / degraded）；
 * - 本模块回答「这条链路具体断在哪一环」——把 4–5 个环节逐一标出状态。
 *
 * 渲染完全复用 `nw-capability-*` 现有类（不新增 CSS），状态用 emoji 表达。
 */

import type { LinkStatus } from '@/shared/link-status-compute';

export {
    summarizeLink,
    computeKnowledgeFlowStatus,
    computeStyleFlowStatus,
    computeConstraintFlowStatus,
    formatLinkStatusForAgent,
} from '@/shared/link-status-compute';
export type {
    LinkStage,
    LinkStageStatus,
    LinkStatus,
    KnowledgeFlowInput,
    StyleFlowInput,
    ConstraintFlowInput,
    FlowKind,
} from '@/shared/link-status-compute';

const STATUS_ICON: Record<string, string> = {
    ok: '✅',
    broken: '❌',
    warn: '⚠️',
    unknown: '❔',
};

const STATUS_TEXT: Record<string, string> = {
    ok: '通',
    broken: '断',
    warn: '弱',
    unknown: '未知',
};

/**
 * 渲染链路状态。
 *
 * 复用 `nw-capability-*` 现有类，不新增 CSS：
 * - 环节用 `nw-capability-metric`（emoji 当 value、环节名+数量当 label）
 * - 断点与建议用 `nw-capability-note`
 *
 * @param container - 挂载容器
 * @param status - 链路状态
 * @returns 状态根元素
 */
export function renderLinkStatus(container: HTMLElement, status: LinkStatus): HTMLElement {
    // 复用 capability banner 的 stage 配色：broken 用 degraded、warn 用 accumulating、ok 用 ready
    const stageClass = status.overall === 'ok'
        ? 'nw-is-ready'
        : status.overall === 'warn'
            ? 'nw-is-accumulating'
            : status.overall === 'broken'
                ? 'nw-is-degraded'
                : 'nw-is-empty';
    const banner = container.createDiv({ cls: `nw-capability-banner ${stageClass}` });

    const head = banner.createDiv({ cls: 'nw-capability-head' });
    head.createSpan({ cls: 'nw-capability-title', text: `${status.title}状态` });
    head.createSpan({
        cls: 'nw-capability-stage',
        text: status.breakpoint ? `断在「${status.breakpoint}」` : STATUS_TEXT[status.overall],
    });

    const metrics = banner.createDiv({ cls: 'nw-capability-metrics' });
    for (const stage of status.stages) {
        const item = metrics.createDiv({
            cls: 'nw-capability-metric',
            attr: { title: `${stage.name}：${stage.detail}` },
        });
        item.createSpan({ cls: 'nw-capability-metric-value', text: STATUS_ICON[stage.status] });
        item.createSpan({
            cls: 'nw-capability-metric-label',
            text: `${stage.name} · ${stage.detail}`,
        });
    }

    const notes = banner.createDiv({ cls: 'nw-capability-notes' });
    const firstBroken = status.stages.find(stage => stage.status === 'broken');
    if (firstBroken) {
        notes.createDiv({
            cls: 'nw-capability-note',
            text: `断点：${firstBroken.name} —— ${firstBroken.detail}。修好这一环，后面的环节才有意义。`,
        });
    } else if (status.overall === 'ok') {
        notes.createDiv({ cls: 'nw-capability-note', text: '链路已通，配置会在下次生成时生效。' });
    } else if (status.overall === 'unknown') {
        notes.createDiv({
            cls: 'nw-capability-note',
            text: '链路尚未产生可判定数据（多为运行时信息，如 rag_sources 归因需写作后核对）。',
        });
    }
    // 运行时降级：静态检查看不到「配了但在运行中回退」，必须单独列出
    if (status.degradations && status.degradations.length > 0) {
        notes.createDiv({
            cls: 'nw-capability-note',
            // DSH-20261112-17：取末 3 条——事件按 push 序保留，slice(0,3) 取的是最旧的，
            // 与「最近」语义相反，还会把新出现的孤儿/降级提示挤掉。
            text: `最近降级 ${status.degradations.length} 次：${status.degradations.slice(-3).join('；')}`
                + (status.degradations.length > 3 ? ' …' : ''),
        });
    }
    return banner;
}
