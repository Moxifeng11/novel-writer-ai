/**
 * timeline-events-format.ts — 时间线事件 → prompt 文本的格式化（单一实现）
 *
 * audit §四-6：时间线表的 `涉及人物 / 地点 / 类型` 列此前被丢弃，
 * 只注入了 time/chapter/event/impact 四列。这些是结构化信息，
 * 对"本章该让谁出场、在何处"直接有用。
 *
 * 抽成纯函数是为了可测：此前该逻辑内联在 800+ 行的模板变量构建器里，无法单测。
 */

/**
 * 时间线事件的最小结构。
 *
 * 不直接 import engine 的 TimelineEvent：shared/ 不允许依赖 engine/（架构锁 D3-3）。
 * engine 的 TimelineEvent 结构上兼容本接口，调用方直接传即可。
 */
export interface TimelineEventLike {
    time: string;
    chapter: string;
    event: string;
    impact: string;
    /** 地点（可选） */
    location?: string;
    /** 涉及人物（可选） */
    involvedEntities?: readonly string[];
    /** 事件类型（可选） */
    type?: string;
}

/**
 * 把时间线事件格式化为 prompt 行。
 *
 * 每条事件输出一行：`- 时间 | 章节 | 事件 | 影响`；
 * 若该事件带结构化字段（涉及人物/地点/类型），以括号追加，例如：
 * `- 第三日 | 第3章 | 宁缺入长安 | 身份暴露风险（涉及人物：宁缺、桑桑；地点：长安）`
 *
 * @param events - 时间线事件
 * @param compressed - 已有的压缩时间线文本（非空时优先使用）
 * @returns 供 prompt 注入的文本
 */
export function formatTimelineEvents(
    events: readonly TimelineEventLike[] | undefined,
    compressed?: string,
): string {
    const compact = (compressed ?? '').trim();
    if (compact) return compact;
    const rows = events ?? [];
    return rows.map((row) => {
        const base = `- ${row.time} | ${row.chapter} | ${row.event} | ${row.impact}`;
        const extras: string[] = [];
        if (row.involvedEntities && row.involvedEntities.length > 0) {
            extras.push(`涉及人物：${row.involvedEntities.join('、')}`);
        }
        if (row.location) extras.push(`地点：${row.location}`);
        if (row.type) extras.push(`类型：${row.type}`);
        return extras.length > 0 ? `${base}（${extras.join('；')}）` : base;
    }).join('\n');
}
