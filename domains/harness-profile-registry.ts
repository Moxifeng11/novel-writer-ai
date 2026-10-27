import type { CreationMode } from '../shared/creation-mode';
import type { DomainHarnessProfile } from '../engine/harness/domain-profile';
import { LONG_HARNESS_PROFILE } from './long/harness-profile';
import { SHORT_HARNESS_PROFILE } from './short/harness-profile';
import { SCRIPT_HARNESS_PROFILE } from './script/harness-profile';

const PROFILES: Record<CreationMode, DomainHarnessProfile> = {
    long: LONG_HARNESS_PROFILE,
    short: SHORT_HARNESS_PROFILE,
    script: SCRIPT_HARNESS_PROFILE,
};

export function getHarnessProfile(mode: CreationMode): DomainHarnessProfile {
    return PROFILES[mode] || LONG_HARNESS_PROFILE;
}

export function listHarnessProfiles(): DomainHarnessProfile[] {
    return Object.values(PROFILES);
}