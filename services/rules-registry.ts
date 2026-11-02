/**
 * rules-registry.ts — 写作规则的单一来源解析（v4 引导版）
 *
 * v4 改版（2026-11-03）：
 * - **唯一生效来源 = vault 的 `元文件/00-系统模板/写作规则.md`**；
 *   内置常量（`shared/writing-rules.ts`）只在文件缺失时作为首次写入模板。
 * - 不再扫描项目目录（项目副本由迁移删除），不再注册 3.6.0-legacy / 3.7 / 3.8 / 3.9
 *   等多版本——「绝对唯一来源」意味着没有可选项、没有漂移告警。
 * - 模式差异（长篇/短篇/剧本）由 `shared/writing-rules-mode-addons.ts` 在
 *   RulesService 组合规则文本时拼接，不进入本文件。
 */
import { App, TFile } from 'obsidian';
import { WRITING_RULES, WRITING_RULES_BUILTIN_VERSION } from '../shared/writing-rules';
import {
    builtinId,
    canonicalContent,
    extractVersion,
    hashContent,
    type VersionedDoc,
} from '../shared/versioned-registry';
import { createLogger } from '../shared/logger';

const log = createLogger('RulesRegistry');

/** 仓库内置模板的版本号（= 迁移目标版本） */
export const BUILTIN_RULES_VERSION = WRITING_RULES_BUILTIN_VERSION;

/** vault 内唯一生效的规则文件路径（相对 vault 根） */
export const VAULT_RULES_PATH = '元文件/00-系统模板/写作规则.md';

/**
 * 内置模板文档（唯一一个；文件缺失时的首次写入来源）。
 *
 * @returns 结果数组
 *
 * @example
 * ```ts
 * const docs = builtinRulesDocs();
 * console.log(docs[0].version); // '4.0.0'
 * console.log(docs.length); // 1（唯一来源在 vault 元文件）
 * ```
 */
export function builtinRulesDocs(): VersionedDoc[] {
    return [
        {
            id: builtinId(BUILTIN_RULES_VERSION),
            version: BUILTIN_RULES_VERSION,
            content: WRITING_RULES,
            hash: hashContent(canonicalContent(WRITING_RULES)),
            source: 'builtin',
            notes: 'v4 引导版模板（唯一来源是 vault 元文件；本条仅作首次写入模板）',
        },
    ];
}

/**
 * RulesVersionListing 类型定义。
 */
export interface RulesVersionListing {
    docs: VersionedDoc[];
    active: { doc: VersionedDoc | null; effectiveId: string; fellBack: boolean; warnings: string[] };
    /** v4 单一来源下恒为空数组（保留字段以兼容既有调用方） */
    drift: string[];
}

/**
 * 读取 vault 唯一规则文件；不存在或读取失败返回 null。
 *
 * @param app - Obsidian 应用实例
 * @returns VersionedDoc 或 null
 *
 * @example
 * ```ts
 * const doc = await readVaultRulesDoc(app);
 * console.log(doc?.version);
 * ```
 */
export async function readVaultRulesDoc(app: App): Promise<VersionedDoc | null> {
    const file = app.vault.getAbstractFileByPath(VAULT_RULES_PATH);
    if (!(file instanceof TFile)) return null;
    try {
        const content = await app.vault.read(file);
        return {
            id: `vault:${VAULT_RULES_PATH}`,
            version: extractVersion(content) || 'unknown',
            content,
            hash: hashContent(canonicalContent(content)),
            source: 'vault',
            path: VAULT_RULES_PATH,
            notes: '唯一来源：vault 元文件',
        };
    } catch (e) {
        log.warn('[RulesRegistry] 读取规则文件失败:', VAULT_RULES_PATH, e);
        return null;
    }
}

/**
 * 列出规则来源并解析生效文档（v4：vault 文件 → 内置模板）。
 * `project` / `activeVersion` 参数已废弃（保留以兼容旧调用方签名，不再参与解析）。
 *
 * @param app - Obsidian 应用实例
 * @param _options - 兼容参数（忽略）
 * @returns RulesVersionListing 实例
 *
 * @example
 * ```ts
 * const listing = await listRulesVersions(app);
 * console.log(listing.active.doc?.path);
 * ```
 */
export async function listRulesVersions(
    app: App,
    _options: { activeVersion?: string; project?: string } = {},
): Promise<RulesVersionListing> {
    const docs: VersionedDoc[] = [...builtinRulesDocs()];
    const vaultDoc = await readVaultRulesDoc(app);
    if (vaultDoc) docs.unshift(vaultDoc);
    return {
        docs,
        active: { doc: vaultDoc, effectiveId: vaultDoc?.id ?? docs[0].id, fellBack: !vaultDoc, warnings: [] },
        drift: [],
    };
}

/**
 * 取当前生效规则的纯文本（vault 文件 → 内置模板兜底）
 *
 * @param app - Obsidian 应用实例
 * @param _options - 兼容参数（忽略）
 * @returns text 与来源文档
 *
 * @example
 * ```ts
 * const { text } = await resolveActiveRulesText(app);
 * ```
 */
export async function resolveActiveRulesText(
    app: App,
    _options: { activeVersion?: string; project?: string } = {},
): Promise<{ text: string; doc: VersionedDoc; warnings: string[] }> {
    const listing = await listRulesVersions(app);
    const doc = listing.active.doc || listing.docs[0];
    return { text: doc.content, doc, warnings: [] };
}
