/**
 * graph-validator.ts — Obsidian 图谱/Bases/双链作为兜底校验层（只读）
 *
 * 只读 `metadataCache.resolvedLinks/unresolvedLinks`、实体索引与故事台账，检查：
 *  - 断链：wiki-link 指向不存在的项目笔记；
 *  - 孤立实体：被章节反复提及却没有任何入链；
 *  - 关系缺卡：关系状态.md 的 A/B 找不到人物卡；
 *  - 双链字段类型不符：所属势力应链势力、当前位置应链地点等；
 *  - 台账未知引用：时间线/伏笔引用的人物/地点无法解析；
 *  - 类型冲突：路径/标签识别出的类型与实体目录类型不一致。
 *
 * 只输出报告，绝不修改任何实体/台账文件。
 */
import type { App } from 'obsidian';
import { EntityIndex, normalizeEntityName, type EntityRecord, type IndexedEntityKind } from '@/shared/entity-index';
import { queryProjectNotes } from '@/shared/obsidian-query';
import { readTagList, resolveFileKind } from '@/shared/frontmatter-schema';
import { getLinkPolicy, parseLinkValue } from '@/shared/entity-links';
import { loadRelationshipStates } from '../relationship-engine';
import { loadStoryLedger } from '../ledger/ledger-io';
import type { StoryLedger } from '../ledger/ledger-index';
import { pjGraphDiagnosticReport } from '@/shared/paths';
import { withWriteLock } from '@/shared/write-lock';
import type { FileSystemPort } from '@/shared/file-system-port';

/** 规则名 */
export type GraphRule =
    | 'broken-link'
    | 'orphan-entity'
    | 'missing-relation-card'
    | 'link-type-mismatch'
    | 'unknown-ledger-ref'
    | 'type-mismatch';

/** 单条问题 */
export interface GraphValidationIssue {
    rule: GraphRule;
    severity: 'high' | 'medium' | 'low';
    message: string;
    path?: string;
    relatedPath?: string;
}

/** 校验报告 */
export interface GraphValidationReport {
    /** 无 metadataCache 等降级原因；空串表示正常执行 */
    skipped: string;
    issues: GraphValidationIssue[];
    scannedEntities: number;
    scannedLinks: number;
    generatedAt: string;
}

/** 校验输入 */
export interface GraphValidationInput {
    app: App;
    project: string;
    ledger?: StoryLedger;
    entityIndex?: EntityIndex;
}

const KIND_TO_CATEGORY: Record<IndexedEntityKind, string> = {
    character: 'character',
    location: 'location',
    faction: 'faction',
    item: 'item',
};

/**
 * 读取 metadataCache 的链接表（旧版本/移动端可能缺失）。
 *
 * @param app - Obsidian 应用
 * @returns 链接表或 null
 */
function readLinkMaps(app: App): { resolved: Record<string, Record<string, number>>; unresolved: Record<string, Record<string, number>> } | null {
    const cache = app.metadataCache as unknown as {
        resolvedLinks?: Record<string, Record<string, number>>;
        unresolvedLinks?: Record<string, Record<string, number>>;
    };
    if (!cache || !cache.resolvedLinks) return null;
    return { resolved: cache.resolvedLinks, unresolved: cache.unresolvedLinks ?? {} };
}

/**
 * 统计章节 frontmatter 的「涉及*」引用次数。
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @returns 名称 → 次数
 */
function countChapterMentions(app: App, project: string): Map<string, number> {
    const counts = new Map<string, number>();
    const files = queryProjectNotes(app, project, { kind: 'body' });
    for (const file of files) {
        const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
        for (const key of ['涉及人物', '涉及地点', '涉及势力', '涉及物品功法']) {
            const value = fm[key];
            const names = Array.isArray(value) ? value : String(value ?? '').split(/[、，,；;]+/);
            for (const name of names) {
                const keyName = normalizeEntityName(name);
                if (!keyName) continue;
                counts.set(keyName, (counts.get(keyName) ?? 0) + 1);
            }
        }
    }
    return counts;
}

/**
 * 校验项目图谱（只读）。
 *
 * @param input - 输入
 * @returns 报告
 */
export async function validateProjectGraph(input: GraphValidationInput): Promise<GraphValidationReport> {
    const maps = readLinkMaps(input.app);
    const generatedAt = new Date().toISOString();
    if (!maps) {
        return { skipped: 'no-metadata-cache', issues: [], scannedEntities: 0, scannedLinks: 0, generatedAt };
    }

    const issues: GraphValidationIssue[] = [];
    const index = input.entityIndex ?? EntityIndex.build(input.app, input.project);
    const ledger = input.ledger ?? await loadStoryLedger(input.app, input.project);
    const ledgerEntityNames = new Set<string>();
    for (const event of ledger.events) {
        for (const ref of event.entityRefs) ledgerEntityNames.add(normalizeEntityName(ref.name));
    }
    for (const foreshadow of ledger.foreshadows) {
        for (const ref of foreshadow.relatedRefs) ledgerEntityNames.add(normalizeEntityName(ref.name));
    }

    // 1) 断链：unresolvedLinks 只保留本项目内的目标
    const prefix = input.project.endsWith('/') ? input.project : `${input.project}/`;
    let scannedLinks = 0;
    for (const [source, targets] of Object.entries(maps.unresolved)) {
        if (!source.startsWith(prefix)) continue;
        for (const target of Object.keys(targets)) {
            scannedLinks++;
            if (!target.startsWith(prefix)) continue;
            issues.push({
                rule: 'broken-link', severity: 'high',
                message: `断链：${source} 指向不存在的笔记 ${target}`,
                path: source, relatedPath: target,
            });
        }
    }

    // 2) 双链字段类型 + 类型冲突
    const fieldCategories: Array<{ kind: IndexedEntityKind; fields: string[] }> = [
        { kind: 'character', fields: ['所属势力', '当前位置', '持有物品'] },
        { kind: 'item', fields: ['所属/归属', '现存放位置'] },
        { kind: 'location', fields: ['所在世界/区域'] },
        { kind: 'faction', fields: ['领袖'] },
    ];
    for (const record of index.list()) {
        const resolvedKind = resolveFileKind(record.properties, record.path);
        const expectedKind = KIND_TO_KIND[record.kind];
        if (resolvedKind !== 'unknown' && resolvedKind !== expectedKind) {
            issues.push({
                rule: 'type-mismatch', severity: 'low',
                message: `类型冲突：路径/标签识别为 ${resolvedKind}，实体目录按 ${record.kind} 处理`,
                path: record.path,
            });
        }
        for (const group of fieldCategories) {
            if (group.kind !== record.kind) continue;
            for (const field of group.fields) {
                const value = record.properties[field];
                const names = parseLinkValue(value);
                if (names.length === 0) continue;
                const policy = getLinkPolicy(KIND_TO_CATEGORY[group.kind], field);
                const expected = policy?.targetCategory;
                for (const name of names) {
                    const resolution = index.resolve(name);
                    if (resolution.unresolved) {
                        issues.push({
                            rule: 'link-type-mismatch', severity: 'medium',
                            message: `${field} 指向的「${name}」没有对应实体笔记`,
                            path: record.path,
                        });
                        continue;
                    }
                    if (!expected) continue;
                    const target = resolution.matches[0];
                    if (KIND_TO_CATEGORY[target.kind] !== expected) {
                        issues.push({
                            rule: 'link-type-mismatch', severity: 'medium',
                            message: `${field} 应指向 ${expected}，实际指向 ${target.kind}「${target.name}」`,
                            path: record.path, relatedPath: target.path,
                        });
                    }
                }
            }
        }
    }

    // 3) 关系缺卡
    const relations = await loadRelationshipStates(input.app, input.project);
    for (const relation of relations) {
        for (const name of [relation.charA, relation.charB]) {
            const resolution = index.resolve(name, 'character');
            if (resolution.unresolved) {
                issues.push({
                    rule: 'missing-relation-card', severity: 'high',
                    message: `关系状态中的「${name}」没有人物卡（${relation.charA} ↔ ${relation.charB}）`,
                });
            }
        }
    }

    // 4) 台账未知引用
    for (const issue of ledger.issues) {
        if (issue.type !== 'unresolved-entity' && issue.type !== 'ambiguous-entity') continue;
        issues.push({
            rule: 'unknown-ledger-ref', severity: issue.severity === 'high' ? 'high' : 'medium',
            message: issue.message,
            path: issue.sourcePath,
        });
    }
    for (const name of ledgerEntityNames) {
        if (!name) continue;
        if (index.resolve(name).unresolved) {
            issues.push({
                rule: 'unknown-ledger-ref', severity: 'medium',
                message: `台账引用了未收录的实体「${name}」`,
            });
        }
    }

    // 5) 孤立实体：入链为 0，但章节 frontmatter 提及 ≥3 次
    const incoming = new Map<string, number>();
    for (const targets of Object.values(maps.resolved)) {
        for (const target of Object.keys(targets)) {
            incoming.set(target, (incoming.get(target) ?? 0) + 1);
        }
    }
    const mentions = countChapterMentions(input.app, input.project);
    for (const record of index.list()) {
        if ((incoming.get(record.path) ?? 0) > 0) continue;
        const count = mentions.get(normalizeEntityName(record.name)) ?? 0;
        if (count < 3) continue;
        issues.push({
            rule: 'orphan-entity', severity: 'medium',
            message: `孤立实体：${record.name} 被章节提及 ${count} 次，但没有任何双链/入链`,
            path: record.path,
        });
    }

    return {
        skipped: '',
        issues,
        scannedEntities: index.size,
        scannedLinks,
        generatedAt,
    };
}

/** 实体索引类型 → NotebookFileKind */
const KIND_TO_KIND: Record<IndexedEntityKind, 'character' | 'location' | 'faction' | 'item'> = {
    character: 'character',
    location: 'location',
    faction: 'faction',
    item: 'item',
};

/**
 * 渲染校验报告。
 *
 * @param report - 报告
 * @returns Markdown
 */
export function formatGraphValidationReport(report: GraphValidationReport): string {
    const lines: string[] = [
        '---',
        'tags: [故事一致性报告, nw/设定/诊断]',
        `生成时间: ${report.generatedAt}`,
        `问题数: ${report.issues.length}`,
        '---',
        '',
        '# 故事一致性报告',
        '',
        report.skipped
            ? `- 状态：跳过（${report.skipped}）`
            : `- 扫描实体：${report.scannedEntities}；扫描链接：${report.scannedLinks}；问题：${report.issues.length}`,
        '',
    ];
    if (report.issues.length === 0) {
        lines.push('未发现断链、孤立实体或类型冲突。');
        return lines.join('\n');
    }
    const byRule = new Map<string, GraphValidationIssue[]>();
    for (const issue of report.issues) {
        const list = byRule.get(issue.rule) ?? [];
        list.push(issue);
        byRule.set(issue.rule, list);
    }
    for (const [rule, list] of byRule) {
        lines.push(`## ${rule}（${list.length}）`, '');
        for (const issue of list) {
            lines.push(`- [${issue.severity}] ${issue.message}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * 写报告文件（只写诊断产物，不改实体/台账）。
 *
 * @param fs - 文件端口
 * @param project - 项目
 * @param report - 报告
 * @returns 报告路径
 */
export async function writeGraphValidationReport(
    fs: FileSystemPort,
    project: string,
    report: GraphValidationReport,
): Promise<string> {
    const path = pjGraphDiagnosticReport(project);
    await fs.mkdir(path.slice(0, path.lastIndexOf('/'))).catch(() => {});
    await withWriteLock(path, async () => {
        await fs.write(path, formatGraphValidationReport(report));
    });
    return path;
}
