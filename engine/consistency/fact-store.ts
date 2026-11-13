/**
 * fact-store.ts — 事实库持久化（独立事实源）
 *
 * 决策变更（2026-11-13，用户拍板）：**保留独立事实库**。
 * 原因：图是每章临时构建的、用完即弃；若不单独落盘，审核跨章比对时读不到历史事实。
 *
 * 定位与权威序（红线）：
 *   正文 > **事实库**（可人工修正）> 章节摘要（LLM 派生）
 *  - 事实库是**结构化事实的唯一持久源**；
 *  - 图在构建时从事实库取事实节点（`factNodes`），与图内其他节点同住一张图；
 *  - 摘要只作为拆解输入，不作为事实来源。
 *
 * 设计约束：
 *  - 3 态加载（ok / missing / read-failed），读失败**拒绝写**，避免把用户数据覆盖成空；
 *  - 原子写：目标存在则直接 write（Obsidian 的 rename 目标存在会抛错，本仓踩过 4 次）；
 *  - 按 `章节|主体|谓词` 去重合并，重复拆解安全。
 */

import type { FileSystemPort } from '@/shared/file-system-port';
import type { FactMetadata } from '@/engine/context/knowledge-fact-nodes';
import type { DecomposeEntry } from './knowledge-decompose';

/** 事实库文件结构 */
export interface FactStore {
    /** 格式版本 */
    version: 1;
    /** 最后更新时间（ISO） */
    updatedAt: string;
    /** 全部事实（按章节升序） */
    facts: FactMetadata[];
}

/** 加载结果（3 态） */
export interface LoadedFactStore {
    status: 'ok' | 'missing' | 'read-failed';
    store: FactStore;
    /** read-failed 时的错误描述 */
    error?: string;
}

/**
 * 创建空事实库。
 *
 * @param now - 当前时间
 * @returns 事实库
 */
export function createFactStore(now = new Date()): FactStore {
    return { version: 1, updatedAt: now.toISOString(), facts: [] };
}

/**
 * 事实去重键。
 *
 * @param fact - 事实
 * @returns 键
 */
export function factKeyOf(fact: Pick<FactMetadata, 'chapter' | 'subject' | 'predicate'>): string {
    return `${fact.chapter}|${fact.subject}|${fact.predicate}`;
}

/**
 * 把拆解条目合并进事实库（按去重键；同键以新值为准，便于人工修正后重跑）。
 *
 * @param store - 事实库（原地修改）
 * @param chapter - 章节号
 * @param entries - 拆解条目
 * @param now - 当前时间
 * @returns 新增与更新条数
 */
export function mergeFactStore(
    store: FactStore,
    chapter: number,
    entries: readonly DecomposeEntry[],
    now = new Date(),
): { added: number; updated: number } {
    const index = new Map<string, number>();
    store.facts.forEach((fact, i) => index.set(factKeyOf(fact), i));
    let added = 0;
    let updated = 0;
    for (const entry of entries) {
        const fact: FactMetadata = {
            type: entry.type,
            subject: entry.subject,
            predicate: entry.predicate,
            value: entry.value,
            numeric: entry.numeric,
            unit: entry.unit,
            validFrom: entry.validFrom,
            validTo: entry.validTo,
            confidence: entry.confidence,
            quote: entry.quote,
            chapter,
            isCurrentState: entry.isCurrentState !== false,
            event: entry.event,
            slot: entry.slot,
        };
        const key = factKeyOf(fact);
        const at = index.get(key);
        if (at === undefined) {
            index.set(key, store.facts.length);
            store.facts.push(fact);
            added += 1;
        } else {
            store.facts[at] = fact;
            updated += 1;
        }
    }
    if (added + updated > 0) {
        store.updatedAt = now.toISOString();
        store.facts.sort((a, b) => a.chapter - b.chapter);
    }
    return { added, updated };
}

/**
 * 加载事实库（3 态）。
 *
 * @param fs - 文件系统端口
 * @param path - 事实库路径
 * @returns 加载结果
 */
export async function loadFactStore(fs: FileSystemPort, path: string): Promise<LoadedFactStore> {
    let exists = false;
    try {
        exists = await fs.exists(path);
    } catch (error) {
        return { status: 'read-failed', store: createFactStore(), error: describeError(error) };
    }
    if (!exists) return { status: 'missing', store: createFactStore() };
    try {
        const text = await fs.read(path);
        const parsed = parseFactStore(text);
        if (!parsed) {
            return { status: 'read-failed', store: createFactStore(), error: '事实库 JSON 损坏' };
        }
        return { status: 'ok', store: parsed };
    } catch (error) {
        return { status: 'read-failed', store: createFactStore(), error: describeError(error) };
    }
}

/**
 * 解析事实库 JSON（损坏返回 null）。
 *
 * @param text - JSON 文本
 * @returns 事实库或 null
 */
export function parseFactStore(text: string): FactStore | null {
    try {
        const parsed = JSON.parse(text) as Partial<FactStore>;
        if (!parsed || !Array.isArray(parsed.facts)) return null;
        return {
            version: 1,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
            facts: parsed.facts.filter((f): f is FactMetadata => Boolean(
                f && typeof f === 'object' && 'subject' in f && 'predicate' in f,
            )),
        };
    } catch {
        return null;
    }
}

/**
 * 序列化事实库。
 *
 * @param store - 事实库
 * @returns JSON 文本
 */
export function serializeFactStore(store: FactStore): string {
    return JSON.stringify({ version: 1, updatedAt: store.updatedAt, facts: store.facts }, null, 2);
}

/**
 * 保存事实库（原子写；目标存在则直接覆盖）。
 *
 * @param fs - 文件系统端口
 * @param path - 事实库路径
 * @param store - 事实库
 * @param options - 选项：readFailed 为 true 时拒绝写入
 * @returns 是否写入
 */
export async function saveFactStore(
    fs: FileSystemPort,
    path: string,
    store: FactStore,
    options: { readFailed?: boolean } = {},
): Promise<boolean> {
    // 读失败时拒绝写：否则会把用户已有的正确数据覆盖成空库
    if (options.readFailed) return false;
    const text = serializeFactStore(store);
    const dir = path.slice(0, Math.max(0, path.lastIndexOf('/')));
    // silent-ok: 目录已存在是正常情况；真的建不出来会在 write 抛错时暴露
    if (dir) await fs.mkdir(dir).catch(() => undefined);
    const exists = await fs.exists(path).catch(() => false);
    if (exists) {
        await fs.write(path, text);
        return true;
    }
    const tmp = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await fs.write(tmp, text);
    await fs.rename(tmp, path);
    return true;
}

/**
 * 描述错误（统一文案）。
 *
 * @param error - 错误
 * @returns 文本
 */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
