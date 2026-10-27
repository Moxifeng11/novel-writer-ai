import type { DomainHarnessProfile } from '../../engine/harness/domain-profile';

export const SHORT_HARNESS_PROFILE: DomainHarnessProfile = {
    mode: 'short',
    label: '短篇小说',
    contentSchema: ['Project', 'StoryCore', 'SectionOutline', 'Section', 'SectionReview'],
    requiredContextKinds: [
        'section-outline',
        'previous-summary',
        'character',
        'random-factor',
        'research',
    ],
    optionalContextKinds: ['style', 'rule', 'user-preference', 'relationship'],
    ruleSetId: 'rules.short.v1',
    promptTemplateIds: ['short.premise', 'short.outline', 'short.section', 'short.review'],
    toolIds: [
        'short.taxonomy-check',
        'short.random-brief',
        'short.premise-check',
        'short.reversal-table',
        'short.section-outline',
        'short.section-words',
        'short.section-review',
        'short.reversal-coverage',
        'short.ending-payoff',
        'short.export',
    ],
    memoryScopes: ['section', 'project', 'global'],
    qualityGates: [
        'taxonomy-valid',
        'premise-complete',
        'section-words',
        'section-hook',
        'reversal-coverage',
        'emotion-payoff',
        'ending-closed',
    ],
};