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

import { t } from '@/i18n';
import { linkTitle, stageDetail, stageName, type LinkStatus } from '@/shared/link-status-compute';

export {
    summarizeLink,
    computeKnowledgeFlowStatus,
    computeStyleFlowStatus,
    computeConstraintFlowStatus,
    formatLinkStatusForAgent,
    // i18n 跨层数据⑦：key 是唯一真源，展示名 / 说明 / 断点名都走这几个 helper
    stageName,
    stageDetail,
    linkTitle,
    linkBreakpointName,
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

const STATUS_TEXT_KEYS: Record<string, string> = {
    ok: 'fingerprint.link.statusOk',
    broken: 'fingerprint.link.statusBroken',
    warn: 'fingerprint.link.statusWarn',
    unknown: 'fingerprint.link.statusUnknown',
};

/** 状态单字（随语言求值；zh 与原常量逐字一致） */
function statusText(overall: string): string {
    return t(STATUS_TEXT_KEYS[overall] ?? STATUS_TEXT_KEYS.unknown);
}

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
    head.createSpan({ cls: 'nw-capability-title', text: t('fingerprint.link.titleSuffix', { title: linkTitle(status) }) });
    const brokenStage = status.breakpointKey ? status.stages.find(stage => stage.nameKey === status.breakpointKey) : undefined;
    head.createSpan({
        cls: 'nw-capability-stage',
        // 断点存 nameKey（稳定标识），展示走 stageName()
        text: brokenStage ? t('fingerprint.link.brokenAt', { bp: stageName(brokenStage) }) : statusText(status.overall),
    });

    const metrics = banner.createDiv({ cls: 'nw-capability-metrics' });
    for (const stage of status.stages) {
        const item = metrics.createDiv({
            cls: 'nw-capability-metric',
            attr: { title: `${stageName(stage)}${t('fingerprint.link.colon')}${stageDetail(stage)}` },
        });
        item.createSpan({ cls: 'nw-capability-metric-value', text: STATUS_ICON[stage.status] });
        item.createSpan({
            cls: 'nw-capability-metric-label',
            text: `${stageName(stage)} · ${stageDetail(stage)}`,
        });
    }

    const notes = banner.createDiv({ cls: 'nw-capability-notes' });
    const firstBroken = status.stages.find(stage => stage.status === 'broken');
    if (firstBroken) {
        notes.createDiv({
            cls: 'nw-capability-note',
            text: t('fingerprint.link.breakpointNote', { name: stageName(firstBroken), detail: stageDetail(firstBroken) }),
        });
    } else if (status.overall === 'ok') {
        notes.createDiv({ cls: 'nw-capability-note', text: t('fingerprint.link.okNote') });
    } else if (status.overall === 'unknown') {
        notes.createDiv({
            cls: 'nw-capability-note',
            text: t('fingerprint.link.unknownNote'),
        });
    }
    // 运行时降级：静态检查看不到「配了但在运行中回退」，必须单独列出
    if (status.degradations && status.degradations.length > 0) {
        notes.createDiv({
            cls: 'nw-capability-note',
            // DSH-20261112-17：取末 3 条——事件按 push 序保留，slice(0,3) 取的是最旧的，
            // 与「最近」语义相反，还会把新出现的孤儿/降级提示挤掉。
            text: t('fingerprint.link.degradations', { count: status.degradations.length, list: status.degradations.slice(-3).join(t('fingerprint.link.degradationSep')) })
                + (status.degradations.length > 3 ? ' …' : ''),
        });
    }
    return banner;
}
