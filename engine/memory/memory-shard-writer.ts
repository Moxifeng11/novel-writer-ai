/**
 * memory-shard-writer.ts — 记忆碎片的自动生成入口（v4.25）
 *
 * 背景：`MEMORY_GENERATION_PROMPTS`（提示词）与读侧（`loadCharacterMemories`）早已存在，
 * 但中间没有任何调用方——记忆碎片只能手工建文件，`${triggeredMemories}` 长期为空。
 * 这里补上写侧：角色灵魂步骤完成后，为「主角」自动生成一次 `<主角名>_记忆碎片.md`
 * （已存在则跳过，不覆盖用户手写内容）。
 *
 * 解析/写盘分离：解析是纯函数可单测；写盘走 vault。
 */
import type { App } from 'obsidian';
import { MEMORY_GENERATION_PROMPTS } from '@/engine/prompts/memory-prompts';
import { fillTemplate } from '@/engine/prompts/template-utils';
import { pjMemoryShardsDir } from '@/shared/paths';
import { mkdirp } from '@/utils/helpers';
import { createLogger } from '@/shared/logger';

const log = createLogger('MemoryShards');

/**
 * 记忆碎片草稿。
 */
export interface MemoryShardDraft {
    id: string;
    title: string;
    body: string;
}

/**
 * 从模型输出里解析 `## mXXX 标题` 段；无 trigger 标签且正文过短的空段丢弃；id 重排为 m001…
 *
 * @param raw - 原始
 * @returns 结果数组
 */
export function parseMemoryShardsFromModel(raw: string): MemoryShardDraft[] {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    const drafts: MemoryShardDraft[] = [];
    const sections = text.split(/^##\s+/gm);
    for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        const headerMatch = trimmed.match(/^(m\d+)?\s*(.+)\n/);
        if (!headerMatch) continue;
        const title = headerMatch[2].trim();
        const body = trimmed.slice(headerMatch[0].length).trim();
        if (!title || !body) continue;
        const hasTrigger = /trigger_(smells|sounds|touches|visuals|keywords)\s*:/i.test(body);
        if (!hasTrigger && body.length < 30) continue;
        drafts.push({ id: '', title, body });
    }
    return drafts.map((draft, index) => ({ ...draft, id: `m${String(index + 1).padStart(3, '0')}` }));
}

/**
 * 序列化为 `<角色>_记忆碎片.md` 的正文（与 memory-trigger.parseMemoryFile 同构）
 *
 * @param shards - 分片列表
 * @returns 文本结果
 */
export function formatMemoryShardFile(shards: MemoryShardDraft[]): string {
    const lines = [
        `# 记忆碎片`,
        '',
        '> 由角色灵魂步骤自动生成（v4.25）。感官触发器用于场景中的 involuntary flashback。',
        '',
    ];
    for (const shard of shards) {
        lines.push(`## ${shard.id} ${shard.title}`, '', shard.body, '');
    }
    return lines.join('\n');
}

/**
 * 记忆碎片写入选项。
 */
export interface MemoryShardRunOptions {
    /** 已存在同名碎片文件时跳过（默认 true，保护手写内容） */
    skipIfExists?: boolean;
    signal?: AbortSignal;
}

/**
 * 为主角生成记忆碎片文件；失败只记日志（记忆是增强层，不应阻塞章节流程）。
 * @param app - Obsidian 应用实例
 * @param options - 配置项
 * @returns 生成的文件路径；未生成返回 null（无灵魂层/已存在/模型空返回）
 */
export async function ensureProtagonistMemoryShards(
    app: App,
    options: {
        project: string;
        characterName: string;
        soulDetail: string;
        relationships?: string;
        callAI: (system: string, user: string) => Promise<string>;
        skipIfExists?: boolean;
    },
): Promise<string | null> {
    const name = String(options.characterName || '').trim();
    const soul = String(options.soulDetail || '').trim();
    if (!name || !soul) return null;

    const dir = pjMemoryShardsDir(options.project);
    const path = `${dir}/${name}_记忆碎片.md`;
    if (options.skipIfExists !== false && app.vault.getAbstractFileByPath(path)) return null;

    const vars: Record<string, string> = {
        characterName: name,
        soulFields: soul,
        relationships: String(options.relationships || '').trim(),
    };
    for (const key of ['characterName', 'soulFields', 'relationships']) {
        if (vars[key] === undefined) vars[key] = '';
    }
    const system = fillTemplate(MEMORY_GENERATION_PROMPTS.systemPrompt, vars);
    const user = fillTemplate(MEMORY_GENERATION_PROMPTS.userPrompt, vars);

    let raw = '';
    try {
        raw = await options.callAI(system, user);
    } catch (e) {
        log.warn('[MemoryShards] 记忆碎片生成调用失败（跳过，不影响章节流程）:', e);
        return null;
    }
    const shards = parseMemoryShardsFromModel(raw);
    if (shards.length === 0) {
        log.warn('[MemoryShards] 模型未返回可解析的记忆碎片，跳过写盘');
        return null;
    }

    try {
        await mkdirp(app, dir);
        await app.vault.create(path, formatMemoryShardFile(shards));
        log.info(`[MemoryShards] 已为主角「${name}」生成 ${shards.length} 个记忆碎片: ${path}`);
        return path;
    } catch (e) {
        log.warn('[MemoryShards] 记忆碎片写盘失败:', e);
        return null;
    }
}
