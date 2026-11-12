/**
 * silent-failures-lib.mjs — 「读失败当没有 / 写失败当成功」模式检测（纯逻辑）
 *
 * 任务 DSH-20261113-26 缘起：2026-11-13 复盘发现本轮修复的 27 处静默失效只有两个
 * 模式，而当时的 check:silent-failures 只在 ui/ 找「保存/导出/删除」关键词附近的
 * 可见出口，27 个 bug 一个都扫不到（15 个在 engine/shared/services）。
 *
 * 本库把检测抽成纯函数（不读文件、不依赖 cwd），便于单测与门禁共用：
 *   - 模式 A「读失败当没有」：catch 返回 null / [] / {} / undefined
 *   - 模式 B「写失败当成功」：catch 只 log（或空 catch），不抛、不返回失败标志
 *   两者都必须处于「写上下文」（邻近行含写动词）才算违规——读路径的降级是合法的。
 *
 * 豁免：catch 同行或上一行写 `// silent-ok: 理由`（理由不能为空）。
 */

/** 写动词（英文 + 中文）。命中任意一个即视为写上下文。 */
const WRITE_VERBS = /(save|write|delete|create|persist|overwrite|remove|rename|落盘|保存|删除|写入|覆盖|重命名)/i;

/** 模式 A：catch 体内返回空值 */
const RETURN_EMPTY = /\breturn\s*(null|undefined|\[\]|\{\})\s*;/;

/** 模式 B：catch 体内只有日志（log./logger./console.）或无实质内容 */
const LOG_CALL = /(log\.|logger\.|console\.)|^\s*$/;

/** 可见出口（有则不算静默） */
const VISIBLE = /(Notice|showError|showWarning|showSuccess|notify|markPostStepFailure|throw\s|hasPartialFailure\s*=|failedDimensions)/;

/** 豁免标记 */
const EXEMPT = /silent-ok\s*[:：]\s*\S/;

/** 邻近上下文行数（catch 之前） */
const CONTEXT_BEFORE = 12;

/**
 * 求指定行号所在的 catch 块体（简化括号配平）。
 *
 * @param {string[]} lines - 文件行
 * @param {number} catchLine - catch 所在行（0 基）
 * @returns {string} catch 体文本（无花括号时取该行）
 */
function catchBody(lines, catchLine) {
    const start = lines[catchLine] ?? '';
    // 取 catch 行最后一个 '{'（单行 fixture 里前面还有 function/try 的花括号）
    const braceIdx = start.lastIndexOf('{');
    if (braceIdx < 0) return start;
    let depth = 0;
    const parts = [];
    for (let i = catchLine; i < lines.length; i++) {
        const text = i === catchLine ? start.slice(braceIdx) : lines[i];
        parts.push(text);
        for (const ch of text) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth <= 0 && i > catchLine) break;
        if (depth <= 0 && i === catchLine) break;
    }
    return parts.join('\n');
}

/**
 * 邻近行是否处于写上下文。
 *
 * @param {string[]} lines - 文件行
 * @param {number} line - 行号（0 基）
 * @returns {boolean} 是否写上下文
 */
export function isInWriteContext(lines, line) {
    const from = Math.max(0, line - CONTEXT_BEFORE);
    const to = Math.min(lines.length - 1, line + 12);
    return WRITE_VERBS.test(lines.slice(from, to + 1).join('\n'));
}

/**
 * 判断 catch 体是否为「静默失败」并给出模式。
 *
 * @param {string} body - catch 体
 * @returns {{ silent: boolean, kind: 'read-as-empty' | 'write-as-success' | null }}
 */
export function classifyCatchBody(body) {
    if (VISIBLE.test(body)) return { silent: false, kind: null };
    if (RETURN_EMPTY.test(body)) return { silent: true, kind: 'read-as-empty' };
    // 只 log / 空 catch：按「语句」判定——剥花括号与换行，再按分号切，逐条看是否日志调用
    const statements = String(body ?? '')
        .replace(/[{}]/g, '\n')
        .split(';')
        .map((s) => s.trim())
        // 注释段不算语句（含 silent-ok 说明）
        .filter((s) => s.length > 0 && !s.startsWith('//'));
    const onlyLogs = statements.every((s) => /^(log\.|logger\.|console\.)/.test(s));
    if (onlyLogs) return { silent: true, kind: 'write-as-success' };
    return { silent: false, kind: null };
}

/**
 * 收集文件里的静默失败候选。
 *
 * @param {string} text - 文件内容
 * @returns {Array<{ line: number, kind: string, exempt: boolean, body: string }>} 候选（line 为 1 基）
 */
export function collectSilentFailures(text) {
    const lines = String(text ?? '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/\bcatch\b/.test(lines[i])) continue;
        const body = catchBody(lines, i);
        const verdict = classifyCatchBody(body);
        if (!verdict.silent) continue;
        const exempt = EXEMPT.test(lines[i]) || (i > 0 && EXEMPT.test(lines[i - 1]));
        if (!exempt && !isInWriteContext(lines, i)) continue;
        out.push({ line: i + 1, kind: verdict.kind, exempt, body });
    }
    return out;
}

/**
 * 对一批文件评估静默失败，并与基线比较。
 *
 * @param {{ files: Record<string, string>, baseline: { total?: number, files?: Record<string, number> } }} input - 输入
 * @returns {{ violations: Array<{ path: string, line: number, kind: string }>, added: Array<{ path: string, line: number, kind: string }>, fixed: string[], exempted: number, total: number }}
 */
export function evaluateSilentFailures({ files, baseline }) {
    const violations = [];
    let exempted = 0;
    for (const [rel, text] of Object.entries(files)) {
        for (const found of collectSilentFailures(text)) {
            if (found.exempt) {
                exempted++;
                continue;
            }
            violations.push({ path: rel, line: found.line, kind: found.kind });
        }
    }
    const baseFiles = baseline?.files ?? {};
    const currentByFile = new Map();
    for (const v of violations) currentByFile.set(v.path, (currentByFile.get(v.path) ?? 0) + 1);
    const added = violations.filter((v) => (currentByFile.get(v.path) ?? 0) > (baseFiles[v.path] ?? 0));
    const fixed = Object.keys(baseFiles).filter((p) => !currentByFile.has(p));
    return { violations, added, fixed, exempted, total: violations.length };
}
