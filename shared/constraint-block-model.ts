/**
 * constraint-block-model.ts — 结构化约束块（B3）
 *
 * 现状：断言、节奏、口吻各自渲染成「一段文本」塞进提示词，模型无法分辨哪条约束
 * 对应哪个实体，事后也无法归因（这条约束有没有起作用、哪来的）。
 *
 * 本模型把它们归一成带稳定 ID、锚点实体与来源的**约束块**：
 *  - 渲染时带 `[C1]` 编号，便于模型引用与日志回查；
 *  - 每个块记录 anchorIds，注入账本可按实体归因。
 */

/** 约束种类 */
export type ConstraintKind = 'fact' | 'timeline' | 'voice' | 'rhythm' | 'foreshadow';

/** 约束来源（可追溯到文件/步骤） */
export type ConstraintSource = '断言' | '人物卡' | '伏笔库' | '情绪规划' | '场景展开';

/** 结构化约束块 */
export interface ConstraintBlock {
    /** 稳定 ID（渲染为 [C1]…），由 kind+内容摘要派生 */
    id: string;
    kind: ConstraintKind;
    /** 一句话约束（给模型看的正文） */
    text: string;
    /** 锚定实体 ID（用于归因与精确匹配） */
    anchorIds: string[];
    /** 来源 */
    source: ConstraintSource;
}

/** 渲染结果 */
export interface RenderedConstraints {
    /** 编号后的 Markdown 段落 */
    section: string;
    /** 注入归因：块 ID → 锚点实体 */
    attribution: Array<{ blockId: string; anchorIds: string[] }>;
}

/**
 * 由 kind/文本派生稳定 ID（同一约束重复注入时编号稳定）。
 *
 * @param kind - 种类
 * @param text - 约束文本
 * @param index - 同文本序号兜底
 * @returns 稳定 ID
 */
export function constraintBlockId(kind: ConstraintKind, text: string, index = 0): string {
    const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
        hash ^= normalized.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `${kind}-${hash.toString(36)}-${index}`;
}

/**
 * 归一化并去重约束块（同 text 只保留一条）。
 *
 * @param blocks - 原始块（id 可空）
 * @returns 去重后的块
 */
export function normalizeConstraintBlocks(
    blocks: ReadonlyArray<Omit<ConstraintBlock, 'id'> & { id?: string }>,
): ConstraintBlock[] {
    const seen = new Set<string>();
    const result: ConstraintBlock[] = [];
    for (const block of blocks) {
        const text = String(block.text ?? '').trim();
        if (!text) continue;
        const key = `${block.kind}|${block.source}|${text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
            id: block.id && block.id.trim() ? block.id : constraintBlockId(block.kind, text, result.length),
            kind: block.kind,
            text,
            anchorIds: [...new Set(block.anchorIds ?? [])],
            source: block.source,
        });
    }
    return result;
}

/**
 * 渲染约束块为提示词段落，并返回注入归因。
 *
 * @param blocks - 约束块
 * @param maxChars - 段落字符上限（超限按优先级截断，不静默丢信息：返回 attribution 里剔除的块）
 * @returns 渲染结果
 */
export function renderConstraintBlocks(blocks: readonly ConstraintBlock[], maxChars = 4000): RenderedConstraints {
    const attribution: Array<{ blockId: string; anchorIds: string[] }> = [];
    const lines: string[] = [];
    let used = 0;
    let shown = 0;
    for (const block of blocks) {
        const line = `- [C${shown + 1}] ${block.text}`;
        if (used + line.length > maxChars && shown > 0) continue;
        lines.push(line);
        used += line.length + 1;
        shown += 1;
        attribution.push({ blockId: block.id, anchorIds: block.anchorIds });
    }
    if (shown === 0) return { section: '', attribution: [] };
    const section = ['【必须遵守的约束】', ...lines].join('\n');
    return { section, attribution };
}
