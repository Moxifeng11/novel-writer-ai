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

export interface PromptManagerDeps {
    getConfig(): Partial<PromptManagerConfig>;
    setConfig(config: Partial<PromptManagerConfig>): Promise<void>;
}

export class PromptManager {
    private deps: PromptManagerDeps;
    private defaultTemplates: PromptTemplate[];
    private config: PromptManagerConfig;

    constructor(deps: PromptManagerDeps) {
        this.deps = deps;
        this.defaultTemplates = JSON.parse(JSON.stringify(DEFAULT_PROMPT_TEMPLATES));
        this.config = { ...DEFAULT_PROMPT_MANAGER_CONFIG, ...deps.getConfig() };
    }

    reloadConfig(): void {
        this.config = { ...DEFAULT_PROMPT_MANAGER_CONFIG, ...this.deps.getConfig() };
    }

    private async saveConfig(): Promise<void> {
        await this.deps.setConfig(this.config);
    }

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

    getTemplateById(id: string): PromptTemplate | null {
        const custom = this.config.customTemplates.find(t => t.id === id);
        if (custom) return custom;
        const def = this.defaultTemplates.find(t => t.id === id);
        return def || null;
    }

    getTemplatesByCategory(category: PromptCategory): PromptTemplate[] {
        return this.getAllTemplates().filter(t => t.category === category);
    }

    getCategories(): { category: PromptCategory; count: number }[] {
        const all = this.getAllTemplates();
        const map = new Map<PromptCategory, number>();
        for (const t of all) {
            map.set(t.category, (map.get(t.category) || 0) + 1);
        }
        return Array.from(map.entries()).map(([category, count]) => ({ category, count }));
    }

    getActiveVersion(template: PromptTemplate): PromptTemplateVersion | null {
        return template.versions.find(v => v.isActive) || template.versions[0] || null;
    }

    getVersion(templateId: string, version: string): PromptTemplateVersion | null {
        const template = this.getTemplateById(templateId);
        if (!template) return null;
        return template.versions.find(v => v.version === version) || null;
    }

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

    async deleteCustomTemplate(templateId: string): Promise<boolean> {
        const idx = this.config.customTemplates.findIndex(t => t.id === templateId);
        if (idx === -1) return false;
        this.config.customTemplates.splice(idx, 1);
        await this.saveConfig();
        return true;
    }

    async resetTemplateToDefault(templateId: string): Promise<boolean> {
        const idx = this.config.customTemplates.findIndex(t => t.id === templateId);
        if (idx === -1) return false;
        this.config.customTemplates.splice(idx, 1);
        await this.saveConfig();
        return true;
    }

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

    getABTests(): ABTest[] {
        return this.config.abTests;
    }

    getABTestById(testId: string): ABTest | null {
        return this.config.abTests.find(t => t.id === testId) || null;
    }

    getActiveABTestForTemplate(templateId: string): ABTest | null {
        return this.config.abTests.find(
            t => t.templateId === templateId && t.status === 'running'
        ) || null;
    }

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

    async deleteABTest(testId: string): Promise<boolean> {
        const idx = this.config.abTests.findIndex(t => t.id === testId);
        if (idx === -1) return false;
        this.config.abTests.splice(idx, 1);
        await this.saveConfig();
        return true;
    }

    selectABVariant(test: ABTest): 'a' | 'b' {
        const rand = Math.random() * 100;
        return rand < test.trafficSplit.a ? 'a' : 'b';
    }

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

    getUsageHistory(templateId?: string, limit = 100): PromptUsageRecord[] {
        let history = [...this.config.usageHistory];
        if (templateId) {
            history = history.filter(r => r.templateId === templateId);
        }
        return history.slice(-limit).reverse();
    }

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

    setABTestingEnabled(enabled: boolean): void {
        this.config.abTestingEnabled = enabled;
        this.saveConfig();
    }

    isABTestingEnabled(): boolean {
        return this.config.abTestingEnabled;
    }

    exportConfig(): string {
        return JSON.stringify(this.config, null, 2);
    }

    importConfig(jsonStr: string): boolean {
        try {
            const data = JSON.parse(jsonStr);
            this.config = { ...DEFAULT_PROMPT_MANAGER_CONFIG, ...data };
            this.saveConfig();
            return true;
        } catch {
            return false;
        }
    }
}

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
