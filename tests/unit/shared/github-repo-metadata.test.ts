import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GITHUB_REPO_SLUG, GITHUB_REPO_URL } from '../../../shared/github-repo';

const root = join(__dirname, '..', '..', '..');

describe('GitHub 仓库元数据一致性', () => {
    it('package.json 的 repository/homepage/bugs 指向同一仓库', () => {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
        expect(String(pkg.repository?.url || '')).toContain(GITHUB_REPO_SLUG);
        expect(String(pkg.homepage || '')).toContain(GITHUB_REPO_SLUG);
        expect(String(pkg.bugs?.url || '')).toContain(`${GITHUB_REPO_SLUG}/issues`);
    });

    it('manifest.json 的 authorUrl 指向同一仓库', () => {
        const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'));
        expect(manifest.authorUrl).toBe(GITHUB_REPO_URL);
    });
});
