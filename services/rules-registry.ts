/**
 * rules-registry.ts — 写作规则的多版本注册与生效选择
 *
 * 事故背景（2026-10-31）：vault 的 `元文件/00-系统模板/写作规则.md` 是旧版（一句一段），
 * 与仓库新版只差 9 行、版本号都是 3.6.0，于是版本检查一路通过，旧规则以约 6:1 的字符权重
 * 覆盖了人味约束。这里把规则变成「可并存的多版本 + 同一时刻只生效一个」：
 *
 *   builtin:3.6.0          仓库新版（自然段 2–6 句，默认生效）
 *   builtin:3.6.0-legacy   旧版快照（对照/消融用）
 *   文件版本                `元文件/00-系统模板/写作规则*.md`、`<项目>/00-系统模板/写作规则*.md`
 *
 * 选择规则：设置里的 activeRulesVersion（id 或版本号）→ project → vault → builtin 优先级回退。
 * 版本号相同但内容哈希不同 → 漂移告警（这正是本次事故的形态）。
 */
import { App, TFile } from 'obsidian';
import { WRITING_RULES, WRITING_RULES_BUILTIN_VERSION } from '../shared/writing-rules';
import { WRITING_RULES_LEGACY, WRITING_RULES_LEGACY_VERSION } from '../shared/writing-rules-legacy';
import { builtinRuleVariants } from '../shared/writing-rules-variants';
import {
    builtinId,
    detectDrift,
    extractVersion,
    hashContent,
    selectActive,
    type SelectResult,
    type VersionedDoc,
} from '../shared/versioned-registry';
import { pjWritingRules } from '../shared/paths';
import { createLogger } from '../shared/logger';

const log = createLogger('RulesRegistry');

/** 仓库新版的版本号（与 WRITING_RULES 同源常量；文件版本用它做漂移对照） */
export const BUILTIN_RULES_VERSION = WRITING_RULES_BUILTIN_VERSION;
/** 目录约定：vault 根与项目内都可能有 `00-系统模板/写作规则*.md` */
const RULES_TEMPLATE_DIRS = ['元文件/00-系统模板', '00-系统模板'];

/** 内置版本：3.6.0 默认 + legacy 对照 + 三个「不同思路」实验版（3.7/3.8/3.9） */
export function builtinRulesDocs(): VersionedDoc[] {
    const docs: VersionedDoc[] = [
        {
            id: builtinId(BUILTIN_RULES_VERSION),
            version: BUILTIN_RULES_VERSION,
            content: WRITING_RULES,
            hash: hashContent(WRITING_RULES),
            source: 'builtin',
            notes: '仓库新版：自然段 2–6 句、对话可并段、允许必要过渡（默认生效）',
        },
        {
            id: builtinId(WRITING_RULES_LEGACY_VERSION),
            version: WRITING_RULES_LEGACY_VERSION,
            content: WRITING_RULES_LEGACY,
            hash: hashContent(WRITING_RULES_LEGACY),
            source: 'builtin',
            notes: '旧版快照：一句一段、一段一个句号（仅用于对照/消融）',
        },
    ];
    for (const variant of builtinRuleVariants()) {
        docs.push({
            id: builtinId(variant.version),
            version: variant.version,
            content: variant.content,
            hash: hashContent(variant.content),
            source: 'builtin',
            notes: variant.notes,
        });
    }
    return docs;
}

export interface RulesVersionListing {
    docs: VersionedDoc[];
    active: SelectResult;
    /** 漂移告警（版本号相同、内容不同） */
    drift: string[];
}

async function readDoc(app: App, path: string, source: 'vault' | 'project'): Promise<VersionedDoc | null> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try {
        const content = await app.vault.read(file);
        const version = extractVersion(content) || 'unknown';
        return {
            id: `${source}:${path}`,
            version,
            content,
            hash: hashContent(content),
            source,
            path,
            notes: source === 'project' ? '项目内规则文件' : 'vault 根模板',
        };
    } catch (e) {
        log.warn('[RulesRegistry] 读取规则文件失败:', path, e);
        return null;
    }
}

/** 扫描某个目录下所有 `写作规则*.md`（含 `写作规则.md` 本身） */
async function scanRuleFiles(app: App, folder: string, source: 'vault' | 'project'): Promise<VersionedDoc[]> {
    try {
        const listed = await app.vault.adapter.list(folder);
        const docs: VersionedDoc[] = [];
        for (const file of listed.files) {
            const name = file.split('/').pop() || '';
            if (!/^写作规则.*\.md$/.test(name)) continue;
            const doc = await readDoc(app, file, source);
            if (doc) docs.push(doc);
        }
        return docs;
    } catch {
        return [];
    }
}

/**
 * 列出全部可用规则版本并解析生效版本。
 * @param activeVersion 设置里的选择（id 或版本号，空 = 按 project/vault/builtin 优先级）
 * @param project 当前项目（可选；有则同时扫描项目内规则文件）
 */
export async function listRulesVersions(
    app: App,
    options: { activeVersion?: string; project?: string } = {},
): Promise<RulesVersionListing> {
    const docs: VersionedDoc[] = [...builtinRulesDocs()];

    for (const dir of RULES_TEMPLATE_DIRS) {
        docs.push(...await scanRuleFiles(app, dir, 'vault'));
    }
    if (options.project) {
        const projectRulesPath = pjWritingRules(options.project);
        const projectDoc = await readDoc(app, projectRulesPath, 'project');
        if (projectDoc) docs.push(projectDoc);
        docs.push(...await scanRuleFiles(app, `${options.project}/00-系统模板`, 'project'));
    }

    // 去重：同 id 只留第一条
    const seen = new Set<string>();
    const unique = docs.filter((doc) => {
        if (seen.has(doc.id)) return false;
        seen.add(doc.id);
        return true;
    });

    const active = selectActive(unique, { activeId: options.activeVersion });
    const drift: string[] = [];
    if (active.doc) {
        const builtinSame = unique.find((doc) => doc.source === 'builtin' && doc.version === active.doc!.version);
        drift.push(...detectDrift(builtinSame || null, active.doc.source === 'builtin' ? null : active.doc));
    }
    return { docs: unique, active, drift };
}

/** 取当前生效规则的纯文本（找不到时回退内置新版） */
export async function resolveActiveRulesText(
    app: App,
    options: { activeVersion?: string; project?: string } = {},
): Promise<{ text: string; doc: VersionedDoc; warnings: string[] }> {
    const listing = await listRulesVersions(app, options);
    const doc = listing.active.doc || builtinRulesDocs()[0];
    return {
        text: doc.content,
        doc,
        warnings: [...listing.active.warnings, ...listing.drift],
    };
}
