import type {
    PromptTemplate,
    PromptTemplateVersion,
    PromptCategory,
    ABTest,
    ABTestStatus,
    ABTestVariant,
    PromptUsageRecord,
    PromptManagerConfig,
} from '../shared/prompt-manager-types';
import { DEFAULT_PROMPT_MANAGER_CONFIG } from '../shared/prompt-manager-types';
import { DEFAULT_PROMPT_TEMPLATES } from './prompt-templates-default';

/**
 * 提示词管理器依赖列表结构定义。
 */
export interface PromptManagerDeps {
    getConfig(): Partial<PromptManagerConfig>;
    setConfig(config: Partial<PromptManagerConfig>): Promise<void>;
}

/**
 * 提示词管理器。
 */
export class PromptManager {
    private deps: PromptManagerDeps;
    private defaultTemplates: PromptTemplate[];
    private config: PromptManagerConfig;

    constructor(deps: PromptManagerDeps) {
        this.deps = deps;
        this.defaultTemplates = JSON.parse(JSON.stringify(DEFAULT_PROMPT_TEMPLATES));
        this.config = { ...DEFAULT_PROMPT_MANAGER_CONFIG, ...deps.getConfig() };
    }

    /**
     * 重新读取配置并重建模板/版本索引。
     * @returns 无
     */
    reloadConfig(): void {
        this.config = { ...DEFAULT_PROMPT_MANAGER_CONFIG, ...this.deps.getConfig() };
    }

    private async saveConfig(): Promise<void> {
        await this.deps.setConfig(this.config);
    }

    /**
     * 同步接口内的写盘：不能 await，但必须吃掉 rejection，
     * 否则持久化失败会变成 unhandled rejection，用户以为已保存。
     */
    private flushConfig(): void {
        void this.saveConfig().catch((e: unknown) => {
            console.error('[PromptManager] 保存提示词配置失败:', e);
        });
    }

    /**
     * 返回全部提示词模板。
     * @returns 模板数组
     */
    getAllTemplates(): PromptTemplate[] {
        const customMap = new Map(this.config.customTemplates.map(t => [t.id, t]));
        const result: PromptTemplate[] = [];
        const defaultIds = new Set<string>();

        for (const dt of this.defaultTemplates) {
            defaultIds.add(dt.id);
            const custom = customMap.get(dt.id);
            result.push(custom || dt);
        }

        for (const ct of this.config.customTemplates) {
            if (!defaultIds.has(ct.id)) {
                result.push(ct);
            }
        }

        return result;
    }

    /**
     * 按 id 取模板。
     *
     * @param id - 标识
     * @returns 模板或 null
     */
    getTemplateById(id: string): PromptTemplate | null {
        const custom = this.config.customTemplates.find(t => t.id === id);
        if (custom) return custom;
        const def = this.defaultTemplates.find(t => t.id === id);
        return def || null;
    }

    /**
     * 按分类取模板。
     *
     * @param category - 分类
     * @returns 模板数组
     */
    getTemplatesByCategory(category: PromptCategory): PromptTemplate[] {
        return this.getAllTemplates().filter(t => t.category === category);
    }

    /**
     * 返回分类及模板数量。
     * @returns 分类计数数组
     */
    getCategories(): { category: PromptCategory; count: number }[] {
        const all = this.getAllTemplates();
        const map = new Map<PromptCategory, number>();
        for (const t of all) {
            map.set(t.category, (map.get(t.category) || 0) + 1);
        }
        return Array.from(map.entries()).map(([category, count]) => ({ category, count }));
    }

    /**
     * 取模板当前生效版本。
     *
     * @param template - 模板
     * @returns 版本或 null
     */
    getActiveVersion(template: PromptTemplate): PromptTemplateVersion | null {
        return template.versions.find(v => v.isActive) || template.versions[0] || null;
    }

    /**
     * 取模板的指定版本。
     *
     * @param templateId - 模板 ID
     * @param version - 版本
     * @returns 版本或 null
     */
    getVersion(templateId: string, version: string): PromptTemplateVersion | null {
        const template = this.getTemplateById(templateId);
        if (!template) return null;
        return template.versions.find(v => v.version === version) || null;
    }

    /**
     * 渲染提示词。
     * @param templateId - 参数值
     * @param variables - 参数值
     * @param version - 参数值
      * @returns string } 结果 或 null
     */
    renderPrompt(
        templateId: string,
        variables: Record<string, string>,
        version?: string
    ): { systemPrompt: string; userPrompt: string; version: string } | null {
        const template = this.getTemplateById(templateId);
        if (!template) return null;

        const ver = version
            ? template.versions.find(v => v.version === version)
            : this.getActiveVersion(template);
        if (!ver) return null;

        return {
            systemPrompt: this.fillTemplate(ver.systemPrompt, variables),
            userPrompt: this.fillTemplate(ver.userPrompt, variables),
            version: ver.version,
        };
    }

    private fillTemplate(template: string, vars: Record<string, string>): string {
        let result = template;
        for (const [key, value] of Object.entries(vars)) {
            result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value || '');
        }
        return result;
    }

    /**
     * 创建自定义模板。
     *
     * @param template - 模板
     * @returns 新模板
     */
    async createCustomTemplate(template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isCustom'> & { id?: string }): Promise<PromptTemplate> {
        const now = Date.now();
        const newTemplate: PromptTemplate = {
            ...template,
            id: template.id || `custom-${now}`,
            isCustom: true,
            createdAt: now,
            updatedAt: now,
            versions: template.versions?.length ? template.versions : [{
                version: '1.0.0',
                createdAt: now,
                systemPrompt: '',
                userPrompt: '',
                isActive: true,
            }],
        };
        this.config.customTemplates.push(newTemplate);
        await this.saveConfig();
        return newTemplate;
    }

    /**
     * 更新模板元数据。
     *
     * @param templateId - 模板 ID
     * @param updates - 更新字段
     * @returns 更新后的模板或 null
     */
    async updateTemplate(templateId: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate | null> {
        const idx = this.config.customTemplates.findIndex(t => t.id === templateId);
        if (idx === -1) {
            const def = this.defaultTemplates.find(t => t.id === templateId);
            if (def) {
                const customCopy: PromptTemplate = {
                    ...JSON.parse(JSON.stringify(def)),
                    ...updates,
                    id: templateId,
                    isCustom: true,
                    updatedAt: Date.now(),
                };
                this.config.customTemplates.push(customCopy);
                await this.saveConfig();
                return customCopy;
            }
            return null;
        }
        this.config.customTemplates[idx] = {
            ...this.config.customTemplates[idx],
            ...updates,
            updatedAt: Date.now(),
        };
        await this.saveConfig();
        return this.config.customTemplates[idx];
    }

    /**
     * 删除自定义模板（内置模板不可删）。
     *
     * @param templateId - 模板 ID
     * @returns 是否删除
     */
    async deleteCustomTemplate(templateId: string): Promise<boolean> {
        const idx = this.config.customTemplates.findIndex(t => t.id === templateId);
        if (idx === -1) return false;
        this.config.customTemplates.splice(idx, 1);
        await this.saveConfig();
        return true;
    }

    /**
     * 把模板恢复为内置默认。
     *
     * @param templateId - 模板 ID
     * @returns 是否恢复
     */
    async resetTemplateToDefault(templateId: string): Promise<boolean> {
        const idx = this.config.customTemplates.findIndex(t => t.id === templateId);
        if (idx === -1) return false;
        this.config.customTemplates.splice(idx, 1);
        await this.saveConfig();
        return true;
    }

    /**
     * 添加版本。
     * @param templateId - 参数值
     * @param versionData - 参数值
      * @returns PromptTemplateVersion 或 null
     */
    async addVersion(
        templateId: string,
        versionData: Omit<PromptTemplateVersion, 'createdAt'>
    ): Promise<PromptTemplateVersion | null> {
        const template = this.config.customTemplates.find(t => t.id === templateId);
        if (!template) {
            const def = this.defaultTemplates.find(t => t.id === templateId);
            if (!def) return null;
            const customCopy: PromptTemplate = JSON.parse(JSON.stringify(def));
            customCopy.isCustom = true;
            customCopy.updatedAt = Date.now();
            const newVersion: PromptTemplateVersion = {
                ...versionData,
                createdAt: Date.now(),
            };
            customCopy.versions.forEach(v => v.isActive = false);
            customCopy.versions.push(newVersion);
            this.config.customTemplates.push(customCopy);
            await this.saveConfig();
            return newVersion;
        }
        const newVersion: PromptTemplateVersion = {
            ...versionData,
            createdAt: Date.now(),
        };
        template.versions.forEach(v => v.isActive = false);
        template.versions.push(newVersion);
        template.updatedAt = Date.now();
        await this.saveConfig();
        return newVersion;
    }

    /**
     * 切换模板生效版本。
     *
     * @param templateId - 模板 ID
     * @param version - 版本
     * @returns 是否切换
     */
    async setActiveVersion(templateId: string, version: string): Promise<boolean> {
        const template = this.config.customTemplates.find(t => t.id === templateId);
        if (!template) {
            const def = this.defaultTemplates.find(t => t.id === templateId);
            if (!def) return false;
            const customCopy: PromptTemplate = JSON.parse(JSON.stringify(def));
            customCopy.isCustom = true;
            customCopy.updatedAt = Date.now();
            const ver = customCopy.versions.find(v => v.version === version);
            if (!ver) return false;
            customCopy.versions.forEach(v => v.isActive = false);
            ver.isActive = true;
            this.config.customTemplates.push(customCopy);
            await this.saveConfig();
            return true;
        }
        const ver = template.versions.find(v => v.version === version);
        if (!ver) return false;
        template.versions.forEach(v => v.isActive = false);
        ver.isActive = true;
        template.updatedAt = Date.now();
        await this.saveConfig();
        return true;
    }

    /**
     * 返回全部 A/B 实验。
     * @returns 实验数组
     */
    getABTests(): ABTest[] {
        return this.config.abTests;
    }

    /**
     * 按 id 取实验。
     *
     * @param testId - 测试 ID
     * @returns 实验或 null
     */
    getABTestById(testId: string): ABTest | null {
        return this.config.abTests.find(t => t.id === testId) || null;
    }

    /**
     * 取模板当前运行中的实验。
     *
     * @param templateId - 模板 ID
     * @returns 实验或 null
     */
    getActiveABTestForTemplate(templateId: string): ABTest | null {
        return this.config.abTests.find(
            t => t.templateId === templateId && t.status === 'running'
        ) || null;
    }

    /**
     * createABTest 方法。
     * @param data - 数据
      * @returns ABTest 实例
     */
    async createABTest(data: {
        name: string;
        description?: string;
        templateId: string;
        variantAVersion: string;
        variantBVersion: string;
        trafficSplit?: { a: number; b: number };
    }): Promise<ABTest> {
        const test: ABTest = {
            id: `abtest-${Date.now()}`,
            name: data.name,
            description: data.description,
            templateId: data.templateId,
            variantA: {
                templateId: data.templateId,
                version: data.variantAVersion,
                metrics: {
                    totalCalls: 0,
                    avgRating: 0,
                    ratingCount: 0,
                    avgQuality: 0,
                    qualityCount: 0,
                    modificationRate: 0,
                    modificationCount: 0,
                },
            },
            variantB: {
                templateId: data.templateId,
                version: data.variantBVersion,
                metrics: {
                    totalCalls: 0,
                    avgRating: 0,
                    ratingCount: 0,
                    avgQuality: 0,
                    qualityCount: 0,
                    modificationRate: 0,
                    modificationCount: 0,
                },
            },
            trafficSplit: data.trafficSplit || { a: 50, b: 50 },
            status: 'draft',
            createdAt: Date.now(),
        };
        this.config.abTests.push(test);
        await this.saveConfig();
        return test;
    }

    /**
     * 更新实验状态。
     *
     * @param testId - 测试 ID
     * @param status - 状态
     * @returns 更新后的实验或 null
     */
    async updateABTestStatus(testId: string, status: ABTestStatus): Promise<ABTest | null> {
        const test = this.config.abTests.find(t => t.id === testId);
        if (!test) return null;
        test.status = status;
        if (status === 'running' && !test.startedAt) {
            test.startedAt = Date.now();
        }
        if (status === 'completed') {
            test.endedAt = Date.now();
        }
        await this.saveConfig();
        return test;
    }

    /**
     * 删除实验。
     *
     * @param testId - 测试 ID
     * @returns 是否删除
     */
    async deleteABTest(testId: string): Promise<boolean> {
        const idx = this.config.abTests.findIndex(t => t.id === testId);
        if (idx === -1) return false;
        this.config.abTests.splice(idx, 1);
        await this.saveConfig();
        return true;
    }

    /**
     * 按实验权重选择 a/b 变体。
     *
     * @param test - 测试实例
     * @returns 变体
     */
    selectABVariant(test: ABTest): 'a' | 'b' {
        const rand = Math.random() * 100;
        return rand < test.trafficSplit.a ? 'a' : 'b';
    }

    /**
     * getPromptWithABTest 方法。
     * @param templateId - 参数值
     * @param variables - 参数值
      * @returns 'a' 结果 或 null
     */
    getPromptWithABTest(
        templateId: string,
        variables: Record<string, string>
    ): { systemPrompt: string; userPrompt: string; version: string; abTestId?: string; abVariant?: 'a' | 'b' } | null {
        const activeTest = this.config.abTestingEnabled
            ? this.getActiveABTestForTemplate(templateId)
            : null;

        if (activeTest) {
            const variant = this.selectABVariant(activeTest);
            const version = variant === 'a' ? activeTest.variantA.version : activeTest.variantB.version;
            const result = this.renderPrompt(templateId, variables, version);
            if (!result) return null;
            return {
                ...result,
                abTestId: activeTest.id,
                abVariant: variant,
            };
        }

        return this.renderPrompt(templateId, variables);
    }

    /**
     * recordUsage 方法。
     * @param record - 记录
     */
    async recordUsage(record: Omit<PromptUsageRecord, 'id' | 'timestamp'> & { timestamp?: number }): Promise<void> {
        const usageRecord: PromptUsageRecord = {
            id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ...record,
            timestamp: record.timestamp || Date.now(),
        };

        this.config.usageHistory.push(usageRecord);
        if (this.config.usageHistory.length > 1000) {
            this.config.usageHistory = this.config.usageHistory.slice(-1000);
        }

        if (record.abTestId && record.abVariant) {
            const test = this.config.abTests.find(t => t.id === record.abTestId);
            if (test) {
                const variant = record.abVariant === 'a' ? test.variantA : test.variantB;
                variant.metrics.totalCalls++;

                if (record.rating !== undefined) {
                    const total = variant.metrics.avgRating * variant.metrics.ratingCount + record.rating;
                    variant.metrics.ratingCount++;
                    variant.metrics.avgRating = total / variant.metrics.ratingCount;
                }
                if (record.qualityScore !== undefined) {
                    const total = variant.metrics.avgQuality * variant.metrics.qualityCount + record.qualityScore;
                    variant.metrics.qualityCount++;
                    variant.metrics.avgQuality = total / variant.metrics.qualityCount;
                }
                if (record.wasModified !== undefined) {
                    const total = variant.metrics.modificationRate * variant.metrics.modificationCount + (record.wasModified ? 1 : 0);
                    variant.metrics.modificationCount++;
                    variant.metrics.modificationRate = total / variant.metrics.modificationCount;
                }
            }
        }

        await this.saveConfig();
    }

    /**
     * 读取模板使用历史。
     *
     * @param templateId - 参数
     * @param limit = 100 - 参数
     * @returns 使用记录数组
     */
    getUsageHistory(templateId?: string, limit = 100): PromptUsageRecord[] {
        let history = [...this.config.usageHistory];
        if (templateId) {
            history = history.filter(r => r.templateId === templateId);
        }
        return history.slice(-limit).reverse();
    }

    /**
     * 计算实验统计与胜者。
     *
     * @param testId - 测试 ID
     * @returns 统计或 null
     */
    getABTestStats(testId: string): { test: ABTest; winner?: 'a' | 'b' | 'tie'; confidence?: number } | null {
        const test = this.getABTestById(testId);
        if (!test) return null;

        const a = test.variantA.metrics;
        const b = test.variantB.metrics;

        let winner: 'a' | 'b' | 'tie' | undefined;

        const aScore = a.ratingCount > 0 ? a.avgRating : (a.qualityCount > 0 ? a.avgQuality : 0);
        const bScore = b.ratingCount > 0 ? b.avgRating : (b.qualityCount > 0 ? b.avgQuality : 0);

        if (a.totalCalls > 10 && b.totalCalls > 10) {
            if (aScore > bScore + 0.5) {
                winner = 'a';
            } else if (bScore > aScore + 0.5) {
                winner = 'b';
            } else {
                winner = 'tie';
            }
        }

        return { test, winner };
    }

    /**
     * 手动指定实验胜者。
     *
     * @param testId - 测试 ID
     * @param winner - 胜出项
     * @returns 是否成功
     */
    async setWinner(testId: string, winner: 'a' | 'b'): Promise<boolean> {
        const test = this.config.abTests.find(t => t.id === testId);
        if (!test) return false;
        test.winner = winner;
        test.status = 'completed';
        test.endedAt = Date.now();

        const winningVersion = winner === 'a' ? test.variantA.version : test.variantB.version;
        await this.setActiveVersion(test.templateId, winningVersion);

        await this.saveConfig();
        return true;
    }

    /**
     * 开关 A/B 实验。
     *
     * @param enabled - 是否启用
     * @returns 无
     */
    setABTestingEnabled(enabled: boolean): void {
        this.config.abTestingEnabled = enabled;
        this.flushConfig();
    }

    /**
     * A/B 实验是否启用。
     * @returns 布尔值
     */
    isABTestingEnabled(): boolean {
        return this.config.abTestingEnabled;
    }

    /**
     * 导出模板/实验配置为 JSON。
     * @returns JSON 文本
     */
    exportConfig(): string {
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * 从 JSON 导入配置。
     *
     * @param jsonStr - JSON 字符串
     * @returns 是否成功
     */
    importConfig(jsonStr: string): boolean {
        try {
            const data = JSON.parse(jsonStr);
            this.config = { ...DEFAULT_PROMPT_MANAGER_CONFIG, ...data };
            this.flushConfig();
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * PROMPT_CATEGORY_LABELS 常量。
 */
export const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
    character: '👤 人设生成',
    chapter: '📖 章节生成',
    outline: '📋 大纲生成',
    expand: '✨ 扩写',
    deconstruct: '🔍 拆解',
    polish: '✍️ 润色',
    cowrite: '🤝 协同写作',
    worldview: '🌍 世界观',
    entity: '🏛 实体生成',
    other: '📦 其他',
};
