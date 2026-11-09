/**
 * step-result-saver.ts — 步骤结果持久化
 *
 * 职责：步骤结果的磁盘读写、正文 frontmatter 维护、实体名称提取。
 *
 * 从 step-runner.ts 拆分而来。
 *
 * 平台解耦：
 * - 优先使用 FileSystemPort 接口（可通过构造函数注入）
 * - 如未提供 fs，回退到使用 app.vault（Obsidian 平台耦合保留在此类内部）
 * - 内部逻辑保持不变，只是对文件系统访问进行抽象
 */

import { App, TFile } from 'obsidian';
import { getChapterFileName, CHAPTER_FILE_TYPES, findChapterFile } from './chapter-utils';
import { BodyWriter } from './body-writer';
import { pjBodyFile, pjBodyDir, pjItemsDir } from '@/shared/paths';
import { entityDir } from '@/shared/entity-reader';
import { findBodyFileByChapterNum } from './chapter-utils';
import { listFolderFiles } from '@/shared/vault-tree';
import { FileSystemPort, FrontmatterPort, VaultMetaPort, ObsidianFileSystem, ObsidianFrontmatter, ObsidianVaultMeta } from '@/shared/file-system-port';
import { StepRunnerCallbacks, NOOP_CALLBACKS } from './step-runner-callbacks';
import { validateStepResult } from './step-validator';
import { createLogger } from '@/shared/logger';
import { projectIdFromPath } from '@/shared/paths';


const log = createLogger('StepResultSaver');
/**
 * 实体名称列表结构定义。
 */
export interface EntityNames {
    chars: string[];
    factions: string[];
    locs: string[];
    items: string[];
}

/**
 * StepResultSaverDeps 类型定义。
 */
export interface StepResultSaverDeps {
    getPlugin?: () => { settings?: { defaultModel?: string; naturalParagraphMode?: boolean } };
    showNotice?: (msg: string, duration?: number) => void;
}

/** 步骤落盘元数据：让文件能回答「哪个模型生成的、是否截断、用了多少 token」。 */
export interface StepSaveMeta {
    model?: string;
    providerId?: string;
    finishReason?: string;
    truncated?: boolean;
    usage?: { prompt: number; completion: number; total: number };
    maxTokens?: number;
    /** v4.23 归因：模板/规则/人味版本与实验分组（写入步骤 frontmatter） */
    templateId?: string;
    templateVersion?: string;
    templateHash?: string;
    rulesVersion?: string;
    rulesHash?: string;
    voiceMode?: string;
    experimentGroup?: string;
    /** G2 可追溯：本步骤实际注入的知识库片段 */
    ragSources?: Array<{ book: string; dimension: string; score: number; excerpt: string }>;
    /** 上下文预算恢复报告（压缩/补检/token） */
    contextBudget?: string;
}

/**
 * StepResultSaver 构造函数选项
 * 支持两种模式：
 * 1. 传统模式：传入 app，直接使用 app.vault
 * 2. 解耦模式：传入 fs（FileSystemPort），使用抽象接口
 */
export interface StepResultSaverOptions {
    /** Obsidian App 实例（传统模式） */
    app?: App;
    /** 文件系统抽象接口（解耦模式，优先使用） */
    fs?: FileSystemPort;
    /** Frontmatter 处理接口（解耦模式） */
    frontmatter?: FrontmatterPort;
    /** 依赖项回调 */
    deps?: StepResultSaverDeps;
}

/**
 * StepResultSaver 类。
 */
export class StepResultSaver {
    private app: App | undefined;
    private fs: FileSystemPort | null = null;
    private frontmatter: FrontmatterPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;
    private deps: StepResultSaverDeps;

    constructor(options: StepResultSaverOptions) {
        this.app = options.app;
        this.fs = options.fs || null;
        this.frontmatter = options.frontmatter || null;
        this.deps = options.deps || {};
    }

    /** 获取 FileSystemPort 实例（懒加载） */
    private getFS(): FileSystemPort {
        if (!this.fs) {
            if (!this.app) {
                throw new Error('[StepResultSaver] 未提供 app 或 fs，无法进行文件操作');
            }
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** 获取 VaultMetaPort 实例（懒加载） */
    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            // 解耦模式下 MockFileSystem 同时实现 VaultMetaPort；直接复用，避免测试/无 app 场景抛错
            if (this.fs && 'getFiles' in this.fs && 'getAbstractFileByPath' in this.fs) {
                this.vaultMeta = this.fs as unknown as VaultMetaPort;
            } else if (this.app) {
                this.vaultMeta = new ObsidianVaultMeta(this.app);
            } else {
                throw new Error('[StepResultSaver] 未提供 app 或 vaultMeta，无法进行 vault 元数据操作');
            }
        }
        return this.vaultMeta;
    }

    /** 获取 FrontmatterPort 实例（懒加载） */
    private getFrontmatter(): FrontmatterPort {
        if (!this.frontmatter) {
            if (!this.app) {
                throw new Error('[StepResultSaver] 未提供 app 或 frontmatter，无法进行 frontmatter 操作');
            }
            this.frontmatter = new ObsidianFrontmatter(this.app);
        }
        return this.frontmatter;
    }

    /**
     * 保存步骤结果到磁盘文件
     * @param stepKey - 步骤键
     * @param content - 内容
     * @param chapDir - 章节目录
     * @param chapterName - 章节名
     * @param volume - 卷
     * @param meta - 元数据
     * @returns 是否成功
     */
    async saveStepResult(
        stepKey: string,
        content: string,
        chapDir: string,
        chapterName: string,
        volume: string,
        meta?: StepSaveMeta,
    ): Promise<boolean> {
        if (!chapDir) {
            log.warn('[StepResultSaver] saveStepResult: chapDir 为空，跳过保存 stepKey=', stepKey);
            return false;
        }

        const plugin = this.deps.getPlugin?.();

        // v4.0: 从 chapDir 反推 project/volN/chapN，正文走 pjBodyFile
        const v4Match = chapDir.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
        const v4Project = v4Match ? v4Match[1] : '';
        const v4VolN = v4Match ? parseInt(v4Match[2], 10) : 0;
        const v4ChapN = v4Match ? parseInt(v4Match[3], 10) : 0;
        // v4.25：正文目标优先用「已存在的章文件」（第N章_章名_正文.md 可能带章名）。
        // 旧实现固定写 pjBodyFile 的无章名路径，会把新稿写进另一个文件、原章还是骨架
        //（实测：同一章出现 第1章_正文.md 与 第1章_九脉逆行_正文.md 两个文件）。
        const existingBodyFile = v4Match
            ? findBodyFileByChapterNum(
                // 只读本卷正文目录：getFiles() 每次落盘都要遍历整库
                listFolderFiles<TFile>(this.getVaultMeta(), pjBodyDir(v4Project, v4VolN)),
                `${pjBodyDir(v4Project, v4VolN)}/`,
                v4ChapN,
                chapterName,
            )
            : undefined;

        const bodyDefaultPath = existingBodyFile
            ? existingBodyFile.path
            : v4Match
                ? pjBodyFile(v4Project, v4VolN, v4ChapN)
                : `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.body)}`;

        const fileMap: Record<string, string> = {
            'infoPlan': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.infoPlan)}`,
            'outline': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.outline)}`,
            'bodyGeneration': bodyDefaultPath,
            'analysisReport': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.analysisReport)}`,
            'continuityCheck': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.continuityReview)}`,
            'selfCheck': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.selfCheck)}`,
            'fix': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.fix)}`,
            'finalFix': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.finalFix)}`,
            'plotDistill': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.plotDistill)}`,
            'qualityControl': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.qualityControl)}`,
            'emotionPlan': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.emotionPlan)}`,
            'sceneExpand': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.sceneExpand)}`,
            'characterSoul': `${chapDir}/${getChapterFileName(chapterName, CHAPTER_FILE_TYPES.characterSoul)}`,
        };

        const targetPath = fileMap[stepKey];
        if (!targetPath) { log.warn('[StepResultSaver] stepKey 未映射到文件', stepKey); return false; }

        try {
            const fs = this.getFS();
            const vaultMeta = this.getVaultMeta();
            if (!vaultMeta.getAbstractFileByPath(chapDir)) {
                await fs.mkdir(chapDir);
            }
            // v4.0: 写正文前确保正文目录存在
            if (stepKey === 'bodyGeneration' && v4Match) {
                const bodyDir = pjBodyDir(v4Project, v4VolN);
                if (!vaultMeta.getAbstractFileByPath(bodyDir)) {
                    await fs.mkdir(bodyDir);
                }
            }

            let fileContent: string;
            const chapName = chapterName;
            let actualTargetPath = targetPath;

            if (stepKey === 'bodyGeneration') {
                // P0-3 修复: v4 项目正文路径由卷号+章号唯一确定，直接使用 bodyDefaultPath，
                // 避免 findChapterFile 在卷目录下按 frontmatter 模糊匹配到错误章节（多章项目正文错位）
                if (v4Match) {
                    actualTargetPath = bodyDefaultPath;
                } else {
                    const foundBody = findChapterFile(
                        listFolderFiles<TFile>(this.getVaultMeta(), chapDir),
                        chapDir,
                        '正文',
                        this.app,
                    );
                    if (foundBody) {
                        actualTargetPath = foundBody.path;
                    } else {
                        log.warn(`[StepResultSaver] bodyGeneration: 未找到已有正文文件，将创建新文件 → ${actualTargetPath}`);
                    }
                }

                const project = v4Project || projectIdFromPath(chapDir);
                const entityNames = project ? await this.extractEntityNames(project) : null;
                const truncated = meta?.truncated === true;

                // 截断保护：本次若是半章，而磁盘上已有完整正文，绝不能覆盖完整稿。
                // 把本次内容落为独立草稿，正文保持原样，由用户决定是否续写/覆盖。
                if (truncated && await fs.exists(actualTargetPath)) {
                    try {
                        const existing = await fs.read(actualTargetPath);
                        if (validateStepResult('bodyGeneration', existing).level === 'complete') {
                            const draftPath = actualTargetPath.replace(/\.md$/i, '_截断草稿.md');
                            await fs.write(draftPath, content);
                            log.warn(`[StepResultSaver] 正文截断，已保留完整正文并写入草稿 → ${draftPath}`);
                            this.deps.showNotice?.(
                                `⚠️ 本次正文输出被截断，已保留原完整正文；截断内容保存为 ${draftPath}`,
                                8000,
                            );
                            return true;
                        }
                    } catch (e) {
                        // 读取失败时按「没有完整旧稿」处理，继续走正常落盘，避免阻断主流程
                        log.warn('[StepResultSaver] 截断保护读取旧正文失败，按正常覆盖处理:', e);
                    }
                }

                // 统一落盘入口：保留旧 frontmatter、剥离模型标题、统一缩进与状态
                const patch: Record<string, unknown> = {
                    step_model: meta?.model || plugin?.settings?.defaultModel || '',
                    step_finish_reason: meta?.finishReason || '',
                    step_truncated: truncated,
                };
                if (meta?.usage) patch['step_usage'] = meta.usage;
                if (meta?.maxTokens) patch['step_max_tokens'] = meta.maxTokens;
                if (meta?.contextBudget) patch['context_budget'] = meta.contextBudget;
                this.appendVersionFields(patch, stepKey, meta);
                if (entityNames) {
                    const inBody = (n: string): boolean => content.includes(n);
                    patch['涉及人物'] = entityNames.chars.filter(inBody);
                    patch['涉及地点'] = entityNames.locs.filter(inBody);
                    patch['涉及势力'] = entityNames.factions.filter(inBody);
                    patch['涉及物品功法'] = entityNames.items.filter(inBody);
                }

                const chapNum = v4ChapN || this.parseChapterNum(chapterName);
                const writer = new BodyWriter({ fs: this.getFS(), frontmatter: this.getFrontmatter() });
                await writer.write({
                    path: actualTargetPath,
                    raw: content,
                    chapterNum: chapNum,
                    chapterName,
                    volume,
                    project,
                    writingMode: 'pipeline',
                    frontmatterPatch: patch,
                    truncated,
                    naturalize: plugin?.settings?.naturalParagraphMode !== false,
                });

                return true;
            } else if (stepKey === 'infoPlan') {
                fileContent = content;
            } else if (stepKey === 'outline') {
                fileContent = content;
            } else if (stepKey === 'analysisReport') {
                // 模型可能自带完整 YAML frontmatter。旧实现只删开头 `---`，
                // 会把 `key: value` 和结尾 `---` 留在报告正文里。
                fileContent = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
            } else if (stepKey === 'continuityCheck') {
                fileContent = `# ${chapName}_连贯性审查\n\n${content}`;
            } else if (stepKey === 'selfCheck') {
                fileContent = `# ${chapName}_自检报告\n\n${content}`;
            } else if (stepKey === 'fix') {
                fileContent = content;
            } else if (stepKey === 'finalFix') {
                fileContent = content;
            } else if (stepKey === 'plotDistill') {
                fileContent = content;
            } else if (stepKey === 'qualityControl') {
                fileContent = `# ${chapName}_质量控制\n\n${content}`;
            } else {
                fileContent = content;
            }

            await this.getFS().write(targetPath, fileContent);

            // 通过 processFrontMatter 设置元数据（非正文步骤）
            if (stepKey !== 'bodyGeneration') {
                const targetFile = await this.getFS().getFile(targetPath);
                if (targetFile) {
                    // A4：step_status 必须由内容结构决定，不能无条件写成 generated。
                    // 否则模板骨架/半成品会被恢复逻辑当成「已完成」，批量续跑也会整步跳过。
                    const pureContent = content.replace(/^---[\s\S]*?\n---\n?/, '').trim();
                    const validation = validateStepResult(stepKey, pureContent);
                    const truncated = meta?.truncated === true;
                    try {
                        await this.getFrontmatter().processFrontmatter(targetFile, (fm: Record<string, unknown>) => {
                            fm['step_status'] = !truncated && validation.level === 'complete' ? 'generated' : 'partial';
                            fm['step_model'] = meta?.model || plugin?.settings?.defaultModel || '';
                            fm['step_finish_reason'] = meta?.finishReason || '';
                            fm['step_truncated'] = truncated;
                            if (meta?.usage) fm['step_usage'] = meta.usage;
                            else delete fm['step_usage'];
                            if (meta?.maxTokens) fm['step_max_tokens'] = meta.maxTokens;
                            if (meta?.contextBudget) fm['context_budget'] = meta.contextBudget;
                            this.appendVersionFields(fm as Record<string, unknown>, stepKey, meta);
                            fm['step_timestamp'] = new Date().toISOString();
                            this.setStepTags(fm, stepKey, chapName);
                        });
                    } catch (fmErr) {
                        log.warn('[StepResultSaver] processFrontMatter 失败:', fmErr);
                    }
                }
            }

            // G2：知识来源归因（正文步骤也写，BodyWriter 已落盘，这里补 frontmatter）
            if (meta?.ragSources && meta.ragSources.length > 0) {
                const ragFile = await this.getFS().getFile(targetPath);
                if (ragFile) {
                    try {
                        await this.getFrontmatter().processFrontmatter(ragFile, (fm: Record<string, unknown>) => {
                            fm['rag_sources'] = meta.ragSources;
                        });
                    } catch (e) {
                        log.warn('[StepResultSaver] 写入 rag_sources 失败:', e);
                    }
                }
            }
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error('[StepResultSaver] 保存步骤结果失败:', e);
            this.deps.showNotice?.(`❌ 保存步骤结果失败：${errMsg}`, 5000);
            return false;
        }
        log.info(`[StepResultSaver] saveStepResult: ${stepKey} → ${targetPath} (${content.length} 字)`);
        return true;
    }

    /**
     * 将修正内容写回正文
     * @param fixContent - 修正内容
     * @param chapDir - 章节目录
     * @param chapterName - 章节名
     * @param volume - 卷
     */
    async writeFixToBody(fixContent: string, chapDir: string, chapterName: string, volume: string): Promise<void> {
        try {
            const v4Match = chapDir.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
            const project = v4Match ? v4Match[1] : projectIdFromPath(chapDir);
            let targetPath: string;
            let chapterNum: number | undefined;
            if (v4Match) {
                // v4：正文路径优先命中「带章名」的现有章文件（v4.25，同 saveStepResult）。
                // 旧实现固定用 pjBodyFile 的无章名路径，修正稿会写进另一个文件。
                const volNum = parseInt(v4Match[2], 10);
                chapterNum = parseInt(v4Match[3], 10);
                const existing = findBodyFileByChapterNum(
                    listFolderFiles<TFile>(this.getVaultMeta(), pjBodyDir(project, volNum)),
                    `${pjBodyDir(project, volNum)}/`,
                    chapterNum,
                    chapterName,
                );
                targetPath = existing?.path ?? pjBodyFile(project, volNum, chapterNum);
            } else {
                const foundBody = findChapterFile(
                    listFolderFiles<TFile>(this.getVaultMeta(), chapDir),
                    chapDir,
                    '正文',
                    this.app,
                );
                if (!foundBody) {
                    log.warn('[StepResultSaver] writeFixToBody: 未找到正文文件，跳过覆写', chapDir);
                    return;
                }
                targetPath = foundBody.path;
                chapterNum = this.parseChapterNum(chapterName);
            }

            const entityNames = project ? await this.extractEntityNames(project) : null;
            const patch: Record<string, unknown> = {};
            if (entityNames) {
                const inBody = (n: string): boolean => fixContent.includes(n);
                patch['涉及人物'] = entityNames.chars.filter(inBody);
                patch['涉及地点'] = entityNames.locs.filter(inBody);
                patch['涉及势力'] = entityNames.factions.filter(inBody);
                patch['涉及物品功法'] = entityNames.items.filter(inBody);
            }

            // 统一落盘入口：旧 frontmatter 原文保留，实体字段只刷新「本章实际出现」的项
            const writer = new BodyWriter({ fs: this.getFS(), frontmatter: this.getFrontmatter() });
            const result = await writer.write({
                path: targetPath,
                raw: fixContent,
                chapterNum,
                chapterName,
                volume,
                project,
                writingMode: 'pipeline',
                frontmatterPatch: patch,
            });

            log.warn(`[StepResultSaver] writeFixToBody: ✅ 修正已写回正文 → ${targetPath} (${result.wordCount} 字)`);
        } catch (e) {
            log.error('[StepResultSaver] writeFixToBody 失败:', e);
            this.deps.showNotice?.('❌ 修正回写失败，正文未更新：' + (e instanceof Error ? e.message : String(e)), 6000);
        }
    }

    /**
     * 提取项目下所有实体名称
     */
    private async extractEntityNames(project: string): Promise<EntityNames | null> {
        try {
            const result: EntityNames = { chars: [], factions: [], locs: [], items: [] };
            const entityDirs: [string, keyof EntityNames][] = [
                [entityDir(project, 'characters'), 'chars'],
                [entityDir(project, 'factions'), 'factions'],
                [entityDir(project, 'locations'), 'locs'],
                [entityDir(project, 'items'), 'items'],
            ];
            for (const [dir, key] of entityDirs) {
                const files = await this.getFS().listFiles(dir);
                const mdFiles = files.filter(f => f.name.endsWith('.md'));
                for (const f of mdFiles) {
                    try {
                        const fc = await this.getFS().read(f.path);
                        const fmMatch = fc.match(/^---\n([\s\S]*?)\n---/);
                        if (fmMatch) {
                            const nameMatch = fmMatch[1].match(/^(?:名称|姓名):\s*(.+)$/m);
                            if (nameMatch) result[key].push(nameMatch[1].trim());
                        }
                    } catch (e) {
                        log.warn('[StepResultSaver] 实体文件读取失败:', e);
                    }
                }
            }
            return result;
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn('[StepResultSaver] extractEntityNames 失败:', e);
            this.deps.showNotice?.(`⚠️ 读取实体名称失败：${errMsg}`, 5000);
            return null;
        }
    }

    /**
     * 公开获取项目实体名称
     * @param project - 项目（路径或对象）
      * @returns EntityNames 或 null
     */
    async getEntityNames(project: string): Promise<EntityNames | null> {
        return this.extractEntityNames(project);
    }

    // ============================================================
    // 内部辅助方法
    // ============================================================

    /** 从「第3章」这类章节名解析序号 */
    private parseChapterNum(chapterName: string): number | undefined {
        const m = (chapterName || '').match(/第(\d+)章/);
        if (!m) return undefined;
        const n = parseInt(m[1], 10);
        return Number.isFinite(n) ? n : undefined;
    }

    /**
     * 版本归因字段（v4.23）：步骤结果里记录「用哪套模板/哪版规则/哪种人味模式/哪个实验组」。
     * 缺省值不写，避免把老数据刷成一片空字段。
     */
    private appendVersionFields(fm: Record<string, unknown>, stepKey: string, meta?: StepSaveMeta): void {
        const fields: Array<[string, string | undefined]> = [
            ['step_template_id', meta?.templateId],
            ['step_template_version', meta?.templateVersion],
            ['step_template_hash', meta?.templateHash],
            ['step_rules_version', meta?.rulesVersion],
            ['step_rules_hash', meta?.rulesHash],
            ['step_voice_mode', meta?.voiceMode],
            ['step_experiment_group', meta?.experimentGroup],
        ];
        for (const [key, value] of fields) {
            const text = String(value || '').trim();
            if (text) fm[key] = text;
            else delete fm[key];
        }
        void stepKey;
    }

    private setStepTags(fm: Record<string, unknown>, stepKey: string, chapterName: string): void {
        if (stepKey === 'infoPlan') {
            fm['tags'] = ['信息规划'];
            fm['章'] = chapterName;
        } else if (stepKey === 'outline') {
            fm['tags'] = ['大纲摘要'];
            fm['章'] = chapterName;
        } else if (stepKey === 'analysisReport') {
            fm['tags'] = ['分析报告'];
        } else if (stepKey === 'continuityCheck') {
            fm['tags'] = ['审查报告'];
            fm['审查时间'] = new Date().toLocaleString();
        } else if (stepKey === 'selfCheck') {
            fm['tags'] = ['自检报告'];
            fm['章'] = chapterName;
        } else if (stepKey === 'fix') {
            fm['tags'] = ['修正记录'];
            fm['章'] = chapterName;
        } else if (stepKey === 'finalFix') {
            fm['tags'] = ['最终修正'];
            fm['章'] = chapterName;
        } else if (stepKey === 'plotDistill') {
            fm['tags'] = ['情节蒸馏'];
            fm['章'] = chapterName;
        } else if (stepKey === 'qualityControl') {
            fm['tags'] = ['质量控制'];
            fm['章'] = chapterName;
        }
    }
}
