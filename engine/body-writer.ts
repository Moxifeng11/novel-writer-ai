/**
 * body-writer.ts — 正文落盘的唯一入口
 *
 * 背景（2026-10-20 审计）：
 * 插件里曾有 7 条独立的「写正文」路径，frontmatter 处理方式各不相同：
 *   - 协同写作：覆盖整篇 → 再按白名单恢复少数字段（白名单外的字段永久丢失）
 *   - 步骤流水线：覆盖整篇 → processFrontmatter 只补 4 个实体字段
 *   - 自动写作器：直接 `vault.modify(body)`，完全不处理 frontmatter
 *   - 批量写正文：重建 frontmatter 为 4 个字段（卷/章/标题/tags）
 *   - 续写 / 修正回写：又各自拼一遍 frontmatter
 * 结果是同一章在「谁最后写谁说了算」之间反复丢字段，status 也会被降级。
 *
 * 本模块把正文落盘收敛为一条路径，统一保证 4 条不变量：
 *   1. 旧 frontmatter 原文原样保留（不经 YAML 重新序列化），未知字段不丢
 *   2. 标题行由写入器统一生成，模型输出里的标题一律剥离
 *   3. 正文按项目「写作规则.md」推导的契约规整（见 shared/body-format.ts）
 *   4. `status` 不降级：已 settled 的章节不会被写回 written / draft
 */
import { App, TFile } from 'obsidian';
import {
    FileSystemPort, FrontmatterPort, ObsidianFileSystem, ObsidianFrontmatter,
} from '../shared/file-system-port';
import {
    BodyFormatContract, DEFAULT_BODY_FORMAT, deriveBodyFormat, normalizeBodyText,
} from '../shared/body-format';
import { naturalizeBodyText } from '../shared/prose-naturalizer';
import { pjBodyFile, pjWritingRules } from '../shared/paths';
import { getChapterFileName, CHAPTER_FILE_TYPES } from './chapter-utils';
import { validateStepResult } from './step-validator';
import { withWriteLock } from '../shared/write-lock';
import { createLogger } from '../shared/logger';

const log = createLogger('BodyWriter');

export type BodyWritingMode = 'co-writer' | 'pipeline' | 'batch' | 'auto' | 'continue' | 'manual' | 'scene';

export interface BodyWriteRequest {
    /** 正文文件的 vault 全路径 */
    path: string;
    /** 原始文本：可含 frontmatter、`# 第X章 标题`、模型元叙述 */
    raw: string;
    /** 章节序号，用于生成 `# 第N章 标题`；缺省时从 chapterName 解析 */
    chapterNum?: number;
    /** 形如 `第3章`，写入 frontmatter 的「章」 */
    chapterName?: string;
    /** 章节标题（不含 `第N章`）；缺省时从 raw 的标题行提取 */
    title?: string;
    /** 形如 `第1卷`，写入 frontmatter 的「卷」 */
    volume?: string;
    /** 项目名；用于读取「写作规则.md」推导格式契约 */
    project?: string;
    writingMode: BodyWritingMode;
    /** 显式指定格式契约；不传则按 project 的写作规则推导 */
    contract?: BodyFormatContract;
    /** 调用方计算的额外元数据（如「涉及人物」），由本模块统一写入 */
    frontmatterPatch?: Record<string, unknown>;
    /** 本次输出是否被模型截断：true 时不得标记 generated/written */
    truncated?: boolean;
    /**
     * 是否把相邻短段合并成自然段。
     * 默认：AI 写入（pipeline/batch/auto/continue/scene）为 true；
     * manual 与 co-writer 为 false（协同写作是逐段插入，整篇自动合并会打断用户排版）。
     */
    naturalize?: boolean;
}

export interface BodyWriteResult {
    path: string;
    created: boolean;
    /** 规整后的纯正文（不含标题行） */
    body: string;
    wordCount: number;
    title: string;
}

export interface BodyWriterOptions {
    app?: App;
    fs?: FileSystemPort;
    frontmatter?: FrontmatterPort;
}

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const CHAPTER_TITLE_INLINE = /^#{0,6}\s*第[0-9一二三四五六七八九十百千]+章[\s：:]+《?(.+?)》?\s*$/m;
const CHAPTER_NUM_FROM_NAME = /第([0-9一二三四五六七八九十百千]+)章/;

function stripFrontmatterBlock(content: string): { fmRaw: string; body: string } {
    const m = content.match(FRONTMATTER_BLOCK);
    if (!m) return { fmRaw: '', body: content };
    return { fmRaw: m[1], body: content.slice(m[0].length) };
}

/** 从文本中提取章节标题（`# 第3章 试炼` / `第3章：试炼`） */
export function extractChapterTitle(content: string, chapterNum?: number): string {
    const { body } = stripFrontmatterBlock(content);
    const firstLines = body.split('\n').slice(0, 6).join('\n');
    const m = firstLines.match(CHAPTER_TITLE_INLINE);
    if (!m) return '';
    const title = m[1].trim();
    // 只保留标题本身：去掉《》与尾部标点
    return title.replace(/^《|》$/g, '').replace(/[。！？!?]$/, '').slice(0, 30);
}

export class BodyWriter {
    private app: App | undefined;
    private fs: FileSystemPort | null;
    private frontmatter: FrontmatterPort | null;
    private contractCache = new Map<string, BodyFormatContract>();

    constructor(options: BodyWriterOptions = {}) {
        this.app = options.app;
        this.fs = options.fs || null;
        this.frontmatter = options.frontmatter || null;
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            if (!this.app) throw new Error('[BodyWriter] 未提供 app 或 fs');
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    private getFrontmatter(): FrontmatterPort {
        if (!this.frontmatter) {
            if (!this.app) throw new Error('[BodyWriter] 未提供 app 或 frontmatter');
            this.frontmatter = new ObsidianFrontmatter(this.app);
        }
        return this.frontmatter;
    }

    /** 按项目写作规则推导格式契约（带缓存）；无规则文件时用默认契约 */
    async resolveContract(project?: string): Promise<BodyFormatContract> {
        if (!project) return { ...DEFAULT_BODY_FORMAT };
        const cached = this.contractCache.get(project);
        if (cached) return cached;

        let contract: BodyFormatContract = { ...DEFAULT_BODY_FORMAT };
        const rulesPath = pjWritingRules(project);
        try {
            const fs = this.getFS();
            if (await fs.exists(rulesPath)) {
                contract = deriveBodyFormat(await fs.read(rulesPath));
            }
        } catch (e) {
            log.warn('[BodyWriter] 读取写作规则失败，使用默认契约:', e);
        }
        this.contractCache.set(project, contract);
        return contract;
    }

    /**
     * 写入正文。所有正文入口都应调用它。
     */
    async write(req: BodyWriteRequest): Promise<BodyWriteResult> {
        if (!req.path) throw new Error('[BodyWriter] path 为空');
        // 同一章可能有多个写入者（协同自动保存 / 流水线 / 润色 / 修正回写）：
        // 写入是「读旧 frontmatter → 整篇覆盖」，必须按路径串行，
        // 否则后写覆盖前写，两次读到的旧 frontmatter 还会互相覆盖。
        return withWriteLock(req.path, () => this.writeLocked(req));
    }

    private async writeLocked(req: BodyWriteRequest): Promise<BodyWriteResult> {
        const fs = this.getFS();

        const chapterNum = req.chapterNum ?? this.parseChapterNum(req.chapterName);
        const chapterName = req.chapterName || (chapterNum ? `第${chapterNum}章` : '');
        const contract = req.contract ?? await this.resolveContract(req.project);

        // 1. 先取标题（normalize 会剥离标题行）
        const title = (req.title || extractChapterTitle(req.raw, chapterNum)).trim();

        // 2. 读旧文件：frontmatter 原文保留，正文重新规整
        const existed = await fs.exists(req.path);
        let fmRaw = '';
        if (existed) {
            try {
                fmRaw = stripFrontmatterBlock(await fs.read(req.path)).fmRaw;
            } catch (e) {
                log.warn('[BodyWriter] 读取旧正文失败，将按新建处理:', e);
            }
        }

        // 3. 规整正文（先剥离模型自带的 frontmatter，避免 status/step_status 行落进正文）
        let body = normalizeBodyText(stripFrontmatterBlock(req.raw).body, contract, { stripTitle: true });

        // 3.1 碎片化后处理：把“一句一段”合并成自然段。只改段落边界，不改句子。
        const shouldNaturalize = req.naturalize
            ?? (req.writingMode !== 'manual' && req.writingMode !== 'co-writer');
        if (shouldNaturalize) {
            const naturalized = naturalizeBodyText(body, {
                indent: contract.indent,
                separator: contract.separator,
            });
            if (naturalized.mergedParagraphs > 0) {
                log.info(`[BodyWriter] 自然段重排：${naturalized.changes.join('；')}`);
            }
            body = naturalized.text;
        }

        // 4. 拼装：旧 frontmatter 原文 + 统一标题行 + 规整正文
        const titleLine = chapterNum ? `# 第${chapterNum}章${title ? ` ${title}` : ''}\n\n` : '';
        const fmBlock = fmRaw.trim() ? `---\n${fmRaw.trim()}\n---\n\n` : '';
        const content = `${fmBlock}${titleLine}${body}\n`;

        await fs.mkdir(this.dirOf(req.path));
        await fs.write(req.path, content);

        // 5. 统一写入不变量字段
        const file = await fs.getFile(req.path);
        if (file) {
            try {
                await this.getFrontmatter().processFrontmatter(file as TFile, (fm) => {
                    this.applyInvariants(fm, {
                        title, chapterName, volume: req.volume,
                        writingMode: req.writingMode, body,
                        // 校验必须带标题行：validateBodyGeneration 的「章节开头」规则要求 `^#`
                        contentForValidation: `${titleLine}${body}`,
                        truncated: req.truncated === true,
                    });
                    if (req.frontmatterPatch) {
                        Object.assign(fm, req.frontmatterPatch);
                    }
                });
            } catch (e) {
                log.warn('[BodyWriter] processFrontmatter 失败，正文已写入但元数据未更新:', e);
            }
        }

        const wordCount = body.length;

        // 通知工作台：正文已由其他入口改写（协同写作 / 批量 / 续写 / 自动写作）
        if (this.app) {
            try {
                this.app.workspace.trigger('novel-writer:body-written', { path: req.path });
            } catch (e) {
                log.warn('[BodyWriter] 广播 body-written 事件失败:', e);
            }
        }

        log.info(`[BodyWriter] ${req.writingMode} → ${req.path} (${wordCount} 字, ${existed ? '覆盖' : '新建'})`);
        return { path: req.path, created: !existed, body, wordCount, title };
    }

    /**
     * 写入不变量字段。
     * - status 不降级：settled 永远保持
     * - 正文达 complete 才标记 step_status=generated，否则撤销
     */
    private applyInvariants(
        fm: Record<string, unknown>,
        ctx: {
            title: string; chapterName: string; volume?: string;
            writingMode: BodyWritingMode; body: string; contentForValidation: string;
            truncated?: boolean;
        },
    ): void {
        const prevStatus = typeof fm['status'] === 'string' ? fm['status'] : '';
        const settled = prevStatus === 'settled' || prevStatus === '已结算';

        fm['tags'] = Array.isArray(fm['tags'])
            ? Array.from(new Set([...(fm['tags'] as string[]), '正文']))
            : ['正文'];
        if (ctx.volume) fm['卷'] = ctx.volume;
        if (ctx.chapterName) fm['章'] = ctx.chapterName;
        if (ctx.title) fm['标题'] = ctx.title;
        fm['writing_mode'] = ctx.writingMode;
        fm['word_count'] = ctx.body.length;

        const level = validateStepResult('bodyGeneration', ctx.contentForValidation).level;
        if (ctx.truncated) {
            // 截断内容即使字数/结尾恰好过关，也不能当完整正文：
            // 保住旧 status（settled 不降级），但正文只能是 draft。
            if (!settled) fm['status'] = 'draft';
            delete fm['step_status'];
            fm['step_truncated'] = true;
        } else if (level === 'complete') {
            delete fm['step_truncated'];
            fm['step_status'] = 'generated';
            if (!settled) fm['status'] = 'written';
        } else if (!settled) {
            delete fm['step_truncated'];
            if (!prevStatus || prevStatus === 'pending' || prevStatus === 'draft') {
                fm['status'] = 'draft';
            }
            if (fm['step_status'] === 'generated') delete fm['step_status'];
        } else {
            delete fm['step_truncated'];
        }
    }

    private parseChapterNum(chapterName?: string): number | undefined {
        if (!chapterName) return undefined;
        const m = chapterName.match(CHAPTER_NUM_FROM_NAME);
        if (!m) return undefined;
        const n = parseInt(m[1], 10);
        return Number.isFinite(n) ? n : undefined;
    }

    private dirOf(path: string): string {
        const idx = path.lastIndexOf('/');
        return idx > 0 ? path.slice(0, idx) : '';
    }
}

/**
 * 生成正文文件的默认路径（与 v4 目录结构一致）。
 * 供批量/自动写作等没有现成路径的入口使用。
 */
export function defaultBodyPath(project: string, volumeNum: number, chapterNum: number, chapterName?: string): string {
    if (volumeNum > 0) return pjBodyFile(project, volumeNum, chapterNum);
    return `${project}/${getChapterFileName(chapterName || `第${chapterNum}章`, CHAPTER_FILE_TYPES.body)}`;
}
