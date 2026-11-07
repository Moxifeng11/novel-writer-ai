import { describe, expect, it, vi } from 'vitest';
import { ensureEntityIntegrity } from '@/shared/entity-integrity';
import { ENTITY_BODY_SECTIONS } from '@/shared/format-constants';

/**
 * 拼装一张完整的势力卡（真实校验器通过），可按需注入空值覆盖字段。
 * @param overrides - 字段覆盖
 * @returns 势力卡全文
 */
function factionCard(overrides: Record<string, string> = {}): string {
    const fields: Record<string, string> = {
        tags: '[势力]',
        名称: '天剑宗',
        别称: '无',
        类型: '宗门',
        描述: '东域剑道第一宗门',
        领袖: '李沧澜',
        '地位/排名': '东域第一',
        entity_status: 'active',
        entity_created_at: '2026-01-01',
        ...overrides,
    };
    const yaml = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n');
    const body = ENTITY_BODY_SECTIONS.map(section => `## ${section}\n- 具体内容`).join('\n\n');
    return `---\n${yaml}\n---\n\n${body}\n`;
}

/** 首次校验即不完整：描述被写成空字符串 */
const INCOMPLETE_CARD = factionCard({ 描述: '""' });

describe('ensureEntityIntegrity 落盘前置契约', () => {
    it('首次校验通过：原样返回且不调用补全', async () => {
        const content = factionCard();
        const repair = vi.fn(async () => '不应被调用');

        const result = await ensureEntityIntegrity('factions', '天剑宗', content, repair);

        expect(result).toEqual({ content, valid: true, missingFields: [], repaired: false });
        expect(repair).not.toHaveBeenCalled();
    });

    it('不完整且未提供补全器：返回原内容与首次缺失项', async () => {
        const result = await ensureEntityIntegrity('factions', '天剑宗', INCOMPLETE_CARD);

        expect(result.valid).toBe(false);
        expect(result.repaired).toBe(false);
        expect(result.content).toBe(INCOMPLETE_CARD);
        expect(result.missingFields).toEqual(['描述（值为空）']);
    });

    it('补全器返回 null：保留原内容与首次缺失项', async () => {
        const repair = vi.fn(async () => null);

        const result = await ensureEntityIntegrity('factions', '天剑宗', INCOMPLETE_CARD, repair);

        expect(result.valid).toBe(false);
        expect(result.repaired).toBe(false);
        expect(result.content).toBe(INCOMPLETE_CARD);
        expect(result.missingFields).toEqual(['描述（值为空）']);
    });

    it('补全后仍不完整：替换内容并返回二次校验的缺失项', async () => {
        const repaired = factionCard({ 领袖: '""' });
        const repair = vi.fn(async () => repaired);

        const result = await ensureEntityIntegrity('factions', '天剑宗', INCOMPLETE_CARD, repair);

        expect(result.valid).toBe(false);
        expect(result.repaired).toBe(true);
        expect(result.content).toBe(repaired);
        expect(result.missingFields).toEqual(['领袖（值为空）']);
    });

    it('补全后通过：替换内容、清空缺失项并透传补全上下文', async () => {
        const repaired = factionCard();
        const repair = vi.fn(async () => repaired);

        const result = await ensureEntityIntegrity('factions', '天剑宗', INCOMPLETE_CARD, repair);

        expect(result).toEqual({ content: repaired, valid: true, missingFields: [], repaired: true });
        expect(repair).toHaveBeenCalledTimes(1);
        expect(repair).toHaveBeenCalledWith({
            kind: 'factions',
            name: '天剑宗',
            content: INCOMPLETE_CARD,
            missingFields: ['描述（值为空）'],
        });
    });

    it('补全器抛错：错误向上传播（调用方必须 catch）', async () => {
        const repair = vi.fn(async () => {
            throw new Error('补全请求超时');
        });

        await expect(
            ensureEntityIntegrity('factions', '天剑宗', INCOMPLETE_CARD, repair)
        ).rejects.toThrow('补全请求超时');
    });
});
