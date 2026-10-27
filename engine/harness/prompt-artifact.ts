/**
 * prompt-artifact.ts - compiled prompt contract.
 *
 * Business code builds an artifact instead of concatenating strings; the
 * artifact carries template version, context/rule/contract ids and a stable
 * hash for audit, caching and reproduction.
 */
import type { CreationMode } from '../../shared/creation-mode';

export interface PromptTokenBudget {
    maxInput: number;
    maxOutput: number;
    thinkingBudget?: number;
}

export interface PromptArtifactInput {
    taskId: string;
    mode: CreationMode;
    templateId: string;
    templateVersion: string;
    variables?: Record<string, string | number | string[]>;
    contextPackId: string;
    ruleSetId: string;
    outputContractId: string;
    systemPrompt: string;
    userPrompt: string;
    tokenBudget: PromptTokenBudget;
}

export interface PromptArtifact extends PromptArtifactInput {
    hash: string;
    createdAt: number;
}

function stableVariables(variables: Record<string, string | number | string[]> = {}): string {
    return Object.keys(variables)
        .sort()
        .map(key => {
            const value = variables[key];
            return `${key}=${Array.isArray(value) ? value.join('\u001f') : String(value)}`;
        })
        .join('\u001e');
}

/** FNV-1a 32-bit; stable in browser and node, used for audit ids only. */
export function hashPromptArtifact(input: PromptArtifactInput): string {
    const payload = [
        input.taskId,
        input.mode,
        input.templateId,
        input.templateVersion,
        stableVariables(input.variables),
        input.contextPackId,
        input.ruleSetId,
        input.outputContractId,
        input.systemPrompt,
        input.userPrompt,
        String(input.tokenBudget.maxInput),
        String(input.tokenBudget.maxOutput),
        String(input.tokenBudget.thinkingBudget ?? ''),
    ].join('\u001d');
    let hash = 2166136261;
    for (let i = 0; i < payload.length; i++) {
        hash ^= payload.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `pa_${hash.toString(16).padStart(8, '0')}`;
}

export function compilePromptArtifact(input: PromptArtifactInput): PromptArtifact {
    if (!input.taskId.trim()) throw new Error('PromptArtifact: taskId 不能为空');
    if (!input.templateId.trim() || !input.templateVersion.trim()) {
        throw new Error('PromptArtifact: templateId/templateVersion 不能为空');
    }
    if (!input.systemPrompt.trim() && !input.userPrompt.trim()) {
        throw new Error('PromptArtifact: system/user prompt 不能同时为空');
    }
    if (input.tokenBudget.maxInput <= 0 || input.tokenBudget.maxOutput <= 0) {
        throw new Error('PromptArtifact: token 预算必须为正数');
    }
    return {
        ...input,
        hash: hashPromptArtifact(input),
        createdAt: Date.now(),
    };
}

export function formatPromptArtifactSummary(artifact: PromptArtifact): string {
    return [
        `${artifact.taskId}@${artifact.templateId}#${artifact.templateVersion}`,
        `context=${artifact.contextPackId}`,
        `rules=${artifact.ruleSetId}`,
        `contract=${artifact.outputContractId}`,
        `budget=${artifact.tokenBudget.maxInput}/${artifact.tokenBudget.maxOutput}`,
        `hash=${artifact.hash}`,
    ].join(' · ');
}