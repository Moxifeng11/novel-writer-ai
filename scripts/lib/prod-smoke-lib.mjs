/**
 * prod-smoke-lib.mjs — 生产环境冒烟测试的判定逻辑（可测试）
 *
 * 背景：2026-11-13 用 obsidian-cli 做生产测试，当场抓到「AI 调用全线失败」
 * （`settings.apiKey` 为空、密钥只在 `providerKeys` 里 → 界面说能用，实际一个请求都发不出去）。
 * 8130 条单元测试全绿也没抓到，因为 mock 里 apiKey 总是有值。
 *
 * 这类缺陷只有真实环境能发现，所以要把「真实 AI 调一次」做成可重复执行的冒烟，
 * 而不是靠人记得手点。本模块把判定逻辑抽出来，保证脚本本身可测。
 */

/** 冒烟结果状态 */
export const SMOKE_STATUS = {
    PASS: 'pass',
    FAIL: 'fail',
    /** 环境不满足（Obsidian 没开 / CLI 不可用）：**不算通过**，必须显式报告 */
    SKIP: 'skip',
};

/**
 * 解析 obsidian CLI 的 `plugin id=...` 输出（TSV：type/name/version/...）。
 *
 * @param stdout - CLI 输出
 * @returns 字段映射；解析失败返回 null
 */
export function parsePluginInfo(stdout) {
    const text = String(stdout || '');
    const out = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^([a-zA-Z]+)\t(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * 版本一致性判定：运行中的插件必须等于磁盘上的 package.json 版本。
 *
 * 真实踩过：磁盘 4.85.0、运行中 4.81.1 —— 发版后没 reload，测的是旧代码。
 *
 * @param input - 输入
 * @param input.runningVersion - 运行中版本
 * @param input.expectedVersion - 期望版本（package.json）
 * @returns 判定结果
 */
export function evaluateVersionMatch({ runningVersion, expectedVersion }) {
    const running = String(runningVersion || '').trim();
    const expected = String(expectedVersion || '').trim();
    if (!running) {
        return { ok: false, reason: '无法读取运行中的插件版本（插件未加载？）' };
    }
    if (!expected) {
        return { ok: false, reason: '无法读取 package.json 版本' };
    }
    if (running !== expected) {
        return {
            ok: false,
            reason: `运行中版本 ${running} ≠ 磁盘版本 ${expected}（发版后必须 plugin:reload，否则测的是旧代码）`,
        };
    }
    return { ok: true };
}

/**
 * 判定一次 AI 调用结果是否通过冒烟。
 *
 * @param input - 输入
 * @param input.label - 调用类型描述（如「非流式 callAI」）
 * @param input.result - 插件返回的 APIResponse
 * @param input.minContentLength - 内容最少字符数（默认 1）
 * @returns 判定结果
 */
export function evaluateAiCall({ label, result, minContentLength = 1 }) {
    const where = label ? `[${label}] ` : '';
    if (!result || typeof result !== 'object') {
        return { ok: false, reason: `${where}AI 调用未返回结果对象` };
    }
    if (result.error) {
        return { ok: false, reason: `${where}AI 调用返回错误：${result.error}` };
    }
    const content = typeof result.content === 'string' ? result.content.trim() : '';
    if (content.length < minContentLength) {
        return {
            ok: false,
            reason: `${where}AI 调用返回空内容（content 长度 ${content.length}，期望 ≥ ${minContentLength}）`,
        };
    }
    return { ok: true, contentLength: content.length, finishReason: result.finishReason };
}

/**
 * 解析 `dev:errors` 输出。
 *
 * @param stdout - CLI 输出
 * @returns 错误条数；无法判断返回 null
 */
export function countCapturedErrors(stdout) {
    const text = String(stdout || '').trim();
    if (!text) return null;
    if (/No errors captured/i.test(text)) return 0;
    // 其余情况按「有错误」处理（保守），并返回行数作为规模参考
    return text.split('\n').filter(Boolean).length;
}

/**
 * 汇总冒烟结果。
 *
 * @param steps - 各步骤结果 [{ name, status, detail }]
 * @returns 汇总
 */
export function summarizeSmoke(steps) {
    const list = Array.isArray(steps) ? steps : [];
    const failed = list.filter(s => s.status === SMOKE_STATUS.FAIL);
    const skipped = list.filter(s => s.status === SMOKE_STATUS.SKIP);
    return {
        total: list.length,
        passed: list.filter(s => s.status === SMOKE_STATUS.PASS).length,
        failed: failed.length,
        skipped: skipped.length,
        ok: failed.length === 0 && skipped.length === 0,
        /** 只有失败才算「真失败」；skip 是环境不满足，必须显式区分 */
        hasFailure: failed.length > 0,
        hasSkip: skipped.length > 0,
    };
}
