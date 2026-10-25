import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { EntityStateManager } from '../../../engine/entity-state-manager';
import { CoWriterEngine } from '../../../engine/co-writer-engine';
import { CO_WRITE_NUM_CTX } from '../../../shared/thresholds';

/**
 * 实体状态检测此前固定使用 `settings.flashModel`（默认云端）。
 * 协同写作切到本地 Ollama 后，OOC 走协同模型、实体检测却仍去云端，用户无法察觉。
 * 这里锁定两条链路：manager 透传模型/调用选项；engine 用协同模型接线。
 */

function makeManager(callAI: any): any {
    const manager: any = Object.create(EntityStateManager.prototype);
    manager.aiEngine = { callAI };
    manager.plugin = { settings: { flashModel: 'deepseek-flash' } };
    manager.notifier = { showNotice: vi.fn() };
    return manager;
}

describe('EntityStateManager — 模型透传', () => {
    it('未传覆盖时保持 flashModel，且不传调用选项', async () => {
        const callAI = vi.fn(async () => ({ content: '[]' }));
        const manager = makeManager(callAI);

        await manager.detectStateChanges('正文', '项目', 1, '第1章');

        expect(callAI).toHaveBeenCalledTimes(1);
        const args = callAI.mock.calls[0] as unknown as unknown[];
        expect(args[2]).toBe('deepseek-flash');
        expect(args[5]).toBeUndefined();
    });

    it('传入覆盖时使用协同模型与协同调用选项', async () => {
        const callAI = vi.fn(async () => ({ content: '[]' }));
        const manager = makeManager(callAI);
        const callOptions = {
            endpoint: 'http://127.0.0.1:11434',
            apiKey: 'ollama',
            disableFallback: true,
            numCtx: CO_WRITE_NUM_CTX,
        };

        await manager.detectStateChanges('正文', '项目', 1, '第1章', {
            model: 'qwen2.5:7b',
            callOptions,
        });

        const args = callAI.mock.calls[0] as unknown as unknown[];
        expect(args[2]).toBe('qwen2.5:7b');
        expect(args[5]).toEqual(callOptions);
    });
});

function makeEngine(settings: Record<string, unknown>) {
    const aiEngine = {
        getPlugin: () => ({ settings }),
        callAI: vi.fn(async () => ({ content: '' })),
    };
    const engine = new CoWriterEngine({} as any, aiEngine as any, { gatherAll: vi.fn() } as any) as any;
    engine.session = { project: '测试项目', chapterNum: 3, chapterName: '第3章' };
    engine.entityStateManager = { detectStateChanges: vi.fn(async () => []) };
    return { engine };
}

describe('CoWriterEngine — 实体检测跟随协同模型', () => {
    it('本地模式：传协同本地模型 + Ollama 端点，并禁用回退', async () => {
        const { engine } = makeEngine({
            coWriteModelMode: 'local',
            coWriteModel: 'qwen2.5:7b',
            customProviders: [{ id: 'ollama', endpoint: 'http://127.0.0.1:11434' }],
        });

        await engine.trackEntityStates('正文');

        const options = engine.entityStateManager.detectStateChanges.mock.calls[0][4];
        expect(options.model).toBe('qwen2.5:7b');
        expect(options.callOptions).toMatchObject({
            endpoint: 'http://127.0.0.1:11434',
            apiKey: 'ollama',
            disableFallback: true,
            numCtx: CO_WRITE_NUM_CTX,
        });
    });

    it('云端模式：传协同云端模型，允许回退', async () => {
        const { engine } = makeEngine({
            coWriteModelMode: 'cloud',
            coWriteCloudModel: 'doubao-pro',
            coWriteCloudProvider: '',
        });

        await engine.trackEntityStates('正文');

        const options = engine.entityStateManager.detectStateChanges.mock.calls[0][4];
        expect(options.model).toBe('doubao-pro');
        expect(options.callOptions.disableFallback).toBe(false);
    });

    it('未配置协同模型时不传覆盖，保持原有 flashModel 行为', async () => {
        const { engine } = makeEngine({
            coWriteModelMode: 'local',
            coWriteModel: '',
            proModel: '',
            defaultModel: '',
            flashModel: '',
        });

        await engine.trackEntityStates('正文');

        const options = engine.entityStateManager.detectStateChanges.mock.calls[0][4];
        expect(options).toBeUndefined();
    });
});
