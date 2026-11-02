/**
 * 建议类型。
 */
export type SuggestionType =
    | 'character'
    | 'character_merge'
    | 'character_role'
    | 'relationship'
    | 'theme'
    | 'technique'
    | 'plot'
    | 'quality';

/**
 * 建议状态。
 */
export type SuggestionStatus = 'pending' | 'adopted' | 'rejected' | 'modified';

/**
 * 建议来源。
 */
export type SuggestionSource = 'rule' | 'vector' | 'llm';

/**
 * 分析建议。
 */
export interface AnalysisSuggestion {
    id: string;
    type: SuggestionType;
    status: SuggestionStatus;
    confidence: number;
    source: SuggestionSource;
    payload: Record<string, any>;
    originalPayload?: Record<string, any>;
    createdAt: number;
    adoptedAt?: number;
    reason?: string;
    evidence?: string[];
}

/**
 * 角色候选。
 */
export interface CharacterCandidate {
    name: string;
    aliases: string[];
    confidence: number;
    source: SuggestionSource;
    evidence: string[];
    mentionCount: number;
    firstAppearance: number;
    lastAppearance: number;
}

/**
 * 角色合并建议。
 */
export interface CharacterMergeSuggestion {
    sourceName: string;
    targetName: string;
    reason: string;
    similarity: number;
}

/**
 * 识别流水线选项。
 */
export interface RecognitionPipelineOptions {
    enableRuleLayer: boolean;
    enableVectorLayer: boolean;
    enableLLMLayer: boolean;
    vectorThreshold?: number;
    llmBatchSize?: number;
    maxCandidates?: number;
    onProgress?: (stage: string, progress: number) => void;
}

/**
 * 角色识别结果。
 */
export interface CharacterRecognitionResult {
    ruleCandidates: CharacterCandidate[];
    vectorFiltered: CharacterCandidate[];
    llmVerified: CharacterCandidate[];
    finalCharacters: any[];
    suggestions: AnalysisSuggestion[];
    mergeSuggestions: AnalysisSuggestion[];
    layerStatus: {
        rule: 'success' | 'skipped' | 'failed';
        vector: 'success' | 'skipped' | 'failed';
        llm: 'success' | 'skipped' | 'failed';
    };
    errors?: string[];
}
