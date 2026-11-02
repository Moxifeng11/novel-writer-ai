/**
 * genre-config-registry.ts — 题材配置注册表
 *
 * 单例模式，管理所有题材配置（GenreConfig）：
 * - 启动时加载 engine/genre/genre-presets/*.genre.json 内置预设
 * - 支持运行时注册自定义配置（同 genreId 时覆盖内置）
 * - 生产环境可通过 setCustomConfigLoader 注入从 vault 读取的配置
 *
 * 设计原则：本类不直接访问文件系统（保持纯逻辑可测试），
 * vault 路径的自定义配置加载由调用方（main.ts）注入。
 */

import type { GenreConfig } from './types';
import cultivationPreset from './genre-presets/cultivation.genre.json';
import militaryPreset from './genre-presets/military.genre.json';
import romancePreset from './genre-presets/romance.genre.json';
import mysteryPreset from './genre-presets/mystery.genre.json';
import scifiPreset from './genre-presets/scifi.genre.json';
import wuxiaPreset from './genre-presets/wuxia.genre.json';
import historyPreset from './genre-presets/history.genre.json';
import fantasyPreset from './genre-presets/fantasy.genre.json';
import urbanPreset from './genre-presets/urban.genre.json';
import genericPreset from './genre-presets/generic.genre.json';

// JSON import 在 strict 模式下推断为 readonly 字面量类型，与 mutable string[] 不兼容，
// 用 as unknown as GenreConfig 双重断言绕过（运行时无开销）
const BUILTIN_PRESETS: GenreConfig[] = [
    cultivationPreset,
    militaryPreset,
    romancePreset,
    mysteryPreset,
    scifiPreset,
    wuxiaPreset,
    historyPreset,
    fantasyPreset,
    urbanPreset,
    genericPreset,
].map(p => ({ ...p }) as unknown as GenreConfig);

/**
 * 自定义配置加载器结构定义。
 */
export type CustomConfigLoader = () => GenreConfig[] | Promise<GenreConfig[]>;

/**
 * 题材配置注册表。
 */
export class GenreConfigRegistry {
    private static instance: GenreConfigRegistry | null = null;

    private configs: Map<string, GenreConfig> = new Map();
    private customLoader: CustomConfigLoader | null = null;
    private customLoaded: boolean = false;

    private constructor() {
        for (const preset of BUILTIN_PRESETS) {
            this.configs.set(preset.genreId, preset);
        }
    }

    /**
     * getInstance 方法。
      * @returns GenreConfigRegistry 实例
     */
    static getInstance(): GenreConfigRegistry {
        if (!GenreConfigRegistry.instance) {
            GenreConfigRegistry.instance = new GenreConfigRegistry();
        }
        return GenreConfigRegistry.instance;
    }

    /**
     * 仅供单元测试重置单例状态使用，生产代码不要调用。
     */
    static resetInstance(): void {
        GenreConfigRegistry.instance = null;
    }

    /**
     * 注册单个自定义配置。同 genreId 时覆盖内置配置。
     * @param config - 配置
     */
    registerCustomConfig(config: GenreConfig): void {
        this.configs.set(config.genreId, { ...config });
    }

    /**
     * 批量注册自定义配置。同 genreId 时覆盖内置配置。
     * @param configs - 配置列表
     */
    loadCustomConfigs(configs: GenreConfig[]): void {
        for (const config of configs) {
            this.registerCustomConfig(config);
        }
    }

    /**
     * 设置自定义配置加载器（生产环境由 main.ts 注入，从 vault 读取 .trae/genres/*.genre.json）。
     * 设置后需调用 reloadCustomConfigs() 才会触发加载。
     * @param loader - 加载器
     */
    setCustomConfigLoader(loader: CustomConfigLoader): void {
        this.customLoader = loader;
        this.customLoaded = false;
    }

    /**
     * 触发自定义配置加载器，加载自定义配置到注册表。
     */
    async reloadCustomConfigs(): Promise<void> {
        if (!this.customLoader) {
            return;
        }
        const configs = await this.customLoader();
        this.loadCustomConfigs(configs);
        this.customLoaded = true;
    }

    /**
     * 按 genreId 查询配置。
     * 未找到时回退到 generic 兜底配置；若 generic 也缺失，抛出错误。
     * @param genreId - 题材ID
      * @returns GenreConfig 实例
     */
    getGenreConfig(genreId: string): GenreConfig {
        const config = this.configs.get(genreId);
        if (config) {
            return config;
        }
        const fallback = this.configs.get('generic');
        if (fallback) {
            return fallback;
        }
        throw new Error(`GenreConfig not found: ${genreId} (and generic fallback missing)`);
    }

    /**
     * 列出所有已注册的 genreId。
     * @returns 结果数组
     */
    listGenreIds(): string[] {
        return Array.from(this.configs.keys());
    }

    /**
     * 判断指定 genreId 是否已注册。
     * @param genreId - 题材ID
     * @returns 是否成功
     */
    hasGenreConfig(genreId: string): boolean {
        return this.configs.has(genreId);
    }
}
