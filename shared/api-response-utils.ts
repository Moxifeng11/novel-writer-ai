/**
 * APIResponse 工具函数 — 消除 (response as any)?.content 模式
 * 从 co-writer-engine / emotion-curve-analyzer 等文件提取的公共逻辑
 */
import { APIResponse } from '../engine/ai-engine';

/**
 * 判断是否为 APIResponse（有 content 字段的对象）
 */
export function isAPIResponse(obj: unknown): obj is APIResponse {
    return typeof obj === 'object' && obj !== null && 'content' in obj;
}

/**
 * 从 string | APIResponse 联合类型中提取文本内容
 * 安全替代 (response as any)?.content || ''
 */
export function extractResponseContent(
    response: string | APIResponse | null | undefined,
    fallback: string = ''
): string {
    if (!response) return fallback;
    if (typeof response === 'string') return response;
    return (response as APIResponse).content ?? fallback;
}

/**
 * 剥离思考型模型（deepseek-r1 等）泄漏进正文的 <think> 段。
 * Ollama 会把思考内容一并写进 response（流式与非流式都有），
 * 不剥离会把「好，我现在需要帮用户…」当成建议正文展示。
 * 无闭合标签时说明整段仍在思考（或输出被截断），没有可用正文。
 */
export function stripThinkingBlock(content: string): string {
    if (!content) return content;
    const close = content.lastIndexOf('</think>');
    if (close >= 0) return content.slice(close + '</think>'.length).trim();
    if (/<think>/i.test(content)) return '';
    return content;
}

/** 开头导语：模型把「好的，我将…」当正文输出 */
const META_PREAMBLE_LEAD = /^(好的|当然|以下是|这是|根据|按照|收到|明白|没问题|我将)/;
const META_PREAMBLE_HINT = /(我将|以下是|根据您|按照您|为您|续写|撰写|内容如下)/;
/** 标题行（提示词已要求「不要写标题」，首部标题都是元信息） */
const META_HEADING = /^#{1,6}\s/;
/** 独立标签段：**场景：碎砂渡口** */
const META_LABEL = /^\*\*[^*\n]{1,16}[：:]/;
/** 元信息段：【本章写作总计】… */
const META_BLOCK = /^【(本章|写作|字数|总计)[^】]*】/;
/** 结尾评论段：模型对刚写内容的赏析 */
const META_TRAILER_LEAD = /^(这段|以上|本节|整体来看|总结[:：]|分析[:：])/;
const META_TRAILER_HINT = /(展现|刻画|突出|揭示|暗示|推动|体现|表现|形成|氛围)/;

/**
 * 剥离模型写在正文首尾的元叙述。
 * 实测 deepseek-r1 即使被要求「只输出正文」，仍会在首段写
 * 「好的，我将按照您的要求续写…」、末尾写「这段描写通过…展现…」。
 * 只处理首尾、且限长，避免误删正文；剥离后为空则退回原文。
 */
export function stripModelMeta(content: string): string {
    if (!content) return content;
    const paragraphs = content.trim().split(/\n{2,}/).filter((p) => p.trim());
    if (paragraphs.length < 2) return content.trim();

    let head = 0;
    while (head < 3 && head < paragraphs.length - 1) {
        const p = paragraphs[head].trim();
        if (p.length > 300) break;
        const isPreamble = META_PREAMBLE_LEAD.test(p) && META_PREAMBLE_HINT.test(p);
        const isHeading = META_HEADING.test(p) && p.length <= 200;
        const isLabel = META_LABEL.test(p) && p.length <= 80;
        const isBlock = META_BLOCK.test(p) && p.length <= 160;
        if (!isPreamble && !isHeading && !isLabel && !isBlock) break;
        head++;
    }

    let tail = paragraphs.length;
    while (tail - head > 1 && paragraphs.length - tail < 2) {
        const p = paragraphs[tail - 1].trim();
        if (p.length > 500) break;
        if (!(META_TRAILER_LEAD.test(p) && META_TRAILER_HINT.test(p))) break;
        tail--;
    }

    const cleaned = paragraphs.slice(head, tail).join('\n\n').trim();
    return cleaned || content.trim();
}

/** 协同写作文本清洗：思考段 + 首尾元叙述 */
export function sanitizeStoryText(content: string): string {
    return stripModelMeta(stripThinkingBlock(content));
}

/** 分析/规划类输出特征（模型把「怎么写」写成了「写什么」） */
const PLANNING_MARKER = /(设定分析|分析与规划|解决方案|具体建议|具体场景设计|当前章节问题|故事背景|人物动机|情感线索|写作总计|本章写作|背景氛围|情绪曲线)/g;
const LIST_BULLET = /^\s*[-*]\s+/gm;
const NUMBERED = /^\s*\d+[.、]\s+/gm;
const MARKDOWN_HEADING = /^#{1,6}\s/gm;
/** 章节元数据泄漏：模型把 frontmatter / scene 字段当正文吐出来 */
const META_LEAK = /(^|\n)\s*([a-z][a-z0-9]*_[a-z0-9_]{2,29}|涉及人物|涉及地点|卷|章)\s*[:：]/;
/** 首行是方括号/加粗标签标题，如【A2 本章情绪曲线镀点】 */
const LABEL_TITLE = /^(【[^】]{1,24}】|\*{0,2}[^*\n：:]{1,16}[：:])/;

/**
 * 判断清洗后的文本是否仍是「分析/规划」而不是正文。
 * 实测 deepseek-r1 偶发整条输出「### 分析与规划 + **设定分析：** + 列表」，
 * 改写时还会复述【A2 本章情绪曲线镀点】甚至 step_status 等元数据。
 * 这种候选插入正文会污染稿件，宁可丢弃并提示重试。
 */
export function isPlanningOutput(content: string): boolean {
    if (!content) return true;
    const sample = content.slice(0, 600);
    const markerHits = (sample.match(PLANNING_MARKER) || []).length;
    const bullets = (content.match(LIST_BULLET) || []).length;
    const numbered = (content.match(NUMBERED) || []).length;
    const headings = (content.match(MARKDOWN_HEADING) || []).length;
    const leaked = META_LEAK.test(sample);
    const labelTitle = LABEL_TITLE.test(content.trim()) && (bullets + numbered) >= 1;
    return leaked
        || markerHits >= 2
        || (headings >= 1 && bullets + numbered >= 2)
        || bullets + numbered >= 6
        || labelTitle;
}

/**
 * 从模型输出中提取第一个完整的 JSON 对象文本。
 * 实测云端思考型模型（deepseek-flash）返回 JSON 时会在前面带 `<think>…</think>`、
 * 在末尾补一段中文解释，直接 JSON.parse 会报
 * 「Unexpected token '<'」/「Unexpected non-whitespace character after JSON」。
 * 优先取 ```json 围栏内容，其次取第一个花括号平衡片段。
 */
export function extractJsonObject(content: string): string | null {
    if (!content) return null;
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [
        fenced ? fenced[1] : null,
        content,
    ].filter((c): c is string => !!c);

    for (const candidate of candidates) {
        const start = candidate.indexOf('{');
        if (start < 0) continue;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < candidate.length; i++) {
            const ch = candidate[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return candidate.slice(start, i + 1);
            }
        }
    }
    return null;
}

/**
 * 从模型输出中提取第一个完整的 JSON 数组文本。
 * 与 extractJsonObject 同源问题：情节线解析要求返回数组，
 * 思考型模型会带 `<think>…</think>` 前缀或 ```json 围栏，直接 JSON.parse 必然抛错，
 * 调用方 catch 后返回空数组，导致「3 个分卷大纲 → 0 条情节线」。
 */
export function extractJsonArray(content: string): string | null {
    if (!content) return null;
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [
        fenced ? fenced[1] : null,
        content,
    ].filter((c): c is string => !!c);

    for (const candidate of candidates) {
        const start = candidate.indexOf('[');
        if (start < 0) continue;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < candidate.length; i++) {
            const ch = candidate[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') inString = true;
            else if (ch === '[') depth++;
            else if (ch === ']') {
                depth--;
                if (depth === 0) return candidate.slice(start, i + 1);
            }
        }
    }
    return null;
}

/**
 * 从 string | APIResponse 联合类型中提取文本内容
 */
export function extractResponseText(
    response: string | APIResponse | null | undefined,
    fallback: string = ''
): string {
    return stripThinkingBlock(extractResponseContent(response, fallback)).trim();
}

/**
 * 去掉 AI 输出外层的 Markdown 代码围栏。
 * 实体补全/生成要求「只输出本体」，但模型偶尔仍会包 ```markdown，
 * 围栏会让「是否以 --- 开头」的判断失效，进而破坏 frontmatter。
 */
export function stripCodeFence(content: string): string {
    const trimmed = content.trim();
    if (!trimmed.startsWith('```')) return trimmed;
    return trimmed
        .replace(/^```[a-zA-Z]*\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
}
