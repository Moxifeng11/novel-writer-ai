import type { DomainHarnessProfile } from '../../engine/harness/domain-profile';

/**
 * 剧本模式 Harness 配置档。
 */
export const SCRIPT_HARNESS_PROFILE: DomainHarnessProfile = {
    mode: 'script',
    label: '短剧剧本',
    contentSchema: ['Project', 'Episode', 'Scene', 'Shot', 'Beat'],
    requiredContextKinds: [
        'episode-outline',
        'scene-bible',
        'shot-ledger',
        'previous-summary',
        'character',
    ],
    optionalContextKinds: ['style', 'rule', 'research', 'user-preference', 'relationship'],
    ruleSetId: 'rules.script.v1',
    promptTemplateIds: ['script.episode-outline', 'script.scene', 'script.storyboard', 'script.review'],
    toolIds: [
        'script.genre-check',
        'script.episode-ids',
        'script.shot-duration',
        'script.hook-3s',
        'script.continuity',
        'script.dialogue-filmable',
        'script.storyboard-export',
        'script.text-export',
    ],
    memoryScopes: ['episode', 'scene', 'project', 'global'],
    qualityGates: [
        'hook-3s',
        'episode-conflict',
        'scene-count',
        'shot-duration',
        'filmable',
        'plain-text-export',
    ],
};