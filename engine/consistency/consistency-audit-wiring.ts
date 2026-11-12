/**
 * consistency-audit-wiring.ts — 把审核服务接到真实 vault 与真实 AI
 *
 * 职责边界：这里只做「取数据 + 调 AI」，判定逻辑全在 consistency-service 与
 * pairing-* 里（纯函数，可单测）。这样接线层薄、易审。
 *
 * 取数来源（全部是既有资产，无新增持久化契约）：
 *  - 章节摘要：`04-项目总控/剧情记忆/*_摘要.md` → `parseChapterDigest`
 *  - 人物档案：`engineRegistry.getCharacterRepository(project).findAll()`
 *  - 台账事件/伏笔：`loadStoryLedger(app, project)`
 *  - 已确认事实：`engineRegistry.getFactIndexManager(project).listConfirmed()`
 *  - 章节正文：`03-大纲与章节/正文/**\/*_正文.md`（按章号映射）
 *  - AI：`plugin.aiEngine.callAI`（非流式；复核只需短输出）
 */

import { App } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { pjChapterDigestDir, pjOutlineDir } from '@/shared/paths';
import { parseChapterDigest, type ChapterDigest } from '@/engine/memory/chapter-digest';
import { loadStoryLedger } from '@/engine/ledger/ledger-io';
import {
    runProjectConsistencyAudit,
    type CharacterProfileInput,
    type ConfirmedFactInput,
    type ConsistencyAuditDeps,
    type ConsistencyAuditResult,
    type LedgerEventInput,
} from './consistency-service';
import type { LlmCaller } from './pairing-llm';

/** 审核选项（对外） */
export interface RunAuditForProjectOptions {
    /** 是否启用 LLM 复核（默认 true，但仅有疑似配对时才会真的调用） */
    useLlm?: boolean;
    /** 最多复核对数（默认 10，控制成本） */
    maxPairs?: number;
}

/** 复核时的最大输出 token（判定很短，给足一点余量） */
const JUDGE_MAX_TOKENS = 200;

/**
 * 对项目跑一次一致性审核。
 *
 * @param app - Obsidian 应用
 * @param plugin - 插件实例
 * @param project - 项目路径
 * @param options - 选项
 * @returns 审核结果
 */
export async function runAuditForProject(
    app: App,
    plugin: NovelWriterPlugin,
    project: string,
    options: RunAuditForProjectOptions = {},
): Promise<ConsistencyAuditResult & { warnings: string[] }> {
    // 数据源读失败不静默：记下来随结果返回，UI 侧提示「审核不完整」
    const warnings: string[] = [];
    const deps = await buildDeps(app, plugin, project, options, warnings);
    const result = await runProjectConsistencyAudit(project, deps, {
        useLlm: options.useLlm !== false,
        maxPairs: options.maxPairs ?? 10,
    });
    return { ...result, warnings };
}

/**
 * 组装依赖。
 *
 * @param app - Obsidian 应用
 * @param plugin - 插件实例
 * @param project - 项目路径
 * @param options - 选项
 * @returns 依赖集合
 */
async function buildDeps(
    app: App,
    plugin: NovelWriterPlugin,
    project: string,
    options: RunAuditForProjectOptions,
    warnings: string[],
): Promise<ConsistencyAuditDeps> {
    const fs = new ObsidianFileSystem(app);
    const chapterBodyIndex = await buildChapterBodyIndex(app, project);

    return {
        fs,
        listDigests: () => loadDigests(app, fs, project, warnings),
        listCharacters: () => loadCharacters(plugin, project, warnings),
        listLedgerEvents: () => loadLedgerEvents(app, project, warnings),
        listConfirmedFacts: () => loadConfirmedFacts(plugin, project, warnings),
        loadChapterBody: async (chapterKey: string) => {
            const path = chapterBodyIndex.get(chapterNumOf(chapterKey) ?? -1);
            if (!path) return '';
            try {
                return await fs.read(path);
            } catch {
                // silent-ok: 正文读失败只影响「能否把引文定位成偏移」，判定结果仍有效
                return '';
            }
        },
        callLLM: options.useLlm === false
            ? undefined
            : buildLlmCaller(plugin),
    };
}

/**
 * 读全部章节摘要。
 *
 * @param app - Obsidian 应用
 * @param fs - 文件端口
 * @param project - 项目路径
 * @returns 章节摘要列表
 */
async function loadDigests(
    app: App,
    fs: ObsidianFileSystem,
    project: string,
    warnings: string[],
): Promise<ChapterDigest[]> {
    const dir = pjChapterDigestDir(project);
    let files;
    try {
        files = await fs.listFiles(dir);
    } catch (error) {
        warnings.push(`章节摘要目录不可读，已跳过章摘要断言（${describeError(error)}）`);
        return [];
    }
    const digests: ChapterDigest[] = [];
    for (const file of files) {
        if (!file.name.endsWith('.md')) continue;
        try {
            const content = await fs.read(file.path);
            const parsed = parseChapterDigest(content, file.name.replace(/_摘要\.md$/, ''));
            if (parsed) digests.push(parsed);
        } catch {
            // 单章摘要读失败不影响其余章节
        }
    }
    return digests;
}

/**
 * 读人物档案。
 *
 * @param plugin - 插件实例
 * @param project - 项目路径
 * @returns 人物档案输入
 */
async function loadCharacters(
    plugin: NovelWriterPlugin,
    project: string,
    warnings: string[],
): Promise<CharacterProfileInput[]> {
    try {
        const repo = plugin.engineRegistry.getCharacterRepository(project);
        const characters = await repo.findAll();
        const out: CharacterProfileInput[] = [];
        for (const character of characters as unknown as Array<Record<string, unknown>>) {
            const name = typeof character.name === 'string' ? character.name : '';
            if (!name) continue;
            const rawFrontmatter = character.frontmatter;
            const frontmatter = extractFrontmatterObject(rawFrontmatter);
            out.push({ name, frontmatter });
        }
        return out;
    } catch (error) {
        warnings.push(`人物档案不可读，已跳过人物断言（${describeError(error)}）`);
        return [];
    }
}

/**
 * 从仓储对象里取出 frontmatter 普通对象（兼容 toObject 与纯对象两种形状）。
 *
 * @param raw - 原始值
 * @returns 普通键值对象
 */
function extractFrontmatterObject(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'object' && typeof (raw as { toObject?: unknown }).toObject === 'function') {
        return (raw as { toObject: () => Record<string, unknown> }).toObject();
    }
    if (typeof raw === 'object') return { ...(raw as Record<string, unknown>) };
    return {};
}

/**
 * 读台账事件与已废弃伏笔。
 *
 * @param app - Obsidian 应用
 * @param project - 项目路径
 * @returns 事件列表
 */
async function loadLedgerEvents(app: App, project: string, warnings: string[]): Promise<LedgerEventInput[]> {
    try {
        const ledger = await loadStoryLedger(app, project);
        return ledger.events.map(event => ({
            name: event.name,
            time: event.time,
            location: event.location,
            chapterKey: event.chapterKey,
            chapterNum: event.chapterNum,
            raw: event.raw,
        }));
    } catch (error) {
        warnings.push(`时间线/伏笔台账不可读，已跳过事件断言（${describeError(error)}）`);
        return [];
    }
}

/**
 * 读已确认事实（命名基准）。
 *
 * @param plugin - 插件实例
 * @param project - 项目路径
 * @returns 已确认事实
 */
async function loadConfirmedFacts(
    plugin: NovelWriterPlugin,
    project: string,
    warnings: string[],
): Promise<ConfirmedFactInput[]> {
    try {
        const manager = await plugin.engineRegistry.getFactIndexManager(project);
        return manager.listConfirmed().map((fact: { name: string; category: string }) => ({
            name: fact.name,
            category: fact.category,
        }));
    } catch (error) {
        warnings.push(`已确认事实索引不可读，命名基准可能不全（${describeError(error)}）`);
        return [];
    }
}

/**
 * 把未知异常转成可读原因（用于数据源告警）。
 *
 * @param error - 异常
 * @returns 可读文本
 */
function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

/**
 * 构造正文索引：章号 → 文件路径。
 *
 * @param app - Obsidian 应用
 * @param project - 项目路径
 * @returns 映射
 */
async function buildChapterBodyIndex(app: App, project: string): Promise<Map<number, string>> {
    const index = new Map<number, string>();
    const fs = new ObsidianFileSystem(app);
    const root = `${pjOutlineDir(project)}/正文`;
    try {
        const files = await fs.listFiles(root);
        for (const file of files) {
            const match = /第(\d+)章_正文\.md$/.exec(file.name) || /第(\d+)章[^/]*\.md$/.exec(file.name);
            if (!match) continue;
            const num = Number(match[1]);
            if (Number.isFinite(num) && !index.has(num)) index.set(num, file.path);
        }
    } catch {
        // 正文目录不存在：审核仍可跑（只是没有 offset）
    }
    return index;
}

/**
 * 从章节 key 里取章号（支持「第12章」「第1卷第12章」等写法）。
 *
 * @param chapterKey - 章节 key
 * @returns 章号；取不到返回 null
 */
export function chapterNumOf(chapterKey: string): number | null {
    const match = /第\s*(\d+)\s*章/.exec(chapterKey || '');
    if (!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : null;
}

/**
 * 构造 LLM 复核调用器（复用插件的 AI 客户端，享受密钥回退等既有能力）。
 *
 * @param plugin - 插件实例
 * @returns 调用器；插件不支持时返回 undefined
 */
function buildLlmCaller(plugin: NovelWriterPlugin): LlmCaller | undefined {
    const engine = (plugin as unknown as { aiEngine?: { callAI?: (...args: unknown[]) => Promise<{ content?: string; error?: string }> } }).aiEngine;
    if (!engine || typeof engine.callAI !== 'function') return undefined;
    const callAI = engine.callAI.bind(engine);
    return async ({ systemPrompt, userPrompt }) => {
        const response = await callAI(systemPrompt, userPrompt, undefined, 0.1, JUDGE_MAX_TOKENS);
        return { content: response?.content ?? '', error: response?.error };
    };
}
