/**
 * text-utils.ts — 拆书/分析器共用的文本处理原语
 *
 * 此前 isChineseChar / splitParagraphs / splitSentences 在拆书引擎里各有
 * 10–16 份私有副本，正则与 Unicode 范围一致但维护分散：改一处漏十处。
 * 这里收口为共享函数；调用方改为导入后删私有副本。
 */

/** 是否为 CJK 统一汉字（基本区 U+4E00–U+9FFF，与全部既有实现一致） */
export function isChineseChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return code >= 0x4E00 && code <= 0x9FFF;
}

/** 是否为英文单词首字符（用于词级计数） */
export function isEnglishLetter(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/** 是否为数字字符 */
export function isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}

/**
 * 按空行拆分段落（Pattern A：仅匹配 `\r?\n\r?\n`，与全部既有实现一致）。
 * 仅匹配完全一致的模式才收口；`\n\s*\n` 等宽松变体语义不同，不在此收口。
 */
export function splitParagraphs(text: string): string[] {
    return String(text ?? '')
        .split(/\r?\n\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

/** 按中英文句末标点拆句子（Pattern A：`[。！？!?]+`，与全部既有实现一致） */
export function splitSentences(text: string): string[] {
    return String(text ?? '')
        .split(/[。！？!?]+/)
        .filter(s => s.trim().length > 0);
}
