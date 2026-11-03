/**
 * domain-profile.ts - harness profile contract owned by each domain.
 *
 * Kernel only knows this interface; concrete profiles live in domains/*.
 */
import type { CreationMode } from '@/shared/creation-mode';
/** 上下文证据的八类（原 context-pack 的类型，此处内联避免死模块引用） */
export type ContextKind =
    | 'worldview'
    | 'character'
    | 'relationship'
    | 'timeline'
    | 'foreshadow'
    | 'previous-summary'
    | 'chapter-state'
    | 'section-outline'
    | 'episode-outline'
    | 'scene-bible'
    | 'shot-ledger'
    | 'style'
    | 'rule'
    | 'research'
    | 'random-factor'
    | 'user-preference';

/**
 * DomainHarnessProfile 类型定义。
 */
export interface DomainHarnessProfile {
    mode: CreationMode;
    label: string;
    contentSchema: string[];
    requiredContextKinds: ContextKind[];
    optionalContextKinds: ContextKind[];
    ruleSetId: string;
    promptTemplateIds: string[];
    toolIds: string[];
    memoryScopes: Array<'chapter' | 'section' | 'episode' | 'scene' | 'project' | 'global'>;
    qualityGates: string[];
}

/**
 * validateDomainProfile 函数。
 * @param profile - 配置档
 * @returns 结果数组
 */
export function validateDomainProfile(profile: DomainHarnessProfile): string[] {
    const issues: string[] = [];
    if (!profile.mode) issues.push('missing mode');
    if (!profile.label.trim()) issues.push('missing label');
    if (profile.contentSchema.length === 0) issues.push('missing content schema');
    if (profile.requiredContextKinds.length === 0) issues.push('missing required context kinds');
    if (profile.toolIds.length === 0) issues.push('missing tool ids');
    if (profile.qualityGates.length === 0) issues.push('missing quality gates');
    return issues;
}