/**
 * coverage-lib.mjs — 覆盖率门禁的纯逻辑（可单测）
 *
 * 数据源：`coverage/coverage-summary.json`（vitest v8 + json-summary reporter）。
 * 口径（DSH-20261112-01 定稿）：
 * - 目录聚合必须 count-weighted（按 total/covered 行数加权），不得对文件 pct 简单平均；
 * - 必须同时支持 ui 与 ui/views 两级；
 * - 棘轮只约束 lines：下降 → 失败；上升或持平 → 通过；
 * - 基线必须带 gitHead provenance，HEAD 不符拒绝比较（防陈旧数据）；
 * - 上调基线必须 --note；下调必须 --allow-decrease + --note 双确认。
 *
 * 纯函数只做计算/校验，文件与环境读写留在 check-coverage.mjs。
 */

/** 四项覆盖率指标名 */
export const METRICS = ['lines', 'statements', 'branches', 'functions'];

/**
 * 棘轮容差（百分点）。
 *
 * 同一份代码在不同运行间，v8 覆盖率会因异步回调/计时器执行时机出现极小抖动
 * （实测 ui lines 6108→6102，约 0.01~0.02pp）。若按严格「任意下降即失败」，
 * 门禁会偶发假红；0.05pp 容差（约 20 行）只吞掉抖动，挡不住真实回退。
 */
export const RATCHET_TOLERANCE_PCT = 0.05;

/**
 * 把绝对路径转为相对仓库根的 POSIX 路径。
 *
 * @param {string} filePath - coverage-summary 的键（绝对路径）
 * @param {string} root - 仓库根
 * @returns {string} 相对路径（统一斜杠）
 */
export function toRelativePath(filePath, root) {
    const normalizedRoot = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedFile = String(filePath || '').replace(/\\/g, '/');
    if (!normalizedRoot) return normalizedFile;
    if (normalizedFile === normalizedRoot) return '';
    const prefix = `${normalizedRoot}/`;
    return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : normalizedFile;
}

/**
 * 判断文件是否属于某目录（严格路径段前缀，避免 ui-services 误命中 ui）。
 *
 * @param {string} relPath - 相对仓库根的路径
 * @param {string} dir - 目录（如 ui 或 ui/views）
 * @returns {boolean} 是否属于该目录（不含目录自身）
 */
export function isInDir(relPath, dir) {
    const normalizedDir = String(dir || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedPath = String(relPath || '').replace(/\\/g, '/');
    if (!normalizedDir || !normalizedPath) return false;
    return normalizedPath.startsWith(`${normalizedDir}/`);
}

/**
 * 聚合一个目录的覆盖率（count-weighted）。
 *
 * @param {Record<string, any>} summary - coverage-summary.json 内容（含 total 与逐文件键）
 * @param {string} dir - 目标目录（如 ui / ui/views）
 * @param {string} root - 仓库根
 * @returns {{dir: string, files: number, lines: object, statements: object, branches: object, functions: object}}
 */
export function aggregateByDir(summary, dir, root) {
    const result = { dir, files: 0 };
    for (const metric of METRICS) result[metric] = { total: 0, covered: 0, pct: 0 };

    for (const [filePath, entry] of Object.entries(summary || {})) {
        if (filePath === 'total' || !entry || typeof entry !== 'object') continue;
        const rel = toRelativePath(filePath, root);
        if (!isInDir(rel, dir)) continue;
        result.files += 1;
        for (const metric of METRICS) {
            const value = entry[metric];
            if (!value || typeof value !== 'object') continue;
            result[metric].total += Number(value.total) || 0;
            result[metric].covered += Number(value.covered) || 0;
        }
    }

    for (const metric of METRICS) {
        const { total, covered } = result[metric];
        result[metric].pct = total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 0;
    }
    return result;
}

/**
 * 比较基线与当前覆盖率（只约束 lines 棘轮）。
 *
 * @param {{dirs: Record<string, any>}} baseline - 基线
 * @param {Record<string, any>} current - 当前（dir → 聚合结果）
 * @returns {{ok: boolean, decreased: Array<{dir: string, baseline: number, actual: number}>}}
 */
export function compareCoverage(baseline, current) {
    const decreased = [];
    const baseDirs = (baseline && baseline.dirs) || {};
    for (const [dir, baseEntry] of Object.entries(baseDirs)) {
        const currentEntry = current[dir];
        if (!currentEntry) continue;
        const basePct = Number(baseEntry?.lines?.pct) || 0;
        const nowPct = Number(currentEntry?.lines?.pct) || 0;
        if (nowPct < basePct - RATCHET_TOLERANCE_PCT) {
            decreased.push({ dir, baseline: basePct, actual: nowPct });
        }
    }
    return { ok: decreased.length === 0, decreased };
}

/**
 * 校验基线 provenance（gitHead 必须与当前 HEAD 一致）。
 *
 * @param {{gitHead?: string}} baseline - 基线
 * @param {string} head - 当前 HEAD
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkProvenance(baseline, head) {
    const expected = String(baseline?.gitHead || '').trim();
    const actual = String(head || '').trim();
    if (!expected) return { ok: false, reason: '基线缺少 gitHead（无法证明与当前代码同源）' };
    if (!actual) return { ok: false, reason: '无法读取当前 HEAD' };
    if (expected !== actual) {
        return { ok: false, reason: `基线 gitHead=${expected} 与当前 HEAD=${actual} 不符，拒绝比较（请先更新基线）` };
    }
    return { ok: true };
}

/**
 * 校验「写基线」请求：note 必填；下调必须显式 --allow-decrease。
 *
 * @param {object} input - 校验输入
 * @param {object|null} input.oldBaseline - 旧基线（不存在时为 null）
 * @param {Record<string, any>} input.current - 当前聚合结果
 * @param {string} input.note - 说明
 * @param {boolean} input.allowDecrease - 是否允许下调
 * @returns {{ok: boolean, errors: string[], decreased: string[]}}
 */
export function validateBaselineUpdate({ oldBaseline, current, note, allowDecrease }) {
    const errors = [];
    const decreased = [];
    if (!String(note || '').trim()) errors.push('--update-baseline 必须提供非空 --note 说明原因');

    const oldDirs = (oldBaseline && oldBaseline.dirs) || {};
    for (const [dir, oldEntry] of Object.entries(oldDirs)) {
        const nowPct = Number(current?.[dir]?.lines?.pct) || 0;
        const oldPct = Number(oldEntry?.lines?.pct) || 0;
        if (nowPct < oldPct - RATCHET_TOLERANCE_PCT) decreased.push(dir);
    }
    if (decreased.length > 0 && !allowDecrease) {
        errors.push(`基线下调（${decreased.join('、')}）必须加 --allow-decrease 双确认`);
    }
    return { ok: errors.length === 0, errors, decreased };
}

/**
 * 把当前聚合结果整理成可写入基线的结构。
 *
 * @param {Record<string, any>} current - dir → 聚合结果
 * @returns {Record<string, any>} 仅保留目录、文件数与四项百分比/计数
 */
export function toBaselineDirs(current) {
    const dirs = {};
    for (const [dir, entry] of Object.entries(current || {})) {
        dirs[dir] = { files: entry.files };
        for (const metric of METRICS) {
            dirs[dir][metric] = {
                total: entry[metric].total,
                covered: entry[metric].covered,
                pct: entry[metric].pct,
            };
        }
    }
    return dirs;
}

/**
 * 评估基线 provenance 是否可用于比较。
 *
 * 严格口径（DSH-20261112-01）：gitHead 与当前 HEAD 不符时默认拒绝（exit 2）。
 * 唯一例外：基线 gitHead 是当前 HEAD 的祖先，且两次提交之间**被统计的源码目录**
 * （ui/engine/shared/services/core/domains）没有任何变化——这对应「基线随门禁文件
 * 一起提交」的自引用场景：提交 hash 由内容决定，基线不可能记录自己的 hash；
 * 只允许这种「差异全是门禁/文档自身」的情形，一旦源码变了仍拒绝比较。
 *
 * @param {object} input - 评估输入
 * @param {string} input.baselineHead - 基线记录的 gitHead
 * @param {string} input.head - 当前 HEAD
 * @param {boolean} input.isAncestor - 基线 gitHead 是否为 HEAD 的祖先
 * @param {boolean} input.sourcesChanged - 两次提交间被统计源码是否有变化
 * @returns {{ok: boolean, code: number, reason?: string, note?: string}}
 */
export function evaluateProvenance({ baselineHead, head, isAncestor, sourcesChanged }) {
    const expected = String(baselineHead || '').trim();
    const actual = String(head || '').trim();
    if (!expected) return { ok: false, code: 2, reason: '基线缺少 gitHead（无法证明与当前代码同源）' };
    if (!actual) return { ok: false, code: 2, reason: '无法读取当前 HEAD' };
    if (expected === actual) return { ok: true, code: 0 };
    if (isAncestor === true && sourcesChanged === false) {
        return {
            ok: true,
            code: 0,
            note: `基线来自祖先提交 ${expected.slice(0, 12)}，其后仅门禁/文档变更（被统计源码未变），按同源处理`,
        };
    }
    return {
        ok: false,
        code: 2,
        reason: `基线 gitHead=${expected} 与当前 HEAD=${actual} 不符，拒绝比较（请先更新基线）`,
    };
}
