/**
 * file-path-guard.ts — Agent 读文件/搜库的路径守卫与行窗口（纯函数）
 *
 * 吸收 dsh `context/file-reference` 的安全约束：模型给的是不可信字符串，
 * 只允许读取库内相对路径，且默认不碰隐藏目录（`.obsidian`/`.trash`/`.git`）。
 * 例外：插件自己落盘的 `.sessions/`（spill 大结果）必须允许回读，
 * 由调用方显式传入 allowHiddenPrefixes。
 */

export interface VaultPathGuardOptions {
    /** 允许读取的隐藏目录前缀（如 `.sessions/`）；默认全部隐藏目录都拒绝 */
    allowHiddenPrefixes?: string[];
}

export type VaultPathGuardResult =
    | { ok: true; path: string }
    | { ok: false; reason: string };

/** 去掉包裹引号与首尾空白（模型常把路径写成 `"a/b.md"`） */
function stripQuotes(raw: string): string {
    let text = String(raw || '').trim();
    while (text.length >= 2 && /^["'`]/.test(text) && /["'`]$/.test(text)) {
        text = text.slice(1, -1).trim();
    }
    return text;
}

/**
 * 校验并规范化库内路径。
 * 拒绝：空值、绝对路径（`/x`、`C:\x`）、`..` 段、隐藏目录、含空字节/控制字符。
 */
export function sanitizeVaultPath(raw: string, options: VaultPathGuardOptions = {}): VaultPathGuardResult {
    const text = stripQuotes(raw).replace(/\\/g, '/');
    if (!text) return { ok: false, reason: '路径为空' };
    if (text.startsWith('/')) return { ok: false, reason: '只接受库内相对路径，不接受绝对路径' };
    if (/^[a-zA-Z]:/.test(text)) return { ok: false, reason: '只接受库内相对路径，不接受盘符路径' };
    if (/[\u0000-\u001f]/.test(text)) return { ok: false, reason: '路径包含控制字符' };
    const segments = text.split('/').filter(segment => segment !== '');
    if (segments.length === 0) return { ok: false, reason: '路径为空' };
    if (segments.some(segment => segment === '.' || segment === '..')) {
        return { ok: false, reason: '路径不允许包含 . 或 ..' };
    }
    const allow = (options.allowHiddenPrefixes || []).map(prefix => prefix.replace(/^\/+/, ''));
    const hidden = segments.filter(segment => segment.startsWith('.'));
    if (hidden.length > 0) {
        const joined = segments.join('/');
        const allowed = allow.some(prefix => joined === prefix.replace(/\/$/, '') || joined.startsWith(prefix));
        if (!allowed) {
            return { ok: false, reason: `不允许读取隐藏目录（${hidden[0]}）` };
        }
    }
    return { ok: true, path: segments.join('/') };
}

export interface LineWindowOptions {
    /** 起始行（1-based，默认 1） */
    offset?: number;
    /** 读取行数（默认 200） */
    limit?: number;
    /** 字符上限（默认 8192；超出时截断并标记） */
    maxChars?: number;
}

export interface LineWindowResult {
    text: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    /** 是否因行数或字符上限被截断 */
    truncated: boolean;
    /** 是否因字符上限截断（调用方据此提示用 offset 继续读） */
    charLimited: boolean;
}

export const MAX_READ_CHARS = 8192;
export const DEFAULT_READ_LINES = 200;
export const MAX_READ_LINES = 2000;

/**
 * 从全文取一段行窗口。
 * 先按行切，再按字符上限收缩：两种上限都遵守，返回的 endLine 是**实际包含**的最后一行。
 */
export function extractLineWindow(text: string, options: LineWindowOptions = {}): LineWindowResult {
    const content = String(text ?? '');
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;
    const maxChars = Math.max(200, options.maxChars ?? MAX_READ_CHARS);
    const limit = Math.max(1, Math.min(MAX_READ_LINES, Math.round(options.limit ?? DEFAULT_READ_LINES)));
    const requestedOffset = Math.max(1, Math.round(options.offset ?? 1));
    // 起始行超出文件末尾：返回空窗口（不回退到末行，否则翻页会重复最后一段）
    if (requestedOffset > totalLines) {
        return {
            text: '',
            startLine: requestedOffset,
            endLine: requestedOffset,
            totalLines,
            truncated: false,
            charLimited: false,
        };
    }
    const startLine = requestedOffset;
    const startIndex = startLine - 1;
    const picked: string[] = [];
    let chars = 0;
    let charLimited = false;
    for (let i = startIndex; i < lines.length && picked.length < limit; i++) {
        const line = lines[i];
        const cost = line.length + (picked.length > 0 ? 1 : 0);
        if (chars + cost > maxChars) {
            // 第一条就超限时仍返回截断片段，避免「读不到任何内容」
            if (picked.length === 0) {
                picked.push(line.slice(0, maxChars));
                chars = picked[0].length;
                charLimited = true;
            } else {
                charLimited = true;
            }
            break;
        }
        picked.push(line);
        chars += cost;
    }
    const endLine = picked.length > 0 ? startIndex + picked.length : startIndex;
    return {
        text: picked.join('\n'),
        startLine,
        endLine,
        totalLines,
        truncated: charLimited || endLine < totalLines,
        charLimited,
    };
}

/** 搜索命中的一行摘要（去缩进、压空白、截断），用于 `path:line:摘要` */
export function summarizeHitLine(line: string, maxChars = 120): string {
    const compact = String(line || '').replace(/^[\s>#*-]+/, '').replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, Math.max(1, maxChars - 1))}…`;
}