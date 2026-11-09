import { describe, expect, it, vi } from 'vitest';
import { buildSettlementTable } from '../../../engine/settlement/settlement-artifacts';
import { settlementTablePath, writeSettlementTableFile } from '../../../engine/settlement/settlement-table-writer';

/**
 * 结算表唯一落盘入口的契约：
 * - 路径统一为 03-大纲与章节/步骤结果/第N卷/第M章/第M章_结算表.md；
 * - 锁内覆盖写（幂等），失败不丢旧表；
 * - buildSettlementTable 对缺省计数按 0 处理，不产出 undefined 行。
 */

function makeFs() {
    return {
        mkdir: vi.fn(async (_dir: string) => undefined),
        write: vi.fn(async (_path: string, _content: string) => undefined),
    };
}

describe('settlement-table-writer — 路径与写入', () => {
    it('无 chapDir 时落标准步骤目录', async () => {
        const fs = makeFs();
        const path = await writeSettlementTableFile(fs as never, {
            project: '书甲',
            volume: '第2卷',
            chapterNum: 3,
            content: '# 第3章 结算表',
        });
        expect(path).toBe('书甲/03-大纲与章节/步骤结果/第2卷/第3章/第3章_结算表.md');
        expect(fs.mkdir).toHaveBeenCalledWith('书甲/03-大纲与章节/步骤结果/第2卷/第3章');
        expect(fs.write).toHaveBeenCalledWith(path, '# 第3章 结算表');
    });

    it('标准 chapDir 原样沿用；非标准 chapDir 回退标准路径', async () => {
        const fs = makeFs();
        const legacyDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const legacy = await writeSettlementTableFile(fs as never, {
            project: '书甲', volume: '第1卷', chapterNum: 1, content: 'a', chapDir: legacyDir,
        });
        expect(legacy).toBe(`${legacyDir}/第1章_结算表.md`);

        const fallback = await writeSettlementTableFile(fs as never, {
            project: '书甲', volume: '第1卷', chapterNum: 2, content: 'b',
            chapDir: '书甲/03-大纲与章节/正文/第1卷',
        });
        expect(fallback).toBe('书甲/03-大纲与章节/步骤结果/第1卷/第2章/第2章_结算表.md');
    });

    it('重复结算覆盖写，不堆叠不删旧表', async () => {
        const fs = makeFs();
        const input = {
            project: '书甲', volume: 1, chapterNum: 1,
        } as const;
        await writeSettlementTableFile(fs as never, { ...input, content: '第一版' });
        await writeSettlementTableFile(fs as never, { ...input, content: '第二版' });
        const path = settlementTablePath('书甲', 1, 1);
        const writes = fs.write.mock.calls.filter((call) => call[0] === path);
        expect(writes).toHaveLength(2);
        expect(writes[1][1]).toBe('第二版');
    });

    it('settlementTablePath 卷名/卷号一致', () => {
        expect(settlementTablePath('书甲', '第3卷', 4)).toBe(settlementTablePath('书甲', 3, 4));
    });

    it('F-7：章号解析失败时标准 chapDir 的目录章号优先（不再错位为 第1章）', async () => {
        const fs = makeFs();
        const path = await writeSettlementTableFile(fs as never, {
            project: '书甲',
            volume: '第2卷',
            chapterNum: 0, // 序章/楔子解析为 0
            content: '序章结算',
            chapDir: '书甲/03-大纲与章节/步骤结果/第2卷/第7章',
        });
        expect(path).toBe('书甲/03-大纲与章节/步骤结果/第2卷/第7章/第7章_结算表.md');
        expect(fs.write).toHaveBeenCalledWith(path, '序章结算');
    });

    it('F-7：无 chapDir 且章号缺失时维持钳 1（无更可信来源，现状不变）', async () => {
        const fs = makeFs();
        const path = await writeSettlementTableFile(fs as never, {
            project: '书甲',
            volume: '第1卷',
            chapterNum: 0,
            content: 'x',
        });
        expect(path).toBe('书甲/03-大纲与章节/步骤结果/第1卷/第1章/第1章_结算表.md');
    });
});

describe('buildSettlementTable — 缺省计数', () => {
    it('只传部分字段时不产出 undefined 行', () => {
        const text = buildSettlementTable({
            chapterName: '第1章',
            volume: '第1卷',
            result: { created: 1, updated: 2 } as never,
        });
        expect(text).toContain('# 第1章 结算表');
        expect(text).toContain('人物状态更新：0 人');
        expect(text).toContain('新建时间线事件：0 个');
        expect(text).not.toContain('undefined');
    });
});
