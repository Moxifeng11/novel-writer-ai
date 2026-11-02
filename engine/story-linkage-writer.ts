/**
 * story-linkage-writer.ts — 关联索引回写
 *
 * Rev 186：用户要求关联结果能回写到「伏笔库.md / 时间线看板.md」。
 * 回写只允许动一对显式标记之间的自动生成区，绝不改用户原表格；
 * 同一份数据重复回写结果字节级一致（幂等）。
 */
import type { LinkageForeshadow, LinkageTimelineEvent } from './story-linkage';

export const LINKAGE_BEGIN = '<!-- NW-LINKAGE:BEGIN 由小说工坊自动生成，请勿手改 -->';
export const LINKAGE_END = '<!-- NW-LINKAGE:END -->';

function escapeCell(value: string): string {
    return (value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function pushWarnings(lines: string[], warnings: string[]): void {
    lines.push('### 数据质量提示', '');
    if (warnings.length === 0) {
        lines.push('无');
        return;
    }
    for (const warning of warnings) lines.push(`- ${warning}`);
}

/**
 * 写入 / 替换自动生成块。
 *
 * - 标记对完整 → 原位替换；
 * - 无标记 → 追加到文末（前面加分隔线）；
 * - 只有 BEGIN 没有 END（残缺）→ 视为无标记追加，不删除任何用户内容。
 * @param original - 原始
 * @param block - 文本块
 * @returns 文本结果
 */
export function upsertLinkageBlock(original: string, block: string): string {
    const body = (block || '').trim();
    const wrapped = `${LINKAGE_BEGIN}\n${body}\n${LINKAGE_END}`;
    const source = original || '';

    const beginIdx = source.indexOf(LINKAGE_BEGIN);
    const endIdx = source.indexOf(LINKAGE_END);
    if (beginIdx >= 0 && endIdx > beginIdx) {
        const before = source.slice(0, beginIdx);
        const after = source.slice(endIdx + LINKAGE_END.length);
        return `${before}${wrapped}${after}`;
    }

    const trimmed = source.replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n\n---\n\n${wrapped}\n` : `${wrapped}\n`;
}

/**
 * 伏笔库自动块：到期 / 逾期 / 即将到期 / 数据质量
 *
 * @param items - 条目列表
 * @param warnings - 警告
 * @param generatedAt - 生成时间
 * @param referenceChapter - 参考章节
 * @returns 文本结果
 */
export function buildForeshadowIndexBlock(
    items: LinkageForeshadow[],
    warnings: string[],
    generatedAt: string,
    referenceChapter: number,
): string {
    const lines: string[] = [
        '## 关联索引（自动生成）',
        '',
        `> 生成时间：${generatedAt} · 参照章：第${referenceChapter}章 · 由「关联索引看板」回写，请勿手改本段`,
        '',
    ];

    const groups: Array<[string, LinkageForeshadow[]]> = [
        ['本章到期', items.filter(i => i.state === 'due')],
        ['逾期未回收', items.filter(i => i.state === 'overdue')],
        ['3 章内即将到期', items.filter(i => i.state === 'upcoming')],
    ];

    for (const [title, list] of groups) {
        lines.push(`### ${title}（${list.length}）`, '');
        if (list.length === 0) {
            lines.push('无', '');
            continue;
        }
        lines.push('| 伏笔 | 重要度 | 埋设章节 | 计划回收 | 关联设定 | 规划定位 |');
        lines.push('| --- | --- | --- | --- | --- | --- |');
        for (const item of list) {
            lines.push([
                '',
                escapeCell(item.name) || '—',
                escapeCell(item.importance) || '—',
                escapeCell(item.buryChapter) || '—',
                escapeCell(item.plannedRaw) || '待定',
                escapeCell(item.settingRefs.join('、')) || '—',
                escapeCell(item.planningRef) || '—',
                '',
            ].join(' | ').trim());
        }
        lines.push('');
    }

    pushWarnings(lines, warnings);
    return lines.join('\n');
}

/**
 * 时间线看板自动块：去重后的事件总览 + 数据质量
 *
 * @param events - 事件列表
 * @param warnings - 警告
 * @param generatedAt - 生成时间
 * @returns 文本结果
 */
export function buildTimelineIndexBlock(
    events: LinkageTimelineEvent[],
    warnings: string[],
    generatedAt: string,
): string {
    const lines: string[] = [
        '## 关联索引（自动生成）',
        '',
        `> 生成时间：${generatedAt} · 事件 ${events.length} 条（已去重）· 由「关联索引看板」回写，请勿手改本段`,
        '',
    ];

    if (events.length === 0) {
        lines.push('无时间线事件', '');
    } else {
        lines.push('| 时间 | 章节 | 事件 | 状态 | 关联设定 |');
        lines.push('| --- | --- | --- | --- | --- |');
        const stateLabel: Record<LinkageTimelineEvent['state'], string> = {
            past: '前史',
            'in-chapter': '本章',
            future: '后续',
        };
        for (const event of events) {
            lines.push([
                '',
                escapeCell(event.time) || '—',
                escapeCell(event.chapter) || '—',
                escapeCell(event.eventName) || '—',
                stateLabel[event.state],
                escapeCell(event.settingRefs.join('、')) || '—',
                '',
            ].join(' | ').trim());
        }
        lines.push('');
    }

    pushWarnings(lines, warnings);
    return lines.join('\n');
}
