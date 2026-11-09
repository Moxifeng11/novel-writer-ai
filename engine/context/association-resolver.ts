/**
 * association-resolver.ts — AI 调用时的关联信息查询
 *
 * 目标：生成/质控/分析时，按「当前场景 + 在场实体」只取真正相关的人物、关系、
 * 到期伏笔、时间线、最近摘要与承诺，并去重后补进上下文缺口。
 *
 * 数据源：
 *  - EntityIndex（人物/地点/势力/物品的属性）
 *  - StoryLedger（时间线/伏笔/承诺）
 *  - 关系状态.md（V2 权威）
 *  - 剧情记忆（最近 N 章摘要）
 *
 * 只读；失败返回空包并记录原因，不抛错给生成链路。
 */
import type { App } from 'obsidian';
import type { FileSystemPort } from '@/shared/file-system-port';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { estimateTokens } from '@/shared/token-estimator';
import { EntityIndex, normalizeEntityName, type EntityRecord } from '@/shared/entity-index';
import { loadRelationshipStates } from '../relationship-engine';
import { loadStoryLedger } from '../ledger/ledger-io';
import { dueForeshadows, openPromises, timelineWindow } from '../ledger/ledger-index';
import { loadRecentChapterDigests, renderChapterDigestBlock } from '../memory/chapter-digest';
import { parsePromiseLedger } from '../promise-ledger';
import { pjPromiseLedger } from '@/shared/paths';
import { createLogger } from '@/shared/logger';

const log = createLogger('AssociationResolver');

/** 任务类型 */
export type AssociationTask = 'body' | 'quality' | 'analysis' | 'suggestion' | 'unit';

/** 查询参数 */
export interface AssociationQuery {
    app: App;
    project: string;
    task: AssociationTask;
    /** 当前场景/正文尾部/大纲文本 */
    text: string;
    /** 上游已识别的在场实体（可空，空则从 text 提取） */
    presentEntities?: string[];
    budgetTokens?: number;
    /** 已注入的 prompt 段（用于去重） */
    alreadyInjected?: string[];
    chapter?: number | null;
    fs?: FileSystemPort;
}

/** 单条关联信息 */
export interface AssociationItem {
    kind: 'character' | 'relationship' | 'foreshadow' | 'timeline' | 'digest' | 'promise';
    title: string;
    text: string;
    tokens: number;
    sourcePath?: string;
}

/** 查询结果 */
export interface AssociationBundle {
    items: AssociationItem[];
    text: string;
    tokens: number;
    skipped: string;
    issues: string[];
}

/** 各任务默认预算（token） */
const DEFAULT_BUDGET: Record<AssociationTask, number> = {
    body: 1800,
    quality: 1200,
    analysis: 1200,
    suggestion: 600,
    unit: 800,
};

const KIND_LABEL: Record<AssociationItem['kind'], string> = {
    character: '关联人物',
    relationship: '关联关系',
    foreshadow: '到期伏笔',
    timeline: '近期时间线',
    digest: '章节记忆',
    promise: '未兑现承诺',
};

/**
 * 从文本中提取在场实体（最长名称优先 + 命中区间屏蔽，避免子串误判）。
 *
 * @param text - 文本
 * @param index - 实体索引
 * @param limit - 最多实体数
 * @returns 命中的实体名
 */
export function extractPresentEntities(text: string, index: EntityIndex, limit = 8): string[] {
    const source = String(text ?? '');
    if (!source) return [];
    const names: string[] = [];
    for (const record of index.list()) {
        for (const alias of record.aliases) {
            const name = String(alias ?? '').trim();
            if (name.length >= 2) names.push(name);
        }
    }
    names.sort((a, b) => b.length - a.length);
    const masked = new Uint8Array(source.length);
    const found: string[] = [];
    for (const name of names) {
        if (found.length >= limit) break;
        let start = source.indexOf(name);
        while (start >= 0) {
            const end = start + name.length;
            let free = true;
            for (let i = start; i < end; i++) {
                if (masked[i]) { free = false; break; }
            }
            if (free) {
                for (let i = start; i < end; i++) masked[i] = 1;
                if (!found.includes(name)) found.push(name);
                break;
            }
            start = source.indexOf(name, start + 1);
        }
    }
    return found;
}

/**
 * 人物卡 → 关联摘要（只取与一致性/连续性相关的字段）。
 *
 * @param record - 实体记录
 * @returns 摘要文本
 */
function formatCharacter(record: EntityRecord): string {
    const fm = record.properties;
    const value = (key: string): string => String(fm[key] ?? '').trim();
    const fields = [
        value('身份') ? `身份：${value('身份')}` : '',
        value('当前状态') ? `状态：${value('当前状态')}` : '',
        value('当前情绪') ? `情绪：${value('当前情绪')}` : '',
        value('当前位置') ? `位置：${value('当前位置')}` : '',
        value('性格标签') ? `性格：${value('性格标签')}` : '',
        value('外貌特征') ? `外貌：${value('外貌特征')}` : '',
        value('功法/技能树') || value('金手指/特殊能力')
            ? `能力：${value('功法/技能树') || value('金手指/特殊能力')}`
            : '',
        value('伤势') ? `伤势：${value('伤势')}` : '',
        value('已知信息') ? `已知：${value('已知信息')}` : '',
    ].filter(Boolean);
    return fields.length > 0 ? `${record.name}（${fields.join('；')}）` : record.name;
}

/**
 * 查询关联信息。
 *
 * @param query - 查询参数
 * @returns AssociationBundle
 */
export async function resolveAssociations(query: AssociationQuery): Promise<AssociationBundle> {
    const issues: string[] = [];
    try {
        const index = EntityIndex.build(query.app, query.project);
        const names = query.presentEntities && query.presentEntities.length > 0
            ? query.presentEntities
            : extractPresentEntities(query.text, index);
        if (names.length === 0) {
            return { items: [], text: '', tokens: 0, skipped: 'no-entities', issues };
        }

        const resolved: EntityRecord[] = [];
        for (const name of names.slice(0, 8)) {
            const resolution = index.resolve(name);
            if (resolution.unresolved) {
                issues.push(`未找到实体「${name}」`);
                continue;
            }
            if (resolution.ambiguous) {
                issues.push(`实体「${name}」有 ${resolution.matches.length} 个同名笔记，已跳过`);
                continue;
            }
            resolved.push(resolution.matches[0]);
        }
        if (resolved.length === 0) {
            return { items: [], text: '', tokens: 0, skipped: 'unresolved-entities', issues };
        }

        const ledger = await loadStoryLedger(query.app, query.project);
        // 承诺账本按需读入索引（ledger-io 只负责时间线/伏笔）
        try {
            const fs = query.fs ?? new ObsidianFileSystem(query.app);
            const file = query.app.vault.getAbstractFileByPath(pjPromiseLedger(query.project));
            if (file) {
                ledger.promises = parsePromiseLedger(await fs.read(pjPromiseLedger(query.project))).map((promise) => ({
                    id: String(promise.id),
                    name: promise.name,
                    type: promise.type,
                    raisedChapter: promise.openedChapter,
                    raisedBy: promise.openedBy,
                    expectedChapter: promise.expectedChapter,
                    status: promise.status,
                    lastAdvancedChapter: promise.lastAdvancedChapter,
                    note: promise.note,
                }));
            }
        } catch {
            // 承诺读取失败不影响其他关联信息
        }

        const injected = (query.alreadyInjected ?? []).join('\n');
        const candidates: AssociationItem[] = [];
        const push = (kind: AssociationItem['kind'], title: string, text: string, sourcePath?: string): void => {
            const clean = String(text ?? '').trim();
            if (!clean) return;
            // 已注入相同文本时不重复
            if (injected.includes(clean)) return;
            candidates.push({ kind, title, text: clean, tokens: estimateTokens(clean), sourcePath });
        };

        for (const record of resolved) {
            push('character', record.name, `- ${formatCharacter(record)}`, record.path);
        }

        const relations = await loadRelationshipStates(query.app, query.project);
        const nameSet = new Set(resolved.map((record) => normalizeEntityName(record.name)));
        for (const relation of relations) {
            if (!nameSet.has(normalizeEntityName(relation.charA)) && !nameSet.has(normalizeEntityName(relation.charB))) continue;
            const state = relation.state;
            push(
                'relationship',
                `${relation.charA} ↔ ${relation.charB}`,
                `- ${relation.charA} ↔ ${relation.charB}：信任${state.trust}/吸引${state.attraction}/恐惧${state.fear}/怨恨${state.resentment}/依赖${state.dependence}（${state.status}）`,
            );
        }

        for (const foreshadow of dueForeshadows(ledger, query.chapter ?? null)) {
            push(
                'foreshadow',
                foreshadow.name,
                `- ${foreshadow.name}（重要度${foreshadow.importance || '中'}，埋于${foreshadow.buryChapter || '?'}，计划${foreshadow.plannedReveal || '待定'}）`,
                foreshadow.sourcePath,
            );
        }

        const timeline = timelineWindow(ledger, query.chapter ?? null, 8)
            .filter((event) => (query.chapter !== null && event.chapterNum === query.chapter)
                || event.entityRefs.some((ref) => nameSet.has(normalizeEntityName(ref.name))))
            .slice(0, 5);
        for (const event of timeline) {
            push(
                'timeline',
                event.name,
                `- ${event.chapterKey} ${event.time ? `（${event.time}）` : ''}：${event.name}${event.impact ? ` → ${event.impact}` : ''}`,
                event.sourcePath,
            );
        }

        try {
            const fs = query.fs ?? new ObsidianFileSystem(query.app);
            const digests = await loadRecentChapterDigests(query.app, fs, query.project, query.chapter ?? null, 3);
            const block = renderChapterDigestBlock(digests);
            if (block) push('digest', '最近章节', `【剧情记忆】\n${block}`);
        } catch {
            // 摘要缺失时静默降级
        }

        for (const promise of openPromises(ledger, query.chapter ?? null).slice(0, 5)) {
            push('promise', promise.name, `- 未兑现承诺：${promise.name}（预期${promise.expectedChapter || '未定'}，${promise.status || '进行中'}）`);
        }

        const budget = Math.max(120, query.budgetTokens ?? DEFAULT_BUDGET[query.task] ?? 1200);
        const selected: AssociationItem[] = [];
        let used = 0;
        for (const item of candidates) {
            if (used + item.tokens > budget) continue;
            selected.push(item);
            used += item.tokens;
        }

        const grouped = new Map<AssociationItem['kind'], AssociationItem[]>();
        for (const item of selected) {
            const list = grouped.get(item.kind) ?? [];
            list.push(item);
            grouped.set(item.kind, list);
        }
        const sections: string[] = [];
        for (const kind of ['character', 'relationship', 'foreshadow', 'timeline', 'digest', 'promise'] as const) {
            const list = grouped.get(kind);
            if (!list || list.length === 0) continue;
            sections.push(`【${KIND_LABEL[kind]}】`, ...list.map((item) => item.text));
        }

        return {
            items: selected,
            text: sections.join('\n'),
            tokens: used,
            skipped: selected.length === 0 ? 'budget' : '',
            issues,
        };
    } catch (e) {
        log.warn('[AssociationResolver] 关联查询失败，已降级为空结果:', e);
        return { items: [], text: '', tokens: 0, skipped: 'error', issues };
    }
}
