/**
 * github-repo.ts — GitHub 仓库参数唯一真相源
 *
 * 仓库所有者、仓库名、默认分支、Web/API 地址集中在这里，避免更新检查、
 * 设置默认值与文档链接各写一份后漂移。
 */

export const GITHUB_OWNER = 'Moxifeng11';
export const GITHUB_REPO_NAME = 'novel-writer-ai';
export const GITHUB_BRANCH = 'master';
export const GITHUB_REPO_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO_NAME}`;
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_SLUG}`;
export const GITHUB_GIT_URL = `https://github.com/${GITHUB_REPO_SLUG}.git`;
export const GITHUB_API_BASE = 'https://api.github.com';

export function buildGitHubLatestReleaseApi(repoSlug: string = GITHUB_REPO_SLUG): string {
    return `${GITHUB_API_BASE}/repos/${repoSlug}/releases/latest`;
}

/** 校验并规范化 owner/repo；非法值返回空串，避免把任意文本拼进 API URL。 */
export function normalizeGitHubRepo(value: string | undefined | null): string {
    const repo = (value || '').trim()
        .replace(/^https?:\/\/github\.com\//i, '')
        .replace(/^git@github\.com:/i, '')
        .replace(/\/+$/g, '')
        .replace(/\.git$/i, '');
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : '';
}
