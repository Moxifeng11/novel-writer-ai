import { describe, expect, it, vi } from 'vitest';
import { BatchEntityGenerator } from '../../../engine/ai-batch-entity-generator';

const incompleteFaction = `---
tags: [势力]
entity_status: active
名称: 青岚阁
---
# 青岚阁

## 确定性设定
青岚阁是一个隐秘组织。`;

describe('BatchEntityGenerator', () => {
    it('重试耗尽后丢弃不完整实体，不输出残缺占位卡', async () => {
        const plugin = { settings: { maxEntityBatchRetries: 1 } } as any;
        const apiClient = {
            callAI: vi.fn()
                .mockResolvedValueOnce({ content: incompleteFaction })
                .mockResolvedValueOnce({ content: incompleteFaction }),
        } as any;
        const notifier = { showNotice: vi.fn() };
        const generator = new BatchEntityGenerator(plugin, apiClient, notifier as any);

        const results = await generator.generateFactionsBatch('世界观', ['青岚阁'], '生成一个势力', 1);

        expect(results).toEqual([]);
        expect(results.some((r) => (r as any).incomplete || r.content.includes('待补充'))).toBe(false);
        expect(notifier.showNotice).toHaveBeenCalledWith(
            expect.stringContaining('已自动丢弃'),
            expect.any(Number)
        );
    });
});
