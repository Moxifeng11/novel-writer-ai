import { describe, expect, it } from 'vitest';
import { BUILTIN_CHANGELOG, getVersionSummary } from '../../../shared/changelog-data';

function versionParts(version: string): number[] {
    return version.split('.').map(part => parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string): number {
    const left = versionParts(a);
    const right = versionParts(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

describe('BUILTIN_CHANGELOG — 插件内更新日志', () => {
    it('首条为当前版本 4.19.0', () => {
        expect(BUILTIN_CHANGELOG[0].version).toBe('4.19.0');
        expect(BUILTIN_CHANGELOG[0].date).toBe('2026-10-26');
        expect(BUILTIN_CHANGELOG[0].sections.length).toBeGreaterThan(0);
    });

    it('版本严格降序且无重复', () => {
        const versions = BUILTIN_CHANGELOG.map(entry => entry.version);
        expect(new Set(versions).size).toBe(versions.length);
        for (let i = 1; i < versions.length; i++) {
            expect(compareVersions(versions[i - 1], versions[i])).toBeGreaterThan(0);
        }
    });

    it('覆盖 4.15–4.19 最近版本', () => {
        const versions = new Set(BUILTIN_CHANGELOG.map(entry => entry.version));
        for (const version of ['4.19.0', '4.18.0', '4.17.0', '4.16.0', '4.15.0']) {
            expect(versions.has(version), version).toBe(true);
        }
    });

    it('版本摘要最多返回 3 条', () => {
        const summary = getVersionSummary('4.19.0');
        expect(summary.length).toBeGreaterThan(0);
        expect(summary.length).toBeLessThanOrEqual(3);
    });
});
