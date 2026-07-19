/**
 * entity-placeholder.ts — 实体缺失字段占位工具
 *
 * 当 AI 生成的实体（角色/势力/地点/物品）重试耗尽后仍缺失字段时，
 * 不再丢弃整个实体，而是在内容末尾追加缺失字段的占位行，保留已生成内容。
 *
 * 纯函数、无副作用、零外部依赖（不 import obsidian），可在主线程 / Worker / 测试中复用。
 */

/**
 * 为内容追加缺失字段的占位行。
 *
 * @param content 已生成的实体内容
 * @param missingFields 缺失字段名列表
 * @returns 追加占位后的内容；missingFields 为空时原样返回
 */
export function appendMissingFieldPlaceholders(content: string, missingFields: string[]): string {
    if (!missingFields || missingFields.length === 0) {
        return content;
    }
    let result = content;
    for (const field of missingFields) {
        if (result.includes(field)) {
            continue;
        }
        result += `\n${field}：（待补充）`;
    }
    return result;
}
