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

export interface PromptVariable {
    name: string;
    type: 'string' | 'number' | 'boolean';
    default?: string;
    description: string;
    required?: boolean;
}

export interface PromptTemplateVersion {
    version: string;
    createdAt: number;
    systemPrompt: string;
    userPrompt: string;
    description?: string;
    isActive: boolean;
}

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

export interface ABTestMetrics {
    totalCalls: number;
    avgRating: number;
    ratingCount: number;
    avgQuality: number;
    qualityCount: number;
    modificationRate: number;
    modificationCount: number;
}

export interface ABTestVariant {
    templateId: string;
    version: string;
    metrics: ABTestMetrics;
}

export type ABTestStatus = 'draft' | 'running' | 'paused' | 'completed';

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

export interface PromptManagerConfig {
    customTemplates: PromptTemplate[];
    abTests: ABTest[];
    usageHistory: PromptUsageRecord[];
    abTestingEnabled: boolean;
}

export const DEFAULT_PROMPT_MANAGER_CONFIG: PromptManagerConfig = {
    customTemplates: [],
    abTests: [],
    usageHistory: [],
    abTestingEnabled: false,
};
