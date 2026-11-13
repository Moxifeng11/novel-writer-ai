/**
 * 第二意见接线单测（P2 落地）
 *
 * 重点：事实库不可用时必须**降级为不干预**（全 unknown），
 * 绝不能因为读不到事实就让功能报错或误判。
 */

import { describe, expect, it } from 'vitest';
import { createStateAdvisor } from '../../../../engine/context/state-advice-wiring';
import { MockFileSystem } from '../../../../shared/file-system-port';
import { createFactStore, mergeFactStore, serializeFactStore } from '../../../../engine/consistency/fact-store';
import { pjFactStoreFile } from '../../../../shared/paths';

/** 造 app（只带可用的 vault.adapter） */
function makeApp(fs: MockFileSystem): never {
    const adapter = {
        exists: (p: string) => fs.exists(p),
        read: (p: string) => fs.read(p),
        write: (p: string, d: string) => fs.write(p, d),
        mkdir: (p: string) => fs.mkdir(p),
        rename: (a: string, b: string) => fs.rename(a, b),
        remove: (p: string) => fs.delete(p),
        list: async () => ({ files: [], folders: [] }),
        stat: async () => null,
        readBinary: async () => new ArrayBuffer(0),
        writeBinary: async () => undefined,
    };
    return {
        vault: {
            configDir: '.obsidian',
            adapter,
            getAbstractFileByPath: () => null,
            getFiles: () => [],
            getName: () => 'vault',
            read: (f: { path: string }) => fs.read(f.path),
        },
        metadataCache: { getFileCache: () => null },
    } as never;
}

const PROJECT = '项目A';

/** 写入一个含事实的事实库 */
async function seedFacts(fs: MockFileSystem): Promise<void> {
    const store = createFactStore();
    mergeFactStore(store, 1, [{
        type: 'age',
        subject: '宁缺',
        predicate: '年龄',
        value: '十七',
        numeric: 17,
        unit: '岁',
        validFrom: 1,
        validTo: null,
        confidence: 0.9,
        quote: '宁缺今年十七岁',
    }]);
    await fs.write(pjFactStoreFile(PROJECT), serializeFactStore(store));
}

describe('createStateAdvisor · 有事实库', () => {
    it('能给出状态建议（一致/冲突）', async () => {
        const fs = new MockFileSystem();
        await seedFacts(fs);
        const advisor = await createStateAdvisor(makeApp(fs), PROJECT);
        expect(advisor.factCount).toBe(1);
        expect(advisor.warnings).toHaveLength(0);
        expect(advisor.advise({ subject: '宁缺', predicate: '年龄', chapter: 5, value: '十七岁' }).status).toBe('consistent');
        expect(advisor.advise({ subject: '宁缺', predicate: '年龄', chapter: 5, value: '四十岁' }).status).toBe('conflict');
    });
});

describe('createStateAdvisor · 降级（关键）', () => {
    it('事实库缺失 → 全 unknown，功能不报错', async () => {
        const advisor = await createStateAdvisor(makeApp(new MockFileSystem()), PROJECT);
        expect(advisor.factCount).toBe(0);
        expect(advisor.advise({ subject: '宁缺', chapter: 1, value: '十七' }).status).toBe('unknown');
        expect(advisor.adviseTimeline({ value: '第三日', chapterNum: 3 }).status).toBe('unknown');
    });

    it('事实库损坏 → 降级且有告警（不抛错）', async () => {
        const fs = new MockFileSystem();
        await fs.write(pjFactStoreFile(PROJECT), '{broken');
        const advisor = await createStateAdvisor(makeApp(fs), PROJECT);
        expect(advisor.factCount).toBe(0);
        expect(advisor.warnings.length).toBeGreaterThan(0);
        expect(advisor.advise({ subject: '宁缺', chapter: 1, value: '十七' }).status).toBe('unknown');
    });
});

describe('createStateAdvisor · adviseForeshadow（伏笔第二意见）', () => {
    it('事实库有后续痕迹 → conflict（台账说未兑现，实际已兑现）', async () => {
        const fs = new MockFileSystem();
        const store = createFactStore();
        mergeFactStore(store, 1, [{ type: 'knowledge', subject: '桑桑', predicate: '身份', value: '并不是侍女', validFrom: 1, validTo: null, confidence: 0.9, quote: '桑桑并不是侍女' }]);
        await fs.write(pjFactStoreFile(PROJECT), serializeFactStore(store));
        const advisor = await createStateAdvisor(makeApp(fs), PROJECT);
        const advice = advisor.adviseForeshadow('侍女', 0);
        expect(advice.status).toBe('conflict');
        expect(advice.evidence?.quote).toContain('桑桑');
    });

    it('第 1 章之后无痕迹 → consistent（与未兑现一致）', async () => {
        const fs = new MockFileSystem();
        await seedFacts(fs);
        const advisor = await createStateAdvisor(makeApp(fs), PROJECT);
        expect(advisor.adviseForeshadow('青铜钥匙', 1).status).toBe('consistent');
    });

    it('事实库为空 → unknown（不干预）', async () => {
        const advisor = await createStateAdvisor(makeApp(new MockFileSystem()), PROJECT);
        expect(advisor.adviseForeshadow('任何', 1).status).toBe('unknown');
    });

    it('关键词为空 → unknown（不猜）', async () => {
        const fs = new MockFileSystem();
        await seedFacts(fs);
        const advisor = await createStateAdvisor(makeApp(fs), PROJECT);
        expect(advisor.adviseForeshadow('', 1).status).toBe('unknown');
    });
});
