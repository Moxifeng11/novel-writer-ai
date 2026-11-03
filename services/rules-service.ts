import { App, TFile } from 'obsidian';
import { WRITING_RULES, WRITING_RULES_BUILTIN_VERSION } from '@/shared/writing-rules';
import { VAULT_RULES_PATH, BUILTIN_RULES_VERSION, listRulesVersions } from './rules-registry';
import { composeWritingRules } from '@/shared/writing-rules-mode-addons';
import { resolveProjectMode } from '@/shared/project-mode';
import type { CreationMode } from '@/shared/creation-mode';
import { createLogger } from '@/shared/logger';

const log = createLogger('RulesService');

/** v4 迁移结果：写入了什么、删了几个项目副本 */
export interface RulesMigrationResult {
    /** 元文件缺失（写入模板）或版本 ≠ 4.0.0（覆写）时为 true */
    overwrote: boolean;
    /** 删除的项目内副本数量 */
    removedProjectCopies: number;
}

/**
 * 规则列表配置结构定义。
 */
export interface RulesConfig {
    version: string;
    lastModified: number;
    content: string;
    /** 生效来源 id（`vault:元文件/...` / `builtin:4.0.0`），用于账本与归因 */
    id?: string;
    /** 内容哈希 */
    hash?: string;
    /** 实际来源路径（内置模板为空） */
    path?: string;
    /** v4 单一来源下恒为空（保留字段以兼容旧调用方） */
    warnings?: string[];
    /** 组合进 content 的创作模式（long/short/script） */
    mode?: CreationMode;
}

/**
 * 规则列表服务（v4：vault 元文件是唯一生效来源，模式附录按项目拼入）。
 *
 * @example
 * ```ts
 * const rules = RulesService.getInstance(app);
 * rules.setProject('长篇小说/书甲');
 * const text = await rules.getWritingRules(); // 主文档 + 对应模式附录
 * ```
 */
export class RulesService {
    private static instance: RulesService | null = null;
    private app: App;
    private cachedRules: RulesConfig | null = null;
    private cacheTime = 0;
    /** 缓存对应的项目（空 = 未指定）；避免 A 项目的模式附录污染 B 项目 */
    private cachedProject = '';
    private static readonly CACHE_TTL = 5000;
    /** v4 起不再有多版本可选；字段保留以兼容旧调用方（写入不影响解析） */
    private activeVersion = '';
    /** 当前项目（决定模式附录的拼接） */
    private project = '';

    private constructor(app: App) {
        this.app = app;
    }

    /** 插件卸载/测试隔离：释放单例持有 App 的引用 */
    static resetInstance(): void {
        RulesService.instance = null;
    }

    /**
     * getInstance 方法。
     * @param app - Obsidian 应用实例
      * @returns RulesService 实例
     */
    static getInstance(app: App): RulesService {
        if (!RulesService.instance) {
            RulesService.instance = new RulesService(app);
        }
        return RulesService.instance;
    }

    /**
     * getWritingRules 方法：主文档 + 当前项目的模式附录。
     *
     * @param project - 显式项目；省略时用 setProject 的当前项目
     * @returns 文本结果
     */
    async getWritingRules(project?: string): Promise<string> {
        const rules = await this.getRulesConfig(project);
        return rules.content;
    }

    /**
     * 获取规则列表配置。
     *
     * @param project - 显式项目；省略时用 setProject 的当前项目
     * @returns RulesConfig
     */
    async getRulesConfig(project?: string): Promise<RulesConfig> {
        const target = String(project ?? this.project ?? '').trim();
        const now = Date.now();
        if (this.cachedRules && this.cachedProject === target && now - this.cacheTime < RulesService.CACHE_TTL) {
            return this.cachedRules;
        }

        const rules = await this.loadWritingRules(target);
        this.cachedRules = rules;
        this.cachedProject = target;
        this.cacheTime = now;
        return rules;
    }

    /**
     * 读取生效规则：vault 唯一文件 → 内置模板兜底；再按项目模式拼附录。
     */
    private async loadWritingRules(project = this.project): Promise<RulesConfig> {
        const listing = await listRulesVersions(this.app);
        const doc = listing.active.doc || {
            id: 'builtin:fallback',
            version: BUILTIN_RULES_VERSION,
            content: WRITING_RULES,
            hash: '',
            source: 'builtin' as const,
        };
        let mode: CreationMode = 'long';
        if (project) {
            try {
                mode = await resolveProjectMode(this.app, project);
            } catch (e) {
                log.warn('[RulesService] 解析项目创作模式失败，按长篇处理:', e);
            }
        }
        return {
            version: doc.version,
            lastModified: Date.now(),
            content: composeWritingRules(doc.content, mode),
            id: doc.id,
            hash: doc.hash,
            path: doc.path,
            warnings: [],
            mode,
        };
    }

    /**
     * 兼容旧调用方：v4 没有多版本可选，本方法只使缓存失效。
     *
     * @param _version - 忽略
     */
    setActiveVersion(_version: string | undefined): void {
        this.invalidateCache();
    }

    /**
     * 设置当前项目（决定模式附录）
     *
     * @param project - 项目（路径或对象）
     */
    setProject(project: string | undefined): void {
        const next = String(project || '').trim();
        if (next === this.project) return;
        this.project = next;
        this.invalidateCache();
    }

    /**
     * invalidateCache 方法。
     */
    invalidateCache(): void {
        this.cachedRules = null;
        this.cacheTime = 0;
    }

    /**
     * 规则状态（v4：唯一来源的版本与路径；无「期望版本」概念）。
     *
     * @param project - 显式项目；用于模式附录与缓存键
      * @returns 版本与路径
     */
    async checkRulesVersion(project?: string): Promise<{
        version: string;
        sourcePath: string;
        lastModified: number;
        /** 兼容旧调用方的字段：恒等于 version / '' */
        current: string;
        expected: string;
        currentHash: string;
        currentId: string;
        warnings: string[];
    }> {
        const config = await this.getRulesConfig(project);
        return {
            version: config.version,
            sourcePath: config.path || `(内置模板 ${WRITING_RULES_BUILTIN_VERSION})`,
            lastModified: config.lastModified,
            current: config.version,
            expected: config.version,
            currentHash: config.hash || '',
            currentId: config.id || '',
            warnings: [],
        };
    }

    /**
     * isRulesFilePresent 方法：vault 唯一文件是否存在。
     * @returns 是否成功
     */
    async isRulesFilePresent(): Promise<boolean> {
        return this.app.vault.getAbstractFileByPath(VAULT_RULES_PATH) instanceof TFile;
    }

    /**
     * v4 迁移（幂等，启动时调用一次）：
     * 1. 元文件缺失 → 用内置 v4 模板写入；
     * 2. 元文件存在但 frontmatter `version` ≠ 4.0.0 → 直接覆写为 v4（用户已确认不备份）；
     * 3. 删除各项目内的「项目 / 00-系统模板 / 写作规则.md」副本（项目不再持有副本）。
     *
     * @returns RulesMigrationResult 实例
     */
    async migrateToVaultSingleSource(): Promise<RulesMigrationResult> {
        const result: RulesMigrationResult = { overwrote: false, removedProjectCopies: 0 };

        // 1) 元文件缺失/旧版 → 覆写
        const existing = this.app.vault.getAbstractFileByPath(VAULT_RULES_PATH);
        if (existing instanceof TFile) {
            const content = await this.app.vault.read(existing);
            const versionMatch = content.match(/^version:\s*"?([^"\n]+)"?/m);
            const version = (versionMatch?.[1] || '').trim();
            if (version !== WRITING_RULES_BUILTIN_VERSION) {
                await this.app.vault.modify(existing, WRITING_RULES);
                result.overwrote = true;
                log.info(`[RulesService] 元文件写作规则已覆写为 v${WRITING_RULES_BUILTIN_VERSION}（原 version=${version || '未知'}）`);
            }
        } else {
            const dir = VAULT_RULES_PATH.slice(0, VAULT_RULES_PATH.lastIndexOf('/'));
            try {
                if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFile)) {
                    await this.app.vault.adapter.mkdir(dir);
                }
                await this.app.vault.create(VAULT_RULES_PATH, WRITING_RULES);
                result.overwrote = true;
                log.info(`[RulesService] 已创建唯一规则来源：${VAULT_RULES_PATH}`);
            } catch (e) {
                log.error('[RulesService] 创建元文件写作规则失败:', e);
            }
        }

        // 2) 删除项目内副本（`<项目>/00-系统模板/写作规则.md`，排除元文件自身）
        const copyPattern = /^([^/]+)\/00-系统模板\/写作规则\.md$/;
        for (const file of [...this.app.vault.getFiles()]) {
            const match = file.path.match(copyPattern);
            if (!match || match[1] === '元文件') continue;
            try {
                await this.app.vault.delete(file, true);
                result.removedProjectCopies += 1;
            } catch (e) {
                log.warn('[RulesService] 删除项目规则副本失败:', file.path, e);
            }
        }
        if (result.removedProjectCopies > 0) {
            log.info(`[RulesService] 已删除 ${result.removedProjectCopies} 个项目内写作规则副本（唯一来源：元文件）`);
        }

        if (result.overwrote || result.removedProjectCopies > 0) {
            this.invalidateCache();
        }
        return result;
    }
}
