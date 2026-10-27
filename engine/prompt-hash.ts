/**
 * prompt-hash.ts — prompt 五元组哈希
 * 对应 spec: p0-api-efficiency-optimization §3.1（P0-3）。
 *
 * 唯一口径源：缓存 key 与断点 checkpoint promptHash 共用
 * （story-quality Task 7 实施时直接 import 复用，不另建 hash）。
 *
 * 纯函数、无依赖；fnv1a 双轮拼接（64 位效果），无密码学需求。
 */

/** FNV-1a 32 位（seed 可变，双轮不同 seed 降低碰撞） */
function fnv1a32(input: string, seed: number): string {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * 计算稳定哈希 key：切换供应商/模型/温度/参数后 key 自动变化（决策 D-6）。
 * 维度：systemPrompt / userPrompt / model / temperature / maxTokens。
 */
export function computePromptHash(
    systemPrompt: string,
    userPrompt: string,
    model: string,
    temperature: number,
    maxTokens: number,
    /** 供应商/端点/思考参数等附加作用域，避免同模型名跨渠道命中同一缓存 */
    scope: string = ''
): string {
    // JSON 数组编码消除分隔符碰撞歧义
    const payload = JSON.stringify([model, temperature, maxTokens, scope, systemPrompt, userPrompt]);
    return fnv1a32(payload, 0x811c9dc5) + fnv1a32(payload, 0x9e3779b9);
}
