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

/**
 * VaultPathGuardResult 类型定义。
 */
export type VaultPathGuardResult =
    | { ok: true; path: string }
    | { ok: false; reason: string };

/**
 * 去掉包裹引号与首尾空白（模型常把路径写成 `"a/b.md"`）
 *
 * @param raw - 原始
 * @returns 文本结果
 */
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
 * @param raw - 原始
 * @param options - 配置项
  * @returns VaultPathGuardResult 实例
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

/**
 * 行窗口选项列表结构定义。
 */
export interface LineWindowOptions {
    /** 起始行（1-based，默认 1） */
    offset?: number;
    /** 读取行数（默认 200） */
    limit?: number;
    /** 字符上限（默认 8192；超出时截断并标记） */
    maxChars?: number;
}

/**
 * 行窗口结果结构定义。
 */
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

/**
 * MAX_READ_CHARS 常量。
 */
export const MAX_READ_CHARS = 8192;
/**
 * DEFAULT_READ_LINES 常量。
 */
export const DEFAULT_READ_LINES = 200;
/**
 * MAX_READ_LINES 常量。
 */
export const MAX_READ_LINES = 2000;

/**
 * 从全文取一段行窗口。
 * 先按行切，再按字符上限收缩：两种上限都遵守，返回的 endLine 是**实际包含**的最后一行。
 * @param text - 文本内容
 * @param options - 配置项
  * @returns LineWindowResult 实例
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

/**
 * 搜索命中的一行摘要（去缩进、压空白、截断），用于 `path:line:摘要`
 *
 * @param line - 行
 * @param maxChars - 最大字符数
 * @returns 文本结果
 */
export function summarizeHitLine(line: string, maxChars = 120): string {
    const compact = String(line || '').replace(/^[\s>#*-]+/, '').replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, Math.max(1, maxChars - 1))}…`;
}
/**
 * shouldAutoApproveNewFile：`write_file` 审批用——判断目标是否为「确实不存在的新文件」。
 *
 * v4.79.0（安全审计 ③）：此前直接用模型给的**原始** `args.path` 调 `adapter.exists`，
 * 而真正写入前 `sanitizeVaultPath` 会剥掉首尾引号。模型传 `"项目/正文/第1章_正文.md"` 时
 * `exists` 返回 false → 自动放行；随后净化后的路径命中已有正文并覆盖，覆盖确认被完全跳过。
 * 因此必须先净化再判断存在性；净化失败一律走确认（返回 false）。
 *
 * @param raw - 模型传入的原始路径
 * @param exists - 存在性探测（通常是 `vault.adapter.exists`）
 * @param allowedPrefix - 可选：新文件必须落在该项目目录下；不传时保持旧行为
 * @returns true = 可自动放行（净化成功、文件不存在且在允许前缀内）
 */
export async function shouldAutoApproveNewFile(
    raw: string,
    exists: (path: string) => Promise<boolean>,
    allowedPrefix?: string,
): Promise<boolean> {
    // S3-6：信任配置类路径不允许自动放行（见 isSensitiveAutoApprovePath）
    if (isSensitiveAutoApprovePath(raw)) return false;
    const guard = sanitizeVaultPath(raw);
    if (!guard.ok || !guard.path) return false;
    if (allowedPrefix !== undefined) {
        const prefix = String(allowedPrefix || '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (!prefix) return false;
        if (guard.path !== prefix && !guard.path.startsWith(`${prefix}/`)) return false;
    }
    try {
        return !(await exists(guard.path));
    } catch {
        return false;
    }
}


/** 这些目录/文件承载「来源信任链」或项目身份，不允许 Agent 自动新建（S3-6） */
const SENSITIVE_AUTO_APPROVE_PATTERNS: ReadonlyArray<RegExp> = [
    /(^|\/)00-系统模板(\/|$)/,
    /(^|\/)04-项目总控(\/|$)/,
    /(^|\/)05-同人设定库\/_资料(\/|$)/,
    /(^|\/)02-时间线与伏笔(\/|$)/,
    /sources\.json$/i,
    /(^|\/)\.project$/,
    /(^|\/)03-大纲与章节\//,
];

/**
 * 判断目标是否属于「不能自动放行新建」的敏感路径（S3-6 安全 r3）。
 *
 * 这些位置要么承载信任链（考据 sources.json、同人资料），要么承载项目身份/结构
 * （.project、系统模板、总控、时间线、正文目录）。命中时 `write_file` 必须走
 * 显式确认，不能因「文件不存在」被静默放行。
 *
 * @param raw - 工具参数里的目标路径（未净化）
 * @returns 是否敏感
 */
export function isSensitiveAutoApprovePath(raw: string): boolean {
    const normalized = String(raw || '').trim().replace(/\\/g, '/').toLowerCase();
    if (!normalized) return false;
    return SENSITIVE_AUTO_APPROVE_PATTERNS.some((pattern) => pattern.test(normalized));
}
