/**
 * relationship-change-queue.ts — 协同写作关系变更待确认队列
 *
 * 协同守卫检测到的关系变化过去只进事实队列，永远不会写 `关系状态.md`。
 * 现在单独落一个待确认队列：用户确认后，下一次结算把队列合并进 V2 权威文件；
 * 未确认不写权威数据。
 */
import { App, TFile } from 'obsidian';
import { pjRelationChangeQueue } from '@/shared/paths';
import { ObsidianFileSystem, ObsidianVaultMeta } from '@/shared/file-system-port';
import { withWriteLock } from '@/shared/write-lock';
import { normalizeLedgerName } from './ledger/ledger-model';

/** 待确认关系变更 */
export interface PendingRelationshipChange {
    chapter: string;
    charA: string;
    charB: string;
    dimension: 'trust' | 'attraction' | 'fear' | 'resentment' | 'dependence';
    delta: number;
    reason: string;
    source: string;
}

const HEADER = `# 关系变更待确认\n\n> 协同写作检测到的关系变化；确认后在下一次结算写入 关系状态.md。\n\n| 章 | 角色A | 角色B | 维度 | 增量 | 原因 | 来源 |\n|---|---|---|---|---|---|---|\n`;

const DIMENSIONS = new Set(['trust', 'attraction', 'fear', 'resentment', 'dependence']);

/**
 * 解析队列表格
 *
 * @param content - 文件内容
 * @returns 变更列表
 */
export function parseRelationshipChangeQueue(content: string): PendingRelationshipChange[] {
    const rows: PendingRelationshipChange[] = [];
    for (const line of String(content ?? '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|') || /^\|[\s:|-]+\|$/.test(trimmed)) continue;
        const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
        if (cells.length < 6) continue;
        const dimension = cells[3].toLowerCase();
        if (!DIMENSIONS.has(dimension)) continue;
        const delta = Number.parseInt(cells[4].replace(/[^\d+-]/g, ''), 10);
        if (!Number.isFinite(delta)) continue;
        rows.push({
            chapter: cells[0],
            charA: cells[1],
            charB: cells[2],
            dimension: dimension as PendingRelationshipChange['dimension'],
            delta,
            reason: cells[5],
            source: cells[6] || 'co-writer',
        });
    }
    return rows;
}

/**
 * 追加关系变更（同章同关系同维度同原因幂等）
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @param chapter - 章名
 * @param changes - 变更
 * @param source - 来源
 */
export async function appendRelationshipChanges(
    app: App,
    project: string,
    chapter: string,
    changes: Array<Omit<PendingRelationshipChange, 'chapter' | 'source'>>,
    source = 'co-writer',
): Promise<number> {
    if (changes.length === 0) return 0;
    const path = pjRelationChangeQueue(project);
    const fs = new ObsidianFileSystem(app);
    const meta = new ObsidianVaultMeta(app);
    let appended = 0;

    await withWriteLock(path, async () => {
        const file = meta.getAbstractFileByPath(path);
        const content = file instanceof TFile ? await fs.read(path) : HEADER;
        const existing = new Set(parseRelationshipChangeQueue(content).map(keyOf));
        const rows: string[] = [];
        for (const change of changes) {
            const item: PendingRelationshipChange = { ...change, chapter, source };
            const key = keyOf(item);
            if (existing.has(key)) continue;
            existing.add(key);
            rows.push(formatRow(item));
            appended++;
        }
        if (rows.length === 0) return;
        const base = content.trimEnd();
        const next = base.startsWith('#') ? `${base}\n${rows.join('\n')}\n` : `${HEADER}${rows.join('\n')}\n`;
        if (!(file instanceof TFile)) {
            const dir = path.slice(0, path.lastIndexOf('/'));
            await fs.mkdir(dir).catch(() => {});
        }
        await fs.write(path, next);
    });
    return appended;
}

/**
 * 读取待确认变更
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @returns 变更列表
 */
export async function loadPendingRelationshipChanges(app: App, project: string): Promise<PendingRelationshipChange[]> {
    const path = pjRelationChangeQueue(project);
    const fs = new ObsidianFileSystem(app);
    const meta = new ObsidianVaultMeta(app);
    const file = meta.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return [];
    try {
        return parseRelationshipChangeQueue(await fs.read(path));
    } catch {
        return [];
    }
}

/**
 * 消费队列（结算成功写入 V2 后清空；返回被消费的条目）
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @returns 变更列表
 */
export async function consumePendingRelationshipChanges(app: App, project: string): Promise<PendingRelationshipChange[]> {
    const path = pjRelationChangeQueue(project);
    const changes = await loadPendingRelationshipChanges(app, project);
    if (changes.length === 0) return [];
    const fs = new ObsidianFileSystem(app);
    await withWriteLock(path, async () => {
        await fs.write(path, HEADER);
    });
    return changes;
}

/**
 * 队列去重键
 *
 * @param change - 变更
 * @returns 键
 */
function keyOf(change: PendingRelationshipChange): string {
    return [
        change.chapter,
        normalizeLedgerName(change.charA),
        normalizeLedgerName(change.charB),
        change.dimension,
        change.delta,
        normalizeLedgerName(change.reason),
    ].join('|');
}

/**
 * 格式化为表格行
 *
 * @param change - 变更
 * @returns Markdown 行
 */
function formatRow(change: PendingRelationshipChange): string {
    const delta = change.delta >= 0 ? `+${change.delta}` : String(change.delta);
    return `| ${change.chapter} | ${change.charA} | ${change.charB} | ${change.dimension} | ${delta} | ${change.reason} | ${change.source} |`;
}

/**
 * 把协同实体变化（A↔B + 文本）转成待确认关系变更。
 * 文本里只有定性描述时按关键词映射小增量。
 *
 * @param changes - 实体状态变化
 * @param chapter - 章名
 * @returns 关系变更
 */
export function entityChangesToRelationshipChanges(
    changes: Array<{ entityName?: string; newStatus?: string; entityType?: string }>,
    chapter: string,
): PendingRelationshipChange[] {
    const result: PendingRelationshipChange[] = [];
    for (const change of changes) {
        if (change.entityType !== 'relationship') continue;
        const name = String(change.entityName ?? '');
        const pair = name.split(/\s*(?:↔|<->|与|和)\s*/).filter(Boolean);
        if (pair.length < 2) continue;
        const text = String(change.newStatus ?? '');
        for (const item of qualitativeDeltas(text)) {
            result.push({
                chapter,
                charA: pair[0].trim(),
                charB: pair[1].trim(),
                dimension: item.dimension,
                delta: item.delta,
                reason: text.slice(0, 120) || '关系变化',
                source: 'co-writer',
            });
        }
    }
    return result;
}

/**
 * 定性描述 → 小增量（仅协同队列使用；显式 ±N 优先）
 *
 * @param text - 描述
 * @returns 维度增量
 */
export function qualitativeDeltas(text: string): Array<{ dimension: PendingRelationshipChange['dimension']; delta: number }> {
    const result: Array<{ dimension: PendingRelationshipChange['dimension']; delta: number }> = [];
    const push = (dimension: PendingRelationshipChange['dimension'], delta: number): void => {
        if (!result.some((item) => item.dimension === dimension)) result.push({ dimension, delta });
    };
    if (/决裂|背叛|仇恨|反目/.test(text)) {
        push('resentment', 6);
        push('trust', -5);
    } else if (/敌对|冲突|怀疑|争执/.test(text)) {
        push('trust', -3);
        push('resentment', 2);
    } else if (/师徒|拜师|收徒|传功|指点/.test(text)) {
        push('trust', 2);
    } else if (/信任|亲近|结盟|并肩|相救|帮助/.test(text)) {
        push('trust', 3);
    }
    if (/恐惧|威胁|压迫|畏惧/.test(text)) push('fear', 3);
    if (/爱慕|心动|吸引|倾心/.test(text)) push('attraction', 3);
    if (/依赖|依靠|离不开/.test(text)) push('dependence', 3);
    return result;
}
