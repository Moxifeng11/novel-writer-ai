import { App } from 'obsidian';
import { WRITING_RULES } from '../shared/writing-rules';
import { pjWritingRulesTemplate, WRITING_RULES_PATH_PROJECT } from '../shared/paths';
import { BUILTIN_RULES_VERSION, listRulesVersions } from './rules-registry';
import type { VersionedDoc } from '../shared/versioned-registry';
import { createLogger } from '../shared/logger';


const log = createLogger('RulesService');
export interface RulesConfig {
    version: string;
    lastModified: number;
    content: string;
    /** 生效版本 id（`builtin:3.6.0` / `vault:元文件/...`），用于账本与归因 */
    id?: string;
    /** 内容哈希（版本号相同但正文不同时靠它发现漂移） */
    hash?: string;
    /** 实际来源路径（内置版本为空） */
    path?: string;
    /** 漂移/回退告警 */
    warnings?: string[];
}

export class RulesService {
    private static instance: RulesService | null = null;
    private app: App;
    private cachedRules: RulesConfig | null = null;
    private cacheTime = 0;
    private static readonly CACHE_TTL = 5000;
    /** 设置里选择的生效版本（id 或版本号；空 = 按 project/vault/builtin 回退） */
    private activeVersion = '';
    /** 当前项目（用于优先读项目内规则文件） */
    private project = '';

    private constructor(app: App) {
        this.app = app;
    }

    static getInstance(app: App): RulesService {
        if (!RulesService.instance) {
            RulesService.instance = new RulesService(app);
        }
        return RulesService.instance;
    }

    async getWritingRules(): Promise<string> {
        const now = Date.now();
        if (this.cachedRules && now - this.cacheTime < RulesService.CACHE_TTL) {
            return this.cachedRules.content;
        }

        const rules = await this.loadWritingRules();
        this.cachedRules = rules;
        this.cacheTime = now;
        return rules.content;
    }

    async getRulesConfig(): Promise<RulesConfig> {
        const now = Date.now();
        if (this.cachedRules && now - this.cacheTime < RulesService.CACHE_TTL) {
            return this.cachedRules;
        }

        const rules = await this.loadWritingRules();
        this.cachedRules = rules;
        this.cacheTime = now;
        return rules;
    }

    /**
     * 读取生效规则。
     * 旧实现：先读 vault 根 `00-系统模板/写作规则.md`、再读 `元文件` 模板、最后内置——
     * 于是 vault 里那份旧版（一句一段）覆盖了仓库新版，且版本号相同所以没人发现。
     * 现在交给 rules-registry 做多版本选择：设置指定 → 项目 → vault → 内置，并做哈希漂移检测。
     */
    private async loadWritingRules(): Promise<RulesConfig> {
        const listing = await listRulesVersions(this.app, {
            activeVersion: this.activeVersion,
            project: this.project,
        });
        const doc: VersionedDoc = listing.active.doc || {
            id: 'builtin:fallback',
            version: BUILTIN_RULES_VERSION,
            content: WRITING_RULES,
            hash: '',
            source: 'builtin',
        };
        const warnings = [...listing.active.warnings, ...listing.drift];
        if (warnings.length > 0) {
            log.warn('[RulesService] 写作规则版本告警:', warnings.join('；'));
        }
        return {
            version: doc.version,
            lastModified: Date.now(),
            content: doc.content,
            id: doc.id,
            hash: doc.hash,
            path: doc.path,
            warnings,
        };
    }

    /** 设置生效版本（模板变量构建入口在知道项目时调用） */
    setActiveVersion(version: string | undefined): void {
        const next = String(version || '').trim();
        if (next === this.activeVersion) return;
        this.activeVersion = next;
        this.invalidateCache();
    }

    /** 设置当前项目（存在项目内规则文件时优先） */
    setProject(project: string | undefined): void {
        const next = String(project || '').trim();
        if (next === this.project) return;
        this.project = next;
        this.invalidateCache();
    }

    private extractVersion(content: string): string {
        const versionMatch = content.match(/v?(\d+\.\d+\.\d+)/);
        return versionMatch ? versionMatch[1] : 'unknown';
    }

    invalidateCache(): void {
        this.cachedRules = null;
        this.cacheTime = 0;
    }

    async checkRulesVersion(): Promise<{
        current: string;
        expected: string;
        currentHash: string;
        currentId: string;
        sourcePath: string;
        warnings: string[];
    }> {
        const config = await this.getRulesConfig();
        return {
            current: config.version,
            expected: BUILTIN_RULES_VERSION,
            currentHash: config.hash || '',
            currentId: config.id || '',
            sourcePath: config.path || '(内置)',
            warnings: config.warnings || [],
        };
    }

    async isRulesFilePresent(): Promise<boolean> {
        // 只要有任意版本可用就算存在（内置也算，避免「未检测到规则文件」误导）
        const listing = await listRulesVersions(this.app, { activeVersion: this.activeVersion, project: this.project });
        return listing.docs.length > 0
            || Boolean(this.app.vault.getAbstractFileByPath(WRITING_RULES_PATH_PROJECT))
            || Boolean(this.app.vault.getAbstractFileByPath(pjWritingRulesTemplate()));
    }
}