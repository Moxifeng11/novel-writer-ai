/**
 * flow-repair-host.test.ts — repair_flow 宿主桥回归（DSH-20261112-16）
 *
 * 接线前 repair_flow 在生产不可达（对抗审计 #B2）。本文件锁桥接行为：
 * 工具可达（engine 注册）、桥接真的调到 scheduler / 指纹库、宿主能力缺失时
 * 如实 ok:false（repair_tools 的 fail-closed 契约不变）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Vault } from 'obsidian';
// 静态 import（check:view-tests 只认行首 import/export 语句；动态 import 不算）——
// vi.mock 由 vitest 提升到文件顶部，静态 import 同样吃得到 mock。
import { createFlowRepairHost } from '../../../ui/services/flow-repair-host';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

const HarnessEngineModule = await import('../../../engine/agent/harness/harness-engine');
const { AgentHarnessEngine } = HarnessEngineModule;
type EngineInstance = InstanceType<typeof AgentHarnessEngine>;
const { REPAIR_FLOW_TOOL } = await import('../../../engine/agent/harness/repair-tools');

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


describe('宿主桥：cleanupOrphanVectors', () => {
    it('对账有孤儿：removeOrphanVectors 以 confirmed:true + kbBookIds 调用（fail-closed 语义固化在桥内）', async () => {
        const removeOrphanVectors = vi.fn(async () => ({ orphanCount: 1, removed: ['kb_ghost'], skipped: [] }));
        const plugin = {
            knowledgeVectorStore: {
                reconcileWithIndex: vi.fn(async () => ({ orphans: ['kb_ghost'], missing: [], healthy: [] })),
                removeOrphanVectors,
            },
            knowledgeBaseManager: { getAllBooks: vi.fn(async () => [{ id: 'kb_live' }]) },
            getActiveProject: () => '长篇小说/晨星外传',
            settings: {},
        };
        const bridge = createFlowRepairHost({ app: {} as never, plugin: plugin as never });
        const result = await bridge.cleanupOrphanVectors();
        expect(removeOrphanVectors).toHaveBeenCalledWith(['kb_ghost'], {
            confirmed: true,
            kbBookIds: ['kb_live'],
        });
        expect(result).toMatchObject({ orphanCount: 1, removed: ['kb_ghost'] });
    });

    it('对账无孤儿：不触碰 removeOrphanVectors', async () => {
        const removeOrphanVectors = vi.fn(async () => ({ orphanCount: 0, removed: [], skipped: [] }));
        const plugin = {
            knowledgeVectorStore: {
                reconcileWithIndex: vi.fn(async () => ({ orphans: [], missing: [], healthy: ['kb_live'] })),
                removeOrphanVectors,
            },
            knowledgeBaseManager: { getAllBooks: vi.fn(async () => [{ id: 'kb_live' }]) },
            getActiveProject: () => '',
            settings: {},
        };
        const bridge = createFlowRepairHost({ app: {} as never, plugin: plugin as never });
        const result = await bridge.cleanupOrphanVectors();
        expect(result.orphanCount).toBe(0);
        expect(removeOrphanVectors).not.toHaveBeenCalled();
    });

    it('向量库未初始化：skipped 带原因，不抛错', async () => {
        const bridge = createFlowRepairHost({ app: {} as never, plugin: {} as never });
        const result = await bridge.cleanupOrphanVectors();
        expect(result.removed).toEqual([]);
        expect(result.skipped[0]).toContain('向量库未初始化');
    });
});

describe('宿主桥：fixZeroIntensity', () => {
    it('强度为 0 的启用指纹恢复 1.0（setIntensityConfig 合并原配置）', async () => {
        stubLibrary({ template: 0, global: 0, project: 0 });
        const setIntensityConfig = vi.fn(async () => {});
        const fpZero = { id: 'fp_zero', enabled: true };
        const fpOk = { id: 'fp_ok', enabled: true };
        const plugin = {
            knowledgeVectorStore: {},
            knowledgeBaseManager: { getAllBooks: vi.fn(async () => []) },
            getActiveProject: () => '长篇小说/晨星外传',
            settings: {},
        };
        const bridge = createFlowRepairHost({ app: {} as never, plugin: plugin as never });
        // 直接替换桥内的 library 行为：通过 StyleFingerprintLibrary.get 的 spy 返回桩
        const { StyleFingerprintLibrary } = await import('../../../engine/style-fingerprint-library');
        const libStub = {
            getEnabledFingerprints: vi.fn(async () => [fpZero, fpOk]),
            loadIntensityConfigs: vi.fn(async () => ({})),
            getIntensityConfig: vi.fn((id: string) => (id === 'fp_zero' ? { globalIntensity: 0 } : { globalIntensity: 0.6 })),
            setIntensityConfig,
        };
        vi.spyOn(StyleFingerprintLibrary, 'get').mockReturnValue(libStub as never);
        const { getStyleIntensityEngine } = await import('../../../engine/style/style-intensity-engine');
        vi.spyOn(await import('../../../engine/style/style-intensity-engine'), 'getStyleIntensityEngine').mockReturnValue({
            previewIntensity: (config: { globalIntensity: number }) => ({ disabled: config.globalIntensity === 0, effectiveIntensity: config.globalIntensity, dimensionEffects: {} }),
        } as never);
        const result = await bridge.fixZeroIntensity();
        expect(result.fixed).toEqual(['fp_zero']);
        expect(result.failed).toEqual([]);
        expect(setIntensityConfig).toHaveBeenCalledWith('fp_zero', { globalIntensity: 1.0 }, '长篇小说/晨星外传');
    });

    it('未激活项目：failed 带原因（强度修复只支持项目层）', async () => {
        const bridge = createFlowRepairHost({
            app: {} as never,
            plugin: makePluginStub({ activeProject: '' }) as never,
        });
        const result = await bridge.fixZeroIntensity();
        expect(result.fixed).toEqual([]);
        expect(result.failed[0]).toContain('未激活项目');
    });
});


describe('宿主桥：cleanupDiskVectors', () => {
    it('对账有 diskUnloaded：removeDiskVectors 以 confirmed:true 调用', async () => {
        const removeDiskVectors = vi.fn(async () => ({ removed: ['kb_diskonly'], skipped: [] }));
        const plugin = {
            knowledgeVectorStore: {
                reconcileWithIndex: vi.fn(async () => ({ orphans: [], missing: [], healthy: ['kb_live'], diskUnloaded: ['kb_diskonly'] })),
                removeDiskVectors,
            },
            knowledgeBaseManager: { getAllBooks: vi.fn(async () => [{ id: 'kb_live' }]) },
            getActiveProject: () => '',
            settings: {},
        };
        const bridge = createFlowRepairHost({ app: {} as never, plugin: plugin as never });
        const result = await bridge.cleanupDiskVectors();
        expect(removeDiskVectors).toHaveBeenCalledWith(['kb_diskonly'], { confirmed: true });
        expect(result).toEqual({ removed: ['kb_diskonly'], skipped: [] });
    });

    it('对账无 diskUnloaded：不触碰 removeDiskVectors', async () => {
        const removeDiskVectors = vi.fn(async () => ({ removed: [], skipped: [] }));
        const plugin = {
            knowledgeVectorStore: {
                reconcileWithIndex: vi.fn(async () => ({ orphans: [], missing: [], healthy: ['kb_live'] })),
                removeDiskVectors,
            },
            knowledgeBaseManager: { getAllBooks: vi.fn(async () => [{ id: 'kb_live' }]) },
            getActiveProject: () => '',
            settings: {},
        };
        const bridge = createFlowRepairHost({ app: {} as never, plugin: plugin as never });
        const result = await bridge.cleanupDiskVectors();
        expect(result).toEqual({ removed: [], skipped: [] });
        expect(removeDiskVectors).not.toHaveBeenCalled();
    });

    it('向量库未初始化：skipped 带原因，不抛错', async () => {
        const bridge = createFlowRepairHost({ app: {} as never, plugin: {} as never });
        const result = await bridge.cleanupDiskVectors();
        expect(result.removed).toEqual([]);
        expect(result.skipped[0]).toContain('向量库未初始化');
    });
});

describe('宿主桥：rerunCanonResearch', () => {
    function seedFanficVault(vault: Vault): void {
        // _seedFile 是 mock Vault 的测试辅助（真实 obsidian 类型里没有），
        // 且读 this._store —— 必须带 this 调用。
        const helper = vault as unknown as { _seedFile: (p: string, c: string) => unknown };
        helper._seedFile('长篇小说/晨星外传/.project', '## 类型\nfanfic\n\n## 同人设定路径\n长篇小说/晨星外传/05-同人设定库/晨星设定.md\n');
        helper._seedFile('长篇小说/晨星外传/05-同人设定库/晨星设定.md', '---\n审核状态: approved\n---\n\n# 晨星志 同人设定\n\n作品名称: 晨星志\n\n- **核心规则**：晨星之夜离港。\n');
    }

    it('前置校验：未激活项目 → ok:false', async () => {
        const plugin = { getActiveProject: () => '', vault: new Vault() };
        const bridge = createFlowRepairHost({ app: { vault: plugin.vault } as never, plugin: plugin as never });
        const result = await bridge.rerunCanonResearch();
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('未激活项目');
    });

    it('前置校验：项目无绑定设定 → ok:false', async () => {
        const vault = new Vault();
        const plugin = { getActiveProject: () => '长篇小说/无设定', vault, knowledgeVectorStore: {} };
        const bridge = createFlowRepairHost({ app: { vault } as never, plugin: plugin as never });
        const result = await bridge.rerunCanonResearch();
        expect(result.ok).toBe(false);
        expect(result.detail).toContain('没有绑定的同人设定文件');
    });

    it('成功路径：research 产出来源 → ok:true + 计数（service 被正确构造）', async () => {
        const vault = new Vault();
        seedFanficVault(vault);
        const { CanonResearchService } = await import('../../../services/canon-research-service');
        const researchSpy = vi.spyOn(CanonResearchService.prototype, 'research').mockResolvedValue({
            workName: '晨星志',
            provider: 'wikipedia',
            sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }, { url: 'https://example.com/3' }],
            sourceHash: 'hash',
            warnings: [],
            updatedAt: 1,
        } as never);
        const plugin = { getActiveProject: () => '长篇小说/晨星外传', vault };
        const bridge = createFlowRepairHost({ app: { vault } as never, plugin: plugin as never });
        const result = await bridge.rerunCanonResearch();
        expect(researchSpy).toHaveBeenCalledWith('晨星志', { project: '长篇小说/晨星外传' });
        expect(result).toMatchObject({ ok: true, sourceCount: 3, workName: '晨星志' });
        researchSpy.mockRestore();
    });

    it('零产出：ok:false（跑了但没产出，如实失败）', async () => {
        const vault = new Vault();
        seedFanficVault(vault);
        const { CanonResearchService } = await import('../../../services/canon-research-service');
        const researchSpy = vi.spyOn(CanonResearchService.prototype, 'research').mockResolvedValue({
            workName: '晨星志',
            provider: 'manual',
            sources: [],
            sourceHash: '',
            warnings: ['没有导入任何原作来源'],
            updatedAt: 1,
        } as never);
        const plugin = { getActiveProject: () => '长篇小说/晨星外传', vault };
        const bridge = createFlowRepairHost({ app: { vault } as never, plugin: plugin as never });
        const result = await bridge.rerunCanonResearch();
        expect(result.ok).toBe(false);
        expect(result.sourceCount).toBe(0);
        researchSpy.mockRestore();
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
