/**
 * chapter-digest.ts — 剧情记忆（章节摘要）
 *
 * 章节结算后从故事台账生成确定性摘要，供后续章节注入：
 *  - 近 3 章完整摘要 + 更早章节单行，替代「只读上一章正文切片」；
 *  - 生成过程不调用 AI，失败不阻断结算；
 *  - 摘要文件是派生数据，可从台账重建。
 */
import { App } from 'obsidian';
import { pjChapterDigestDir, pjChapterDigestFile } from '@/shared/paths';
import { listFolderFiles } from '@/shared/vault-tree';
import { withWriteLock } from '@/shared/write-lock';
import type { FileSystemPort } from '@/shared/file-system-port';
import { chapterNumOf, normalizeLedgerName } from '@/engine/ledger/ledger-model';
import { loadStoryLedger } from '@/engine/ledger/ledger-io';
import { openPromises } from '@/engine/ledger/ledger-index';

/** 章节摘要 */
export interface ChapterDigest {
    chapterKey: string;
    chapterNum: number | null;
    title: string;
    involved: string[];
    events: string[];
    unresolved: string[];
    facts: string[];
    promises: string[];
    endingHook: string;
    timeSpan: string;
    generatedAt: string;
}

/** 生成输入 */
export interface ChapterDigestInput {
    chapterKey: string;
    title?: string;
    bodyText: string;
    involved?: string[];
    events?: string[];
    unresolved?: string[];
    facts?: string[];
    promises?: string[];
    timeSpan?: string;
    generatedAt?: string;
}

/**
 * 去重并限制条数
 *
 * @param values - 原始列表
 * @param limit - 上限
 * @returns 去重后的列表
 */
function uniqueLimited(values: string[], limit: number): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const text = String(value ?? '').trim();
        const key = normalizeLedgerName(text);
        if (!text || seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

/**
 * 从正文尾段提取结尾钩子（最后一句/最后 160 字）
 *
 * @param body - 正文
 * @returns 钩子文本
 */
function extractEndingHook(body: string): string {
    const trimmed = String(body ?? '').trim();
    if (!trimmed) return '';
    const tail = trimmed.slice(-160);
    const lastBreak = Math.max(tail.lastIndexOf('。'), tail.lastIndexOf('！'), tail.lastIndexOf('？'), tail.lastIndexOf('\n'));
    return (lastBreak >= 0 ? tail.slice(0, lastBreak + 1) : tail).trim();
}

/**
 * 构建章节摘要（纯函数）
 *
 * @param input - 输入
 * @returns ChapterDigest
 */
export function buildChapterDigest(input: ChapterDigestInput): ChapterDigest {
    return {
        chapterKey: input.chapterKey,
        chapterNum: chapterNumOf(input.chapterKey),
        title: input.title || input.chapterKey,
        involved: uniqueLimited(input.involved ?? [], 12),
        events: uniqueLimited(input.events ?? [], 8),
        unresolved: uniqueLimited(input.unresolved ?? [], 8),
        facts: uniqueLimited(input.facts ?? [], 8),
        promises: uniqueLimited(input.promises ?? [], 8),
        endingHook: extractEndingHook(input.bodyText),
        timeSpan: input.timeSpan || '',
        generatedAt: input.generatedAt || new Date().toISOString(),
    };
}

/**
 * 渲染摘要文件（frontmatter + 人读正文）
 *
 * @param digest - 摘要
 * @returns Markdown
 */
export function formatChapterDigest(digest: ChapterDigest): string {
    const list = (values: string[]): string => JSON.stringify(values);
    const frontmatter = [
        '---',
        'tags: [剧情记忆, nw/设定/剧情记忆]',
        `章: ${digest.chapterKey}`,
        `标题: ${digest.title}`,
        `在场人物: ${list(digest.involved)}`,
        `关键事件: ${list(digest.events)}`,
        `未回收线索: ${list(digest.unresolved)}`,
        `新事实: ${list(digest.facts)}`,
        `未兑现承诺: ${list(digest.promises)}`,
        `结尾钩子: ${JSON.stringify(digest.endingHook)}`,
        `时间跨度: ${digest.timeSpan}`,
        `生成时间: ${digest.generatedAt}`,
        '---',
        '',
        `# ${digest.chapterKey} 剧情摘要`,
        '',
        `- 在场人物：${digest.involved.join('、') || '（无）'}`,
        `- 关键事件：${digest.events.join('；') || '（无）'}`,
        `- 未回收线索：${digest.unresolved.join('；') || '（无）'}`,
        `- 未兑现承诺：${digest.promises.join('；') || '（无）'}`,
        `- 结尾钩子：${digest.endingHook || '（无）'}`,
        '',
    ];
    return frontmatter.join('\n');
}

/**
 * 解析摘要文件（读取时用；解析失败返回 null）
 *
 * @param content - 文件内容
 * @param fallbackChapter - 文件名兜底章名
 * @returns ChapterDigest 或 null
 */
export function parseChapterDigest(content: string, fallbackChapter = ''): ChapterDigest | null {
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
    if (!fmMatch) return null;
    const fm = fmMatch[1];
    const get = (key: string): string => {
        const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm);
        return match ? match[1].trim() : '';
    };
    const parseList = (key: string): string[] => {
        const raw = get(key);
        if (!raw) return [];
        try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
        } catch {
            return raw.replace(/^\[|\]$/g, '').split(/[,，、]/).map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        }
    };
    const parseText = (key: string): string => {
        const raw = get(key);
        try {
            const parsed: unknown = JSON.parse(raw);
            return typeof parsed === 'string' ? parsed : raw;
        } catch {
            return raw;
        }
    };
    const chapterKey = get('章') || fallbackChapter;
    if (!chapterKey) return null;
    return {
        chapterKey,
        chapterNum: chapterNumOf(chapterKey),
        title: get('标题') || chapterKey,
        involved: parseList('在场人物'),
        events: parseList('关键事件'),
        unresolved: parseList('未回收线索'),
        facts: parseList('新事实'),
        promises: parseList('未兑现承诺'),
        endingHook: parseText('结尾钩子'),
        timeSpan: get('时间跨度'),
        generatedAt: get('生成时间'),
    };
}

/**
 * 写入摘要文件并更新索引（失败抛错，由调用方决定是否降级）
 *
 * @param app - Obsidian 应用
 * @param fs - 文件端口
 * @param project - 项目
 * @param digest - 摘要
 */
export async function writeChapterDigest(
    app: App,
    fs: FileSystemPort,
    project: string,
    digest: ChapterDigest,
): Promise<void> {
    const path = pjChapterDigestFile(project, digest.chapterKey);
    await fs.mkdir(pjChapterDigestDir(project)).catch(() => {});
    await withWriteLock(path, async () => {
        await fs.write(path, formatChapterDigest(digest));
    });
    await updateDigestIndex(app, fs, project, digest);
}

/**
 * 更新摘要索引（JSON，只增不删；仅用于快速列出，不参与 prompt）
 *
 * @param app - Obsidian 应用
 * @param fs - 文件端口
 * @param project - 项目
 * @param digest - 摘要
 */
async function updateDigestIndex(app: App, fs: FileSystemPort, project: string, digest: ChapterDigest): Promise<void> {
    const dir = pjChapterDigestDir(project);
    const indexPath = `${dir}/index.json`;
    let entries: Array<Record<string, unknown>> = [];
    try {
        const file = app.vault.getAbstractFileByPath(indexPath);
        if (file) {
            const raw = await fs.read(indexPath);
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) entries = parsed as Array<Record<string, unknown>>;
        }
    } catch {
        entries = [];
    }
    entries = entries.filter((entry) => String(entry['章'] ?? '') !== digest.chapterKey);
    entries.push({
        章: digest.chapterKey,
        标题: digest.title,
        关键事件: digest.events,
        未回收线索: digest.unresolved,
        生成时间: digest.generatedAt,
    });
    entries.sort((a, b) => (chapterNumOf(a['章']) ?? 0) - (chapterNumOf(b['章']) ?? 0));
    await fs.write(indexPath, JSON.stringify(entries, null, 2));
}

/**
 * 读取最近 N 章摘要（按章号升序返回，方便直接拼接）
 *
 * @param app - Obsidian 应用
 * @param fs - 文件端口
 * @param project - 项目
 * @param currentChapter - 当前章号
 * @param count - 数量
 * @returns 摘要列表
 */
export async function loadRecentChapterDigests(
    app: App,
    fs: FileSystemPort,
    project: string,
    currentChapter: number | null,
    count = 3,
): Promise<ChapterDigest[]> {
    const dir = pjChapterDigestDir(project);
    const files = listFolderFiles<{ path: string; name: string }>(app.vault, dir)
        .filter((file) => file.name.endsWith('.md'));
    const digests: ChapterDigest[] = [];
    for (const file of files) {
        const num = chapterNumOf(file.name);
        if (num === null) continue;
        if (currentChapter !== null && num >= currentChapter) continue;
        try {
            const content = await fs.read(file.path);
            const digest = parseChapterDigest(content, file.name.replace(/\.md$/, ''));
            if (digest) digests.push(digest);
        } catch {
            // 单文件损坏不影响其他摘要
        }
    }
    return digests
        .sort((a, b) => (a.chapterNum ?? 0) - (b.chapterNum ?? 0))
        .slice(-Math.max(1, count));
}

/**
 * 把摘要渲染成 prompt 段（近 3 章完整，更早单行由调用方裁剪）
 *
 * @param digests - 摘要列表
 * @returns 文本
 */
export function renderChapterDigestBlock(digests: ChapterDigest[]): string {
    if (digests.length === 0) return '';
    return digests.map((digest) => {
        const events = digest.events.join('；') || '（无关键事件）';
        const threads = digest.unresolved.length > 0 ? `；未回收：${digest.unresolved.join('、')}` : '';
        return `- ${digest.chapterKey}：${events}${threads}`;
    }).join('\n');
}

/**
 * 结算后从台账生成并写入本章摘要。
 *
 * @param app - Obsidian 应用
 * @param fs - 文件端口
 * @param project - 项目
 * @param chapterKey - 章名
 * @param bodyText - 正文
 * @param involved - 本章涉及人物（可空）
 * @returns 生成的摘要
 */
export async function writeChapterDigestFromProject(
    app: App,
    fs: FileSystemPort,
    project: string,
    chapterKey: string,
    bodyText: string,
    involved: string[] = [],
): Promise<ChapterDigest> {
    const ledger = await loadStoryLedger(app, project);
    const chapterNum = chapterNumOf(chapterKey);
    const chapterEvents = ledger.events.filter((event) => event.chapterNum !== null && event.chapterNum === chapterNum);
    const unresolved = ledger.foreshadows
        .filter((record) => record.status === 'unrevealed' && (record.buryChapter === chapterKey || (chapterNum !== null && (chapterNumOf(record.buryChapter) ?? 0) <= chapterNum)))
        .map((record) => record.name);
    const promiseNames = openPromises(ledger, chapterNum).map((promise) => promise.name);
    const eventNames = chapterEvents.map((event) => event.name);
    const eventPeople = chapterEvents.flatMap((event) => event.entityRefs.map((ref) => ref.name));
    const times = chapterEvents.map((event) => event.time).filter(Boolean);
    const digest = buildChapterDigest({
        chapterKey,
        bodyText,
        involved: [...involved, ...eventPeople],
        events: eventNames,
        unresolved,
        promises: promiseNames,
        timeSpan: times.length > 1 ? `${times[0]} → ${times[times.length - 1]}` : (times[0] || ''),
    });
    await writeChapterDigest(app, fs, project, digest);
    return digest;
}
