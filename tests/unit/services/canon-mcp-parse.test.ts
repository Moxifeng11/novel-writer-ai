/**
 * MCP 检索通道测试（2026-11-16）
 *
 * 用户要求「联网不要限定自己」：除了 DeepSeek/维基，还要能接任意 MCP 搜索工具。
 * 各 MCP 服务返回格式不一，这里锁定通用解析与调用契约。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../../__mocks__/obsidian')>('../../__mocks__/obsidian');
    return { ...actual, requestUrl: vi.fn(async () => ({ status: 200, json: {}, text: '' })) };
});

import { CanonResearchService, parseMcpSearchText } from '../../../services/canon-research-service';

describe('parseMcpSearchText — 兼容各家 MCP 搜索返回', () => {
    it('JSON：results 数组', () => {
        const out = parseMcpSearchText(JSON.stringify({
            results: [
                { title: '作品百科', url: 'https://example.com/a', snippet: '摘要A' },
                { title: '官方设定', url: 'https://example.com/b', summary: '摘要B' },
            ],
        }));
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({ title: '作品百科', url: 'https://example.com/a', excerpt: '摘要A' });
        expect(out[1].excerpt).toBe('摘要B');
    });

    it('JSON：data / items / web.results 也认', () => {
        expect(parseMcpSearchText(JSON.stringify({ data: [{ title: 'x', url: 'https://a.com' }] }))).toHaveLength(1);
        expect(parseMcpSearchText(JSON.stringify({ items: [{ name: 'y', link: 'https://b.com' }] }))).toHaveLength(1);
        expect(parseMcpSearchText(JSON.stringify({ web: { results: [{ title: 'z', url: 'https://c.com' }] } }))).toHaveLength(1);
    });

    it('纯文本：按行提取 URL', () => {
        const out = parseMcpSearchText([
            '搜索结果：',
            '作品百科 - https://example.com/wiki 这是摘要',
            '无关行',
            '官方站 https://example.com/official',
        ].join('\n'));
        expect(out.map(item => item.url)).toEqual(['https://example.com/wiki', 'https://example.com/official']);
        expect(out[0].title).toContain('作品百科');
    });

    it('过滤非 http 链接并去重', () => {
        const out = parseMcpSearchText(JSON.stringify({
            results: [
                { title: 'a', url: 'ftp://x.com' },
                { title: 'b', url: 'https://ok.com' },
                { title: 'c', url: 'https://ok.com' },
            ],
        }));
        expect(out).toHaveLength(1);
        expect(out[0].url).toBe('https://ok.com');
    });

    it('空返回不炸', () => {
        expect(parseMcpSearchText('')).toEqual([]);
        expect(parseMcpSearchText('没有结果')).toEqual([]);
    });
});

describe('MCP 检索通道调用契约', () => {
    it('把服务/工具/参数名透传给注入的 mcpCallTool', async () => {
        const calls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];
        const service = new CanonResearchService({ vault: { adapter: { exists: async () => false } } } as never, {
            settings: {
                canonResearch: {
                    provider: 'mcp',
                    mcpServerId: 'brave',
                    mcpToolName: 'brave_search',
                    mcpQueryParam: 'q',
                    maxSources: 6,
                    excerptChars: 1200,
                },
            },
            mcpCallTool: async (serverId, toolName, args) => {
                calls.push({ serverId, toolName, args });
                return JSON.stringify({ results: [{ title: '原作', url: 'https://example.com/canon', snippet: '设定' }] });
            },
        });
        const result = await service.research('凡人修仙传');
        expect(calls).toHaveLength(1);
        expect(calls[0].serverId).toBe('brave');
        expect(calls[0].toolName).toBe('brave_search');
        // 自定义参数名必须被尊重（不同搜索工具字段不同）
        expect(calls[0].args.q).toContain('凡人修仙传');
        expect(result.sources.length).toBeGreaterThan(0);
    });

    it('缺少服务或工具时给出明确指引', async () => {
        const service = new CanonResearchService({ vault: { adapter: { exists: async () => false } } } as never, {
            settings: { canonResearch: { provider: 'mcp', maxSources: 6 } },
            mcpCallTool: async () => '[]',
        });
        const result = await service.research('凡人修仙传');
        expect(result.warnings.join(' ')).toContain('MCP');
    });
});
