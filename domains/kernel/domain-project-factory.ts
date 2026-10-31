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
import { ENGINE_NAMES } from '../../engine/engine-registry';
import { newProjectPath } from './project-locator';
import { createLogger } from '../../shared/logger';

const log = createLogger('DomainProjectFactory');

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

export class DomainProjectFactory {
    constructor(
        private readonly app: import('obsidian').App,
        private readonly plugin: NovelWriterPlugin,
        private readonly adapter: DataAdapter
    ) {}

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

        new Notice(`✅ ${spec.label}项目「${input.name}」创建完成`, 5000);
        await input.onCreated?.(projectId);
        return projectId;
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
