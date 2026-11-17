/**
 * tts-text.ts — 听校（TTS）的纯文本层：断句 / 朗读文本清洗 / 偏移换算
 *
 * 为什么单独抽一层：断句规则（中英标点、引号收尾、长句切分）与 Markdown
 * 清洗都是纯函数，能单测、能复用；播放器只管「读哪一句、高亮哪一段」。
 * 断句产出的 offset 指向**原始编辑器文本**，高亮与跳转都靠它，
 * 所以清洗只作用于 speech 字段，绝不改变 start/end。
 */

/** 一句话：原文区间 + 用于朗读的清洗后文本 */
export interface TtsSentence {
    /** 句序（0 基，仅在本章内有效） */
    index: number;
    /** 原文起始偏移（含） */
    start: number;
    /** 原文结束偏移（不含） */
    end: number;
    /** 原始文本（含标点 / Markdown 记号） */
    raw: string;
    /** 清洗后的朗读文本（去 Markdown 记号、压缩空白） */
    speech: string;
}

/** 断句参数 */
export interface TtsSplitOptions {
    /** 起点偏移（通常传 frontmatterEndOffset 的结果） */
    from?: number;
    /** 终点偏移（默认文本末尾） */
    to?: number;
    /** 单句上限（字符）；超过时在逗号处切分，仍超则硬切 */
    maxChars?: number;
    /** 短于此长度的残句并入上一句（避免「。」单独成句） */
    minChars?: number;
}

/** 句末标点（含中文省略号 / 分号） */
const SENTENCE_END = new Set(['。', '！', '？', '…', '；', '!', '?', ';']);

/** 句末标点后允许紧跟的收尾引号 / 括号 */
const TRAILING_CLOSERS = new Set(['”', '’', '」', '』', '）', ')', '】', '》', '"', "'"]);

/** 长句切分点（次级标点） */
const SOFT_BREAK = new Set(['，', '、', ',']);

/** 默认单句上限：中文朗读约 20 秒，再长听众会丢失句首 */
export const DEFAULT_MAX_CHARS = 120;

/** 语速可选值（播放器下拉） */
export const TTS_RATE_OPTIONS: readonly number[] = [0.75, 1, 1.25, 1.5, 2];

/**
 * 计算 frontmatter 之后的正文起点。
 *
 * 编辑器 getValue() 含 YAML 头；直接朗读会把 tags 念出来。
 * 只有文件以 --- 开头且能闭合时才跳过，否则返回 0（不算错）。
 *
 * @param text - 编辑器全文
 * @returns 正文字符偏移（无 frontmatter 时为 0）
 */
export function frontmatterEndOffset(text: string): number {
    if (!text.startsWith('---')) return 0;
    const firstLineEnd = text.indexOf('\n');
    if (firstLineEnd < 0) return 0;
    if (text.slice(0, firstLineEnd).trim() !== '---') return 0;
    let cursor = firstLineEnd + 1;
    while (cursor < text.length) {
        const lineEnd = text.indexOf('\n', cursor);
        const line = lineEnd < 0 ? text.slice(cursor) : text.slice(cursor, lineEnd);
        if (line.trim() === '---') return lineEnd < 0 ? text.length : lineEnd + 1;
        if (lineEnd < 0) break;
        cursor = lineEnd + 1;
    }
    return 0;
}

/**
 * 把一段 Markdown 原文清洗成适合朗读的纯文本。
 *
 * 只做「念出来会别扭」的替换：链接取文字、双链取别名、去记号与图片；
 * 不做任何语义改写（原文怎么写就怎么念，听校才有意义）。
 *
 * @param raw - 原始片段（可含 Markdown 记号）
 * @returns 朗读文本；清洗后为空表示该片段不该念（分隔线 / 纯图片）
 */
export function cleanForSpeech(raw: string): string {
    let text = raw;
    // 图片整段丢弃（念 URL 没有意义）
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    // 行内代码保留内容，去掉反引号（用 RegExp 构造，避免模板内的反引号相互干扰）
    text = text.replace(new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + ']*)' + String.fromCharCode(96), 'g'), '$1');
    // 双链：[[目标|别名]] → 别名；[[目标]] → 目标
    text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
    text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
    // 普通链接：[文字](url) → 文字
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // HTML 标签
    text = text.replace(/<[^>]+>/g, ' ');
    // 行首记号：标题 / 引用 / 列表 / 有序列表 / 分隔线
    text = text.replace(/^\s*#{1,6}\s*/gm, '');
    text = text.replace(/^\s*>+\s*/gm, '');
    text = text.replace(/^\s*[-*+]\s+/gm, '');
    text = text.replace(/^\s*\d+\.\s+/gm, '');
    text = text.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');
    // 强调 / 删除线记号
    text = text.replace(/\*\*|__|~~|\*|_/g, '');
    // 零宽字符与多余空白
    text = text.replace(/[\u200b-\u200d\ufeff]/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

/**
 * 找句末位置：从 endIndex 起吞掉紧跟的收尾引号 / 括号。
 *
 * @param text - 全文
 * @param endIndex - 句末标点下标
 * @returns 该句真正的结束偏移（不含）
 */
function consumeClosers(text: string, endIndex: number): number {
    let cursor = endIndex + 1;
    while (cursor < text.length && TRAILING_CLOSERS.has(text[cursor])) cursor += 1;
    return cursor;
}

/**
 * 判断点号是否句末：后面是空白 / 结尾 / 引号，且前面不是数字（避开版本号）。
 *
 * @param text - 全文
 * @param index - 点号下标
 * @returns 是否按句末处理
 */
function isDotBoundary(text: string, index: number): boolean {
    const prev = text[index - 1] ?? '';
    const next = text[index + 1] ?? '';
    if (/\d/.test(prev)) return false;
    return next === '' || /\s/.test(next) || TRAILING_CLOSERS.has(next);
}

/**
 * 把超长句按次级标点再切，仍无标点则硬切。
 *
 * @param text - 全文
 * @param start - 句起点
 * @param end - 句终点
 * @param maxChars - 单句上限
 * @param minChars - 残句阈值
 * @returns 切分后的 [start, end] 区间
 */
function splitLongSentence(text: string, start: number, end: number, maxChars: number, minChars: number): Array<[number, number]> {
    if (end - start <= maxChars) return [[start, end]];
    const pieces: Array<[number, number]> = [];
    let cursor = start;
    while (end - cursor > maxChars) {
        let cut = -1;
        for (let i = cursor + maxChars; i > cursor + Math.max(minChars, 8); i -= 1) {
            if (SOFT_BREAK.has(text[i])) { cut = i + 1; break; }
        }
        if (cut < 0) cut = cursor + maxChars;
        pieces.push([cursor, cut]);
        cursor = cut;
    }
    pieces.push([cursor, end]);
    return pieces;
}

/**
 * 断句：产出「原文区间 + 朗读文本」序列。
 *
 * 规则：中文句末标点（。！？…；）+ 英文 ! ? ; + 独立成句的点号；
 * 换行视为软边界（段落 / 标题各自成句）；标点后紧跟的引号归上一句；
 * 超长句在逗号处再切；清洗后为空的片段（分隔线、纯图片）直接丢弃。
 *
 * @param text - 全文（编辑器 getValue 的结果）
 * @param options - 起止偏移与长度阈值
 * @returns 句子数组（可能为空）
 * @example
 * splitSentences('他走了。她说：「等等！」').map(s => s.speech);
 * // ['他走了。', '她说：「等等！」']
 */
export function splitSentences(text: string, options: TtsSplitOptions = {}): TtsSentence[] {
    const from = Math.max(0, Math.min(options.from ?? 0, text.length));
    const to = Math.max(from, Math.min(options.to ?? text.length, text.length));
    const maxChars = Math.max(20, options.maxChars ?? DEFAULT_MAX_CHARS);
    const minChars = Math.max(1, options.minChars ?? 2);

    const ranges: Array<[number, number]> = [];
    let sentenceStart = from;
    for (let i = from; i < to; i += 1) {
        const ch = text[i];
        let boundaryEnd = -1;
        if (SENTENCE_END.has(ch)) boundaryEnd = consumeClosers(text, i);
        else if (ch === '.' && isDotBoundary(text, i)) boundaryEnd = consumeClosers(text, i);
        else if (ch === '\n') boundaryEnd = i + 1;
        if (boundaryEnd < 0) continue;
        if (boundaryEnd > sentenceStart) ranges.push([sentenceStart, boundaryEnd]);
        sentenceStart = boundaryEnd;
    }
    if (to > sentenceStart) ranges.push([sentenceStart, to]);

    const sentences: TtsSentence[] = [];
    const push = (range: [number, number]): void => {
        const raw = text.slice(range[0], range[1]);
        const speech = cleanForSpeech(raw);
        if (!speech) return;
        if (speech.length < minChars && sentences.length > 0) {
            const last = sentences[sentences.length - 1];
            last.end = range[1];
            last.raw = text.slice(last.start, last.end);
            last.speech = cleanForSpeech(last.raw);
            return;
        }
        sentences.push({ index: sentences.length, start: range[0], end: range[1], raw, speech });
    };
    for (const range of ranges) {
        for (const piece of splitLongSentence(text, range[0], range[1], maxChars, minChars)) push(piece);
    }
    return sentences;
}

/**
 * 偏移 → 编辑器行列位置（0 基行列，Obsidian Editor 口径）。
 *
 * @param text - 全文
 * @param offset - 字符偏移（越界自动收敛）
 * @returns 行列位置
 */
export function offsetToPosition(text: string, offset: number): { line: number; ch: number } {
    const target = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < target; i += 1) {
        if (text[i] === '\n') { line += 1; lineStart = i + 1; }
    }
    return { line, ch: target - lineStart };
}

/**
 * 语速收敛：非法值回落到 1，超出 [0.5, 2] 截断。
 *
 * @param value - 设置里读到的原始值
 * @returns 合法语速
 * @example
 * clampRate('fast'); // 1
 */
export function clampRate(value: unknown): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num <= 0) return 1;
    return Math.min(2, Math.max(0.5, num));
}

/**
 * 粗估朗读时长（用于进度提示；不参与调度）。
 *
 * @param speech - 朗读文本
 * @param rate - 语速
 * @returns 毫秒
 */
export function estimateSpeechMs(speech: string, rate = 1): number {
    const chars = Array.from(speech).length;
    return Math.round((chars * 220) / clampRate(rate));
}
