import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHarnessProfile, listHarnessProfiles } from '../../../domains/harness-profile-registry';
import { validateDomainProfile } from '../../../engine/harness/domain-profile';

const ROOT = path.resolve(__dirname, '../../..');

describe('三域 Harness profile', () => {
    it('三域 profile 必填项完整', () => {
        for (const profile of listHarnessProfiles()) {
            expect(validateDomainProfile(profile)).toEqual([]);
        }
        expect(listHarnessProfiles().map(profile => profile.mode)).toEqual(['long', 'short', 'script']);
    });

    it('按模式取到正确 profile', () => {
        expect(getHarnessProfile('long').contentSchema).toContain('Chapter');
        expect(getHarnessProfile('short').contentSchema).toContain('Section');
        expect(getHarnessProfile('script').contentSchema).toContain('Shot');
        expect(getHarnessProfile('short').requiredContextKinds).toContain('random-factor');
        expect(getHarnessProfile('script').requiredContextKinds).toContain('shot-ledger');
    });

    it('领域 profile 互不 import；kernel 不反向依赖领域', () => {
        const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const longSrc = read('domains/long/harness-profile.ts');
        const shortSrc = read('domains/short/harness-profile.ts');
        const scriptSrc = read('domains/script/harness-profile.ts');
        expect(longSrc).not.toContain("../short/");
        expect(longSrc).not.toContain("../script/");
        expect(shortSrc).not.toContain("../long/");
        expect(shortSrc).not.toContain("../script/");
        expect(scriptSrc).not.toContain("../long/");
        expect(scriptSrc).not.toContain("../short/");

        const kernelSrc = read('engine/harness/domain-profile.ts');
        expect(kernelSrc).not.toMatch(/from\s+['"][^'"]*domains\//);
    });

    it('profile 工具/模板/质量门 ID 无重复', () => {
        for (const profile of listHarnessProfiles()) {
            expect(new Set(profile.toolIds).size).toBe(profile.toolIds.length);
            expect(new Set(profile.promptTemplateIds).size).toBe(profile.promptTemplateIds.length);
            expect(new Set(profile.qualityGates).size).toBe(profile.qualityGates.length);
        }
    });
});