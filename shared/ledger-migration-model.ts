/**
 * ledger-migration-model.ts — 时间线/伏笔迁移计划（纯函数）
 *
 * M14：把「单表 md」迁移为「条目卡 + 派生视图」的计划生成。
 * 只产出计划与派生文本，不写盘；写盘与备份由服务层负责。
 */

import {
    parseForeshadowLibrary,
    parseTimelineBoard,
    renderForeshadowLibrary,
    renderTimelineBoard,
    type ForeshadowCard,
    type TimelineEventCard,
} from './ledger-card-model';

/** 迁移计划 */
export interface LedgerMigrationPlan {
    /** 解析出的事件卡（临时 ID 需替换为正式 ID） */
    timelineCards: TimelineEventCard[];
    /** 解析出的伏笔卡 */
    foreshadowCards: ForeshadowCard[];
    /** 需要分配正式 ID 的数量 */
    needsId: { timeline: number; foreshadow: number };
    /** 派生视图文本 */
    derived: { timeline: string; foreshadow: string };
    /** 摘要 */
    summary: string;
}

/**
 * 生成迁移计划。
 *
 * @param input - 时间线与伏笔原文
 * @returns 计划
 */
export function planLedgerMigration(input: {
    timelineText?: string;
    foreshadowText?: string;
}): LedgerMigrationPlan {
    const timelineCards = parseTimelineBoard(String(input.timelineText ?? ''));
    const foreshadowCards = parseForeshadowLibrary(String(input.foreshadowText ?? ''));
    const needsTimelineId = timelineCards.filter(card => card.id.startsWith('EVT-TMP-')).length;
    const needsForeshadowId = foreshadowCards.filter(card => card.id.startsWith('FSH-TMP-')).length;
    const parts: string[] = [];
    if (timelineCards.length > 0) parts.push(`时间线事件 ${timelineCards.length} 条（需分配 ID ${needsTimelineId} 条）`);
    if (foreshadowCards.length > 0) parts.push(`伏笔 ${foreshadowCards.length} 条（需分配 ID ${needsForeshadowId} 条）`);
    return {
        timelineCards,
        foreshadowCards,
        needsId: { timeline: needsTimelineId, foreshadow: needsForeshadowId },
        derived: {
            timeline: timelineCards.length > 0 ? renderTimelineBoard(timelineCards) : '',
            foreshadow: foreshadowCards.length > 0 ? renderForeshadowLibrary(foreshadowCards) : '',
        },
        summary: parts.length > 0 ? parts.join('；') : '没有可迁移的看板/伏笔库内容',
    };
}

/**
 * 用正式 ID 替换临时 ID。
 *
 * @param plan - 计划
 * @param ids - 正式 ID 序列（按卡片顺序）
 * @returns 新计划
 */
export function assignLedgerIds(
    plan: LedgerMigrationPlan,
    ids: { timeline: string[]; foreshadow: string[] },
): LedgerMigrationPlan {
    let timelineIndex = 0;
    let foreshadowIndex = 0;
    const timelineCards = plan.timelineCards.map(card => {
        if (!card.id.startsWith('EVT-TMP-')) return card;
        const next = ids.timeline[timelineIndex++] ?? card.id;
        return { ...card, id: next };
    });
    const foreshadowCards = plan.foreshadowCards.map(card => {
        if (!card.id.startsWith('FSH-TMP-')) return card;
        const next = ids.foreshadow[foreshadowIndex++] ?? card.id;
        return { ...card, id: next };
    });
    return {
        ...plan,
        timelineCards,
        foreshadowCards,
        needsId: { timeline: 0, foreshadow: 0 },
        derived: {
            timeline: timelineCards.length > 0 ? renderTimelineBoard(timelineCards) : '',
            foreshadow: foreshadowCards.length > 0 ? renderForeshadowLibrary(foreshadowCards) : '',
        },
    };
}
