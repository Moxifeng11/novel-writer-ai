/**
 * 免 Key 检索通道（FAN-1，v4.83.1）
 *
 * 背景：此前 provider 全部需要第三方搜索 Key（bing/brave/serper/tavily），
 * 默认 `manual` 等于**开箱没有任何联网检索能力**——用户反馈「同人源需要联网搜索程序」。
 *
 * 本文件锁定：
 * 1. `providerNeedsApiKey` 的判定口径（wikipedia / bangumi 免 Key）
 * 2. 免 Key provider 不会被「未配置 Key」拦下
 * 3. 联网失败的告警文案指向免 Key 通道（引导用户可用）
 */

import { describe, expect, it, vi } from 'vitest';

// 网络层全部 mock：只验证分支与文案，不发真实请求
vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../../__mocks__/obsidian')>('../../__mocks__/obsidian');
    return {
        ...actual,
        requestUrl: vi.fn(async (params: { url: string }) => {
            // 维基百科：search → extracts 两次调用
            if (params.url.includes('list=search')) {
                return { status: 200, json: { query: { search: [{ title: '凡人修仙传', pageid: 123 }] } }, text: '' };
            }
            if (params.url.includes('prop=extracts')) {
                return { status: 200, json: { query: { pages: { '123': { title: '凡人修仙传', extract: '《凡人修仙传》是忘语创作的仙侠小说，主角韩立。' } } } }, text: '' };
            }
            // Bangumi：search → detail
            if (params.url.includes('/search/subject/')) {
                return { status: 200, json: { list: [{ id: 607915, name: '凡人修仙传', name_cn: '凡人修仙传' }] }, text: '' };
            }
            if (params.url.includes('/v0/subjects/')) {
                return { status: 200, json: { summary: '动画改编自忘语同名小说。' }, text: '' };
            }
            return { status: 200, json: {}, text: '' };
        }),
    };
});

import { CanonResearchService, providerNeedsApiKey } from '../../../services/canon-research-service';

/**
 * 构造带指定 provider 的服务。
 *
 * @param provider - 检索提供方
 * @returns 服务实例
 */
function makeService(provider: string): CanonResearchService {
    return new CanonResearchService({ vault: { adapter: { exists: async () => false } } } as never, {
        settings: {
            canonResearch: {
                provider: provider as never,
                apiKey: '',            // 故意不配 Key
                maxSources: 6,
                excerptChars: 1200,
            },
        },
    });
}

describe('providerNeedsApiKey — 免 Key 口径', () => {
    it('manual / wikipedia / bangumi 免 Key', () => {
        expect(providerNeedsApiKey('manual')).toBe(false);
        expect(providerNeedsApiKey('wikipedia')).toBe(false);
        expect(providerNeedsApiKey('bangumi')).toBe(false);
    });

    it('第三方搜索需要 Key', () => {
        for (const provider of ['bing', 'brave', 'serper', 'tavily'] as const) {
            expect(providerNeedsApiKey(provider)).toBe(true);
        }
    });
});

describe('免 Key provider 不被「未配置 Key」拦下', () => {
    it('wikipedia 未配 Key 也能检索到来源', async () => {
        const result = await makeService('wikipedia').research('凡人修仙传');
        expect(result.warnings.join(' ')).not.toContain('未配置搜索 API Key');
        expect(result.sources.length).toBeGreaterThan(0);
        expect(result.sources[0].url).toContain('wikipedia.org');
        // 维基百科属于二手资料
        expect(result.sources[0].tier).toBe('reference');
    });

    it('bangumi 未配 Key 也能检索到来源', async () => {
        const result = await makeService('bangumi').research('凡人修仙传');
        expect(result.warnings.join(' ')).not.toContain('未配置搜索 API Key');
        expect(result.sources.length).toBeGreaterThan(0);
        expect(result.sources[0].url).toContain('bgm.tv');
        expect(result.sources[0].tier).toBe('reference');
    });

    it('需要 Key 的 provider 未配 Key 时给出指引（提到免 Key 通道）', async () => {
        const result = await makeService('bing').research('凡人修仙传');
        const text = result.warnings.join(' ');
        expect(text).toContain('未配置搜索 API Key');
        expect(text).toContain('维基百科');
        expect(result.sources).toHaveLength(0);
    });
});

describe('来源分级仍遵守「官方优先」', () => {
    it('免 Key 检索到的百科/wiki 是 reference，不是 official', async () => {
        const result = await makeService('wikipedia').research('凡人修仙传');
        expect(result.sources.every(source => source.tier === 'reference')).toBe(true);
        expect(result.warnings.join(' ')).toContain('不是官方/官方 Wiki');
    });
});
