/**
 * annotation-marker.ts — 摘要内嵌写作批注（2026-11-27，⟨✍⟩ 机制）
 *
 * ## 设计来源
 *
 * 云笔的章节摘要里可以嵌「导演批注」：
 *
 * ```
 * **【角色】林玄**没有告诉任何人梦中的内容。
 * ⟨✍ 此处不展开战斗细节，只用两句写结果——重点是战后他发现的那个不该出现的东西 ⟩
 * ```
 *
 * ## 为什么分离
 *
 * - **摘要**告诉正文模型「发生什么」（故事层）
 * - **批注**告诉正文模型「怎么处理这一段」（技法层）
 *
 * 混在一起写会让摘要臃肿（故事和技法纠缠）；完全不写又会让模型失去微操指令。
 * 用标记分隔，解析时剥离——摘要保持干净，批注单独成块注入。
 *
 * ## 本仓适配
 *
 * 云笔每章 3-5 处批注。本仓不强制数量，有就注入、没有就不加块。
 * 批注来源：用户在大纲里手写，或 AI 生成大纲时产出。
 */

/** 批注标记正则：⟨✍ ... ⟩ */
const ANNOTATION_RE = /⟨✍\s*([\s\S]*?)\s*⟩/g;

/** 单条批注 */
export interface ExtractedAnnotation {
    /** 批注文本 */
    text: string;
    /** 在原文中的起始位置 */
    index: number;
}

/**
 * 从摘要文本中提取批注，并返回剥离批注后的纯摘要。
 *
 * 容错：批注内可含换行（多行批注合法）。
 *
 * @param summary - 含批注的摘要
 * @returns 纯摘要 + 批注列表
 * @example
 * const { text, annotations } = extractAnnotations('他推门。⟨✍ 门后应有声音 ⟩');
 * // text = '他推门。'
 * // annotations = [{ text: '门后应有声音', index: 4 }]
 */
export function extractAnnotations(summary: string): {
    text: string;
    annotations: ExtractedAnnotation[];
} {
    const annotations: ExtractedAnnotation[] = [];
    // 用 replace 的回调拿 index 不可靠（replace 不提供偏移）；改用 exec 循环
    let m: RegExpExecArray | null;
    const re = new RegExp(ANNOTATION_RE.source, 'g');
    while ((m = re.exec(summary)) !== null) {
        const t = m[1].trim();
        if (t) annotations.push({ text: t, index: m.index });
    }
    // 剥离批注（保留其它内容）
    const text = summary
        .replace(ANNOTATION_RE, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { text, annotations };
}

/**
 * 把批注渲染成给正文模型的「写作批注」块。
 *
 * 无批注时返回空串（调用方据此决定是否注入）。
 *
 * @param annotations - 批注列表（字符串或 ExtractedAnnotation）
 * @returns 提示词片段
 * @example
 * renderAnnotationBlock(['门后应有声音'])
 * // '【本章写作批注（按位置执行）】\n1. 门后应有声音\n'
 */
export function renderAnnotationBlock(
    annotations: Array<string | ExtractedAnnotation>,
): string {
    if (annotations.length === 0) return '';
    const texts = annotations
        .map(a => (typeof a === 'string' ? a : a.text))
        .map(t => t.trim())
        .filter(Boolean);
    if (texts.length === 0) return '';
    return [
        '【本章写作批注（来自大纲，按位置执行；不是剧情要求，是写法要求）】',
        ...texts.map((t, i) => `${i + 1}. ${t}`),
        '',
    ].join('\n');
}

/**
 * 判断摘要里是否含有批注（不解析，只探测）。
 *
 * @param summary - 摘要文本
 * @returns 是否含批注
 * @example
 * hasAnnotations('他推门。⟨✍ 门后应有声音 ⟩') // true
 * hasAnnotations('他推门。')                   // false
 */
export function hasAnnotations(summary: string): boolean {
    return new RegExp(ANNOTATION_RE.source).test(summary);
}

/**
 * 从「摘要 + 批注」构造正文提示词需要的两段内容。
 *
 * 一步完成「剥离 + 渲染」，调用方直接用两个返回值。
 *
 * @param summary - 原始摘要（含批注）
 * @returns 纯摘要 + 批注块（无批注时块为空串）
 * @example
 * const { cleanSummary, annotationBlock } = buildAnnotationParts(infoPlan);
 * vars['infoPlan'] = cleanSummary;
 * vars['writingAnnotations'] = annotationBlock;
 */
export function buildAnnotationParts(summary: string): {
    cleanSummary: string;
    annotationBlock: string;
} {
    const { text, annotations } = extractAnnotations(summary);
    return { cleanSummary: text, annotationBlock: renderAnnotationBlock(annotations) };
}
