import { describe, expect, it } from 'vitest';
import {
    GITHUB_BRANCH,
    GITHUB_OWNER,
    GITHUB_REPO_NAME,
    GITHUB_REPO_SLUG,
    GITHUB_REPO_URL,
    buildGitHubLatestReleaseApi,
    normalizeGitHubRepo,
} from '../../../shared/github-repo';

describe('github-repo — 仓库参数单一真相源', () => {
    it('owner/repo/branch/API 地址一致', () => {
        expect(GITHUB_OWNER).toBe('Moxifeng11');
        expect(GITHUB_REPO_NAME).toBe('novel-writer-ai');
        expect(GITHUB_BRANCH).toBe('master');
        expect(GITHUB_REPO_SLUG).toBe('Moxifeng11/novel-writer-ai');
        expect(GITHUB_REPO_URL).toBe('https://github.com/Moxifeng11/novel-writer-ai');
        expect(buildGitHubLatestReleaseApi()).toBe('https://api.github.com/repos/Moxifeng11/novel-writer-ai/releases/latest');
    });

    it('接受 owner/repo、GitHub URL 与 .git 后缀', () => {
        expect(normalizeGitHubRepo('Moxifeng11/novel-writer-ai')).toBe('Moxifeng11/novel-writer-ai');
        expect(normalizeGitHubRepo('https://github.com/Moxifeng11/novel-writer-ai')).toBe('Moxifeng11/novel-writer-ai');
        expect(normalizeGitHubRepo('https://github.com/Moxifeng11/novel-writer-ai.git')).toBe('Moxifeng11/novel-writer-ai');
    });

    it('非法格式返回空串，不能拼进 API URL', () => {
        expect(normalizeGitHubRepo('not a repo')).toBe('');
        expect(normalizeGitHubRepo('')).toBe('');
        expect(normalizeGitHubRepo('https://gitlab.com/a/b')).toBe('');
    });
});
