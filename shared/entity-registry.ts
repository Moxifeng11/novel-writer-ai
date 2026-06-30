/**
 * v3.4.8 Batch-5a: 实体类型注册表 — 消除 4 处重复的 entity categories 数组
 * 原重复位置: full-writer-view.ts L355-360 / L2539-2544 / L2616-2628 / L5399-5404
 */
export const ENTITY_CATEGORIES = [
    { label: '人物', icon: '👤', dir: '人物' },
    { label: '地点', icon: '📍', dir: '地点' },
    { label: '势力', icon: '🏰', dir: '势力' },
    { label: '物品功法', icon: '⚔️', dir: '物品功法' },
] as const;

export type EntityCategory = typeof ENTITY_CATEGORIES[number];
