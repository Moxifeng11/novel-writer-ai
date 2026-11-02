/**
 * character-context.ts — 人物 frontmatter → 质量/偏离检测上下文的统一映射
 *
 * 协同主视图（OOC / 设定矛盾检测）与浮窗逻辑检查原先各写一份映射，口径已出现分歧：
 * 一边用「未知」兜底后再过滤，一边直接过滤空 name。统一为一份纯函数，便于单测，
 * 也避免后续新增检测入口时再复制第三份。
 */

import type { CharacterContextInfo } from './quality/quality-score-engine';

/**
 * 只接受字符串（frontmatter 可能把字段解析成对象/数字），并去掉首尾空白
 *
 * @param value - 值
 * @returns 文本结果
 */
function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 把 `ctxManager.gatherCharacterState` 返回的原始人物记录映射为检测上下文。
 * 缺少可用姓名的记录直接丢弃（无姓名的角色无法参与 OOC / 外貌矛盾匹配）。
 * @param raw - 原始
 * @returns 结果数组
 */
export function toCharacterContextInfos(
    raw: Array<Record<string, unknown>> | undefined | null,
): CharacterContextInfo[] {
    if (!raw || raw.length === 0) return [];

    const list: CharacterContextInfo[] = [];
    for (const c of raw) {
        const name = text(c.name) || text(c['姓名']) || text(c.fileName);
        if (!name) continue;
        list.push({
            name,
            personality: text(c['性格标签']),
            appearance: text(c['外貌特征']),
            abilities: text(c['功法/技能树']) || text(c['金手指/特殊能力']),
            background: text(c['人物背景']),
        });
    }
    return list;
}
