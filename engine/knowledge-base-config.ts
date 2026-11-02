/**
 * knowledge-base-config.ts — 知识库用户自定义配置管理
 *
 * 功能：管理用户自定义的知识参考库配置
 * 存储位置：知识库目录下的 _config/ 子目录
 * 包含：自定义题材、自定义人设标签、自定义技巧库等
 */

import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import { kbConfigDir, kbConfigFile } from '../shared/paths';
import { GenreConfig, TechniqueDef, SubGenreConfig } from '../shared/webnovel-knowledge-base';
import { createLogger } from '../shared/logger';

const log = createLogger('KnowledgeBaseConfig');

/**
 * 自定义题材结构定义。
 */
export type CustomGenre = GenreConfig & { isCustom: boolean };

/**
 * LegacyCustomGenre 类型定义。
 */
export interface LegacyCustomGenre {
    id: string;
    name: string;
    category: 'male' | 'female' | 'neutral';
    description: string;
    isCustom: boolean;
}

/**
 * 自定义技法结构定义。
 */
export interface CustomTechnique {
    id: string;
    name: string;
    category: 'structure' | 'cool_point' | 'emotion' | 'rhythm' | 'genre';
    description: string;
    keywords: string[];
    baseConfidence: number;
    genreWeight: number;
}

/**
 * 知识基础配置结构定义。
 */
export interface KnowledgeBaseConfig {
    customGenres: CustomGenre[];
    customPersonalityTags: Record<string, string[]>;
    customAbilityTypes: Record<string, string[]>;
    customTechniques: Record<string, CustomTechnique[]>;
    lastUpdated: number;
}

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
    customGenres: [],
    customPersonalityTags: {},
    customAbilityTypes: {},
    customTechniques: {},
    lastUpdated: 0,
};

const DEFAULT_GENRE_WEIGHTS = {
    character: 0.2,
    foreshadow: 0.15,
    technique: 0.2,
    style: 0.1,
    rhythm: 0.15,
    structure: 0.1,
};

function isLegacyCustomGenre(genre: any): genre is LegacyCustomGenre {
    return genre && !genre.personalityTags && !genre.abilityTypes && !genre.roleTypes && !genre.backgroundTypes && !genre.techniques && !genre.weights;
}

function convertLegacyToFull(legacy: LegacyCustomGenre): CustomGenre {
    return {
        id: legacy.id,
        name: legacy.name,
        category: legacy.category,
        description: legacy.description,
        personalityTags: [],
        abilityTypes: [],
        roleTypes: [],
        backgroundTypes: [],
        techniques: [],
        subGenres: [],
        weights: { ...DEFAULT_GENRE_WEIGHTS },
        isCustom: true,
    };
}

/**
 * 知识基础配置管理器。
 */
export class KnowledgeBaseConfigManager {
    private app: App;
    private baseDir?: string;
    private fs: FileSystemPort | null = null;
    private config: KnowledgeBaseConfig = { ...DEFAULT_CONFIG };
    private loaded = false;

    constructor(app: App, baseDir?: string) {
        this.app = app;
        this.baseDir = baseDir;
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    private async ensureConfigDir(): Promise<void> {
        const fs = this.getFS();
        const configDir = kbConfigDir(this.baseDir);
        await fs.mkdir(configDir).catch(() => undefined);
    }

    /**
     * 加载配置（不存在时返回默认）。
     * @returns 配置对象
     */
    async load(): Promise<KnowledgeBaseConfig> {
        if (this.loaded) {
            return this.config;
        }

        const fs = this.getFS();
        const configPath = kbConfigFile(this.baseDir);

        let content: string | null = null;
        try {
            content = await fs.read(configPath);
        } catch {
            content = null;
        }

        if (content === null) {
            // 文件确实不存在：写一份默认配置作为起点
            this.config = { ...DEFAULT_CONFIG };
            await this.save();
        } else {
            try {
                const parsed = JSON.parse(content) as Partial<KnowledgeBaseConfig>;
                this.config = this.mergeConfig(DEFAULT_CONFIG, parsed);
            } catch (e) {
                // 读到了但解析失败（同步冲突/半写）：只在内存用默认值，
                // 绝不覆盖磁盘——旧实现会立刻 save()，把用户自定义分类永久抹掉。
                log.warn('[KnowledgeBaseConfig] 配置解析失败，本次会话使用默认值，磁盘文件保留原样:', e);
                this.config = { ...DEFAULT_CONFIG };
            }
        }

        this.loaded = true;
        return this.config;
    }

    private normalizeCustomGenres(genres: any[]): CustomGenre[] {
        return genres.map(genre => {
            if (isLegacyCustomGenre(genre)) {
                return convertLegacyToFull(genre);
            }
            return { ...genre, isCustom: true };
        });
    }

    private mergeConfig(base: KnowledgeBaseConfig, override: Partial<KnowledgeBaseConfig>): KnowledgeBaseConfig {
        return {
            customGenres: override.customGenres ? this.normalizeCustomGenres(override.customGenres) : base.customGenres,
            customPersonalityTags: override.customPersonalityTags ?? base.customPersonalityTags,
            customAbilityTypes: override.customAbilityTypes ?? base.customAbilityTypes,
            customTechniques: override.customTechniques ?? base.customTechniques,
            lastUpdated: override.lastUpdated ?? base.lastUpdated,
        };
    }

    /**
     * 保存配置到磁盘。
     * @returns 无
     */
    async save(): Promise<void> {
        await this.ensureConfigDir();
        const fs = this.getFS();
        const configPath = kbConfigFile(this.baseDir);

        this.config.lastUpdated = Date.now();
        const content = JSON.stringify(this.config, null, 2);
        await fs.write(configPath, content);
    }

    /**
     * 读取内存中的配置。
     * @returns 配置对象
     */
    getConfig(): KnowledgeBaseConfig {
        return this.config;
    }

    /**
     * 新增自定义题材。
     *
     * @param genre - 题材
     * @returns 无
     */
    async addCustomGenre(genre: Omit<CustomGenre, 'isCustom'>): Promise<void> {
        await this.load();
        const exists = this.config.customGenres.some(g => g.id === genre.id);
        if (!exists) {
            this.config.customGenres.push({ ...genre, isCustom: true });
            await this.save();
        }
    }

    /**
     * 更新自定义题材。
     *
     * @param id - 标识
     * @param updates - 更新字段
     * @returns 无
     */
    async updateCustomGenre(id: string, updates: Partial<Omit<CustomGenre, 'id' | 'isCustom'>>): Promise<void> {
        await this.load();
        const index = this.config.customGenres.findIndex(g => g.id === id);
        if (index !== -1) {
            this.config.customGenres[index] = {
                ...this.config.customGenres[index],
                ...updates,
            };
            await this.save();
        }
    }

    /**
     * 删除自定义题材。
     *
     * @param id - 标识
     * @returns 无
     */
    async deleteCustomGenre(id: string): Promise<void> {
        await this.load();
        this.config.customGenres = this.config.customGenres.filter(g => g.id !== id);
        delete this.config.customPersonalityTags[id];
        delete this.config.customAbilityTypes[id];
        delete this.config.customTechniques[id];
        await this.save();
    }

    /**
     * 覆盖某题材的性格标签。
     *
     * @param genreId - 题材 ID
     * @param tags - 标签列表
     * @returns 无
     */
    async setPersonalityTags(genreId: string, tags: string[]): Promise<void> {
        await this.load();
        this.config.customPersonalityTags[genreId] = tags;
        await this.save();
    }

    /**
     * 添加性格标签。
     *
     * @param genreId - 题材 ID
     * @param tag - 标签
     * @returns 无
     */
    async addPersonalityTag(genreId: string, tag: string): Promise<void> {
        await this.load();
        if (!this.config.customPersonalityTags[genreId]) {
            this.config.customPersonalityTags[genreId] = [];
        }
        if (!this.config.customPersonalityTags[genreId].includes(tag)) {
            this.config.customPersonalityTags[genreId].push(tag);
            await this.save();
        }
    }

    /**
     * 移除性格标签。
     *
     * @param genreId - 题材 ID
     * @param tag - 标签
     * @returns 无
     */
    async removePersonalityTag(genreId: string, tag: string): Promise<void> {
        await this.load();
        if (this.config.customPersonalityTags[genreId]) {
            this.config.customPersonalityTags[genreId] = this.config.customPersonalityTags[genreId].filter(t => t !== tag);
            await this.save();
        }
    }

    /**
     * 覆盖某题材的能力类型。
     *
     * @param genreId - 题材 ID
     * @param types - 类型列表
     * @returns 无
     */
    async setAbilityTypes(genreId: string, types: string[]): Promise<void> {
        await this.load();
        this.config.customAbilityTypes[genreId] = types;
        await this.save();
    }

    /**
     * 添加能力类型。
     *
     * @param genreId - 题材 ID
     * @param type - 类型
     * @returns 无
     */
    async addAbilityType(genreId: string, type: string): Promise<void> {
        await this.load();
        if (!this.config.customAbilityTypes[genreId]) {
            this.config.customAbilityTypes[genreId] = [];
        }
        if (!this.config.customAbilityTypes[genreId].includes(type)) {
            this.config.customAbilityTypes[genreId].push(type);
            await this.save();
        }
    }

    /**
     * 移除能力类型。
     *
     * @param genreId - 题材 ID
     * @param type - 类型
     * @returns 无
     */
    async removeAbilityType(genreId: string, type: string): Promise<void> {
        await this.load();
        if (this.config.customAbilityTypes[genreId]) {
            this.config.customAbilityTypes[genreId] = this.config.customAbilityTypes[genreId].filter(t => t !== type);
            await this.save();
        }
    }

    /**
     * 覆盖某题材的技法列表。
     *
     * @param genreId - 题材 ID
     * @param techniques - 技法列表
     * @returns 无
     */
    async setTechniques(genreId: string, techniques: CustomTechnique[]): Promise<void> {
        await this.load();
        this.config.customTechniques[genreId] = techniques;
        await this.save();
    }

    /**
     * 添加技法。
     *
     * @param genreId - 题材 ID
     * @param technique - 技法
     * @returns 无
     */
    async addTechnique(genreId: string, technique: CustomTechnique): Promise<void> {
        await this.load();
        if (!this.config.customTechniques[genreId]) {
            this.config.customTechniques[genreId] = [];
        }
        const exists = this.config.customTechniques[genreId].some(t => t.id === technique.id);
        if (!exists) {
            this.config.customTechniques[genreId].push(technique);
            await this.save();
        }
    }

    /**
     * 更新技法。
     *
     * @param genreId - 题材 ID
     * @param techniqueId - 技法 ID
     * @param updates - 更新字段
     * @returns 无
     */
    async updateTechnique(genreId: string, techniqueId: string, updates: Partial<CustomTechnique>): Promise<void> {
        await this.load();
        const techniques = this.config.customTechniques[genreId];
        if (techniques) {
            const index = techniques.findIndex(t => t.id === techniqueId);
            if (index !== -1) {
                techniques[index] = { ...techniques[index], ...updates };
                await this.save();
            }
        }
    }

    /**
     * 删除技法。
     *
     * @param genreId - 题材 ID
     * @param techniqueId - 技法 ID
     * @returns 无
     */
    async deleteTechnique(genreId: string, techniqueId: string): Promise<void> {
        await this.load();
        if (this.config.customTechniques[genreId]) {
            this.config.customTechniques[genreId] = this.config.customTechniques[genreId].filter(t => t.id !== techniqueId);
            await this.save();
        }
    }

    /**
     * 取完整自定义题材配置。
     * @returns 题材数组
     */
    getFullCustomGenres(): GenreConfig[] {
        return this.config.customGenres.map(g => ({ ...g }));
    }

    /**
     * 保存完整题材配置。
     *
     * @param genre - 题材
     * @returns 无
     */
    async saveFullCustomGenre(genre: GenreConfig): Promise<void> {
        await this.load();
        const index = this.config.customGenres.findIndex(g => g.id === genre.id);
        const fullGenre: CustomGenre = { ...genre, isCustom: true };
        if (index !== -1) {
            this.config.customGenres[index] = fullGenre;
        } else {
            this.config.customGenres.push(fullGenre);
        }
        await this.save();
    }

    /**
     * 更新完整题材配置。
     *
     * @param id - 标识
     * @param updates - 更新字段
     * @returns 是否更新
     */
    async updateFullCustomGenre(id: string, updates: Partial<GenreConfig>): Promise<boolean> {
        await this.load();
        const index = this.config.customGenres.findIndex(g => g.id === id);
        if (index === -1) return false;
        this.config.customGenres[index] = {
            ...this.config.customGenres[index],
            ...updates,
            isCustom: true,
        };
        await this.save();
        return true;
    }

    /**
     * 删除完整题材配置。
     *
     * @param id - 标识
     * @returns 是否删除
     */
    async deleteFullCustomGenre(id: string): Promise<boolean> {
        await this.load();
        const index = this.config.customGenres.findIndex(g => g.id === id);
        if (index === -1) return false;
        this.config.customGenres = this.config.customGenres.filter(g => g.id !== id);
        delete this.config.customPersonalityTags[id];
        delete this.config.customAbilityTypes[id];
        delete this.config.customTechniques[id];
        await this.save();
        return true;
    }

    /**
     * 导出配置为 JSON。
     * @returns JSON 文本
     */
    async exportConfig(): Promise<string> {
        await this.load();
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * 导入配置 JSON。
     *
     * @param json - JSON 文本
     * @returns 无
     */
    async importConfig(json: string): Promise<void> {
        try {
            const parsed = JSON.parse(json) as Partial<KnowledgeBaseConfig>;
            this.config = this.mergeConfig(DEFAULT_CONFIG, parsed);
            await this.save();
        } catch (e) {
            throw new Error('配置文件格式错误: ' + (e as Error).message);
        }
    }

    /**
     * 恢复默认配置。
     * @returns 无
     */
    async resetToDefault(): Promise<void> {
        this.config = { ...DEFAULT_CONFIG };
        await this.save();
    }
}
