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
import { pjBodyFile, pjBodyDir, pjCharsDir, pjFactionsDir, pjLocsDir, pjItemsDir } from '../shared/paths';
import { FileSystemPort, FrontmatterPort, VaultMetaPort, ObsidianFileSystem, ObsidianFrontmatter, ObsidianVaultMeta } from '../shared/file-system-port';
import { StepRunnerCallbacks, NOOP_CALLBACKS } from './step-runner-callbacks';
import { validateStepResult } from './step-validator';
import { createLogger } from '../shared/logger';


const log = createLogger('StepResultSaver');
export interface EntityNames {
    chars: string[];
    factions: string[];
    locs: string[];
    items: string[];
}

export interface StepResultSaverDeps {
    getPlugin?: () => { settings?: { defaultModel?: string } };
    showNotice?: (msg: string, duration?: number) => void;
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
            if (!this.app) {
                throw new Error('[StepResultSaver] 未提供 app 或 vaultMeta，无法进行 vault 元数据操作');
            }
            this.vaultMeta = new ObsidianVaultMeta(this.app);
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
     */
    async saveStepResult(
        stepKey: string,
        content: string,
        chapDir: string,
        chapterName: string,
        volume: string,
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
        const bodyDefaultPath = v4Match
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
                    const foundBody = findChapterFile(this.getVaultMeta().getFiles(), chapDir, '正文', this.app);
                    if (foundBody) {
                        actualTargetPath = foundBody.path;
                    } else {
                        log.warn(`[StepResultSaver] bodyGeneration: 未找到已有正文文件，将创建新文件 → ${actualTargetPath}`);
                    }
                }

                const project = v4Project || chapDir.split('/')[0] || '';
                const entityNames = project ? await this.extractEntityNames(project) : null;

                // 统一落盘入口：保留旧 frontmatter、剥离模型标题、统一缩进与状态
                const patch: Record<string, unknown> = {};
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
                });

                return true;
            } else if (stepKey === 'infoPlan') {
                fileContent = content;
            } else if (stepKey === 'outline') {
                fileContent = content;
            } else if (stepKey === 'analysisReport') {
                fileContent = content.replace(/^---[\t ]*\n/, '');
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
                if (targetFile instanceof TFile) {
                    // A4：step_status 必须由内容结构决定，不能无条件写成 generated。
                    // 否则模板骨架/半成品会被恢复逻辑当成「已完成」，批量续跑也会整步跳过。
                    const pureContent = content.replace(/^---[\s\S]*?\n---\n?/, '').trim();
                    const validation = validateStepResult(stepKey, pureContent);
                    try {
                        await this.getFrontmatter().processFrontmatter(targetFile, (fm: Record<string, unknown>) => {
                            fm['step_status'] = validation.level === 'complete' ? 'generated' : 'partial';
                            fm['step_model'] = plugin?.settings?.defaultModel || '';
                            fm['step_timestamp'] = new Date().toISOString();
                            this.setStepTags(fm, stepKey, chapName);
                        });
                    } catch (fmErr) {
                        log.warn('[StepResultSaver] processFrontMatter 失败:', fmErr);
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
     */
    async writeFixToBody(fixContent: string, chapDir: string, chapterName: string, volume: string): Promise<void> {
        try {
            const v4Match = chapDir.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
            const bodyLookupDir = v4Match
                ? pjBodyDir(v4Match[1], parseInt(v4Match[2], 10))
                : chapDir;
            const foundBody = findChapterFile(this.getVaultMeta().getFiles(), bodyLookupDir, '正文', this.app);
            if (!foundBody) {
                log.warn('[StepResultSaver] writeFixToBody: 未找到正文文件，跳过覆写', bodyLookupDir);
                return;
            }

            const project = v4Match ? v4Match[1] : (chapDir.split('/')[0] || '');
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
                path: foundBody.path,
                raw: fixContent,
                chapterNum: v4Match ? parseInt(v4Match[3], 10) : this.parseChapterNum(chapterName),
                chapterName,
                volume,
                project,
                writingMode: 'pipeline',
                frontmatterPatch: patch,
            });

            log.warn(`[StepResultSaver] writeFixToBody: ✅ 修正已写回正文 → ${foundBody.path} (${result.wordCount} 字)`);
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
                [pjCharsDir(project), 'chars'],
                [pjFactionsDir(project), 'factions'],
                [pjLocsDir(project), 'locs'],
                [pjItemsDir(project), 'items'],
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
