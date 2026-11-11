/**
 * logic-check-format.ts — 人物逻辑检查的展示映射（阶段 D1）
 *
 * 从 `ui/co-write-floating-panel.ts` 抽出。这些映射此前内联在渲染方法里：
 * - 得分 → 颜色（≥80 绿 / ≥60 橙 / 其余红）
 * - 严重度 → 颜色 + emoji
 * - 不一致类型 → 中文标签
 *
 * 抽出的理由：**新增一个类型却忘了加标签，界面就会直接显示英文 key**
 * （如 `appearance` 变成英文），而这类回归此前零测试覆盖。
 */

/** 严重度 */
export type LogicSeverity = 'high' | 'medium' | 'low';

/** 严重度的展示元数据 */
export interface SeverityMeta {
    /** 颜色（CSS 值） */
    color: string;
    /** 圆点 emoji */
    icon: string;
    /** 中文标签 */
    label: string;
}

const SEVERITY_META: Record<LogicSeverity, SeverityMeta> = {
    high: { color: '#ef4444', icon: '🔴', label: '高' },
    medium: { color: '#f59e0b', icon: '🟡', label: '中' },
    low: { color: '#3b82f6', icon: '🟢', label: '低' },
};

/** 不一致类型 → 中文标签 */
const TYPE_LABELS: Record<string, string> = {
    personality: '性格语气',
    behavior: '行为逻辑',
    ability: '能力边界',
    appearance: '外貌描述',
};

/**
 * 人物逻辑检查得分 → 颜色。
 *
 * 阈值：`>=80` 绿、`>=60` 橙、其余红。
 *
 * @param score - 0–100 的分数
 * @returns 颜色
 */
export function resolveLogicScoreColor(score: number | undefined): string {
    const value = Number(score);
    if (!Number.isFinite(value)) return '#ef4444';
    if (value >= 80) return '#10b981';
    if (value >= 60) return '#f59e0b';
    return '#ef4444';
}

/**
 * 严重度 → 展示元数据（颜色 / emoji / 中文标签）。
 *
 * 未知严重度按 `low` 处理，避免出现空白颜色。
 *
 * @param severity - 严重度
 * @returns 展示元数据
 */
export function resolveSeverityMeta(severity: string | undefined): SeverityMeta {
    if (severity === 'high') return SEVERITY_META.high;
    if (severity === 'medium') return SEVERITY_META.medium;
    return SEVERITY_META.low;
}

/**
 * 不一致类型 → 中文标签。
 *
 * 未知类型回落到原始 key（不显示空白，便于排查新增类型漏配标签）。
 *
 * @param type - 类型 key
 * @returns 中文标签或原 key
 */
export function resolveLogicTypeLabel(type: string | undefined): string {
    const key = String(type ?? '').trim();
    if (!key) return '未知类型';
    return TYPE_LABELS[key] ?? key;
}

/**
 * 当前已配置中文标签的类型列表（供测试与文档核对）。
 *
 * @returns 类型 key 数组
 */
export function listLogicTypeKeys(): string[] {
    return Object.keys(TYPE_LABELS);
}
