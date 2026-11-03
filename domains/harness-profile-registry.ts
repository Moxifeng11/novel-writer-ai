import type { CreationMode } from '@/shared/creation-mode';
import type { DomainHarnessProfile } from '@/engine/harness/domain-profile';
import { LONG_HARNESS_PROFILE } from './long/harness-profile';
import { SHORT_HARNESS_PROFILE } from './short/harness-profile';
import { SCRIPT_HARNESS_PROFILE } from './script/harness-profile';

const PROFILES: Record<CreationMode, DomainHarnessProfile> = {
    long: LONG_HARNESS_PROFILE,
    short: SHORT_HARNESS_PROFILE,
    script: SCRIPT_HARNESS_PROFILE,
};

/**
 * 按创作模式取 Harness 配置档。
 *
 * @param mode - 创作模式
 * @returns 对应配置档；未知模式回退到长篇配置
 */
export function getHarnessProfile(mode: CreationMode): DomainHarnessProfile {
    return PROFILES[mode] || LONG_HARNESS_PROFILE;
}

/**
 * 列出全部 Harness 配置档。
 *
 * @returns 配置档数组（顺序与注册表一致）
 */
export function listHarnessProfiles(): DomainHarnessProfile[] {
    return Object.values(PROFILES);
}