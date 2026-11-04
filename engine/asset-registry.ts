/**
 * asset-registry.ts — 写作资产的统一清单与生效来源
 *
 * 模板 / 提示词 / 规则 / 文笔风格 / 指纹 / 知识库此前分散在五个入口，
 * 用户问「这一章为什么写成这样」时无法回答“用了哪个资产、来自哪里”。
 * 这里只做只读聚合：列出资产、标注来源（builtin/vault/project/custom）、
 * 版本/时间与是否生效；不修改任何资产，也不替代各管理器。
 */
import type { App } from 'obsidian';
import { ALL_TEMPLATE_DEFS } from '@/shared/prompt-template-catalog';
import { listRulesVersions } from '@/services/rules-registry';
import { StyleFingerprintLibrary } from './style-fingerprint-library';

/** 资产种类。 */
export type AssetKind = 'rules' | 'prompt-template' | 'style-fingerprint' | 'knowledge-book' | 'writing-profile';

/** 资产来源。 */
export type AssetSource = 'builtin' | 'vault' | 'project' | 'custom' | 'global';

/** 单条资产。 */
export interface AssetEntry {
    kind: AssetKind;
    id: string;
    name: string;
    source: AssetSource;
    /** 版本号 / 更新时间（ISO 或原始字符串） */
    version?: string;
    hash?: string;
    path?: string;
    /** 是否参与生成（指纹/知识库等） */
    enabled?: boolean;
    /** 影响范围说明 */
    impact: string;
}

/** 资产总览。 */
export interface AssetRegistryReport {
    project: string;
    generatedAt: number;
    entries: AssetEntry[];
    /** 生效摘要（一行一条，UI 直接展示） */
    effective: string[];
    summary: Record<AssetKind, number>;
}

/** 可注入的外部管理器（避免本模块自己构造重引擎）。 */
export interface AssetRegistryDeps {
    /** PromptManager（用户自建提示词模板） */
    promptManager?: { getAllTemplates(): Array<{ id: string; name: string; category?: string; versions?: Array<{ version: string; isActive?: boolean }>; isCustom?: boolean }> } | null;
    /** 文笔风格指纹库 */
    fingerprintLibrary?: StyleFingerprintLibrary | null;
    /** 知识库管理器 */
    knowledgeBaseManager?: { getAllBooks(): Promise<Array<{ id: string; name: string; updatedAt?: number; breakdownStatus?: string; primaryGenre?: string }>> } | null;
}

function emptySummary(): Record<AssetKind, number> {
    return {
        rules: 0,
        'prompt-template': 0,
        'style-fingerprint': 0,
        'knowledge-book': 0,
        'writing-profile': 0,
    };
}

async function collectRules(app: App): Promise<AssetEntry[]> {
    try {
        const listing = await listRulesVersions(app);
        const entries: AssetEntry[] = [];
        if (listing.active.doc) {
            entries.push({
                kind: 'rules',
                id: listing.active.doc.id,
                name: '写作规则（唯一来源）',
                source: listing.active.doc.source,
                version: listing.active.doc.version,
                hash: listing.active.doc.hash,
                path: listing.active.doc.path || '元文件/00-系统模板/写作规则.md',
                enabled: true,
                impact: '所有模式写作与正文生成',
            });
        }
        for (const doc of listing.docs) {
            if (listing.active.doc && doc.id === listing.active.doc.id) continue;
            entries.push({
                kind: 'rules',
                id: doc.id,
                name: `写作规则模板 v${doc.version}`,
                source: doc.source,
                version: doc.version,
                hash: doc.hash,
                path: doc.path,
                enabled: false,
                impact: '仅作首次写入模板，不直接生效',
            });
        }
        return entries;
    } catch {
        return [];
    }
}

async function collectPromptTemplates(app: App, deps: AssetRegistryDeps): Promise<AssetEntry[]> {
    const adapter = app.vault.adapter;
    const entries: AssetEntry[] = [];
    for (const def of ALL_TEMPLATE_DEFS) {
        let hasCustom = false;
        try {
            hasCustom = (await adapter.exists(def.systemPath)) || (await adapter.exists(def.userPath));
        } catch {
            hasCustom = false;
        }
        entries.push({
            kind: 'prompt-template',
            id: `template:${def.key}`,
            name: def.name,
            source: hasCustom ? 'vault' : 'builtin',
            path: hasCustom ? def.systemPath : undefined,
            enabled: true,
            impact: `${def.categoryName} · ${hasCustom ? 'vault 覆盖内置' : '内置默认'}`,
        });
    }

    const templates = deps.promptManager?.getAllTemplates?.() ?? [];
    for (const template of templates) {
        const active = template.versions?.find(version => version.isActive) ?? template.versions?.[0];
        entries.push({
            kind: 'prompt-template',
            id: `prompt-manager:${template.id}`,
            name: template.name,
            source: 'custom',
            version: active?.version,
            enabled: true,
            impact: `提示词库${template.category ? ` · ${template.category}` : ''}`,
        });
    }
    return entries;
}

async function collectFingerprints(app: App, project: string, deps: AssetRegistryDeps): Promise<AssetEntry[]> {
    try {
        const library = deps.fingerprintLibrary ?? StyleFingerprintLibrary.get(app, project);
        const enabled = await library.getEnabledFingerprints(project);
        const entries: AssetEntry[] = enabled.map(fp => ({
            kind: 'style-fingerprint' as const,
            id: fp.id,
            name: fp.name,
            source: fp.scope === 'project' ? 'project' : 'global',
            version: fp.extractedAt ? new Date(fp.extractedAt).toISOString().slice(0, 10) : undefined,
            enabled: true,
            impact: `文笔风格注入 · ${fp.scope === 'project' ? '项目级' : '全局启用'}`,
        }));
        // 未启用的指纹也列出来，便于用户理解“为什么没生效”
        const [projectAll, globalAll] = await Promise.all([library.listProject(), library.listGlobal()]);
        const enabledIds = new Set(enabled.map(fp => fp.id));
        for (const fp of [...projectAll, ...globalAll]) {
            if (enabledIds.has(fp.id)) continue;
            entries.push({
                kind: 'style-fingerprint',
                id: fp.id,
                name: fp.name,
                source: fp.scope === 'project' ? 'project' : 'global',
                version: fp.extractedAt ? new Date(fp.extractedAt).toISOString().slice(0, 10) : undefined,
                enabled: false,
                impact: fp.scope === 'project' ? '项目级 · 未启用' : '全局 · 未对本项目启用',
            });
        }
        return entries;
    } catch {
        return [];
    }
}

async function collectKnowledgeBooks(deps: AssetRegistryDeps): Promise<AssetEntry[]> {
    try {
        const books = (await deps.knowledgeBaseManager?.getAllBooks?.()) ?? [];
        return books.map((book: { id: string; name: string; updatedAt?: number; breakdownStatus?: string; primaryGenre?: string }) => ({
            kind: 'knowledge-book' as const,
            id: book.id,
            name: book.name,
            source: 'vault' as const,
            version: book.updatedAt ? new Date(book.updatedAt).toISOString().slice(0, 10) : undefined,
            enabled: book.breakdownStatus === 'completed',
            impact: book.breakdownStatus === 'completed'
                ? `知识库检索可用 · ${book.primaryGenre || '未分类'}`
                : `拆解状态：${book.breakdownStatus}`,
        }));
    } catch {
        return [];
    }
}

/**
 * 收集当前项目可见的全部写作资产。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目 ID（指纹等项目级资产用）
 * @param deps - 可注入的管理器
 * @returns 资产总览
 *
 * @example
 * ```ts
 * const report = await collectAssetRegistry(app, project, {
 *   promptManager: plugin.promptManager,
 *   knowledgeBaseManager: plugin.knowledgeBaseManager,
 * });
 * console.log(report.effective);
 * ```
 */
export async function collectAssetRegistry(
    app: App,
    project: string,
    deps: AssetRegistryDeps = {},
): Promise<AssetRegistryReport> {
    const [rules, prompts, fingerprints, knowledge] = await Promise.all([
        collectRules(app),
        collectPromptTemplates(app, deps),
        collectFingerprints(app, project, deps),
        collectKnowledgeBooks(deps),
    ]);
    const entries = [...rules, ...prompts, ...fingerprints, ...knowledge];
    const summary = emptySummary();
    for (const entry of entries) summary[entry.kind] += 1;

    const effective = entries.filter(entry => entry.enabled).map(entry => {
        const version = entry.version ? ` · v${entry.version}` : '';
        return `${entry.name}${version}（${entry.source}）→ ${entry.impact}`;
    });

    return {
        project,
        generatedAt: Date.now(),
        entries,
        effective,
        summary,
    };
}
