/**
 * word-count.ts — 字数统计的唯一实现（B5）
 *
 * 此前全仓有 13 份实现，至少四种口径：
 *   A. 中文字 + 英文单词（无数字）          —— 多数分析/分段器
 *   B. 中文字 + 英文单词 + 数字串（逐 token）—— 拆书/分析器
 *   C. 中文字 + 英文单词 + 数字串（正则）    —— 实时监控
 *   D. 平台口径：中文字 + 数字逐个 + 英文按 0.5 折算 —— 番茄等平台
 * 同一章在不同入口会得到不同字数。这里显式命名口径，调用方按需选择；
 * 默认 `cjk_words` 与历史多数实现一致，避免静默改数。
 */

/** CJK 基本区（历史实现只认这一段，保持兼容） */
const CJK_BASIC = /[\u4e00-\u9fa5]/g;
const EN_WORD = /[a-zA-Z]+/g;

/** 中文汉字数（仅基本区） */
export function countCjkChars(text: string): number {
    return (String(text ?? '').match(CJK_BASIC) || []).length;
}

/** 口径 A：中文字 + 英文单词（数字不计） */
export function countCjkAndWords(text: string): number {
    const raw = String(text ?? '');
    if (!raw) return 0;
    return (raw.match(CJK_BASIC) || []).length + (raw.match(EN_WORD) || []).length;
}

/** 口径 B/C：中文字 + 英文单词 + 数字串，各算 1（英文允许 ' 与 - 连接） */
export function countCjkWordsAndNumbers(text: string): number {
    const raw = String(text ?? '');
    if (!raw) return 0;
    let count = 0;
    let i = 0;
    const isCjk = (ch: string): boolean => ch >= '\u4e00' && ch <= '\u9fa5';
    const isLetter = (ch: string): boolean => /[a-zA-Z]/.test(ch);
    const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
    while (i < raw.length) {
        const ch = raw[i];
        if (isCjk(ch)) {
            count++;
            i++;
        } else if (isLetter(ch)) {
            let j = i;
            while (j < raw.length && (isLetter(raw[j]) || raw[j] === "'" || raw[j] === '-')) j++;
            if (j > i) count++;
            i = j;
        } else if (isDigit(ch)) {
            let j = i;
            while (j < raw.length && (isDigit(raw[j]) || raw[j] === '.' || raw[j] === ',')) j++;
            if (j > i) count++;
            i = j;
        } else {
            i++;
        }
    }
    return count;
}

/** 口径 D：平台字数（中文字 + 数字逐个 + 英文 0.5/字符，向下取整） */
export function countPlatformWords(text: string): number {
    const raw = String(text ?? '');
    if (!raw) return 0;
    let count = 0;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if ((ch >= '\u4e00' && ch <= '\u9fff') ||
            (ch >= '\u3400' && ch <= '\u4dbf') ||
            (ch >= '\uf900' && ch <= '\ufaff')) {
            count++;
        } else if ((ch >= '0' && ch <= '9') || (ch >= '\uff10' && ch <= '\uff19')) {
            count++;
        } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
            (ch >= '\uff21' && ch <= '\uff3a') || (ch >= '\uff41' && ch <= '\uff5a')) {
            count += 0.5;
        }
    }
    return Math.floor(count);
}

/** 总字符数（原 text-segmenter.countTotalChars 的行为） */
export function countTotalChars(text: string): number {
    const raw = String(text ?? '');
    let count = 0;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if ((ch >= '\u4e00' && ch <= '\u9fff') ||
            (ch >= '\u3400' && ch <= '\u4dbf') ||
            (ch >= '\uf900' && ch <= '\ufaff') ||
            (ch >= '\u3000' && ch <= '\u303f') ||
            (ch >= '\uff00' && ch <= '\uffef') ||
            (ch >= '\x00' && ch <= '\x7f' && !(' \t\n\r'.includes(ch))) ||
            (ch >= '\u0030' && ch <= '\u0039') ||
            (ch >= '\uff10' && ch <= '\uff19')) {
            count++;
        }
    }
    return count;
}

export type SharedWordCountMode = 'cjk_only' | 'cjk_words' | 'cjk_words_numbers' | 'platform' | 'total';

/** 统一入口；默认与历史多数实现一致（中文字 + 英文单词） */
export function countWordsByMode(text: string, mode: SharedWordCountMode = 'cjk_words'): number {
    switch (mode) {
        case 'cjk_only': return countCjkChars(text);
        case 'cjk_words_numbers': return countCjkWordsAndNumbers(text);
        case 'platform': return countPlatformWords(text);
        case 'total': return countTotalChars(text);
        case 'cjk_words':
        default:
            return countCjkAndWords(text);
    }
}
