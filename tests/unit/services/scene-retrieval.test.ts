/**
 * A2/A3：逐场检索与覆盖记录
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { SceneRetrievalService } from '@/services/scene-retrieval-service';
import type { SceneTask } from '@/engine/scene-generation-loop';

const PROJECT = '长篇小说/甲';

const task = (num: number, characters: string): SceneTask => ({
    num, name: `场景${num}`, objective: 'x', conflict: 'y', emotionArc: 'z',
    sensoryHook: '', memoryTrigger: '', bodyReaction: '', subtext: '', cliffhanger: '',
    characters, rawBlock: '',
});

const make = (resolvable: string[] = ['林玄']) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    const service = new SceneRetrievalService(app, async (name) => (resolvable.includes(name) ? `CHR-${name}` : null));
    return { service, vault, app };
};

describe('SceneRetrievalService', () => {
    it('在场的角色全部可解析时无提示', async () => {
        const { service } = make();
        const result = await service.retrieve(task(1, '林玄、苏婉'.replace('苏婉', '林玄')));
        expect(result.resolved).toEqual(['CHR-林玄']);
        expect(result.missing).toEqual([]);
        expect(result.hint).toBe('');
    });

    it('缺卡角色给出「不要虚构」提示', async () => {
        const { service } = make();
        const result = await service.retrieve(task(2, '林玄、路人甲'));
        expect(result.missing).toEqual(['路人甲']);
        expect(result.hint).toContain('不要虚构');
        expect(result.hint).toContain('路人甲');
    });

    it('兼容中文「在场人物：」行（历史场景卡格式）', async () => {
        const { service } = make();
        const legacy = { ...task(1, ''), rawBlock: '- 在场人物：林玄、路人甲' };
        const result = await service.retrieve(legacy as never);
        expect(result.missing).toEqual(['路人甲']);
    });

    it('记录逐场覆盖到账本并统计缺口场景', async () => {
        const { service } = make();
        await service.recordCoverage(PROJECT, '第1章', [
            { scene: 1, chars: 500, resolvedCount: 1, missing: [], hinted: false },
            { scene: 2, chars: 300, resolvedCount: 0, missing: ['路人甲'], hinted: true },
        ]);
        const ledger = await service.readCoverage(PROJECT);
        expect(ledger['第1章'].scenes).toHaveLength(2);
        expect(ledger['第1章'].scenesWithGaps).toBe(1);
    });

    it('账本损坏时按空处理仍可写', async () => {
        const { service, vault } = make();
        vault._seedFile(`${PROJECT}/04-项目总控/注入账本/场景覆盖.json`, '{坏');
        await service.recordCoverage(PROJECT, '第1章', []);
        const ledger = await service.readCoverage(PROJECT);
        expect(ledger['第1章']).toBeDefined();
    });
});
