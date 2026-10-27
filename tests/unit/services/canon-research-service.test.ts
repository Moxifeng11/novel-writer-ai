import { describe, expect, it } from 'vitest';
import { CanonResearchService } from '../../../services/canon-research-service';

function makeService() {
    return new CanonResearchService({} as never, {
        settings: { canonResearch: { provider: 'manual', apiKey: '', maxSources: 6, excerptChars: 1200 } },
    });
}

describe('CanonResearchService — 来源 URL 安全', () => {
    it('拒绝 file:// 与本机/内网地址', async () => {
        const service = makeService();
        await expect(service.addManualSource('file:///etc/passwd', '', '内容')).rejects.toThrow('http');
        await expect(service.addManualSource('http://127.0.0.1:11434/api', '', '内容')).rejects.toThrow('本机');
        await expect(service.addManualSource('http://192.168.1.10/x', '', '内容')).rejects.toThrow('本机');
    });

    it('公开官方 URL 可以保存短摘录', async () => {
        const service = makeService();
        const source = await service.addManualSource(
            'https://www.qidian.com/book/123',
            '官方设定',
            '官方短摘录',
        );
        expect(source.tier).toBe('official');
        expect(source.excerpt).toBe('官方短摘录');
    });
});
