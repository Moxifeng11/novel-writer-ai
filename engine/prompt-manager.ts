import type { PromptTemplate } from './prompts/template-utils';
import { getStepTemplate, fillTemplate } from './prompts/template-utils';

export interface PromptTemplateVersion {
    version: string;
    template: PromptTemplate;
    createdAt: string;
    description: string;
}

export interface PromptVariable {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required: boolean;
    description: string;
    defaultValue?: string;
    validationRegex?: string;
}

export interface PromptManagerOptions {
    enableCache?: boolean;
    cacheTTL?: number;
}

export class PromptManager {
    private templates: Map<string, PromptTemplateVersion[]> = new Map();
    private currentVersions: Map<string, string> = new Map();
    private variableDefinitions: Map<string, PromptVariable[]> = new Map();
    private cache: Map<string, string> = new Map();
    private cacheTTL: number;
    private cacheEnabled: boolean;

    constructor(options: PromptManagerOptions = {}) {
        this.cacheEnabled = options.enableCache ?? true;
        this.cacheTTL = options.cacheTTL ?? 3600000;
        this.initializeBuiltInTemplates();
    }

    private initializeBuiltInTemplates(): void {
        const templateKeys = [
            'infoPlan', 'plotDistill', 'outline', 'characterSoul',
            'emotionPlan', 'sceneExpand', 'bodyGeneration', 'bodyGenerationV2',
            'selfCheck', 'fix', 'finalFix', 'continuityCheck',
            'analysisReport', 'qualityControl', 'memoryGeneration',
        ];

        for (const key of templateKeys) {
            const template = getStepTemplate(key);
            if (template) {
                this.registerTemplate(key, template, '1.0.0', '内置模板');
            }
        }
    }

    registerTemplate(
        key: string,
        template: PromptTemplate,
        version: string = '1.0.0',
        description: string = '',
    ): void {
        const versions = this.templates.get(key) || [];
        versions.push({
            version,
            template,
            createdAt: new Date().toISOString(),
            description,
        });
        versions.sort((a, b) => this.compareVersions(b.version, a.version));
        this.templates.set(key, versions);
        this.currentVersions.set(key, version);
        this.invalidateCache(key);
    }

    /**
     * 取模板（可指定版本）。
     *
     * @param key - 键
     * @param version? - 参数
     * @returns 模板或 null
     */
    getTemplate(key: string, version?: string): PromptTemplate | null {
        const versions = this.templates.get(key);
        if (!versions || versions.length === 0) return null;

        if (version) {
            const found = versions.find(v => v.version === version);
            return found?.template ?? null;
        }

        const currentVersion = this.currentVersions.get(key);
        if (currentVersion) {
            const found = versions.find(v => v.version === currentVersion);
            if (found) return found.template;
        }

        return versions[0]?.template ?? null;
    }

    /**
     * 切换模板生效版本。
     *
     * @param key - 键
     * @param version - 版本
     * @returns 是否切换
     */
    setCurrentVersion(key: string, version: string): boolean {
        const versions = this.templates.get(key);
        if (!versions) return false;

        const exists = versions.some(v => v.version === version);
        if (exists) {
            this.currentVersions.set(key, version);
            this.invalidateCache(key);
            return true;
        }
        return false;
    }

    /**
     * 读取模板版本列表。
     *
     * @param key - 键
     * @returns 版本数组
     */
    getVersions(key: string): string[] {
        const versions = this.templates.get(key);
        return versions?.map(v => v.version) || [];
    }

    /**
     * 删除模板。
     *
     * @param key - 键
     */
    deleteTemplate(key: string): void {
        this.templates.delete(key);
        this.currentVersions.delete(key);
        this.variableDefinitions.delete(key);
        this.invalidateCache(key);
    }

    /**
     * 注册模板变量定义。
     *
     * @param key - 键
     * @param variables - 变量表
     */
    registerVariables(key: string, variables: PromptVariable[]): void {
        this.variableDefinitions.set(key, variables);
    }

    /**
     * 读取模板变量定义。
     *
     * @param key - 键
     * @returns 变量数组
     */
    getVariables(key: string): PromptVariable[] {
        return this.variableDefinitions.get(key) || [];
    }

    /**
     * 校验变量是否齐全。
     *
     * @param key - 键
     * @param vars - 变量表
     * @returns {valid,errors}
     */
    validateVariables(key: string, vars: Record<string, string>): { valid: boolean; errors: string[] } {
        const variables = this.getVariables(key);
        const errors: string[] = [];

        for (const variable of variables) {
            const value = vars[variable.name];

            if (variable.required && (value === undefined || value === null || value === '')) {
                errors.push(`变量 "${variable.name}"（${variable.description}）是必填的`);
                continue;
            }

            if (value !== undefined && value !== null && variable.validationRegex) {
                const regex = new RegExp(variable.validationRegex);
                if (!regex.test(value)) {
                    errors.push(`变量 "${variable.name}" 的值 "${value}" 不符合格式要求`);
                }
            }
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * 渲染模板（变量替换）。
     *
     * @param key - 键
     * @param vars - 变量表
     * @param version? - 参数
     * @returns 渲染文本或 null
     */
    fillTemplate(key: string, vars: Record<string, string>, version?: string): string | null {
        const template = this.getTemplate(key, version);
        if (!template) return null;

        const cacheKey = `${key}:${version || 'current'}:${JSON.stringify(vars)}`;
        if (this.cacheEnabled) {
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;
        }

        const systemPrompt = fillTemplate(template.systemPrompt, vars);
        const userPrompt = fillTemplate(template.userPrompt, vars);
        const result = `${systemPrompt}\n\n${userPrompt}`;

        if (this.cacheEnabled) {
            this.cache.set(cacheKey, result);
            setTimeout(() => this.cache.delete(cacheKey), this.cacheTTL);
        }

        return result;
    }

    fillSeparateTemplates(
        key: string,
        vars: Record<string, string>,
        version?: string,
    ): { systemPrompt: string; userPrompt: string } | null {
        const template = this.getTemplate(key, version);
        if (!template) return null;

        return {
            systemPrompt: fillTemplate(template.systemPrompt, vars),
            userPrompt: fillTemplate(template.userPrompt, vars),
        };
    }

    createDynamicTemplate(
        key: string,
        systemPromptParts: string[],
        userPromptParts: string[],
        version: string = 'dynamic',
        description: string = '动态生成的模板',
    ): void {
        const template: PromptTemplate = {
            description,
            systemPrompt: systemPromptParts.join('\n\n'),
            userPrompt: userPromptParts.join('\n\n'),
        };

        this.registerTemplate(key, template, version, description);
    }

    combineTemplates(
        targetKey: string,
        sourceKeys: string[],
        version: string = 'combined',
        description: string = '组合模板',
    ): boolean {
        const systemParts: string[] = [];
        const userParts: string[] = [];

        for (const sourceKey of sourceKeys) {
            const template = this.getTemplate(sourceKey);
            if (!template) return false;
            systemParts.push(template.systemPrompt);
            userParts.push(template.userPrompt);
        }

        this.createDynamicTemplate(targetKey, systemParts, userParts, version, description);
        return true;
    }

    /**
     * 读取全部模板键。
     * @returns 键数组
     */
    getAllTemplateKeys(): string[] {
        return Array.from(this.templates.keys());
    }

    /**
     * 读取模板信息摘要。
     *
     * @param key - 键
     * @returns 信息对象
     */
    getTemplateInfo(key: string): {
        key: string;
        currentVersion: string | null;
        versions: string[];
        description: string | null;
        variables: PromptVariable[];
    } {
        const versions = this.getVersions(key);
        const currentVersion = this.currentVersions.get(key) || null;
        const template = this.getTemplate(key);

        return {
            key,
            currentVersion,
            versions,
            description: template?.description ?? null,
            variables: this.getVariables(key),
        };
    }

    /**
     * 失效模板缓存。
     *
     * @param key? - 参数
     */
    invalidateCache(key?: string): void {
        if (key) {
            for (const cacheKey of this.cache.keys()) {
                if (cacheKey.startsWith(`${key}:`)) {
                    this.cache.delete(cacheKey);
                }
            }
        } else {
            this.cache.clear();
        }
    }

    /**
     * 读取缓存统计。
     * @returns 统计
     */
    getCacheStats(): { size: number; enabled: boolean; ttl: number } {
        return {
            size: this.cache.size,
            enabled: this.cacheEnabled,
            ttl: this.cacheTTL,
        };
    }

    private compareVersions(a: string, b: string): number {
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);
        const maxLength = Math.max(partsA.length, partsB.length);

        for (let i = 0; i < maxLength; i++) {
            const partA = partsA[i] || 0;
            const partB = partsB[i] || 0;
            if (partA !== partB) return partA - partB;
        }

        return 0;
    }
}