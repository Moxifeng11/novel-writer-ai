/**
 * versioned-registry.ts — 版本化文档的通用选择逻辑（纯函数）
 *
 * 背景（2026-10-31 取证）：vault 里实际注入的《写作规则》是旧版（一句一段、一段一个句号），
 * 与仓库新版只差 9 行，且**版本号完全相同**（都是 3.6.0），所以版本检查一路通过，
 * 而每次正文生成都被这段旧规则以约 6:1 的字符权重覆盖人味约束。
 *
 * 结论：只校验「版本号字符串」不够，必须同时校验**内容哈希**。这里提供两个能力：
 *   1. `hashContent()` —— 无依赖 FNV-1a，用于检测「版本号没变、正文回退」；
 *   2. `selectActive()` —— 多版本并存、同一时刻只生效一个，缺失时回退并给出告警。
 */

export type VersionedSource = 'builtin' | 'vault' | 'project' | 'custom';

/**
 * VersionedDoc 类型定义。
 */
export interface VersionedDoc {
    /** 稳定 id，格式建议 `builtin:v3.6.0` / `project:写作规则@v3.6.0` */
    id: string;
    /** 语义版本（展示用） */
    version: string;
    content: string;
    /** 内容哈希（hashContent(content)），用于漂移检测 */
    hash: string;
    source: VersionedSource;
    /** 适用创作模式；空表示全部 */
    applicableModes?: string[];
    /** 一行说明（设置页展示） */
    notes?: string;
    /** 文件版本的实际路径（内置版本为空） */
    path?: string;
}

/**
 * FNV-1a 32 位哈希（十六进制 8 位）。没有任何依赖，Obsidian/浏览器/Node 通用。
 *
 * @param text - 任意文本；null/undefined 按空串处理
 * @returns 8 位十六进制哈希（小写）
 */
export function hashContent(text: string): string {
    let hash = 0x811c9dc5;
    const source = String(text || '');
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        // 32 位溢出回绕
        hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * 规则类内容的规范化：去 BOM、统一换行、剥离 frontmatter、去首尾空白。
 *
 * 同一份规则可能以两种形态存在：内置常量（纯正文，注入 prompt 用）与
 * vault 文件（带 tags/version/updated）。二者正文相同、哈希不同，会被误判成
 * 「同版本号不同内容」。比较内容身份时应先规范化，元数据不参与哈希。
 *
 * @param text - 文件全文或内置常量
 * @returns 去 BOM、LF 归一、剥离 frontmatter 并 trim 后的正文
 */
export function canonicalContent(text: string): string {
    return String(text || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/^---\n[\s\S]*?\n---\n?/, '')
        .trim();
}

/**
 * 比较两个版本号的主干（忽略 `-suffix` 与前导 v）。
 *
 * @param a - 版本号，如 `3.6.0-引导代禁止` / `v3.6.0`
 * @param b - 版本号
 * @returns a<b 返回 -1，相等返回 0，a>b 返回 1
 */
export function compareVersionBase(a: string, b: string): number {
    const parts = (value: string): number[] =>
        String(value || '').replace(/^v/i, '').split(/[-+]/)[0]
            .split('.').map((part) => parseInt(part, 10) || 0);
    const left = parts(a);
    const right = parts(b);
    for (let i = 0; i < Math.max(left.length, right.length, 3); i++) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

/**
 * 抽取规则文件的版本号。
 *
 * 权威来源是 frontmatter 的 `version:` 字段；只有当文件没有 frontmatter
 * 声明时才退化为「正文第一个 semver」。
 *
 * 事故（2026-11-02）：`tags: [写作规则, 文风, v3.6.0]` 排在 `version: "3.6.0-引导代禁止"`
 * 之前，全文取第一个版本号会把标签里的 `v3.6.0` 当成版本，于是自定义变体被误判成
 * 内置 3.6.0，再比内容哈希就触发「版本号相同但内容不同」的假漂移告警。
 *
 * @param text - 文件全文（可含 frontmatter）
 * @returns 版本号；无法识别时返回空串
 * @example
 * ```ts
 * extractVersion('---
version: "3.6.0-引导代禁止"
---') // '3.6.0-引导代禁止'
 * ```
 */
export function extractVersion(text: string): string {
    // 去 BOM：Windows 记事本/部分同步工具会在文件头写 U+FEFF，导致 `^---` 匹配失败
    const raw = String(text || '').replace(/^\uFEFF/, '');
    // 允许空 frontmatter（`---\n---`）
    const frontmatter = raw.match(/^---\r?\n([\s\S]*?)(?:\r?\n)?---(?:\r?\n|$)/);
    if (frontmatter) {
        // 只认顶层字段（无缩进）；嵌套的 `meta.version` 不是文件版本
        const declared = frontmatter[1].match(/^version\s*:\s*["']?([^"'\r\n]+)["']?\s*$/mi);
        const value = declared?.[1]?.trim() || '';
        // 后缀可能带中文（如 `3.6.0-引导代禁止`），\w 不匹配 CJK，这里放宽到「非空白/引号」
        const match = value.match(/v?(\d+\.\d+\.\d+(?:[-+][^\s"',;]+)?)/);
        if (match) return match[1];
    }
    const match = raw.match(/v?(\d+\.\d+\.\d+(?:[-+][^\s"',;]+)?)/);
    return match ? match[1] : '';
}

/**
 * SelectOptions 类型定义。
 */
export interface SelectOptions {
    /** 期望生效的版本 id；找不到时按 fallback 顺序回退 */
    activeId?: string;
    /** 当前创作模式（用于 applicableModes 过滤） */
    mode?: string;
}

/**
 * SelectResult 类型定义。
 */
export interface SelectResult<T extends VersionedDoc = VersionedDoc> {
    doc: T | null;
    /** 实际生效的 id（可能因回退而不同） */
    effectiveId: string;
    /** 是否发生了回退 */
    fellBack: boolean;
    warnings: string[];
}

/**
 * 多版本并存、只生效一个。
 * 规则：精确 id 命中 → 同 version 命中的最高优先级（project > vault > custom > builtin）
 *      → 第一个内置版本 → null。
 *
 * @param docs - 候选版本；调用方负责去重
 * @param options - `activeId` 可写 id 或版本号；`mode` 用于过滤 applicableModes
 * @returns 生效文档、实际 id、是否回退、告警（回退/无可用版本）
 */
export function selectActive<T extends VersionedDoc>(docs: readonly T[], options: SelectOptions = {}): SelectResult<T> {
    const warnings: string[] = [];
    const mode = String(options.mode || '').trim();
    const usable = docs.filter((doc) => {
        if (!mode) return true;
        const modes = doc.applicableModes || [];
        return modes.length === 0 || modes.includes(mode);
    });
    if (usable.length === 0) {
        return { doc: null, effectiveId: '', fellBack: false, warnings: ['没有可用版本'] };
    }

    const activeId = String(options.activeId || '').trim();
    if (activeId) {
        const exact = usable.find((doc) => doc.id === activeId);
        if (exact) {
            return { doc: exact, effectiveId: exact.id, fellBack: false, warnings };
        }
        // 允许只写版本号（如 "3.6.0"）
        const byVersion = usable.filter((doc) => doc.version === activeId || doc.version.startsWith(`${activeId}-`));
        if (byVersion.length > 0) {
            const picked = [...byVersion].sort((a, b) => sourceWeight(b.source) - sourceWeight(a.source))[0];
            return { doc: picked, effectiveId: picked.id, fellBack: false, warnings };
        }
        warnings.push(`指定版本「${activeId}」不存在，已回退到默认版本`);
    }

    const fallback = usable.find((doc) => doc.source === 'project')
        || usable.find((doc) => doc.source === 'vault')
        || usable.find((doc) => doc.source === 'custom')
        || usable.find((doc) => doc.source === 'builtin')
        || usable[0];
    return { doc: fallback, effectiveId: fallback.id, fellBack: Boolean(activeId), warnings };
}

function sourceWeight(source: VersionedSource): number {
    switch (source) {
        case 'project': return 4;
        case 'vault': return 3;
        case 'custom': return 2;
        case 'builtin': return 1;
        default: return 0;
    }
}

/**
 * 版本漂移检测：版本号相同但内容哈希不同 → 说明「版本号没变、正文被换过」。
 * 返回需要展示给用户的告警（空数组表示一致）。
 *
 * @param expected - 基准版本（通常是内置版）；为空时跳过
 * @param actual - 实际生效版本；为空时跳过
 * @returns 告警文本数组；版本或内容不一致时非空
 */
export function detectDrift(expected: VersionedDoc | null, actual: VersionedDoc | null): string[] {
    if (!expected || !actual) return [];
    if (expected.version !== actual.version) {
        return [`版本号不一致：期望 ${expected.version}，实际 ${actual.version}（${actual.path || actual.id}）`];
    }
    if (expected.hash !== actual.hash) {
        return [
            `版本号相同但内容不同：${actual.path || actual.id}`
            + `（期望 hash ${expected.hash}，实际 ${actual.hash}）。`
            + '这通常意味着文件被旧版覆盖，请在设置里切换生效版本或补一份带新版本号的文件。',
        ];
    }
    return [];
}

/**
 * 生成版本 id（内置版本用）。
 *
 * @param version - 版本号
 * @returns `builtin:<version>`
 */
export function builtinId(version: string): string {
    return `builtin:${version}`;
}
