/**
 * domain-project-factory.ts - mode-project creation for short/script domains.
 *
 * It intentionally does not use the long-novel CreateProjectModal:
 * short/script projects get their own minimal scaffold and mode content roots.
 */
import type { DataAdapter } from 'obsidian';
import { Notice } from 'obsidian';
import type NovelWriterPlugin from '../../main';
import type { CreationMode, CreationModeMeta } from '../../shared/creation-mode';
import { CREATION_MODE_SPECS, buildCreationModeGuide, buildCreationModeMetaSection } from '../../shared/creation-mode';
import { ensureModeContentStructure } from '../../shared/mode-content';
import { pjProjectMeta } from '../../shared/paths';
import { WritingProfileManager } from '../../engine/writing-profile';
// 只取名字常量：从 engine-registry 引会连带加载整个引擎图（其中 ai-engine 等 runtime import main）
import { ENGINE_NAMES } from '../../shared/engine-names';
import { newProjectPath } from './project-locator';
import { createLogger } from '../../shared/logger';

const log = createLogger('DomainProjectFactory');

/** 创建短篇/剧本项目所需的输入；长篇小说不走本工厂。 */
export interface DomainProjectInput {
    name: string;
    mode: CreationMode;
    genre: string;
    description?: string;
    targetWords: number;
    targetUnits: number;
    shortCategory?: string;
    scriptGenre?: string;
    projectType?: 'original' | 'fanfic';
    onCreated?: (projectId: string) => void | Promise<void>;
}

function validateName(name: string): string | null {
    if (!name) return '项目名称不能为空';
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,20}$/.test(name)) {
        return '项目名只能包含中文、字母、数字、下划线、连字符，且 2-20 字';
    }
    return null;
}

/** 短篇/剧本项目工厂：独立脚手架与模式内容根，不复用长篇创建弹窗。 */
export class DomainProjectFactory {
    constructor(
        private readonly app: import('obsidian').App,
        private readonly plugin: NovelWriterPlugin,
        private readonly adapter: DataAdapter
    ) {}

    /**
     * 创建项目：校验名称 → 检查同名 → 写入 .project 与模式内容结构。
     *
     * @param input - 项目名、模式、题材、目标字数/单元等
     * @returns 新项目 ID（vault 相对路径）
     * @throws 名称非法、已存在、或不属于短篇/剧本模式时抛出
     */
    async create(input: DomainProjectInput): Promise<string> {
        const error = validateName(input.name);
        if (error) throw new Error(error);
        if (input.mode === 'long') throw new Error('长篇小说必须使用长篇创建入口');

        const projectId = newProjectPath(input.name, input.mode);
        if (await this.adapter.exists(projectId)) {
            throw new Error(`项目「${input.name}」已存在于 ${input.mode} 模式库`);
        }

        const meta: CreationModeMeta = {
            mode: input.mode,
            shortCategory: input.shortCategory || '',
            scriptGenre: input.scriptGenre || '',
            targetWords: input.targetWords,
            targetUnits: input.targetUnits,
        };

        const spec = CREATION_MODE_SPECS[input.mode];
        if (
            meta.targetWords < spec.targetWords.min ||
            meta.targetWords > spec.targetWords.max ||
            meta.targetUnits < spec.targetUnits.min ||
            meta.targetUnits > spec.targetUnits.max
        ) {
            throw new Error(`${spec.label}目标字数或单元数量超出范围`);
        }

        await this.adapter.mkdir(projectId);
        // 失败回滚：旧实现 mkdir 成功后任一写盘失败都会留下半成品目录，
        // 重试又被 exists 判成「已存在」→ 用户永久卡住。
        try {
        const projectContent = `# ${input.name}

## 题材
${input.genre}

## 类型
${input.projectType || 'original'}

${input.description ? `## 描述\n${input.description}\n\n` : ''}${buildCreationModeMetaSection(meta)}

## 内容结构
${spec.label}独立内容目录，不使用长篇 03-大纲与章节。
`;
        await this.adapter.write(pjProjectMeta(projectId), projectContent);
        await this.adapter.write(`${projectId}/作品信息.md`, `# ${input.name}

- 创作类型：${spec.label}
- 题材：${input.genre}
- 目标字数：${meta.targetWords}
- 目标${input.mode === 'script' ? '集数' : '节数'}：${meta.targetUnits}
${meta.shortCategory ? `- 短篇分类：${meta.shortCategory}\n` : ''}${meta.scriptGenre ? `- 剧本类型：${meta.scriptGenre}\n` : ''}
`);

        await ensureModeContentStructure(this.adapter, projectId, input.mode);
        await this.writeModeGuide(projectId, meta);

        try {
            const profileManager = this.plugin.engineRegistry.get(ENGINE_NAMES.WRITING_PROFILE_MANAGER);
            const profile = profileManager.generateDefault(input.genre, input.name, input.projectType || 'original');
            profile.creationMode = input.mode;
            profile.shortCategory = meta.shortCategory;
            profile.scriptGenre = meta.scriptGenre;
            profile.targetWords = meta.targetWords;
            profile.targetUnits = meta.targetUnits;
            await profileManager.save(projectId, profile);
        } catch (e) {
            log.warn('初始化模式写作配置失败（不影响项目创建）:', e);
        }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            await this.removeProjectDir(projectId);
            throw new Error(`创建${spec.label}项目失败，已回滚：${message}`);
        }

        new Notice(`✅ ${spec.label}项目「${input.name}」创建完成`, 5000);
        await input.onCreated?.(projectId);
        return projectId;
    }

    /** 尽力删除半成品项目目录（回滚用；失败只记日志，不掩盖原始错误） */
    private async removeProjectDir(projectId: string): Promise<void> {
        try {
            const list = await this.adapter.list(projectId);
            for (const file of list.files) await this.adapter.remove(file);
            for (const folder of list.folders) {
                const nested = await this.adapter.list(folder);
                for (const file of nested.files) await this.adapter.remove(file);
                await this.adapter.rmdir(folder, true);
            }
            await this.adapter.rmdir(projectId, true);
        } catch (e) {
            log.warn('[DomainProjectFactory] 回滚删除半成品目录失败:', e);
        }
    }

    private async writeModeGuide(project: string, meta: CreationModeMeta): Promise<void> {
        const dir = `${project}/00-系统模板`;
        const path = `${dir}/创作模式指南.md`;
        try {
            if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
            await this.adapter.write(path, buildCreationModeGuide(meta));
        } catch (e) {
            log.warn('写创作模式指南失败:', e);
        }
    }
}
