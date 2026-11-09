/**
 * entity-recheck-gate.ts — 正文修改触发 AI 实体重检的冷却闸门（W-7）
 *
 * main.ts 的 P1-16 哈希跳过只防「同内容重复触发」；连续写作时内容每 2 秒都在变，
 * 每次停顿仍会发一次 AI 实体检测。本闸门叠加「每路径冷却窗口」（对齐
 * live-analysis 的 GUARD_INPUT_COOLDOWN_MS）：冷却期内内容再变只更新「已见」
 * 哈希，冷却后第一次事件按最新内容补检一次。
 *
 * 关键区分：checkedHash（AI 实际检过的内容）与 seenHash（仅到过闸门的内容）——
 * 冷却期内被延迟的内容不能进入 checkedHash，否则冷却后的补检会被「同内容」
 * 短路漏掉（2026-11-10 单测发现的实现缺陷）。
 *
 * 纯内存、无 Obsidian 依赖，便于单测。
 */
import { GUARD_INPUT_COOLDOWN_MS } from './thresholds';

/** 单路径登记 */
interface RecheckGateEntry {
    /** AI 实际检过的内容哈希 */
    checkedHash: string;
    /** 到过闸门的最新内容哈希（冷却期内被延迟的更新记在这里） */
    seenHash: string;
    /** 上次放行时间 */
    lastRunAt: number;
}

/**
 * EntityRecheckGate 类。
 */
export class EntityRecheckGate {
    private readonly entries = new Map<string, RecheckGateEntry>();
    private readonly cooldownMs: number;
    private readonly maxEntries: number;

    /**
     * @param cooldownMs - 每路径冷却窗口（默认对齐 live-analysis 的 5 分钟）
     * @param maxEntries - 登记上限（超出淘汰最旧，防御异常多路径）
     */
    constructor(cooldownMs: number = GUARD_INPUT_COOLDOWN_MS, maxEntries = 200) {
        this.cooldownMs = Math.max(0, cooldownMs);
        this.maxEntries = Math.max(1, maxEntries);
    }

    /**
     * 判定本次 modify 是否放行 AI 重检。
     *
     * 语义：
     * - 内容 === 上次已检内容 → 不放行（镜像 P1-16，与冷却无关）；
     * - 冷却期内内容变化 → 只记「已见」，不放行（连续写作不逐次发 AI）；
     * - 冷却已过且已见内容 ≠ 已检内容 → 放行一次（补检最新内容）。
     *
     * @param path - 正文路径
     * @param hash - 内容指纹（调用方生成，如 `${length}:${tail}`）
     * @param now - 当前时间（注入，便于测试）
     * @returns 是否放行
     */
    shouldRun(path: string, hash: string, now: number = Date.now()): boolean {
        const entry = this.entries.get(path);
        if (entry && hash === entry.checkedHash) return false; // 已检过：无论冷却
        if (entry && now - entry.lastRunAt < this.cooldownMs) {
            entry.seenHash = hash; // 冷却内：只记已见，推迟到冷却后
            return false;
        }
        this.entries.set(path, { checkedHash: hash, seenHash: hash, lastRunAt: now });
        if (this.entries.size > this.maxEntries) {
            const firstKey = this.entries.keys().next().value;
            if (firstKey) this.entries.delete(firstKey);
        }
        return true;
    }

    /**
     * 清空（切项目/插件重载场景）
     *
     * @param path - 只清某一路径；缺省清空全部
     */
    reset(path?: string): void {
        if (path) this.entries.delete(path);
        else this.entries.clear();
    }
}
