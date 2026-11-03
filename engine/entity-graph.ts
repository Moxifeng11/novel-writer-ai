/**
 * entity-graph.ts — 基于 Obsidian 原生图谱的实体状态反查
 *
 * 数据源全是结算回写的产物，零 AI：
 * - 实体 frontmatter（metadataCache 零 I/O 读取）：修为等级/当前位置/所属势力/当前状态；
 * - 所有权链接：物品 frontmatter「所属/归属」里的 [[人物]] 链接（单侧写入，这里反查）；
 * - 出场记录（结算沉淀的角色按章行为摘要）。
 *
 * 消费方：正文生成 ${entityRelations}（template-vars-builder）与
 * 协同写作 init（PromptSnapshot.entityRelationsContext）。
 */
import type { App, TFile } from 'obsidian';
import { parseLinkValue } from '@/shared/entity-links';
import { parseBehaviorLog } from '@/shared/behavior-log';
import { activeContextQuotas } from '@/shared/context-budget-policy';

/**
 * OwnedItemSummary 类型定义。
 */
export interface OwnedItemSummary {
    name: string;
    path: string;
    grade: string;
    status: string;
}

/**
 * CharacterQuickState 类型定义。
 */
export interface CharacterQuickState {
    name: string;
    realm: string;
    location: string;
    faction: string;
    status: string;
    emotion: string;
    ownedItems: OwnedItemSummary[];
    recentBehaviors: string[];
}

const WORLD_ARCH = '01-世界架构';

function listFilesUnder(app: App, dirPath: string): TFile[] {
    return app.vault.getFiles().filter(
        (file) => file.path.startsWith(`${dirPath}/`) && file.path.endsWith('.md'),
    );
}

function readFrontmatter(app: App, file: TFile): Record<string, unknown> | null {
    try {
        return (app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown>) || null;
    } catch {
        return null;
    }
}

function normalizeName(name: string): string {
    return String(name || '').replace(/[\s【】\[\]]/g, '');
}

function nameMatches(owner: string, charName: string): boolean {
    const a = normalizeName(owner);
    const b = normalizeName(charName);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
}

/**
 * 某角色当前拥有的物品：物品 frontmatter「所属/归属」反查（单侧写入的查询侧）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param charName - 字符名称
 * @returns 结果数组
 */
export function getOwnedItems(app: App, project: string, charName: string): OwnedItemSummary[] {
    const dir = `${project}/${WORLD_ARCH}/物品功法`;
    const out: OwnedItemSummary[] = [];
    for (const file of listFilesUnder(app, dir)) {
        const fm = readFrontmatter(app, file);
        if (!fm) continue;
        const owners = parseLinkValue(fm['所属/归属']);
        if (!owners.some((owner) => nameMatches(owner, charName))) continue;
        out.push({
            name: file.basename,
            path: file.path,
            grade: String(fm['品阶/等级'] ?? '').trim(),
            status: String(fm['当前状态'] ?? '').trim(),
        });
    }
    return out;
}

/**
 * 出场记录里该角色最近的行为摘要（按文件顺序取最后 limit 条，即最近章节）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param charName - 字符名称
 * @param limit - 上限
 * @returns 结果数组
 */
export async function getRecentBehaviors(app: App, project: string, charName: string, limit = 2): Promise<string[]> {
    try {
        const path = `${project}/${WORLD_ARCH}/人物/出场记录.md`;
        const adapter = app.vault.adapter;
        if (!adapter || !(await adapter.exists(path))) return [];
        const content = await adapter.read(path);
        return parseBehaviorLog(content)
            .filter((row) => nameMatches(row.name, charName))
            .slice(-limit)
            .map((row) => `${row.chapter} ${row.summary}`);
    } catch {
        return [];
    }
}

/**
 * 汇总出场角色的状态速览块：
 * 修为 / 当前位置 / 所属势力 / 状态情绪 / 随身物品（品阶+状态）/ 近况。
 * 全部数据来自结算回写，零 AI；无数据时返回空串（调用方跳过注入）。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param charNames - 角色名称列表
 * @param options - 配置项
 * @returns 文本结果
 */
export async function buildEntityRelationsBlock(
    app: App,
    project: string,
    charNames: string[],
    options: { behaviorLimit?: number; maxChars?: number } = {},
): Promise<string> {
    // v4.22：速览人数跟预算走（旧值固定 8 人，群像章后面的人物整段消失 → OOC）
    const maxChars = options.maxChars ?? activeContextQuotas().entityGraphMaxChars;
    const names = (charNames || []).map((name) => String(name || '').trim()).filter(Boolean).slice(0, maxChars);
    if (names.length === 0) return '';

    const charDir = `${project}/${WORLD_ARCH}/人物`;
    const charFiles = listFilesUnder(app, charDir);
    const byBasename = new Map(charFiles.map((file) => [file.basename, file] as const));

    const lines: string[] = ['【实体状态速览（结算自动回写：境界/位置/所有权/近况，请保持一致）】'];
    let hasAny = false;

    for (const name of names) {
        const file = byBasename.get(name);
        const fm = file ? readFrontmatter(app, file) : null;
        const realm = String(fm?.['修为等级'] ?? '').trim();
        const location = String(fm?.['当前位置'] ?? '').trim();
        const faction = String(fm?.['所属势力'] ?? '').trim();
        const status = String(fm?.['当前状态'] ?? '').trim();
        const emotion = String(fm?.['当前情绪'] ?? '').trim();

        const parts: string[] = [];
        if (realm) parts.push(`修为：${realm}`);
        if (faction) parts.push(`所属：${parseLinkValue(faction)[0] || faction}`);
        if (location) parts.push(`所在：${parseLinkValue(location)[0] || location}`);
        if (status) parts.push(`状态：${status}`);
        if (emotion) parts.push(`情绪：${emotion}`);

        const owned = getOwnedItems(app, project, name);
        const itemText = owned
            .map((item) => `${item.name}${item.grade ? `（${item.grade}${item.status ? ` · ${item.status}` : ''}）` : ''}`)
            .join('、');
        const behaviors = await getRecentBehaviors(app, project, name, options.behaviorLimit ?? 2);

        if (parts.length === 0 && owned.length === 0 && behaviors.length === 0) continue;
        hasAny = true;
        lines.push(`- ${name}${parts.length > 0 ? `｜${parts.join('｜')}` : ''}`);
        if (itemText) lines.push(`  · 随身物品：${itemText}`);
        if (behaviors.length > 0) lines.push(`  · 近况：${behaviors.join('；')}`);
    }

    return hasAny ? `${lines.join('\n')}\n` : '';
}

/**
 * 实体文件的图谱反链（基于 metadataCache.resolvedLinks；限定项目前缀）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param entityPath - 实体路径
 * @returns 结果数组
 */
export function getEntityBacklinks(app: App, project: string, entityPath: string): string[] {
    const resolved = (app.metadataCache as unknown as {
        resolvedLinks?: Record<string, Record<string, number>>;
    }).resolvedLinks;
    if (!resolved) return [];
    const out: string[] = [];
    for (const [sourcePath, targets] of Object.entries(resolved)) {
        if (!sourcePath.startsWith(`${project}/`)) continue;
        if (targets[entityPath]) out.push(sourcePath);
    }
    return out;
}
