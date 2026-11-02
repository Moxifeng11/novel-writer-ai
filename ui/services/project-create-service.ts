/**
 * project-create-service.ts — 长篇小说项目创建服务
 *
 * 从 CreateProjectModal 抽取的创建逻辑，供表单弹窗与对话引导 Agent 共用。
 * 只做纯创建动作：模板复制、.project、创作指南、写作配置、打开工作台；
 * 交互（覆盖确认）通过回调注入，方便 Agent 以对话形式确认。
 */
import { App, Notice, TFile } from 'obsidian';
import { WritingProfileManager } from '../../engine/writing-profile';
import {
    SUBDIR_SETTING_LIB_FILE,
    SUBDIR_WRITING_STYLE_FILE,
    SUBDIR_WORLD_ARCH,
    PJ_FANFIC_DIR,
    PJ_WORLD_ARCH_DIR,
    PJ_TEMPLATE_DIR,
    PJ_OUTLINE_DIR,
    pjFanficDir,
    pjProjectMeta,
    templateFingerprintsFile,
    projectFingerprintsFile,
    projectFingerprintLibraryDir,
} from '../../shared/paths';
import { createLogger } from '../../shared/logger';
import { ensureTemplateScaffold } from '../../shared/template-scaffold';
import { writeVaultText } from '../../shared/file-system-port';
import { newProjectPath } from '../../domains/kernel/project-locator';
import { fanficSettingsFileName, isFanficApproved } from '../full-writer/fanfic-settings-utils';
import { buildCreationModeMetaSection, type CreationModeMeta } from '../../shared/creation-mode';
import type { LongStorySettings } from '../../shared/story-structure';

const log = createLogger('ProjectCreateService');

/** 只声明创建流程实际用到的插件能力，避免 ui service 反向 import main 造成循环依赖。 */
export interface ProjectCreatePluginHost {
    engineRegistry: { get<T>(name: string): T };
    openFullWriterView?: () => Promise<void>;
}

/**
 * CreateLongProjectParams 类型定义。
 */
export interface CreateLongProjectParams {
    projectName: string;
    genre: string;
    description?: string;
    projectType: 'original' | 'fanfic';
    sourceWork?: string;
    sourceWorldview?: string;
    /** 已通过人工审核的同人设定路径；fanfic 时必须 */
    fanficSettingPath?: string;
    creationMeta: CreationModeMeta;
    /** 已存在同名项目时的覆盖确认；未提供时用交互确认 */
    confirmOverwrite?: () => Promise<boolean>;
}

/**
 * CreateLongProjectResult 类型定义。
 */
export interface CreateLongProjectResult {
    created: boolean;
    projectId: string;
    fileCount: number;
    reason?: string;
}

/**
 * writeCreationModeGuideFile 函数。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param meta - 元数据
 */
export async function writeCreationModeGuideFile(app: App, project: string, meta: CreationModeMeta): Promise<void> {
    const path = `${project}/00-系统模板/创作模式指南.md`;
    const { buildCreationModeGuide } = await import('../../shared/creation-mode');
    try {
        await writeVaultText(app, path, buildCreationModeGuide(meta));
    } catch (e) {
        log.warn('[ProjectCreate] 写创作模式指南失败:', e);
    }
}

/**
 * writeStoryStructureGuideFile 函数。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param settings - 设置
 */
export async function writeStoryStructureGuideFile(app: App, project: string, settings: LongStorySettings): Promise<void> {
    const path = `${project}/00-系统模板/故事结构指南.md`;
    const { buildStoryStructureGuide } = await import('../../shared/story-structure');
    try {
        await writeVaultText(app, path, buildStoryStructureGuide(settings));
    } catch (e) {
        log.warn('[ProjectCreate] 写故事结构指南失败:', e);
    }
}

/**
 * 创建长篇小说项目；覆盖被拒绝或同人设定未审核时 created=false。
 *
 * @param app - Obsidian 应用实例
 * @param plugin - 插件实例
 * @param params - 参数集合
  * @returns CreateLongProjectResult 实例
 */
export async function createLongNovelProject(
    app: App,
    plugin: ProjectCreatePluginHost,
    params: CreateLongProjectParams,
): Promise<CreateLongProjectResult> {
    const adapter = app.vault.adapter;
    const { projectName, genre, projectType, creationMeta } = params;
    const description = params.description || '';
    const sourceWork = params.sourceWork || '';
    const sourceWorldview = params.sourceWorldview || '';
    const fanficSettingPath = params.fanficSettingPath || '';

    if (projectType === 'fanfic' && fanficSettingPath) {
        try {
            const selected = app.vault.getAbstractFileByPath(fanficSettingPath);
            if (selected instanceof TFile) {
                const content = await app.vault.read(selected);
                if (!isFanficApproved(content)) {
                    return { created: false, projectId: '', fileCount: 0, reason: '所选同人设定尚未通过人工审核' };
                }
            }
        } catch (e) {
            log.warn('[ProjectCreate] 校验同人设定审核状态失败:', e);
            return { created: false, projectId: '', fileCount: 0, reason: '无法读取所选同人设定' };
        }
    }

    const selectedFanficFileName = fanficSettingPath
        ? fanficSettingPath.split('/').pop() || ''
        : '';
    const fanficTargetFileName = selectedFanficFileName || fanficSettingsFileName(sourceWork);
    const projectId = newProjectPath(projectName, 'long');
    const exists = await adapter.exists(projectId);
    if (exists) {
        if (!params.confirmOverwrite) {
            return { created: false, projectId, fileCount: 0, reason: '项目已存在，需要确认是否覆盖' };
        }
        const overwrite = await params.confirmOverwrite();
        if (!overwrite) {
            return { created: false, projectId, fileCount: 0, reason: '用户取消覆盖已有项目' };
        }

        const removeDir = async (dirPath: string): Promise<void> => {
            const list = await adapter.list(dirPath);
            for (const f of list.files) await adapter.remove(f);
            for (const d of list.folders) await removeDir(d);
            await adapter.rmdir(dirPath, true);
        };
        try { await removeDir(projectId); } catch (e) { log.warn('[ProjectCreate] 操作失败:', e); }
        await new Promise(r => setTimeout(r, 300));
    }

    const notice = new Notice(`正在创建项目「${projectName}」...`, 0);
    const projectRootId = projectId;
    let count = 0;

    try {
        const shouldCopyTemplatePath = (path: string): boolean => {
            if (path.startsWith(`${PJ_OUTLINE_DIR}/步骤结果`)) return false;
            if (path.startsWith(`${PJ_OUTLINE_DIR}/正文`)) return false;
            if (projectType === 'original' && path.startsWith(PJ_FANFIC_DIR)) return false;
            if (projectType === 'fanfic' && new RegExp(`^${PJ_FANFIC_DIR.replace(/[/\\]/g, '\\/')}/(斗罗大陆设定|哈利波特设定)\\.md$`).test(path)) return false;
            return true;
        };

        const scanDir = async (dirPath: string): Promise<{ files: string[], dirs: string[] }> => {
            const result: { files: string[], dirs: string[] } = { files: [], dirs: [] };
            const list = await adapter.list(dirPath);
            for (const dir of list.folders) {
                const dirName = dir.substring(dir.lastIndexOf('/') + 1);
                if (dirName.startsWith('_') || dirName.startsWith('.')) continue;
                if (!shouldCopyTemplatePath(dir)) continue;
                result.dirs.push(dir);
                const sub = await scanDir(dir);
                result.files.push(...sub.files);
                result.dirs.push(...sub.dirs);
            }
            for (const file of list.files) {
                if (!shouldCopyTemplatePath(file)) continue;
                result.files.push(file);
            }
            return result;
        };

        const scaffold = await ensureTemplateScaffold(app);
        if (scaffold.failed > 0) {
            log.warn('[ProjectCreate] 模板自举存在失败项:', scaffold);
        }

        const source = await scanDir('元文件');
        if (source.files.length === 0) {
            notice.hide();
            return { created: false, projectId: projectRootId, fileCount: 0, reason: '未找到「元文件」下的模板文件' };
        }

        const dirsToCreate = new Set<string>();
        for (const f of source.files) {
            const newPath = f.replace('元文件', projectRootId);
            const parent = newPath.substring(0, newPath.lastIndexOf('/'));
            dirsToCreate.add(parent);
        }
        for (const d of source.dirs) {
            dirsToCreate.add(d.replace('元文件', projectRootId));
        }

        const sortedDirs = [...dirsToCreate].sort((a, b) => a.split('/').length - b.split('/').length);
        for (const dir of sortedDirs) {
            try {
                if (!(await adapter.exists(dir))) {
                    await adapter.mkdir(dir);
                }
            } catch (e) {
                log.warn('创建目录失败:', dir, e);
            }
        }

        for (const srcPath of source.files) {
            const destPath = srcPath.replace('元文件', projectRootId);
            try {
                const content = await adapter.read(srcPath);
                await adapter.write(destPath, content);
                count++;
            } catch (fileErr) {
                log.warn(`复制失败: ${srcPath}`, fileErr);
            }
        }

        const rootCopies: Array<{ srcs: string[]; dst: string; existing: string[] }> = [
            {
                srcs: [
                    `${PJ_TEMPLATE_DIR}/设定库模板.md`,
                    `${PJ_WORLD_ARCH_DIR}/设定库模板.md`,
                    `${PJ_WORLD_ARCH_DIR}/设定库.md`,
                ],
                dst: `${projectRootId}/${SUBDIR_SETTING_LIB_FILE}`,
                existing: [
                    `${projectRootId}/${SUBDIR_SETTING_LIB_FILE}`,
                    `${projectRootId}/${SUBDIR_WORLD_ARCH}/设定库模板.md`,
                ],
            },
            {
                srcs: [
                    `${PJ_WORLD_ARCH_DIR}/文笔风格模板.md`,
                    `${PJ_TEMPLATE_DIR}/文笔风格模板.md`,
                ],
                dst: `${projectRootId}/${SUBDIR_WRITING_STYLE_FILE}`,
                existing: [
                    `${projectRootId}/${SUBDIR_WRITING_STYLE_FILE}`,
                    `${projectRootId}/${SUBDIR_WORLD_ARCH}/文笔风格模板.md`,
                ],
            },
        ];
        for (const { srcs, dst, existing } of rootCopies) {
            try {
                if (await adapter.exists(dst)) continue;
                let templateFilePath = '';
                for (const p of existing) {
                    if (p === dst) continue;
                    if (await adapter.exists(p)) { templateFilePath = p; break; }
                }
                if (templateFilePath) {
                    const content = await adapter.read(templateFilePath);
                    await adapter.write(dst, content);
                    count++;
                    continue;
                }
                let srcContent: string | null = null;
                for (const s of srcs) {
                    if (await adapter.exists(s)) { srcContent = await adapter.read(s); break; }
                }
                if (srcContent === null) {
                    log.warn('[ProjectCreate] 跳过根级文件复制：未找到任何模板源', { dst, srcs });
                    continue;
                }
                await adapter.write(dst, srcContent);
                count++;
            } catch (e) { log.warn('复制根级文件失败:', dst, e); }
        }

        try {
            const tplFpPath = templateFingerprintsFile();
            if (await adapter.exists(tplFpPath)) {
                const tplFpContent = await adapter.read(tplFpPath);
                const tplFingerprints = JSON.parse(tplFpContent) as Array<{
                    id: string;
                    name: string;
                    source: string;
                    scope: string;
                    enabled: boolean;
                    tags: string[];
                    stats: unknown;
                    features: unknown;
                    samples: string[];
                    extractedAt: number;
                    sourceText?: string;
                }>;
                const enabledFps = tplFingerprints.filter(fp => fp.enabled);
                if (enabledFps.length > 0) {
                    const projectFps = enabledFps.map(fp => ({
                        ...fp,
                        id: fp.id,
                        scope: 'project' as const,
                        samples: [],
                    }));
                    const projFpDir = projectFingerprintLibraryDir(projectRootId);
                    if (!(await adapter.exists(projFpDir))) {
                        await adapter.mkdir(projFpDir);
                    }
                    const projFpPath = projectFingerprintsFile(projectRootId);
                    await adapter.write(projFpPath, JSON.stringify(projectFps, null, 2));
                    count += enabledFps.length;
                }
            }
        } catch (e) {
            log.warn('[ProjectCreate] 模板指纹复制失败:', e);
        }

        try {
            const projectFile = pjProjectMeta(projectRootId);
            let projectContent = `# ${projectName}

## 题材
${genre}

## 类型
${projectType}

${description ? `## 描述\n${description}\n\n` : ''}${buildCreationModeMetaSection(creationMeta)}\n\n`;

            if (projectType === 'fanfic') {
                projectContent += `## 同人设定路径\n${pjFanficDir(projectRootId)}/${fanficTargetFileName}\n\n`;
                if (sourceWork) {
                    projectContent += `## 原作名称\n${sourceWork}\n\n`;
                }
                if (sourceWorldview) {
                    projectContent += `## 原作世界观简述\n${sourceWorldview}\n\n`;
                }
            }

            const existingProjectFile = app.vault.getAbstractFileByPath(projectFile);
            if (existingProjectFile instanceof TFile) {
                await app.vault.modify(existingProjectFile, projectContent);
            } else {
                await app.vault.create(projectFile, projectContent);
            }
        } catch (e) { log.warn('[ProjectCreate] 操作失败:', e); }

        if (projectType === 'fanfic' && fanficSettingPath) {
            const dstPath = `${pjFanficDir(projectRootId)}/${fanficTargetFileName}`;
            try {
                const content = await adapter.read(fanficSettingPath);
                const dstDir = dstPath.substring(0, dstPath.lastIndexOf('/'));
                if (!(await adapter.exists(dstDir))) {
                    await adapter.mkdir(dstDir);
                }
                await adapter.write(dstPath, content);
                count++;
            } catch (e) {
                log.warn('Failed to copy fanfic settings:', e);
            }
        }

        await writeCreationModeGuideFile(app, projectRootId, creationMeta);
        if (creationMeta.storySettings) {
            await writeStoryStructureGuideFile(app, projectRootId, creationMeta.storySettings);
        }

        try {
            const profileManager = plugin.engineRegistry.get<WritingProfileManager>('writingProfileManager');
            const templateProfilePath = WritingProfileManager.getConfigFilePath('元文件');
            let writingProfile;
            try {
                if (await adapter.exists(templateProfilePath)) {
                    writingProfile = await profileManager.load('元文件');
                    writingProfile.projectName = projectName;
                    writingProfile.projectType = projectType;
                    writingProfile.creationMode = creationMeta.mode;
                    writingProfile.shortCategory = creationMeta.shortCategory;
                    writingProfile.scriptGenre = creationMeta.scriptGenre;
                    writingProfile.targetWords = creationMeta.targetWords;
                    writingProfile.targetUnits = creationMeta.targetUnits;
                    writingProfile.createdAt = new Date().toISOString();
                    writingProfile.updatedAt = new Date().toISOString();
                    if (writingProfile.genre && genre) {
                        writingProfile.genre.primary = genre;
                        if (!writingProfile.genre.tags.includes(genre)) {
                            writingProfile.genre.tags.push(genre);
                        }
                    }
                    log.info('[ProjectCreate] 从模板继承写作配置');
                }
            } catch (e) {
                log.warn('[ProjectCreate] 从模板继承写作配置失败，生成默认配置:', e);
            }
            if (!writingProfile) {
                writingProfile = profileManager.generateDefault(genre, projectName, projectType);
                writingProfile.creationMode = creationMeta.mode;
                writingProfile.shortCategory = creationMeta.shortCategory;
                writingProfile.scriptGenre = creationMeta.scriptGenre;
                writingProfile.targetWords = creationMeta.targetWords;
                writingProfile.targetUnits = creationMeta.targetUnits;
                log.info('[ProjectCreate] 生成默认写作配置');
            }
            await profileManager.save(projectRootId, writingProfile);
        } catch (e) {
            log.warn('[ProjectCreate] 初始化写作配置失败（不影响项目创建）:', e);
        }

        notice.hide();
        new Notice(`✅ 项目「${projectName}」创建完成（${count} 个文件）`, 5000);

        try {
            if (typeof plugin.openFullWriterView === 'function') {
                await plugin.openFullWriterView();
            }
        } catch (e) {
            log.warn('[ProjectCreate] 打开 FullWriterView 失败:', e);
        }

        app.workspace.trigger('novel-writer:project-created', {
            projectName: projectRootId,
            projectType,
        });

        return { created: true, projectId: projectRootId, fileCount: count };
    } catch (e) {
        notice.hide();
        log.error('[ProjectCreate] 创建项目失败:', e);
        return { created: false, projectId: projectRootId, fileCount: count, reason: e instanceof Error ? e.message : String(e) };
    }
}
