import type { DomainHarnessProfile } from '../../engine/harness/domain-profile';

/**
 * 长篇模式 Harness 配置档。
 */
export const LONG_HARNESS_PROFILE: DomainHarnessProfile = {
    mode: 'long',
    label: '长篇小说',
    contentSchema: ['Project', 'Volume', 'Chapter', 'StepResult', 'ChapterStateSnapshot'],
    requiredContextKinds: [
        'chapter-state',
        'previous-summary',
        'character',
        'relationship',
        'foreshadow',
        'timeline',
        'worldview',
    ],
    optionalContextKinds: ['style', 'rule', 'research', 'user-preference'],
    ruleSetId: 'rules.long.v1',
    promptTemplateIds: ['long.planning.combined', 'long.body', 'long.quality', 'long.analysis'],
    toolIds: [
        'long.chapter-state',
        'long.fact-index',
        'long.entity-lookup',
        'long.relationship',
        'long.foreshadow',
        'long.timeline',
        'long.style-sample',
        'long.coherence',
        'long.planning-parse',
        'long.body-format',
    ],
    memoryScopes: ['chapter', 'project', 'global'],
    qualityGates: [
        'context-complete',
        'fact-consistency',
        'word-count',
        'format-contract',
        'pov-consistency',
        'chapter-hook',
        'settlement-ready',
    ],
};