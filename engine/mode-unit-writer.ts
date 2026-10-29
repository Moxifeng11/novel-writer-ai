/**
 * mode-unit-writer.ts — 短篇「节」/ 剧本「集」的单元写作引擎
 *
 * 短篇/剧本此前只有骨架和原生 Markdown 编辑器：没有 AI、没有状态回写，
 * 进度永远停在 0。这里补齐「读上下文 → 生成/续写/改写 → 落盘 + 回写
 * status/word_count」这条最小闭环，界面部分在 unit-writer-controller。
 *
 * 纯逻辑（提示词、frontmatter 合并、字数统计）与磁盘 I/O 分离，
 * 通过 UnitFilePort 注入，便于在 Node 里直接测。
 */
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { CreationMode } from '../shared/creation-mode';
import { getCreationModePromptBlock, getCreationModeLabel, parseCreationModeMeta } from '../shared/creation-mode';
import {
    listModeUnits,
    modeBodyDir,
    modeDocPath,
    modeUnitDisplay,
    modeUnitFileName,
} from '../shared/mode-content';
import { extractUnitOutlineSection } from '../shared/mode-unit-outline';
import { readPreResearchData } from '../shared/pre-research';
import { readProjectMeta } from '../shared/paths';
import { createLogger } from '../shared/logger';

const log = createLogger('ModeUnitWriter');

export type UnitWriteAction = 'generate' | 'continue' | 'rewrite';

export interface UnitWriterContext {
    mode: CreationMode;
    project: string;
    unitNumber: number;
    unitName: string;
    unitPath: string;
    outlineSection: string;
    outlineDoc: string;
    storyDoc: string;
    characters: string;
    previousTail: string;
    modeGuide: string;
    targetWords: number;
    existingBody: string;
}

export interface UnitAIEngine {
    callAI(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature?: number,
        maxTokens?: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal },
    ): Promise<{ content: string; error?: string }>;
    callAIAsyncIterator?(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature?: number,
        maxTokens?: number,
        options?: { isWritingTask?: boolean; signal?: AbortSignal },
    ): AsyncGenerator<string, unknown, unknown>;
}

export interface UnitFilePort {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    updateFrontmatter(path: string, patch: Record<string, unknown>): Promise<void>;
}

export interface UnitGenerateOptions {
    model: string;
    maxTokens: number;
    instruction?: string;
    selection?: string;
    signal?: AbortSignal;
    onDelta?: (chunk: string) => void;
}

// ============================================================
// 纯函数：frontmatter / 字数
// ============================================================

export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
    const raw = String(text ?? '');
    const matched = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (!matched) return { frontmatter: '', body: raw };
    return { frontmatter: matched[0], body: raw.slice(matched[0].length) };
}

function formatFrontmatterValue(value: unknown): string {
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `[${value.map(item => String(item)).join(', ')}]`;
    const text = String(value ?? '');
    if (!text) return '""';
    if (/^[^\s"'#:[\]{},&*!|>%@`][^:#]*$/.test(text)) return text;
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 在原始文本上就地更新 frontmatter 字段；没有 frontmatter 时补一个 */
export function patchFrontmatterText(raw: string, patch: Record<string, unknown>): string {
    const source = String(raw ?? '');
    const { frontmatter, body } = splitFrontmatter(source);
    const entries = Object.entries(patch);
    if (entries.length === 0) return source;

    if (!frontmatter) {
        const lines = entries.map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`);
        return `---\n${lines.join('\n')}\n---\n\n${source}`;
    }

    const header = frontmatter.replace(/\r\n/g, '\n');
    const closingIndex = header.lastIndexOf('\n---');
    const head = header.slice(0, closingIndex);
    const tail = header.slice(closingIndex);
    const lines = head.split('\n');

    for (const [key, value] of entries) {
        const rendered = `${key}: ${formatFrontmatterValue(value)}`;
        const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:.*$`);
        const index = lines.findIndex(line => pattern.test(line));
        if (index >= 0) lines[index] = rendered;
        else lines.push(rendered);
    }

    return `${lines.join('\n')}\n${tail.slice(1)}${body}`;
}

/** 正文字数：去掉 frontmatter、标题符号与空白后的字符数 */
export function countUnitWords(text: string): number {
    const body = splitFrontmatter(text).body;
    return body
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/[*_`>]/g, '')
        .replace(/\s+/g, '')
        .length;
}

// ============================================================
// 提示词
// ============================================================

export function buildUnitPrompt(
    ctx: UnitWriterContext,
    action: UnitWriteAction,
    options: { instruction?: string; selection?: string } = {},
): { system: string; user: string } {
    const label = ctx.mode === 'script' ? '短剧剧本' : '短篇小说';
    const formatRule = ctx.mode === 'script'
        ? [
            '输出剧本格式：场次标题（日/夜 内/外 场景）、人物名、△动作/画面、对白；',
            '不要写小说化的心理描写与长段叙述，画面必须可拍。',
        ].join('\n')
        : [
            '输出自然段叙事，避免连续短句和提纲式罗列；',
            '对白与动作交替推进，每段都要有信息增量。',
        ].join('\n');

    const system = [
        `你是${label}写作引擎，正在写《${ctx.project}》的${ctx.unitName}。`,
        ctx.modeGuide,
        '写作要求：',
        '- 只输出正文，不要解释创作思路，不要复述大纲；',
        '- 严格遵守已给设定与人物关系，不新增关键设定；',
        '- 本节结尾必须留下推动下一节的钩子；',
        formatRule,
        options.instruction ? `本次额外要求：${options.instruction}` : '',
    ].filter(Boolean).join('\n');

    const contextBlock = [
        ctx.outlineSection ? `【本节大纲】\n${ctx.outlineSection}` : '',
        ctx.storyDoc ? `【${ctx.mode === 'script' ? '场景圣经' : '故事核'}】\n${ctx.storyDoc}` : '',
        ctx.characters ? `【人物】\n${ctx.characters}` : '',
        ctx.previousTail ? `【上一${ctx.mode === 'script' ? '集' : '节'}结尾】\n${ctx.previousTail}` : '',
    ].filter(Boolean).join('\n\n');

    if (action === 'rewrite') {
        return {
            system,
            user: [
                contextBlock,
                '【待改写片段】',
                options.selection || '',
                '',
                '请改写上面这段正文：保留全部情节信息与人物关系，提升节奏、画面感与对白质量。',
                '只输出改写后的文本，不要解释，不要加标题。',
            ].filter(Boolean).join('\n'),
        };
    }

    if (action === 'continue') {
        return {
            system,
            user: [
                contextBlock,
                `【${ctx.unitName}已写正文】`,
                ctx.existingBody,
                '',
                `请从上面的结尾继续写${ctx.unitName}，约 ${ctx.targetWords} 字。`,
                '不要重复已写内容，不要写总结或“未完待续”。',
            ].join('\n'),
        };
    }

    return {
        system,
        user: [
            contextBlock,
            `【目标】写${ctx.unitName}，约 ${ctx.targetWords} 字。`,
            '从场景直接切入，不要写“本章讲述……”之类的导语。',
        ].filter(Boolean).join('\n'),
    };
}

// ============================================================
// 上下文读取
// ============================================================

async function readText(adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string> }, path: string): Promise<string> {
    try {
        if (!(await adapter.exists(path))) return '';
        return await adapter.read(path);
    } catch {
        return '';
    }
}

export async function loadUnitWriterContext(
    app: App,
    project: string,
    mode: CreationMode,
    unitNumber: number,
): Promise<UnitWriterContext> {
    const adapter = app.vault.adapter;
    const units = listModeUnits(app, project, mode);
    const unit = units.find(item => item.number === unitNumber);
    const unitName = unit?.unitName || modeUnitDisplay(unitNumber, mode);
    const unitPath = unit?.file?.path || `${modeBodyDir(project, mode)}/${modeUnitFileName(mode, unitNumber)}`;

    const meta = parseCreationModeMeta((await readProjectMeta(app, project)) || '');
    const targetTotal = meta.mode === mode ? meta.targetUnits : 0;
    const wordTotal = meta.mode === mode ? meta.targetWords : 0;
    const targetWords = targetTotal > 0 && wordTotal > 0
        ? Math.max(600, Math.round(wordTotal / targetTotal))
        : (mode === 'script' ? 900 : 3000);

    const outlineDoc = await readText(adapter, modeDocPath(project, mode, 'outline'));
    const storyDoc = await readText(
        adapter,
        modeDocPath(project, mode, mode === 'script' ? 'bible' : 'storyCore'),
    );

    const preResearch = await readPreResearchData(adapter, project);
    const characters = preResearch
        ? (preResearch.mode === 'script' ? preResearch.characters : preResearch.characterCore)
        : '';

    let previousTail = '';
    if (unitNumber > 1) {
        const previous = units.find(item => item.number === unitNumber - 1);
        const previousPath = previous?.file?.path
            || `${modeBodyDir(project, mode)}/${modeUnitFileName(mode, unitNumber - 1)}`;
        const previousText = await readText(adapter, previousPath);
        const body = splitFrontmatter(previousText).body.trim();
        previousTail = body.length > 800 ? body.slice(body.length - 800) : body;
    }

    const existingBody = splitFrontmatter(await readText(adapter, unitPath)).body;

    return {
        mode,
        project,
        unitNumber,
        unitName,
        unitPath,
        outlineSection: extractUnitOutlineSection(outlineDoc, mode, unitNumber),
        outlineDoc,
        storyDoc: storyDoc.slice(0, 4000),
        characters: String(characters || '').slice(0, 1500),
        previousTail,
        modeGuide: getCreationModePromptBlock(mode, meta),
        targetWords,
        existingBody,
    };
}

// ============================================================
// 生成
// ============================================================

function temperatureFor(action: UnitWriteAction): number {
    if (action === 'rewrite') return 0.75;
    if (action === 'continue') return 0.82;
    return 0.88;
}

export async function generateUnitText(
    ai: UnitAIEngine,
    ctx: UnitWriterContext,
    action: UnitWriteAction,
    options: UnitGenerateOptions,
): Promise<string> {
    const { system, user } = buildUnitPrompt(ctx, action, {
        instruction: options.instruction,
        selection: options.selection,
    });
    const temperature = temperatureFor(action);
    const callOptions = { isWritingTask: true, signal: options.signal };

    if (options.onDelta && typeof ai.callAIAsyncIterator === 'function') {
        let accumulated = '';
        try {
            const stream = ai.callAIAsyncIterator(system, user, options.model, temperature, options.maxTokens, callOptions);
            for await (const chunk of stream) {
                if (options.signal?.aborted) {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    throw error;
                }
                if (!chunk) continue;
                accumulated += chunk;
                options.onDelta(chunk);
            }
            if (accumulated.trim()) return accumulated.trim();
        } catch (e) {
            if ((e as { name?: string })?.name === 'AbortError') throw e;
            log.warn('[单元写作] 流式生成失败，回退到一次性调用:', e);
        }
    }

    const response = await ai.callAI(system, user, options.model, temperature, options.maxTokens, callOptions);
    if (response.error) throw new Error(response.error);
    const content = (response.content || '').trim();
    if (!content) throw new Error('模型返回为空，请重试或更换模型');
    options.onDelta?.(content);
    return content;
}

// ============================================================
// 落盘
// ============================================================

export interface SaveUnitOptions {
    markWritten?: boolean;
    title?: string;
}

export async function saveUnitBody(
    port: UnitFilePort,
    path: string,
    bodyText: string,
    options: SaveUnitOptions = {},
): Promise<{ words: number }> {
    const existing = await port.read(path);
    const { frontmatter } = splitFrontmatter(existing);
    const normalizedBody = String(bodyText ?? '').replace(/\r\n/g, '\n');
    const content = `${frontmatter}${frontmatter && !normalizedBody.startsWith('\n') ? '\n' : ''}${normalizedBody}`;
    await port.write(path, content);

    const words = countUnitWords(normalizedBody);
    const patch: Record<string, unknown> = { word_count: words };
    if (options.markWritten) patch.status = 'written';
    if (options.title) patch['标题'] = options.title;
    await port.updateFrontmatter(path, patch);
    return { words };
}

export function createObsidianUnitFilePort(app: App): UnitFilePort {
    const adapter = app.vault.adapter;
    return {
        read: async (path: string) => {
            if (!(await adapter.exists(path))) return '';
            return adapter.read(path);
        },
        write: async (path: string, content: string) => {
            const file = app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) await app.vault.modify(file, content);
            else await app.vault.create(path, content);
        },
        updateFrontmatter: async (path: string, patch: Record<string, unknown>) => {
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) return;
            const manager = app.fileManager as unknown as {
                processFrontMatter?: (file: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void>;
            } | undefined;
            if (typeof manager?.processFrontMatter === 'function') {
                await manager.processFrontMatter(file, (fm) => { Object.assign(fm, patch); });
                return;
            }
            const raw = await app.vault.read(file);
            await app.vault.modify(file, patchFrontmatterText(raw, patch));
        },
    };
}

/** 改写结果的应用守卫：目标区间原文变了就拒绝，避免覆盖用户新输入 */
export function canApplyRewrite(
    currentText: string,
    selection: { start: number; end: number; originalText: string },
): boolean {
    if (selection.start < 0 || selection.end > currentText.length || selection.start > selection.end) return false;
    return currentText.slice(selection.start, selection.end) === selection.originalText;
}

export function unitTitleOf(ctx: UnitWriterContext): string {
    return `${getCreationModeLabel(ctx.mode)} · ${ctx.unitName}`;
}
