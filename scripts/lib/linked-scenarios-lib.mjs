/**
 * linked-scenarios-lib.mjs — 联动场景锚点校验（可测试）
 *
 * 背景（Trae preflight 审计 P2 · 第 17 步）：锚点清单原本**内嵌在检查脚本里**，
 * 形成自证循环——文件搬家时把锚点从脚本删掉，检查就跟着消失，门禁永远绿。
 *
 * 修法：
 * 1. 清单外置到 `scripts/linked-scenarios.anchors.json`（与被检查逻辑分离）
 * 2. 清单缺失 / 空 / schema 不对 → 失败（不允许静默通过）
 * 3. **锚点总数下限棘轮**（`floor`）：删锚点必须 `--update-floor --note "原因"` 显式下调
 * 4. 文档小节交叉校验：清单里每条链都必须在 `LINKED-SCENARIOS.md` 有对应小节
 */

/** 锚点数据文件（相对仓库根） */
export const ANCHOR_FILE = 'scripts/linked-scenarios.anchors.json';

/**
 * 校验锚点数据结构。
 *
 * @param data - 解析后的 JSON
 * @returns 错误列表（空表示通过）
 */
export function validateAnchorData(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        errors.push('锚点清单不是对象');
        return errors;
    }
    if (data.schemaVersion !== 1) {
        errors.push(`锚点清单 schemaVersion 应为 1，实际 ${data.schemaVersion}`);
    }
    if (typeof data.doc !== 'string' || !data.doc.trim()) {
        errors.push('锚点清单缺少 doc（联动清单文档路径）');
    }
    if (!Number.isInteger(data.floor) || data.floor < 1) {
        errors.push(`锚点清单 floor 必须是正整数，实际 ${data.floor}`);
    }
    const chains = data.chains;
    if (!chains || typeof chains !== 'object' || Array.isArray(chains)) {
        errors.push('锚点清单缺少 chains 对象');
        return errors;
    }
    const names = Object.keys(chains);
    if (names.length === 0) {
        errors.push('锚点清单 chains 为空（删光了？）');
        return errors;
    }
    for (const name of names) {
        const list = chains[name];
        if (!Array.isArray(list) || list.length === 0) {
            errors.push(`链「${name}」的锚点列表为空`);
            continue;
        }
        for (const anchor of list) {
            if (!anchor || typeof anchor !== 'object') {
                errors.push(`链「${name}」含非法锚点`);
                continue;
            }
            if (typeof anchor.file !== 'string' || !anchor.file.trim()) {
                errors.push(`链「${name}」有锚点缺少 file`);
            }
            if (anchor.text !== undefined && typeof anchor.text !== 'string') {
                errors.push(`链「${name}」锚点 ${anchor.file} 的 text 必须是字符串`);
            }
        }
    }
    return errors;
}

/**
 * 统计锚点总数。
 *
 * @param data - 锚点数据
 * @returns 锚点数量
 */
export function countAnchors(data) {
    const chains = data?.chains || {};
    return Object.values(chains).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

/**
 * 锚点下限棘轮判定。
 *
 * @param input - 输入
 * @param input.total - 当前锚点总数
 * @param input.floor - 基线下限
 * @returns 判定结果
 */
export function evaluateAnchorFloor({ total, floor }) {
    if (!Number.isInteger(floor)) {
        return { ok: false, reason: `floor 非法：${floor}` };
    }
    if (total < floor) {
        return {
            ok: false,
            reason: `锚点总数 ${total} 低于下限 ${floor}（删锚点必须显式下调：--update-floor --note "原因"）`,
        };
    }
    if (total > floor) {
        return { ok: true, tighten: true, reason: `锚点总数 ${total} 高于下限 ${floor}，可上调 floor` };
    }
    return { ok: true, tighten: false };
}

/**
 * 校验锚点与文档、源码的一致性。
 *
 * @param input - 输入
 * @param input.data - 锚点数据
 * @param input.readFile - (rel: string) => string | null
 * @returns 结果
 */
export function evaluateAnchors({ data, readFile }) {
    const problems = [];
    const chains = data?.chains || {};
    const doc = data?.doc || '';

    // 1. 文档存在且每条链有对应小节
    const docContent = doc ? readFile(doc) : null;
    if (docContent === null) {
        problems.push(`${doc} 不存在（联动清单被删除？）`);
    } else {
        for (const chain of Object.keys(chains)) {
            const num = chain.match(/链 (\d)/)?.[1];
            if (!num) {
                problems.push(`链名缺少编号：${chain}`);
                continue;
            }
            if (!docContent.includes(`## 链 ${num}：`)) {
                problems.push(`${doc} 缺少「## 链 ${num}：」小节`);
            }
        }
    }

    // 2. 逐个锚点校验
    let checked = 0;
    const filesTouched = new Set();
    for (const [chain, anchors] of Object.entries(chains)) {
        for (const anchor of anchors || []) {
            checked++;
            filesTouched.add(anchor.file);
            const content = readFile(anchor.file);
            if (content === null) {
                problems.push(`${chain}｜${anchor.file} 不存在（${anchor.why || ''}）`);
                continue;
            }
            if (anchor.text && !content.includes(anchor.text)) {
                problems.push(`${chain}｜${anchor.file} 不再包含「${anchor.text}」（${anchor.why || ''}）`);
            }
        }
    }

    return { problems, checked, chains: Object.keys(chains).length, files: filesTouched.size };
}
