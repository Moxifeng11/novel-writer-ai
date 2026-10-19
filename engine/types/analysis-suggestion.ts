export type SuggestionType =
    | 'character'
    | 'character_merge'
    | 'character_role'
    | 'relationship'
    | 'theme'
    | 'technique'
    | 'plot'
    | 'quality';

export type SuggestionStatus = 'pending' | 'adopted' | 'rejected' | 'modified';

export type SuggestionSource = 'rule' | 'vector' | 'llm';

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

export interface CharacterMergeSuggestion {
    sourceName: string;
    targetName: string;
    reason: string;
    similarity: number;
}

export interface RecognitionPipelineOptions {
    enableRuleLayer: boolean;
    enableVectorLayer: boolean;
    enableLLMLayer: boolean;
    vectorThreshold?: number;
    llmBatchSize?: number;
    maxCandidates?: number;
    onProgress?: (stage: string, progress: number) => void;
}

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
