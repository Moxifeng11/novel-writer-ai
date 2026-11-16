/**
 * endpoint-key.ts — 端点归一化（shared 纯函数）
 *
 * 同一渠道的写法可能不同：`https://a.com`、`https://a.com/v1`、
 * `https://a.com/v1/chat/completions`。覆盖表、渠道匹配都按归一化 key 对齐。
 *
 * 历史缺陷：旧实现只剥一层，`…/v1/chat/completions` 归一化后仍是 `…/v1`，
 * 与 `…com` 不相等 → 历史覆盖读不到、写入新建第二条 key（表现为「手动覆盖不生效」）。
 */

/**
 * 端点归一：忽略协议尾部斜杠、`/v1`、`/chat/completions` 等尾段。
 *
 * @param endpoint - 接口地址
 * @returns 归一化后的端点键
 * @example
 * normalizeEndpointKey('https://api.deepseek.com/v1/chat/completions/');
 * // 'https://api.deepseek.com'
 */
export function normalizeEndpointKey(endpoint?: string): string {
    let out = String(endpoint || '').trim().toLowerCase().replace(/\/+$/, '');
    // 循环剥离：`…/v1/chat/completions` 要连剥两层才能和 `…com` 对齐
    for (let guard = 0; guard < 4; guard += 1) {
        const next = out.replace(/\/(chat\/completions|completions|v1)$/, '').replace(/\/+$/, '');
        if (next === out || !next) break;
        out = next;
    }
    return out;
}
