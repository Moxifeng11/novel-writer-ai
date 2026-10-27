/**
 * engine/settlement/settlement-types.ts
 * 章节结算引擎共享类型。
 *
 * 从 settlement-engine.ts 提取（2026-06-30 P1-2 拆分阶段一）。
 */

/**
 * AI 分析报告中所有可识别指令的解析结果。
 *
 * 指令格式约定（每行一条，由 parseReport 用正则匹配）：
 * - UPDATE_CHARACTER: [[角色]] | 字段 | 新值
 * - UPDATE_FACTION / UPDATE_LOCATION / UPDATE_ITEM / UPDATE_FORESHADOW: 同上
 * - NEW_CHARACTER / NEW_LOCATION / NEW_FACTION / NEW_ITEM: 名 | 描述
 * - NEW_FORESHADOW: 内容 | 埋设章节 | 预期揭示 | 相关人物 | 关联主线 (v1.3.0 起 5 字段，兼容旧 3 字段)
 * - NEW_TIMELINE: 时间点 | 事件
 * - RELATION: 实体A | 实体B | 关系类型 | 描述
 * - GROWTH: 人物 | 成长类型 | 新值 | 描述
 * - EMOTION: [[角色]] | 当前情绪 | 描述
 * - DELETE_ENTITY: 实体类型 | 名称
 */
export interface Instructions {
    uc: { name: string; field: string; value: string }[];        // UPDATE_CHARACTER
    uf: { name: string; field: string; value: string }[];        // UPDATE_FORESHADOW
    ufa: { name: string; field: string; value: string }[];       // UPDATE_FACTION
    uloc: { name: string; field: string; value: string }[];      // UPDATE_LOCATION
    uitem: { name: string; field: string; value: string }[];     // UPDATE_ITEM
    nc: { name: string; description: string }[];                 // NEW_CHARACTER
    nl: { name: string; description: string }[];                 // NEW_LOCATION
    nf: { name: string; description: string }[];                 // NEW_FACTION
    ni: { name: string; description: string }[];                 // NEW_ITEM
    nfs: { name: string; chapter: string; reveal: string; relatedChars?: string; relatedPlotline?: string }[]; // NEW_FORESHADOW
    nt: { desc: string; event: string }[];                       // NEW_TIMELINE
    rel: { entityA: string; entityB: string; relType: string; desc: string }[];  // RELATION
    growth: { name: string; type: string; value: string; desc: string }[];       // GROWTH
    emotion: { name: string; emotion: string; desc: string }[];                  // EMOTION
    del: { entityType: string; entityName: string }[];                           // DELETE_ENTITY (v1.4.0)
    promise: { action: 'open' | 'advance' | 'resolve' | 'drop'; name: string; type?: string; chapter?: string; expected?: string; note?: string }[]; // PROMISE_*
    arc: { name: string; from: string; to: string; trigger: string; visible: string }[]; // ARC
}

/** frontmatter 通用类型（settlement 内部使用） */
export interface FrontMatter { [key: string]: unknown }
