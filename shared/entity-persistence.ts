import { App, TFile } from 'obsidian';
import { pjCharFile, pjFactionFile, pjItemFile, pjLocFile } from './paths';
import {
    validateCharacterOutput,
    validateFactionOutput,
    validateItemOutput,
    validateLocationOutput,
    type ValidationResult,
} from './template-validator';

/**
 * 实体落盘统一入口。
 *
 * 背景：人物/势力/地点/物品的生成分别散落在四个独立模态、统一生成模态与工作台向导中，
 * 保存行为不一致（有的只新建、有的直接覆盖、有的不补 frontmatter），
 * 导致同名实体被静默丢弃或互相覆盖。此处收敛为单一契约：
 *
 * - 路径统一走 shared/paths 的 `sanitizeName`
 * - 缺 frontmatter 时补 tags 与名称字段
 * - 同名且内容相同 → 跳过（幂等）
 * - 同名但内容不同 → 另存为「名称（2）」…（同名分身/不同角色不互相覆盖）
 */
export type EntityKind = 'characters' | 'factions' | 'locations' | 'items';

/**
 * EntitySaveInput 类型定义。
 */
export interface EntitySaveInput {
    name: string;
    content: string;
}

/**
 * EntitySaveOutcome 类型定义。
 */
export interface EntitySaveOutcome {
    /** 新建成功的实体名 */
    saved: string[];
    /** 因同名而另存副本的实体 */
    renamed: Array<{ name: string; savedAs: string }>;
    /** 同名且内容完全一致，未重复写入 */
    skipped: string[];
    /** 保存失败 */
    failed: Array<{ name: string; error: string }>;
}

interface EntityKindMeta {
    label: string;
    tag: string;
    nameKey: string;
    file: (project: string, name: string) => string;
}

const KIND_META: Record<EntityKind, EntityKindMeta> = {
    characters: { label: '人物', tag: '人物', nameKey: '姓名', file: pjCharFile },
    factions: { label: '势力', tag: '势力', nameKey: '名称', file: pjFactionFile },
    locations: { label: '地点', tag: '地点', nameKey: '名称', file: pjLocFile },
    items: { label: '物品功法', tag: '物品功法', nameKey: '名称', file: pjItemFile },
};

/** 同名副本上限，避免异常数据导致无限探测 */
const MAX_DUPLICATE_INDEX = 100;

/** 单次保存上限，防止误触发导致大量文件落盘 */
const MAX_SAVE_COUNT = 200;

/**
 * SaveEntitiesOptions 类型定义。
 */
export interface SaveEntitiesOptions {
    /** 是否拒绝不完整实体（默认 true：缺字段/空分节一律不落盘） */
    requireComplete?: boolean;
}

const VALIDATORS: Record<EntityKind, (content: string) => ValidationResult> = {
    characters: validateCharacterOutput,
    factions: validateFactionOutput,
    locations: validateLocationOutput,
    items: validateItemOutput,
};

/**
 * 按实体类型校验内容完整性
 *
 * @param kind - 种类
 * @param content - 内容
  * @returns ValidationResult 实例
 */
export function validateEntityContent(kind: EntityKind, content: string): ValidationResult {
    return VALIDATORS[kind](content);
}

/**
 * 获取实体种类标签。
 * @param kind - 种类
 * @returns 文本结果
 */
export function getEntityKindLabel(kind: EntityKind): string {
    return KIND_META[kind].label;
}

/**
 * 缺少 frontmatter 时补齐最小可用字段，保证实体可被检索与渲染
 *
 * @param content - 内容
 * @param name - 名称
 * @param kind - 种类
 * @returns 文本结果
 */
export function normalizeEntityContent(content: string, name: string, kind: EntityKind): string {
    if (content.trimStart().startsWith('---')) return content;
    const meta = KIND_META[kind];
    return `---\ntags: [${meta.tag}]\n${meta.nameKey}: ${JSON.stringify(name)}\n---\n\n${content}`;
}

/**
 * formatSaveOutcome 函数。
 * @param outcome - 结果
 * @param kind - 种类
 * @returns 文本结果
 */
export function formatSaveOutcome(outcome: EntitySaveOutcome, kind: EntityKind): string {
    const label = KIND_META[kind].label;
    const parts: string[] = [`已新增 ${outcome.saved.length} 个${label}`];
    if (outcome.renamed.length > 0) {
        const sample = outcome.renamed
            .slice(0, 3)
            .map(r => `${r.name}→${r.savedAs}`)
            .join('、');
        parts.push(`同名另存 ${outcome.renamed.length} 个（${sample}${outcome.renamed.length > 3 ? ' 等' : ''}）`);
    }
    if (outcome.skipped.length > 0) parts.push(`内容相同跳过 ${outcome.skipped.length} 个`);
    if (outcome.failed.length > 0) {
        const sample = outcome.failed
            .slice(0, 2)
            .map(f => `${f.name}：${f.error}`)
            .join('；');
        parts.push(`失败 ${outcome.failed.length} 个（${sample}${outcome.failed.length > 2 ? ' 等' : ''}）`);
    }
    return parts.join('，');
}

/**
 * saveEntities 函数。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param kind - 种类
 * @param entities - 实体列表
 * @param options - 配置项
  * @returns EntitySaveOutcome 实例
 */
export async function saveEntities(
    app: App,
    project: string,
    kind: EntityKind,
    entities: EntitySaveInput[],
    options: SaveEntitiesOptions = {}
): Promise<EntitySaveOutcome> {
    const meta = KIND_META[kind];
    const requireComplete = options.requireComplete !== false;
    const outcome: EntitySaveOutcome = { saved: [], renamed: [], skipped: [], failed: [] };

    if (entities.length > MAX_SAVE_COUNT) {
        outcome.failed.push({
            name: `(${entities.length} 个实体)`,
            error: `单次保存数量超过上限 ${MAX_SAVE_COUNT}`,
        });
        return outcome;
    }

    for (const entity of entities) {
        const name = entity.name?.trim();
        if (!name) {
            outcome.failed.push({ name: '(空名称)', error: '实体名称为空' });
            continue;
        }

        const content = normalizeEntityContent(entity.content, name, kind);

        if (requireComplete) {
            const validation = VALIDATORS[kind](content);
            if (!validation.valid) {
                outcome.failed.push({
                    name,
                    error: `内容不完整，缺少：${validation.missingFields.slice(0, 8).join('、')}${validation.missingFields.length > 8 ? ' 等' : ''}`,
                });
                continue;
            }
        }

        try {
            const basePath = meta.file(project, name);
            const existing = app.vault.getAbstractFileByPath(basePath);

            if (existing instanceof TFile) {
                const current = await app.vault.read(existing);
                if (current.trim() === content.trim()) {
                    outcome.skipped.push(name);
                    continue;
                }

                let index = 2;
                let targetPath = '';
                for (; index < MAX_DUPLICATE_INDEX; index++) {
                    targetPath = meta.file(project, `${name}（${index}）`);
                    if (!app.vault.getAbstractFileByPath(targetPath)) break;
                }
                if (index >= MAX_DUPLICATE_INDEX) {
                    outcome.failed.push({ name, error: '同名副本数量超过上限' });
                    continue;
                }

                await app.vault.create(targetPath, content);
                outcome.renamed.push({ name, savedAs: `${name}（${index}）` });
                continue;
            }

            if (existing) {
                outcome.failed.push({ name, error: '目标路径已被文件夹占用' });
                continue;
            }

            await app.vault.create(basePath, content);
            outcome.saved.push(name);
        } catch (e) {
            outcome.failed.push({ name, error: e instanceof Error ? e.message : String(e) });
        }
    }

    return outcome;
}
