/**
 * ledger-link.ts — 台账关联边与「关联索引」渲染
 *
 * 旧实现把关联索引写进伏笔库/时间线看板末尾的 NW-LINKAGE 块，且用名称子串
 * 连边；块被多个解析器当成业务数据，名称相似还会错连。现在：
 *  - 关联索引写到独立文件；
 *  - 边由结构化引用生成（实体 ID、伏笔 ID、事件 ID）；
 *  - 未解析/歧义引用只记 issue，不猜。
 */
import { normalizeLedgerName, type EventRecord, type ForeshadowRecord, type LedgerIssue, type LinkRecord } from './ledger-model';

/** 台账最小结构（避免与 ledger-index 形成运行时循环依赖） */
interface LedgerLike {
    events: EventRecord[];
    foreshadows: ForeshadowRecord[];
    links: LinkRecord[];
    issues: LedgerIssue[];
}

/** 实体解析结果 */
export interface EntityLookup {
    id: string;
    name: string;
    kind: string;
    path?: string;
}

/** 实体解析器：返回 null 表示未找到；返回多个表示歧义 */
export type EntityResolver = (name: string) => EntityLookup | EntityLookup[] | null;

/**
 * 解析台账里的实体引用并生成关联边。
 *
 * @param ledger - 台账（会就地补全 EntityRef）
 * @param resolver - 实体解析器
 * @returns 关联边与问题
 */
export function buildLedgerLinks(ledger: LedgerLike, resolver: EntityResolver): { links: LinkRecord[]; issues: LedgerIssue[] } {
    const links: LinkRecord[] = [];
    const issues: LedgerIssue[] = [];
    let counter = 0;

    const resolveRef = (ref: { id: string; name: string; kind: string; path?: string; resolved: boolean }, sourcePath: string, lineNo: number, recordId: string): void => {
        const found = resolver(ref.name);
        if (!found) {
            issues.push({
                type: 'unresolved-entity',
                message: `无法解析实体「${ref.name}」`,
                sourcePath,
                lineNo,
                recordId,
                severity: 'medium',
            });
            return;
        }
        const list = Array.isArray(found) ? found : [found];
        if (list.length > 1) {
            issues.push({
                type: 'ambiguous-entity',
                message: `实体「${ref.name}」有 ${list.length} 个同名笔记：${list.map((item) => item.path || item.id).join('、')}`,
                sourcePath,
                lineNo,
                recordId,
                severity: 'medium',
            });
            return;
        }
        ref.id = list[0].id;
        ref.kind = list[0].kind;
        ref.path = list[0].path;
        ref.resolved = true;
    };

    for (const event of ledger.events) {
        for (const ref of event.entityRefs) {
            resolveRef(ref, event.sourcePath, event.lineNo, event.id);
            if (!ref.resolved) continue;
            links.push({
                id: `LNK-${++counter}`,
                from: event.id,
                to: ref.id,
                kind: 'mention',
                weight: 3,
                chapterNum: event.chapterNum,
                source: 'explicit',
            });
        }
        for (const foreshadowRef of event.foreshadowRefs) {
            const target = ledger.foreshadows.find((record) => record.id === foreshadowRef
                || normalizeLedgerName(record.name) === normalizeLedgerName(foreshadowRef));
            if (!target) {
                issues.push({
                    type: 'unresolved-entity',
                    message: `事件「${event.name}」引用了不存在的伏笔「${foreshadowRef}」`,
                    sourcePath: event.sourcePath,
                    lineNo: event.lineNo,
                    recordId: event.id,
                    severity: 'medium',
                });
                continue;
            }
            links.push({
                id: `LNK-${++counter}`,
                from: target.id,
                to: event.id,
                kind: event.chapterNum !== null && target.buryChapter && event.chapterKey === target.buryChapter ? 'sets-up' : 'related',
                weight: 4,
                chapterNum: event.chapterNum,
                source: 'explicit',
            });
        }
    }

    for (const foreshadow of ledger.foreshadows) {
        for (const ref of foreshadow.relatedRefs) {
            resolveRef(ref, foreshadow.sourcePath, foreshadow.lineNo, foreshadow.id);
            if (!ref.resolved) continue;
            links.push({
                id: `LNK-${++counter}`,
                from: foreshadow.id,
                to: ref.id,
                kind: 'related',
                weight: 3,
                chapterNum: null,
                source: 'explicit',
            });
        }
    }

    // 派生边：同章伏笔与事件（权重低，仅用于检索提示）
    for (const foreshadow of ledger.foreshadows) {
        for (const event of ledger.events) {
            if (foreshadow.buryChapter && event.chapterKey === foreshadow.buryChapter) {
                links.push({
                    id: `LNK-${++counter}`,
                    from: foreshadow.id,
                    to: event.id,
                    kind: 'sets-up',
                    weight: 2,
                    chapterNum: event.chapterNum,
                    source: 'derived',
                });
            }
        }
    }

    // 去重（from/to/kind 唯一）
    const unique = new Map<string, LinkRecord>();
    for (const link of links) {
        const key = `${link.from}|${link.to}|${link.kind}`;
        const existing = unique.get(key);
        if (!existing || link.weight > existing.weight || link.source === 'explicit') {
            unique.set(key, link);
        }
    }
    ledger.issues.push(...issues);
    return { links: [...unique.values()], issues };
}

/**
 * 渲染独立关联索引文件（按章分节）。
 *
 * @param ledger - 台账
 * @param generatedAt - 生成时间
 * @returns Markdown
 */
export function renderLinkageIndex(ledger: LedgerLike, generatedAt = new Date().toISOString()): string {
    const lines: string[] = [
        '# 故事台账 · 关联索引',
        '',
        `> 由小说工坊自动生成，请勿手改本文件；修改时间：${generatedAt}`,
        '> 权威数据仍在「时间线看板.md」「伏笔库.md」「关系状态.md」。',
        '',
        '## 总览',
        '',
        `- 事件：${ledger.events.length}`,
        `- 伏笔：${ledger.foreshadows.length}`,
        `- 关联边：${ledger.links.length}`,
        `- 待处理问题：${ledger.issues.length}`,
        '',
    ];

    const byChapter = new Map<string, { events: string[]; foreshadows: string[] }>();
    for (const event of ledger.events) {
        const key = event.chapterKey || '未定章';
        const entry = byChapter.get(key) ?? { events: [], foreshadows: [] };
        entry.events.push(`${event.id} | ${event.name}`);
        byChapter.set(key, entry);
    }
    for (const foreshadow of ledger.foreshadows) {
        const key = foreshadow.buryChapter || '未定章';
        const entry = byChapter.get(key) ?? { events: [], foreshadows: [] };
        entry.foreshadows.push(`${foreshadow.id} | ${foreshadow.name}（${foreshadow.status}）`);
        byChapter.set(key, entry);
    }

    const chapterOrder = [...byChapter.keys()].sort((a, b) => {
        const aNum = Number.parseInt(a.replace(/[^\d]/g, ''), 10);
        const bNum = Number.parseInt(b.replace(/[^\d]/g, ''), 10);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
        return a.localeCompare(b);
    });

    for (const chapter of chapterOrder) {
        const entry = byChapter.get(chapter)!;
        lines.push(`## ${chapter}`, '');
        if (entry.events.length > 0) {
            lines.push('| 事件ID | 事件 |', '|---|---|', ...entry.events.map((row) => `| ${row} |`), '');
        }
        if (entry.foreshadows.length > 0) {
            lines.push('| 伏笔ID | 伏笔 |', '|---|---|', ...entry.foreshadows.map((row) => `| ${row} |`), '');
        }
    }

    if (ledger.issues.length > 0) {
        lines.push('## 待处理问题', '');
        for (const issue of ledger.issues) {
            lines.push(`- [${issue.severity}] ${issue.message}${issue.sourcePath ? `（${issue.sourcePath}${issue.lineNo ? `:${issue.lineNo}` : ''}）` : ''}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
