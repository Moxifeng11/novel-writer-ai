import { App, TFile } from 'obsidian';
import { WRITING_RULES } from '../engine/prompt-templates';
import { pjWritingRulesTemplate, WRITING_RULES_PATH_PROJECT } from '../shared/paths';
import { createLogger } from '../shared/logger';


const log = createLogger('RulesService');
export interface RulesConfig {
    version: string;
    lastModified: number;
    content: string;
}

export class RulesService {
    private static instance: RulesService | null = null;
    private app: App;
    private cachedRules: RulesConfig | null = null;
    private cacheTime = 0;
    private static readonly CACHE_TTL = 5000;

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

    private async loadWritingRules(): Promise<RulesConfig> {
        const projectRulesPath = WRITING_RULES_PATH_PROJECT;
        const templateRulesPath = pjWritingRulesTemplate();

        let content = WRITING_RULES;
        let lastModified = 0;

        const projectFile = this.app.vault.getAbstractFileByPath(projectRulesPath);
        if (projectFile instanceof TFile) {
            try {
                content = await this.app.vault.read(projectFile);
                lastModified = projectFile.stat.mtime;
            } catch (e) {
                log.warn('[RulesService] 读取项目写作规则失败:', e);
            }
        } else {
            const templateFile = this.app.vault.getAbstractFileByPath(templateRulesPath);
            if (templateFile instanceof TFile) {
                try {
                    content = await this.app.vault.read(templateFile);
                    lastModified = templateFile.stat.mtime;
                } catch (e) {
                    log.warn('[RulesService] 读取模板写作规则失败:', e);
                }
            }
        }

        const version = this.extractVersion(content);

        return { version, lastModified, content };
    }

    private extractVersion(content: string): string {
        const versionMatch = content.match(/v?(\d+\.\d+\.\d+)/);
        return versionMatch ? versionMatch[1] : 'unknown';
    }

    invalidateCache(): void {
        this.cachedRules = null;
        this.cacheTime = 0;
    }

    async checkRulesVersion(): Promise<{ current: string; expected: string }> {
        const config = await this.getRulesConfig();
        return {
            current: config.version,
            expected: '3.6.0'
        };
    }

    async isRulesFilePresent(): Promise<boolean> {
        const projectRulesPath = WRITING_RULES_PATH_PROJECT;
        const templateRulesPath = pjWritingRulesTemplate();

        return !!(
            this.app.vault.getAbstractFileByPath(projectRulesPath) ||
            this.app.vault.getAbstractFileByPath(templateRulesPath)
        );
    }
}