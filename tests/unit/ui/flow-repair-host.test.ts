/**
 * flow-repair-host.test.ts — repair_flow 宿主桥回归（DSH-20261112-16）
 *
 * 接线前 repair_flow 在生产不可达（对抗审计 #B2）。本文件锁桥接行为：
 * 工具可达（engine 注册）、桥接真的调到 scheduler / 指纹库、宿主能力缺失时
 * 如实 ok:false（repair_tools 的 fail-closed 契约不变）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

const HarnessEngineModule = await import('../../../engine/agent/harness/harness-engine');
const { AgentHarnessEngine } = HarnessEngineModule;
type EngineInstance = InstanceType<typeof AgentHarnessEngine>;
const { REPAIR_FLOW_TOOL } = await import('../../../engine/agent/harness/repair-tools');
const { createFlowRepairHost } = await import('../../../ui/services/flow-repair-host');

function makePluginStub(options: {
    scheduler?: { revectorizeBook: (id: string, name: string) => Promise<void> };
    books?: Array<{ id: string; name: string }>;
    libraryCounts?: { template: number; global: number; project: number };
    activeProject?: string;
} = {}) {
    return {
        deconstructionScheduler: options.scheduler ?? undefined,
        knowledgeBaseManager: { getBook: vi.fn(async (id: string) => options.books?.find(b => b.id === id)) },
        getActiveProject: () => options.activeProject ?? '长篇小说/晨星外传',
        settings: {},
    };
}

/** StyleFingerprintLibrary.get 单例按 app+project 缓存；测试里替换实例方法 */
async function stubLibrary(counts: { template: number; global: number; project: number }): Promise<void> {
    const library = {
        loadTemplate: vi.fn(async () => Array.from({ length: counts.template }, () => ({}))),
        loadGlobal: vi.fn(async () => Array.from({ length: counts.global }, () => ({}))),
        loadProject: vi.fn(async () => Array.from({ length: counts.project }, () => ({}))),
    };
    const { StyleFingerprintLibrary } = await import('../../../engine/style-fingerprint-library');
    vi.spyOn(StyleFingerprintLibrary, 'get').mockReturnValue(library as never);
}

function makeEngine(pluginStub: ReturnType<typeof makePluginStub>): EngineInstance {
    const ctx = { projects: ['长篇小说/晨星外传'], activeProject: '长篇小说/晨星外传' };
    const diagnose = {
        collectKnowledge: async () => ({ bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0, embeddingReady: true, storeLoadedBooks: 1, storeReady: true }),
        collectStyle: async () => ({ templateCount: 1, globalCount: 1, projectCount: 1, enabledCount: 1, intensityDisabledCount: 0, embeddingReady: true }),
        collectConstraint: async () => ({ sourceCount: 1, settingExists: true, reviewStatus: 'approved' as const, bound: true, rulesHasContent: true }),
    };
    return new AgentHarnessEngine({
        ctx,
        adapter: { call: async () => ({ content: '{"reply":"ok"}', finishReason: 'stop' }) } as never,
        portDeps: { port: { confirmDangerousAction: async () => true } as never, ctx },
        flowDiagnosis: diagnose,
        flowRepair: createFlowRepairHost({ app: {} as never, plugin: pluginStub as never }),
    });
}

function registeredTool(engine: EngineInstance, name: string) {
    const registry = (engine as unknown as { registry: { tools: Map<string, { sideEffect?: string; execute: (args: Record<string, unknown>, ctx: unknown) => Promise<{ ok: boolean; content: string }> }> } }).registry;
    const tool = registry.tools.get(name);
    if (!tool) throw new Error(`工具未注册：${name}；已注册 ${[...(registry.tools as Map<string, unknown>).keys()].join(', ')}`);
    return tool;
}

const CTX = { memory: { slots: {} } };

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('repair_flow 工具可达（接线断言）', () => {
    it('workbench 同款构造（flowDiagnosis + flowRepair=宿主桥）后 registry 里有 repair_flow', () => {
        const engine = makeEngine(makePluginStub({ scheduler: { revectorizeBook: async () => {} } }));
        const names = engine.getTools().map(t => t.name);
        expect(names).toContain(REPAIR_FLOW_TOOL);
        expect(registeredTool(engine, REPAIR_FLOW_TOOL).sideEffect).toBe('write');
    });
});

describe('宿主桥：revectorizeBook', () => {
    it('桥接调用到 scheduler.revectorizeBook（bookId + 补齐的书名），返回 ok:true', async () => {
        const scheduler = { revectorizeBook: vi.fn(async () => {}) };
        const bridge = createFlowRepairHost({
            app: {} as never,
            plugin: makePluginStub({
                scheduler,
                books: [{ id: 'kb_a', name: '赤潮' }],
            }) as never,
        });
        const result = await bridge.revectorizeBook('kb_a');
        expect(scheduler.revectorizeBook).toHaveBeenCalledWith('kb_a', '赤潮');
        expect(result).toMatchObject({ ok: true, detail: '《赤潮》向量已重算' });
    });

    it('宿主缺 scheduler：如实 ok:false（不抛错）', async () => {
        const bridge = createFlowRepairHost({ app: {} as never, plugin: makePluginStub({}) as never });
        const result = await bridge.revectorizeBook('kb_a');
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('拆解调度器未初始化');
    });

    it('书不在知识库：ok:false 并指明 bookId', async () => {
        const scheduler = { revectorizeBook: vi.fn(async () => {}) };
        const bridge = createFlowRepairHost({
            app: {} as never,
            plugin: makePluginStub({ scheduler, books: [] }) as never,
        });
        const result = await bridge.revectorizeBook('kb_missing');
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('kb_missing');
        expect(scheduler.revectorizeBook).not.toHaveBeenCalled();
    });

    it('scheduler 抛错：ok:false 带异常信息', async () => {
        const scheduler = { revectorizeBook: vi.fn(async () => { throw new Error('模型 404'); }) };
        const bridge = createFlowRepairHost({
            app: {} as never,
            plugin: makePluginStub({ scheduler, books: [{ id: 'kb_a', name: '赤潮' }] }) as never,
        });
        const result = await bridge.revectorizeBook('kb_a');
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('模型 404');
    });

    it('端到端：宿主缺 scheduler 时执行 repair_flow → ok:false（桥如实上报，不静默成功）', async () => {
        const engine = makeEngine(makePluginStub({}));
        const tool = registeredTool(engine, REPAIR_FLOW_TOOL);
        const result = await tool.execute(
            { action: 'revectorize_book', bookId: 'kb_a' },
            { memory: { slots: {} }, approvalGranted: true },
        );
        expect(result.ok).toBe(false);
        expect(result.content).toContain('拆解调度器未初始化');
    });
});

describe('宿主桥：reloadFingerprints', () => {
    it('三层条数返回（有项目时 loadProject 参与）', async () => {
        await stubLibrary({ template: 2, global: 3, project: 1 });
        const bridge = createFlowRepairHost({
            app: {} as never,
            plugin: makePluginStub({ activeProject: '长篇小说/晨星外传' }) as never,
        });
        const result = await bridge.reloadFingerprints();
        expect(result).toEqual({ template: 2, global: 3, project: 1 });
    });

    it('无活动项目：project 层为 0（不调用 loadProject）', async () => {
        await stubLibrary({ template: 1, global: 2, project: 0 });
        const bridge = createFlowRepairHost({
            app: {} as never,
            plugin: makePluginStub({ activeProject: '' }) as never,
        });
        const result = await bridge.reloadFingerprints();
        expect(result.project).toBe(0);
    });
});
