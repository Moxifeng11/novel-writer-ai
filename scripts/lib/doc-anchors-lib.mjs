/**
 * doc-anchors-lib.mjs — 活文档锚点校验的纯函数层
 *
 * 规矩（2026-11-28 用户要求固化）：固化文档（*-flow / *-map / *-reference）
 * 必须随软件优化同步更新，避免后续优化读到过期结论造成偏移。
 * 机制：preflight 的 check:doc-anchors 逐条验证活文档里的代码引用仍存在；
 * 代码改动破坏锚点 → 门禁拦 → 必须同步文档才能过（与 template-parity 同思路）。
 * 历史审计报告（*-audit.md）是时间点快照，允许过期，不在校验范围。
 */

/**
 * 判断文档是否属于「活文档」（固化参考，需随码更新）。
 *
 * @param filename - 文件名（不含目录）
 * @returns 是否活文档
 * @example
 * isLivingDoc('2026-11-28-settings-module-map.md') // true
 * isLivingDoc('2026-11-28-plugin-full-audit.md') // false（历史快照）
 */
export function isLivingDoc(filename) {
    return /-(flow|map|reference|guide)\.md$/i.test(String(filename || ''));
}

/**
 * 从活文档提取仓库内代码路径锚点。
 *
 * 只认反引号包裹、以已知顶层目录开头且以 .ts/.mjs/.js 结尾的路径；
 * 忽略 node_modules、通配符与目录（无扩展名）引用。
 *
 * @param content - 文档全文
 * @returns 去重后的路径列表
 */
export function extractPathAnchors(content) {
    // 跳过带豁免标记的行（历史记述不校验路径存在性）
    const NL = String.fromCharCode(10);
    const text = String(content || '')
        .split(NL)
        .filter(l => !l.includes('anchor-ok'))
        .join(NL);
    const re = /`((?:engine|ui|shared|services|core|scripts|workers)\/[\w@/.-]+\.(?:ts|mjs|js))`/g;
    const out = new Set();
    let m;
    while ((m = re.exec(text)) !== null) {
        const p = m[1];
        if (p.includes('*') || p.includes('<')) continue;
        out.add(p);
    }
    return [...out];
}

/**
 * 从活文档提取设置字段锚点。
 *
 * 识别 `- \`field\`（默认` 与「表格首列 \`field\`」两种行文；
 * 由调用方对照 core/settings-service.ts + main.ts 验证存在性。
 *
 * @param content - 文档全文
 * @returns 去重后的字段名列表
 */
export function extractSettingsFieldAnchors(content) {
    const text = String(content || '');
    const out = new Set();
    // 形态一：字段清单行 `- \`field\`（默认 ...`
    let m;
    const re1g = /- `([a-zA-Z][\w.]*)`（默认/g;
    while ((m = re1g.exec(text)) !== null) out.add(m[1]);
    // 形态二：反查表行 `field`(行号)（settings 字段 + 代表读取点行号；
    // 行号在闭合反引号之后）
    const re2g = /`([a-zA-Z][\w]+)`\((?:\d+|L?\d+[^)]*)\)/g;
    const NL2 = String.fromCharCode(10);
    const tableRows = text.split(NL2).filter(l => l.startsWith('| ') && !l.includes('|---'));
    for (const row of tableRows) {
        while ((m = re2g.exec(row)) !== null) out.add(m[1]);
    }
    return [...out];
}

/**
 * 校验锚点。
 *
 * @param anchors - {paths: string[], fields: string[]}
 * @param ctx - {fileExists(path), repoText: {mainSettings: string}} 验证上下文
 * @returns {missingPaths: string[], missingFields: string[]}
 */
export function verifyAnchors(anchors, ctx) {
    const missingPaths = (anchors.paths || []).filter(p => !(ctx.fileExists ? ctx.fileExists(p) : false));
    let repoText = ctx.repoText || '';
    const missingFields = (anchors.fields || []).filter(f => !repoText.includes(f));
    return { missingPaths, missingFields };
}
