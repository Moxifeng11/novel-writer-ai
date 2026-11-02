/**
 * file-mention.ts — 输入框里的 `@路径` 引用（纯函数）
 *
 * 吸收 dsh `context/file-reference`：只把**路径**放进上下文（很短、不花 token），
 * 需要内容时由模型调 read_file 按需读取。相比「把文件内容拼进提示词」，
 * 引用一本书的 20 个章节也不会把上下文撑爆。
 *
 * 语法：`@路径` 或 `@"带 空格/特殊字符 的路径"`；`@` 必须在行首或空白之后。
 */

export interface MentionToken {
    /** `@` 的位置 */
    start: number;
    /** 光标位置（token 结束） */
    end: number;
    /** `@` 之后已输入的内容（用于候选过滤） */
    query: string;
    /** 是否已输入左引号 */
    quoted: boolean;
}

const MAX_QUERY_CHARS = 120;
/** 引用串允许的结尾标点（不吞掉 `.md` 里的点） */
const TRAILING_PUNCTUATION = /[，。；：、！？,;:!?)\]]+$/;

/**
 * 光标前是否处于一个 `@` 引用中（输入法组词/中文标点后不触发）
 *
 * @param text - 文本内容
 * @param cursor - 光标
  * @returns MentionToken 或 null
 */
export function activeAtToken(text: string, cursor: number): MentionToken | null {
    const source = String(text ?? '');
    const pos = Math.max(0, Math.min(source.length, cursor));
    const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
    const at = source.lastIndexOf('@', pos - 1);
    if (at < lineStart) return null;
    const before = at === 0 ? '' : source[at - 1];
    if (before && !/\s/.test(before)) return null;
    const raw = source.slice(at + 1, pos);
    const quoted = raw.startsWith('"');
    const query = quoted ? raw.slice(1) : raw;
    // 引号模式允许空格（路径带空格）；未加引号时空格即结束引用
    if (quoted) {
        if (query.includes('"')) return null;
    } else if (/\s/.test(query) || query.includes('"')) {
        return null;
    }
    if (query.length > MAX_QUERY_CHARS) return null;
    return { start: at, end: pos, query, quoted };
}

/**
 * 生成可插入的引用串：含空格/特殊字符时用引号包起来
 *
 * @param path - 路径
 * @returns 文本结果
 */
export function formatFileMention(path: string): string {
    const cleaned = String(path || '').trim().replace(/^\/+/, '');
    if (!cleaned) return '';
    return /[\s"'`]/.test(cleaned) ? `@"${cleaned}"` : `@${cleaned}`;
}

export interface ParsedMention {
    path: string;
    start: number;
    end: number;
}

/**
 * 解析文本中所有引用（按出现顺序，保留位置便于替换）
 *
 * @param text - 文本内容
 * @returns 结果数组
 */
export function parseMentions(text: string): ParsedMention[] {
    const source = String(text ?? '');
    const mentions: ParsedMention[] = [];
    const pattern = /@(?:"([^"\n]+)"|([^\s@"'`]+))/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
        const start = match.index;
        const before = start === 0 ? '' : source[start - 1];
        if (before && !/\s/.test(before)) continue;
        const raw = match[1] ?? match[2] ?? '';
        const path = match[1] ? raw.trim() : raw.replace(TRAILING_PUNCTUATION, '').trim();
        if (!path) continue;
        mentions.push({ path, start, end: start + match[0].length });
    }
    return mentions;
}

/**
 * 文本里引用到的文件路径（去重，保持首次出现顺序）
 *
 * @param text - 文本内容
 * @returns 结果数组
 */
export function extractMentionPaths(text: string): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const mention of parseMentions(text)) {
        if (seen.has(mention.path)) continue;
        seen.add(mention.path);
        paths.push(mention.path);
    }
    return paths;
}

/**
 * 候选排序：文件名前缀命中 > 路径包含 > 其余；同分时短路径优先。
 * 只做纯字符串匹配，不读库。
 * @param paths - 路径列表
 * @param query - 查询串
 * @returns 结果数组
 */
export function filterVaultPaths(paths: readonly string[], query: string, limit = 20): string[] {
    const needle = String(query || '').trim().toLowerCase();
    const scored: Array<{ path: string; score: number; length: number }> = [];
    for (const path of paths) {
        const lower = path.toLowerCase();
        const base = lower.slice(lower.lastIndexOf('/') + 1);
        let score = 0;
        if (!needle) score = 1;
        else if (base.startsWith(needle)) score = 3;
        else if (base.includes(needle)) score = 2;
        else if (lower.includes(needle)) score = 1;
        if (score === 0) continue;
        scored.push({ path, score, length: path.length });
    }
    scored.sort((a, b) => b.score - a.score || a.length - b.length || a.path.localeCompare(b.path));
    return scored.slice(0, Math.max(0, limit)).map(item => item.path);
}

/**
 * 注入给模型的引用说明块：只给路径与取用方式，不含正文。
 * 未提供路径时返回空串。
 * @param paths - 路径列表
 * @returns 文本结果
 */
export function buildMentionBlock(paths: readonly string[]): string {
    const unique = [...new Set(paths.map(path => String(path || '').trim()).filter(Boolean))];
    if (unique.length === 0) return '';
    const lines = unique.map(path => `- ${path}`);
    return ['【用户引用的文件】（内容未自动加载；需要时用 read_file 读取，不要凭空猜测）', ...lines].join('\n');
}

/**
 * 把用户输入里的引用替换成纯文本（引用条/气泡展示时去掉 `@`，保留路径可读性）
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
export function stripMentionMarkers(text: string): string {
    return String(text ?? '').replace(/@(?:"([^"\n]+)"|([^\s@"'`]+))/g, (_all, quoted: string | undefined, plain: string | undefined) => {
        const path = quoted ?? (plain || '').replace(TRAILING_PUNCTUATION, '');
        return `《${path}》`;
    });
}