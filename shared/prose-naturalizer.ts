/**
 * prose-naturalizer.ts — 把“一句一段”的碎片正文重排成自然段
 *
 * 这是确定性后处理，不调用模型、不改写句子，只做三件事：
 *   1. 合并相邻的叙述短段；
 *   2. 把对话和紧跟其后的说话人动作/神态并到同一段；
 *   3. 保留场景转换、标题、列表和显式空行作为硬边界。
 *
 * 目标是可读性，不是“过检测”。合并后仍应人工检查一遍。
 */
import { splitProseSentences } from './prose-metrics';

/**
 * NaturalizeOptions 类型定义。
 */
export interface NaturalizeOptions {
    /** 单个自然段的最大字数（超过就不再合并） */
    maxParagraphChars?: number;
    /** 单个自然段的最大句数 */
    maxSentencesPerParagraph?: number;
    /** 短动作节拍（不超过这个字数）可以和后一句对话合并 */
    maxBeatChars?: number;
    /** 输出段间分隔符；默认沿用输入（有空行则空行，否则单换行） */
    separator?: '\n' | '\n\n';
    /** 段首缩进；传入后会先剥离、输出时再补回 */
    indent?: string;
}

/**
 * NaturalizeResult 类型定义。
 */
export interface NaturalizeResult {
    text: string;
    paragraphsBefore: number;
    paragraphsAfter: number;
    mergedParagraphs: number;
    changes: string[];
}

const DEFAULT_MAX_PARAGRAPH_CHARS = 220;
const DEFAULT_MAX_SENTENCES = 6;
const DEFAULT_MAX_BEAT_CHARS = 46;

const TRANSITION_RE = /^(第二天|次日|夜里|天亮|半晌|半个时辰|一炷香|与此同时|另一边|远处|片刻|过了一会儿|不多时|稍顷|后来|从那以后|这时|此时|忽然|突然|转眼|入夜|清晨|黄昏|天黑|风停|雨停|出了|进了|回到|到了|等[他到]|直到)/;
const SPEECH_VERB_RE = /(说|问|答|道|喊|叫|嚷|嘟囔|嘀咕|骂|笑|叹|哼|回|应|开口|低声|高声|沉声|冷声|补了一句|接话|念叨|咕哝|吼|喝|吩咐|交代|解释|打断)/;
const DIALOGUE_RE = /“[^”]*”|『[^』]*』|「[^」]*」|"[^"]*"/g;
const STRUCTURAL_RE = /^(#{1,6}\s+|[-*+]\s+|>\s+|\d+[.、]\s+)/;

function normalizeNewlines(text: string): string {
    return (text || '').replace(/\r\n?/g, '\n');
}

function stripIndent(line: string, indent: string): string {
    let out = line.replace(/^[ \t\u3000]+/, '');
    if (indent && out.startsWith(indent.trim())) {
        out = out.slice(indent.trim().length).replace(/^[ \t\u3000]+/, '');
    }
    return out.trim();
}

function readableLength(text: string): number {
    return text.replace(/[\s，。！？!?…；：、“”‘’"'—\-（）()《》〈〉【】\[\]]/g, '').length;
}

function hasDialogue(text: string): boolean {
    DIALOGUE_RE.lastIndex = 0;
    return DIALOGUE_RE.test(text);
}

function isDialogueOnly(text: string): boolean {
    DIALOGUE_RE.lastIndex = 0;
    const withoutDialogue = text.replace(DIALOGUE_RE, '');
    return hasDialogue(text) && readableLength(withoutDialogue) <= 4;
}

function startsWithDialogue(text: string): boolean {
    return /^[“『「"]/.test(text.trim());
}

function isTransition(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.length <= 40 && TRANSITION_RE.test(trimmed);
}

function isSpeechTag(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.length > 120) return false;
    if (!SPEECH_VERB_RE.test(trimmed)) return false;
    // 只含对话的段落不是 tag
    return !isDialogueOnly(trimmed);
}

function sentenceCount(text: string): number {
    return splitProseSentences(text).length || 1;
}

function mergeText(left: string, right: string): string {
    const a = left.trimEnd();
    const b = right.trimStart();
    if (!a) return b;
    if (!b) return a;
    // 英文单词/数字相邻时补一个空格；中文直接拼接
    if (/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)) return `${a} ${b}`;
    return `${a}${b}`;
}

function shouldMerge(prev: string, next: string, opts: Required<Pick<NaturalizeOptions, 'maxParagraphChars' | 'maxSentencesPerParagraph' | 'maxBeatChars'>>): boolean {
    if (!prev || !next) return false;
    if (STRUCTURAL_RE.test(prev) || STRUCTURAL_RE.test(next)) return false;
    if (isTransition(next)) return false;

    const prevChars = readableLength(prev);
    const nextChars = readableLength(next);
    const combinedChars = prevChars + nextChars;
    if (combinedChars > opts.maxParagraphChars) return false;

    const prevDialogue = isDialogueOnly(prev);
    const nextDialogue = isDialogueOnly(next);
    const prevHasDialogue = hasDialogue(prev);
    const nextHasDialogue = hasDialogue(next);

    // 连续两句独立对话：默认按说话人分段，不合并
    if (prevDialogue && nextDialogue) return false;

    // 对话在前：后面紧跟说话人的动作/神态 → 合并
    if (prevHasDialogue && !prevDialogue) {
        // 已经是“动作 + 对话”或“对话 + 动作”的段落：
        // 后面紧跟一个短动作节拍时仍可并入，避免对话段又被拆成两截。
        if (!nextDialogue && nextChars <= 60) {
            return sentenceCount(prev) + sentenceCount(next) <= opts.maxSentencesPerParagraph;
        }
        return false;
    }
    if (prevDialogue && (isSpeechTag(next) || (!nextDialogue && nextChars <= 60))) {
        return sentenceCount(prev) + sentenceCount(next) <= opts.maxSentencesPerParagraph;
    }
    if (prevDialogue && nextHasDialogue && nextChars <= 120) {
        return combinedChars <= opts.maxParagraphChars;
    }
    if (prevDialogue) {
        return false;
    }

    // 短动作节拍 + 对话 → 合并（“沈铁山没回头。”+“三年攒的。”）
    if (nextDialogue && prevChars <= opts.maxBeatChars && isSpeechTag(prev)) {
        return sentenceCount(prev) + sentenceCount(next) <= opts.maxSentencesPerParagraph;
    }
    // 叙事 + 叙事：按段长和句数合并
    if (!nextDialogue) {
        if (sentenceCount(prev) + sentenceCount(next) > opts.maxSentencesPerParagraph) return false;
        // 下一句以“他/她/名字”开头且是短动作，通常属于同一段
        return true;
    }
    return false;
}

/**
 * 把碎片正文重排成自然段。
 * 不会修改句子内部，只调整段落边界。
 * @param raw - 原始
 * @param options - 配置项
  * @returns NaturalizeResult 实例
 */
export function naturalizeBodyText(raw: string, options: NaturalizeOptions = {}): NaturalizeResult {
    const text = normalizeNewlines(raw).trim();
    if (!text) {
        return { text: '', paragraphsBefore: 0, paragraphsAfter: 0, mergedParagraphs: 0, changes: [] };
    }

    const maxParagraphChars = options.maxParagraphChars ?? DEFAULT_MAX_PARAGRAPH_CHARS;
    const maxSentencesPerParagraph = options.maxSentencesPerParagraph ?? DEFAULT_MAX_SENTENCES;
    const maxBeatChars = options.maxBeatChars ?? DEFAULT_MAX_BEAT_CHARS;
    const indent = options.indent ?? '';
    const inputLines = text.split('\n');
    const blankLineCount = inputLines.filter((line) => !line.trim()).length;
    const inputHasBlankLines = blankLineCount > 0 && blankLineCount / inputLines.length > 0.2;
    const separator = options.separator ?? (inputHasBlankLines ? '\n\n' : '\n');

    const lines = text.split('\n');
    const paragraphs: string[] = [];
    const changes: string[] = [];
    let current = '';
    let paragraphsBefore = 0;
    let mergedParagraphs = 0;

    const flush = (): void => {
        if (current.trim()) paragraphs.push(current.trim());
        current = '';
    };

    for (const rawLine of lines) {
        const line = stripIndent(rawLine, indent);
        if (!line) {
            flush();
            continue;
        }
        paragraphsBefore++;
        if (STRUCTURAL_RE.test(line)) {
            flush();
            paragraphs.push(line);
            continue;
        }
        if (!current) {
            current = line;
            continue;
        }
        if (shouldMerge(current, line, { maxParagraphChars, maxSentencesPerParagraph, maxBeatChars })) {
            current = mergeText(current, line);
            mergedParagraphs++;
            continue;
        }
        flush();
        current = line;
    }
    flush();

    const output = paragraphs
        .map((paragraph) => {
            const body = indent ? `${indent}${paragraph}` : paragraph;
            return body;
        })
        .join(separator);

    if (mergedParagraphs > 0) {
        changes.push(`合并了 ${mergedParagraphs} 处相邻短段`);
        changes.push(`输入 ${paragraphsBefore} 行 → 输出 ${paragraphs.length} 段`);
    }

    return {
        text: output,
        paragraphsBefore,
        paragraphsAfter: paragraphs.length,
        mergedParagraphs,
        changes,
    };
}
