/**
 * trend-research-service 测试：免 Key 通道不再被 Key 守卫静默拦掉。
 *
 * 2026-11-16（M-24）：设置页早就有 wikipedia / bangumi 免 Key 通道，
 * 但趋势调研在「没有 Key」时直接 return []，用户选了免 Key 通道也永远搜不到，
 * 且没有任何提示——表现为「同人考据/联网搜索功能坏了」。
 */
import { describe, expect, it } from 'vitest';
import {
    TrendResearchService,
    trendProviderNeedsApiKey,
    type RequestUrlFn,
} from '../../../engine/harness/trend-research-service';

function responder(table: Record<string, unknown>): RequestUrlFn {
    return async (options) => {
        const key = Object.keys(table).find(marker => options.url.includes(marker));
        if (!key) return { status: 404, text: '{}' };
        return { status: 200, text: JSON.stringify(table[key]), json: table[key] };
    };
}

describe('trend-research-service — 检索通道', () => {
    it('免 Key 通道判定', () => {
        expect(trendProviderNeedsApiKey('wikipedia')).toBe(false);
        expect(trendProviderNeedsApiKey('bangumi')).toBe(false);
        expect(trendProviderNeedsApiKey('manual')).toBe(false);
        expect(trendProviderNeedsApiKey('bing')).toBe(true);
        expect(trendProviderNeedsApiKey('tavily')).toBe(true);
        expect(trendProviderNeedsApiKey('deepseek')).toBe(true);
    });

    it('DeepSeek 联网搜索通道走官方 tools/search 并复用 Key', async () => {
        const request = responder({
            '/v1/tools/search': {
                results: [
                    { title: '玄幻小说', url: 'https://example.com/x', snippet: '短摘要', summary: '长摘要' },
                ],
            },
        });
        const service = new TrendResearchService({ provider: 'deepseek', apiKey: 'sk-deepseek' }, request);
        const sources = await service.search('short', '玄幻');
        expect(sources).toHaveLength(1);
        expect(sources[0].title).toBe('玄幻小说');
        // summary 优先于 snippet：更适合给模型读
        expect(sources[0].snippet).toBe('长摘要');
    });

    it('需要 Key 的通道没有 Key 时返回空（不白跑请求）', async () => {
        let called = false;
        const request: RequestUrlFn = async () => {
            called = true;
            return { status: 200, text: '{}' };
        };
        const service = new TrendResearchService({ provider: 'bing', apiKey: '' }, request);
        expect(await service.search('short', '玄幻')).toEqual([]);
        expect(called).toBe(false);
    });

    it('免 Key 的维基百科通道无 Key 也能检索', async () => {
        const request = responder({
            'zh.wikipedia.org': {
                query: {
                    search: [
                        { title: '玄幻小说', snippet: '<b>玄幻</b>是网络文学分类', pageid: 1 },
                    ],
                },
            },
        });
        const service = new TrendResearchService({ provider: 'wikipedia', apiKey: '' }, request);
        const sources = await service.search('short', '玄幻');
        expect(sources).toHaveLength(1);
        expect(sources[0].title).toBe('玄幻小说');
        expect(sources[0].url).toContain('zh.wikipedia.org/wiki/');
        // HTML 标签不能原样进提示词
        expect(sources[0].snippet).not.toContain('<b>');
    });

    it('免 Key 的 Bangumi 通道无 Key 也能检索', async () => {
        const request = responder({
            'api.bgm.tv': {
                list: [{ id: 42, name: '作品', name_cn: '中文名', summary: '简介' }],
            },
        });
        const service = new TrendResearchService({ provider: 'bangumi', apiKey: '' }, request);
        const sources = await service.search('script', '短剧');
        expect(sources).toHaveLength(1);
        expect(sources[0].title).toBe('中文名');
        expect(sources[0].url).toContain('bgm.tv/subject/42');
    });

    it('manual 不联网', async () => {
        let called = false;
        const request: RequestUrlFn = async () => {
            called = true;
            return { status: 200, text: '{}' };
        };
        const service = new TrendResearchService({ provider: 'manual' }, request);
        expect(await service.search('short', '都市')).toEqual([]);
        expect(called).toBe(false);
    });
});
