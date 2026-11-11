import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_CHANGELOG, getVersionSummary } from '../../../shared/changelog-data';

const packageVersion = (JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as { version: string }).version;

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
    it('首条为当前 package.json 版本', () => {
        expect(BUILTIN_CHANGELOG[0].version).toBe(packageVersion);
        expect(BUILTIN_CHANGELOG[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(BUILTIN_CHANGELOG[0].sections.length).toBeGreaterThan(0);
    });

    it('版本严格降序且无重复', () => {
        const versions = BUILTIN_CHANGELOG.map(entry => entry.version);
        expect(new Set(versions).size).toBe(versions.length);
        for (let i = 1; i < versions.length; i++) {
            expect(compareVersions(versions[i - 1], versions[i])).toBeGreaterThan(0);
        }
    });

    it('覆盖当前版本及之前 4 个 minor', () => {
        const versions = new Set(BUILTIN_CHANGELOG.map(entry => entry.version));
        const [major, minor] = packageVersion.split('.').map(Number);
        for (let offset = 0; offset < 5; offset++) {
            const expected = `${major}.${minor - offset}.0`;
            expect(versions.has(expected), expected).toBe(true);
        }
    });

    it('版本摘要最多返回 3 条', () => {
        const summary = getVersionSummary(packageVersion);
        expect(summary.length).toBeGreaterThan(0);
        expect(summary.length).toBeLessThanOrEqual(3);
    });

    // 包体积治理（v4.83.0）：内置条目随版本线性膨胀曾是 main.js 逼近 5MB 上限的主因之一。
    // 这两条是防回归闸门——新增版本时必须同时裁剪最旧条目，否则测试失败。
    it('内置条目数不超过 12 条（包体积上限）', () => {
        expect(BUILTIN_CHANGELOG.length).toBeLessThanOrEqual(12);
    });

    it('内置条目总字节不超过 12000（单批文案膨胀防线）', () => {
        const totalBytes = Buffer.byteLength(JSON.stringify(BUILTIN_CHANGELOG), 'utf8');
        expect(totalBytes).toBeLessThanOrEqual(12000);
    });
});
