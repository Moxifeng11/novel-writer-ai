/**
 * 提示词分类。
 */
export type PromptCategory =
    | 'character'
    | 'chapter'
    | 'outline'
    | 'expand'
    | 'deconstruct'
    | 'polish'
    | 'cowrite'
    | 'worldview'
    | 'entity'
    | 'other';

/**
 * 提示词变量。
 */
export interface PromptVariable {
    name: string;
    type: 'string' | 'number' | 'boolean';
    default?: string;
    description: string;
    required?: boolean;
}

/**
 * 模板版本。
 */
export interface PromptTemplateVersion {
    version: string;
    createdAt: number;
    systemPrompt: string;
    userPrompt: string;
    description?: string;
    isActive: boolean;
}

/**
 * 提示词模板。
 */
export interface PromptTemplate {
    id: string;
    name: string;
    category: PromptCategory;
    description: string;
    versions: PromptTemplateVersion[];
    variables: PromptVariable[];
    model?: string;
    createdAt: number;
    updatedAt: number;
    isCustom?: boolean;
    tags?: string[];
}

/**
 * A/B 指标。
 */
export interface ABTestMetrics {
    totalCalls: number;
    avgRating: number;
    ratingCount: number;
    avgQuality: number;
    qualityCount: number;
    modificationRate: number;
    modificationCount: number;
}

/**
 * A/B 变体。
 */
export interface ABTestVariant {
    templateId: string;
    version: string;
    metrics: ABTestMetrics;
}

/**
 * A/B 状态。
 */
export type ABTestStatus = 'draft' | 'running' | 'paused' | 'completed';

/**
 * A/B 实验。
 */
export interface ABTest {
    id: string;
    name: string;
    description?: string;
    templateId: string;
    variantA: ABTestVariant;
    variantB: ABTestVariant;
    trafficSplit: { a: number; b: number };
    status: ABTestStatus;
    createdAt: number;
    startedAt?: number;
    endedAt?: number;
    winner?: 'a' | 'b' | 'tie';
    notes?: string;
}

/**
 * 使用记录。
 */
export interface PromptUsageRecord {
    id: string;
    templateId: string;
    version: string;
    timestamp: number;
    durationMs?: number;
    tokensUsed?: { prompt: number; completion: number; total: number };
    rating?: number;
    qualityScore?: number;
    wasModified?: boolean;
    abTestId?: string;
    abVariant?: 'a' | 'b';
    metadata?: Record<string, any>;
}

/**
 * 管理器配置。
 */
export interface PromptManagerConfig {
    customTemplates: PromptTemplate[];
    abTests: ABTest[];
    usageHistory: PromptUsageRecord[];
    abTestingEnabled: boolean;
}

/**
 * 默认配置。
 */
export const DEFAULT_PROMPT_MANAGER_CONFIG: PromptManagerConfig = {
    customTemplates: [],
    abTests: [],
    usageHistory: [],
    abTestingEnabled: false,
};
