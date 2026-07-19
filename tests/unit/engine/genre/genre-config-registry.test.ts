import { describe, it, expect, beforeEach } from 'vitest';
import { GenreConfigRegistry } from '../../../../engine/genre/genre-config-registry';
import type { GenreConfig } from '../../../../engine/genre/types';

function buildCustomConfig(overrides: Partial<GenreConfig> & Pick<GenreConfig, 'genreId'>): GenreConfig {
    return {
        displayName: overrides.genreId,
        behaviorTraits: [],
        abilityKeywords: [],
        techniqueKeywords: [],
        foreshadowTypes: [],
        conflictKeywords: [],
        showSignalWords: [],
        styleKeywords: [],
        detectorSignals: [],
        ...overrides,
    };
}

describe('GenreConfigRegistry - 配置注册表', () => {
    let registry: GenreConfigRegistry;

    beforeEach(() => {
        GenreConfigRegistry.resetInstance();
        registry = GenreConfigRegistry.getInstance();
    });

    describe('getGenreConfig - 按 genreId 查询', () => {
        it('military 配置包含统帅', () => {
            const config = registry.getGenreConfig('military');
            expect(config.genreId).toBe('military');
            expect(config.abilityKeywords).toContain('统帅');
            expect(config.techniqueKeywords).toContain('军事谋略');
            expect(config.conflictKeywords).toContain('厮杀');
        });

        it('cultivation 配置包含功法', () => {
            const config = registry.getGenreConfig('cultivation');
            expect(config.genreId).toBe('cultivation');
            expect(config.abilityKeywords).toContain('功法');
            expect(config.techniqueKeywords).toContain('升级');
            expect(config.foreshadowTypes).toContain('功法');
        });

        it('generic 配置存在且 detectorSignals 为空', () => {
            const config = registry.getGenreConfig('generic');
            expect(config.genreId).toBe('generic');
            expect(config.detectorSignals).toEqual([]);
        });

        it('未找到 genreId 时回退到 generic', () => {
            const config = registry.getGenreConfig('non-existent-genre');
            expect(config.genreId).toBe('generic');
        });

        it('10 种内置题材配置字段完整（7 类关键词 + detectorSignals）', () => {
            const expectedIds = [
                'cultivation', 'military', 'romance', 'mystery', 'scifi',
                'wuxia', 'history', 'fantasy', 'urban', 'generic',
            ];
            for (const id of expectedIds) {
                const config = registry.getGenreConfig(id);
                expect(config.genreId).toBe(id);
                expect(config.displayName).toBeTruthy();
                expect(Array.isArray(config.behaviorTraits)).toBe(true);
                expect(Array.isArray(config.abilityKeywords)).toBe(true);
                expect(Array.isArray(config.techniqueKeywords)).toBe(true);
                expect(Array.isArray(config.foreshadowTypes)).toBe(true);
                expect(Array.isArray(config.conflictKeywords)).toBe(true);
                expect(Array.isArray(config.showSignalWords)).toBe(true);
                expect(Array.isArray(config.styleKeywords)).toBe(true);
                expect(Array.isArray(config.detectorSignals)).toBe(true);
            }
        });
    });

    describe('listGenreIds / hasGenreConfig', () => {
        it('内置 10 种题材全部加载', () => {
            const ids = registry.listGenreIds();
            expect(ids).toContain('cultivation');
            expect(ids).toContain('military');
            expect(ids).toContain('romance');
            expect(ids).toContain('mystery');
            expect(ids).toContain('scifi');
            expect(ids).toContain('wuxia');
            expect(ids).toContain('history');
            expect(ids).toContain('fantasy');
            expect(ids).toContain('urban');
            expect(ids).toContain('generic');
            expect(ids.length).toBeGreaterThanOrEqual(10);
        });

        it('hasGenreConfig 正确返回', () => {
            expect(registry.hasGenreConfig('military')).toBe(true);
            expect(registry.hasGenreConfig('non-existent')).toBe(false);
        });
    });

    describe('registerCustomConfig / loadCustomConfigs - 自定义配置', () => {
        it('注册新自定义题材', () => {
            const custom = buildCustomConfig({
                genreId: 'my-custom',
                displayName: '自定义题材',
                abilityKeywords: ['特殊能力'],
                detectorSignals: ['特殊信号'],
            });
            registry.registerCustomConfig(custom);
            const config = registry.getGenreConfig('my-custom');
            expect(config.genreId).toBe('my-custom');
            expect(config.abilityKeywords).toContain('特殊能力');
            expect(registry.hasGenreConfig('my-custom')).toBe(true);
        });

        it('同 genreId 自定义配置覆盖内置（优先级高于内置）', () => {
            const custom = buildCustomConfig({
                genreId: 'military',
                displayName: '自定义军事',
                abilityKeywords: ['自定义能力'],
            });
            registry.registerCustomConfig(custom);
            const config = registry.getGenreConfig('military');
            expect(config.displayName).toBe('自定义军事');
            expect(config.abilityKeywords).toContain('自定义能力');
            expect(config.abilityKeywords).not.toContain('统帅');
        });

        it('loadCustomConfigs 批量注册', () => {
            const configs = [
                buildCustomConfig({ genreId: 'batch-1' }),
                buildCustomConfig({ genreId: 'batch-2' }),
            ];
            registry.loadCustomConfigs(configs);
            expect(registry.hasGenreConfig('batch-1')).toBe(true);
            expect(registry.hasGenreConfig('batch-2')).toBe(true);
        });
    });

    describe('setCustomConfigLoader - 异步加载器', () => {
        it('异步加载自定义配置', async () => {
            const custom = buildCustomConfig({
                genreId: 'async-custom',
                displayName: '异步自定义',
            });
            registry.setCustomConfigLoader(async () => [custom]);
            await registry.reloadCustomConfigs();
            expect(registry.hasGenreConfig('async-custom')).toBe(true);
            const config = registry.getGenreConfig('async-custom');
            expect(config.displayName).toBe('异步自定义');
        });

        it('未设置 loader 时 reloadCustomConfigs 不报错', async () => {
            await expect(registry.reloadCustomConfigs()).resolves.toBeUndefined();
        });
    });

    describe('单例模式', () => {
        it('getInstance 返回同一实例', () => {
            const a = GenreConfigRegistry.getInstance();
            const b = GenreConfigRegistry.getInstance();
            expect(a).toBe(b);
        });

        it('resetInstance 后获取新实例', () => {
            const a = GenreConfigRegistry.getInstance();
            GenreConfigRegistry.resetInstance();
            const b = GenreConfigRegistry.getInstance();
            expect(a).not.toBe(b);
        });
    });
});
