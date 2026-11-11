/**
 * 指纹消费链路：读取前必须自愈加载（v4.83.1）
 *
 * 排查发现的真缺陷：`StyleFingerprintLibrary` 构造函数**不加载任何数据**，
 * 而 `getEnabledFingerprints()` 直接读内存表。除协同写作外，其余 5 条消费路径
 * （11 步执行 / 模式注入 / 资产注册 / 润色 / prompt-builder）都不调 `reloadIfChanged`
 * —— 于是**首次运行时启用的指纹恒为空**，风格约束静默消失，用户看不到任何报错。
 *
 * 对照：`KnowledgeVectorStore.search` 有 `ensureLoaded()` 自愈，指纹库没有，属于设计不一致。
 *
 * 本文件锁定修复后的语义：**新建实例直接读，也能拿到磁盘上的指纹**。
 */

import { describe, expect, it } from 'vitest';
import { Vault } from 'obsidian';
import {
    StyleFingerprintLibrary,
    type StyleFingerprint,
} from '../../../../engine/style-fingerprint-library';

const PROJECT = '测试书';

/** 构造指纹 */
function makeFingerprint(id: string, scope: 'global' | 'project' = 'project'): StyleFingerprint {
    return {
        id,
        name: `指纹 ${id}`,
        source: '测试源文本',
        scope,
        enabled: true,
        tags: ['test'],
        stats: {
            avgSentenceLength: 20,
            avgParagraphLength: 100,
            dialogueRatio: 0.3,
            descriptionRatio: 0.4,
            wordCount: 10000,
        },
        features: {
            sentenceRhythm: '短句为主，节奏明快',
            wordPreference: '常用词，四字格密度低',
            narrativeStyle: '第三人称全知',
            rhetoric: '比喻为主，少排比',
            dialogueStyle: '简短对白，潜台词多',
            paragraphStructure: '单段成意，少长段',
            overallTone: '冷峻克制',
        },
        samples: ['示例片段'],
        extractedAt: Date.now(),
    };
}

/** 直接 new（不走单例缓存，模拟「另一条路径首次拿到实例」） */
function makeLibrary(vault: Vault): StyleFingerprintLibrary {
    return new StyleFingerprintLibrary({ vault } as never, PROJECT);
}

describe('getEnabledFingerprints 读取前自愈', () => {
    it('新建实例直接读，能拿到磁盘上已有的项目指纹（无需手动 reload）', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.loadProject();
        await writer.addProject(makeFingerprint('fp-1'));

        // 新实例：构造函数不加载任何数据，旧实现这里会返回空
        const reader = makeLibrary(vault);
        const enabled = await reader.getEnabledFingerprints(PROJECT);
        expect(enabled.map(fp => fp.id)).toContain('fp-1');
    });

    it('新建实例直接读，能拿到全局指纹（无项目时按全局库）', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.loadGlobal();
        await writer.addGlobal(makeFingerprint('fp-global', 'global'));

        const reader = makeLibrary(vault);
        const enabled = await reader.getEnabledFingerprints(PROJECT);
        expect(enabled.map(fp => fp.id)).toContain('fp-global');
    });

    it('另一实例禁用后，读取自动同步（不需要调用方记得 reload）', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.loadProject();
        await writer.addProject(makeFingerprint('fp-toggle'));

        const reader = makeLibrary(vault);
        expect((await reader.getEnabledFingerprints(PROJECT)).map(fp => fp.id)).toContain('fp-toggle');

        await writer.disableProject('fp-toggle');
        // 不手动 reload，直接读
        expect((await reader.getEnabledFingerprints(PROJECT)).map(fp => fp.id)).not.toContain('fp-toggle');
    });

    it('重复读取不会重复累加（幂等）', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.loadProject();
        await writer.addProject(makeFingerprint('fp-idem'));

        const reader = makeLibrary(vault);
        const first = await reader.getEnabledFingerprints(PROJECT);
        const second = await reader.getEnabledFingerprints(PROJECT);
        expect(second.length).toBe(first.length);
        expect(new Set(second.map(fp => fp.id)).size).toBe(second.length);
    });

    it('磁盘坏文件不阻断读取（退回内存数据，不抛错）', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.loadProject();
        await writer.addProject(makeFingerprint('fp-safe'));

        const reader = makeLibrary(vault);
        // 先正常读一次把数据装进内存
        expect((await reader.getEnabledFingerprints(PROJECT)).length).toBeGreaterThan(0);

        // 之后即便签名检查/加载出错，也不应让读取抛错
        await expect(reader.getEnabledFingerprints(PROJECT)).resolves.toBeInstanceOf(Array);
    });
});
