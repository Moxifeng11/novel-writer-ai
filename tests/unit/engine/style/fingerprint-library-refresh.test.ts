/**
 * fingerprint-library-refresh.test.ts — 指纹列表的跨实例变更检测
 *
 * 指纹库 UI 与协同引擎各持一个 StyleFingerprintLibrary 实例：前者新增/删除/启停指纹后，
 * 后者的内存列表不会自动更新，表现为「新指纹不生效」「禁用无效」。
 */

import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import {
    StyleFingerprintLibrary,
    type StyleFingerprint,
} from '../../../../engine/style-fingerprint-library';

const PROJECT = '测试书';

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

function makeLibrary(vault: Vault): StyleFingerprintLibrary {
    return new StyleFingerprintLibrary({ vault } as any, PROJECT);
}

async function loadAll(library: StyleFingerprintLibrary): Promise<void> {
    await library.loadGlobal();
    await library.loadProject();
    await library.loadGlobalState(PROJECT);
}

describe('StyleFingerprintLibrary — 跨实例指纹变更检测', () => {
    it('另一实例新增项目指纹后，reloadIfChanged 会重新加载', async () => {
        const vault = new Vault();
        const reader = makeLibrary(vault);
        await loadAll(reader);
        expect(await reader.getEnabledFingerprints()).toHaveLength(0);

        const writer = makeLibrary(vault);
        await writer.loadProject();
        await writer.addProject(makeFingerprint('fp-new'));

        expect(await reader.reloadIfChanged()).toBe(true);
        expect((await reader.getEnabledFingerprints()).map(fp => fp.id)).toContain('fp-new');
    });

    it('另一实例禁用指纹后，reloadIfChanged 让启用列表同步', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.loadProject();
        await writer.addProject(makeFingerprint('fp-a'));

        const reader = makeLibrary(vault);
        await loadAll(reader);
        expect(await reader.getEnabledFingerprints()).toHaveLength(1);

        await writer.disableProject('fp-a');

        expect(await reader.reloadIfChanged()).toBe(true);
        expect(await reader.getEnabledFingerprints()).toHaveLength(0);
    });

    it('另一实例新增全局指纹后同样能感知', async () => {
        const vault = new Vault();
        const reader = makeLibrary(vault);
        await loadAll(reader);

        const writer = makeLibrary(vault);
        await writer.loadGlobal();
        await writer.addGlobal(makeFingerprint('fp-global', 'global'));

        expect(await reader.reloadIfChanged()).toBe(true);
        expect((await reader.getEnabledFingerprints()).map(fp => fp.id)).toContain('fp-global');
    });

    it('文件未变化时 reloadIfChanged 返回 false，不重复读盘', async () => {
        const vault = new Vault();
        const reader = makeLibrary(vault);
        await loadAll(reader);

        await reader.reloadIfChanged();
        expect(await reader.reloadIfChanged()).toBe(false);
    });
});
