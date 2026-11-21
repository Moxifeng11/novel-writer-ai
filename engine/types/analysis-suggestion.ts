import type { Character } from '@/engine/deconstructors/character-deconstructor';

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
 * 建议载荷：常见字段显式声明，其余按建议类型自行约定。
 */
export interface SuggestionPayload {
    characterName?: string;
    category?: string;
    name?: string;
    aliases?: string[];
    sourceName?: string;
    targetName?: string;
    reason?: string;
    [key: string]: unknown;
}

/**
 * 分析建议。
 */
export interface AnalysisSuggestion {
    id: string;
    type: SuggestionType;
    status: SuggestionStatus;
    confidence: number;
    source: SuggestionSource;
    /** 建议载荷：常见字段显式声明，其余按建议类型自行约定 */
    payload: SuggestionPayload;
    originalPayload?: SuggestionPayload;
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
    finalCharacters: Character[];
    suggestions: AnalysisSuggestion[];
    mergeSuggestions: AnalysisSuggestion[];
    layerStatus: {
        rule: 'success' | 'skipped' | 'failed';
        vector: 'success' | 'skipped' | 'failed';
        llm: 'success' | 'skipped' | 'failed';
    };
    errors?: string[];
}
