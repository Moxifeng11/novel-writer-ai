import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CommandRegistry, CommandIds } from '../../../core/command-registry';

/**
 * CommandRegistry 的命令注册护栏。
 *
 * 背景：core 层不允许依赖 ui，44 个 Modal 构造与视图方法迁至 ui/command-ui-executor.ts。
 * 这里先钉住「迁移前后注册的命令 id 集合完全一致」，再钉住「UI 命令走注入端口、
 * 非 UI 命令仍留在 core 执行」，避免搬迁时漏注册或把业务命令一起搬走。
 */

/** 重构前 registerInternalCommands 注册的全部命令 id（64 项） */
const EXPECTED_REGISTERED_IDS: string[] = [
    CommandIds.CREATE_PROJECT,
    CommandIds.AGENT_GUIDE,
    CommandIds.CREATE_SHORT,
    CommandIds.CREATE_SCRIPT,
    CommandIds.SHORT_RESEARCH,
    CommandIds.SCRIPT_RESEARCH,
    CommandIds.SHORT_STORY_CORE,
    CommandIds.SHORT_OUTLINE,
    CommandIds.SCRIPT_SCENE_BIBLE,
    CommandIds.SCRIPT_OUTLINE,
    CommandIds.SCRIPT_STORYBOARD,
    CommandIds.IMPORT_EXAMPLE,
    CommandIds.PLAN_BOOK,
    CommandIds.VOLUME_INTRO,
    CommandIds.BATCH_CHAPTERS,
    CommandIds.BATCH_NOVELS,
    CommandIds.CONTINUE_CHAPTERS,
    CommandIds.AUTO_WRITER,
    CommandIds.DIAGNOSE,
    CommandIds.TOMATO_RANK,
    CommandIds.REBUILD_CHAPTERS,
    CommandIds.BACKUP_META,
    CommandIds.PROTECT_META,
    CommandIds.TAGS_ANALYSIS,
    CommandIds.AI_BUILDER,
    CommandIds.ADD_FANFIC,
    CommandIds.WRITE_CHAPTER,
    CommandIds.WRITE_CHAPTER_AUTO,
    CommandIds.REVIEW_CHAPTER,
    CommandIds.TARGETED_REVISION,
    CommandIds.QUALITY_DASHBOARD,
    CommandIds.BATCH_CREATE,
    CommandIds.WORLDVIEW,
    CommandIds.CHARACTER,
    CommandIds.FACTION,
    CommandIds.LOCATION,
    CommandIds.ITEM,
    CommandIds.ENTITY_MANAGER,
    CommandIds.ENTITY_GENERATE,
    CommandIds.REFRESH_INFO_DEBT,
    CommandIds.CROSS_VOLUME_STATE,
    CommandIds.STYLE_DISTILLER,
    CommandIds.CONTEXT_INJECTOR,
    CommandIds.CHAPTER_SETTLEMENT,
    CommandIds.IDEATION,
    CommandIds.GOLDEN_OPENING,
    CommandIds.STEP_RESULT_VIEWER,
    // Rev 186：关联索引看板（时间线/伏笔 ↔ 设定库/全书规划）
    CommandIds.STORY_LINKAGE_BOARD,
    CommandIds.BATCH_DECONSTRUCT,
    CommandIds.FULL_WRITER,
    CommandIds.SWITCH_PROVIDER,
    CommandIds.EXTRACT_ELEMENTS,
    CommandIds.CHARACTER_RECOGNITION,
    CommandIds.POPULATE_SETTING_LIB_INTERNAL,
    CommandIds.CO_WRITING,
    CommandIds.EXPAND_TEXT,
    CommandIds.OUTLINE_EXPAND,
    CommandIds.REWRITE_SUGGESTION,
    CommandIds.EXPORT_MANUSCRIPT,
    CommandIds.FINGERPRINT_LIBRARY,
    CommandIds.OPEN_KNOWLEDGE_BASE,
    CommandIds.CLEAR_WORLDVIEW_CACHE,
    CommandIds.WORLDVIEW_CACHE_STATS,
    CommandIds.VERSION_HISTORY,
    CommandIds.SAVE_VERSION,
    // Rev 180：叙事总览补进 registry，快捷工具点击不再 fallback 到 Obsidian 命令面板
    CommandIds.NARRATIVE_OVERVIEW,
    // 2026-10-29：Agent 工作台「设置」入口此前指向不存在的命令，补真实注册
    CommandIds.OPEN_SETTINGS,
    CommandIds.MIGRATE_ENTITY_LINKS,
    CommandIds.PROJECT_SIDE_PANEL,
    CommandIds.GENERATE_BASES,
    CommandIds.MIGRATE_NAMESPACE_TAGS,
    CommandIds.COMPLETE_PROPERTIES,
    // 命令面板已注册「创作流程」但不在 UI 委托表 → exec 找不到、点了无反应；补进来
    CommandIds.CREATION_FLOW,
    CommandIds.WRITING_STATS,
    CommandIds.TOGGLE_PET,
];

interface Harness {
    registry: CommandRegistry;
    register: ReturnType<typeof vi.fn>;
    ui: any;
    refreshInfoDebt: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
    const register = vi.fn();
    const refreshInfoDebt = vi.fn();
    const ui = { executeCommand: vi.fn(async () => true) };
    const registry = new CommandRegistry({
        app: {} as never,
        registry: { register } as never,
        aiEngine: { extractElements: vi.fn(async () => ({ error: undefined })) },
        ctxManager: {},
        foreshadowManager: { refreshInfoDebt },
        plugin: {} as never,
        getActiveProject: () => null,
        openProviderSwitcher: vi.fn(),
        refreshFullWriterContextPanel: vi.fn(),
        populateSettingLib: vi.fn(async () => {}),
        isWorkbenchContext: () => false,
        ui,
    } as never);
    return { registry, register, ui, refreshInfoDebt };
}

function findCallback(register: ReturnType<typeof vi.fn>, id: string): (() => Promise<void>) | undefined {
    const call = register.mock.calls.find((args) => args[0] === id);
    return call?.[1] as (() => Promise<void>) | undefined;
}

describe('CommandRegistry 注册与 UI 委托', () => {
    it('注册的命令 id 集合与重构前快照一致', () => {
        const { registry, register } = makeHarness();

        registry.registerInternalCommands();

        const ids = register.mock.calls.map((args) => args[0]);
        expect(ids).toHaveLength(EXPECTED_REGISTERED_IDS.length);
        expect(new Set(ids)).toEqual(new Set(EXPECTED_REGISTERED_IDS));
    });

    it('UI 类命令委托注入端口执行，core 不再构造 Modal', async () => {
        const { registry, register, ui } = makeHarness();
        registry.registerInternalCommands();

        const callback = findCallback(register, CommandIds.PLAN_BOOK);
        expect(callback).toBeTypeOf('function');
        await callback?.();

        expect(ui.executeCommand).toHaveBeenCalledWith(CommandIds.PLAN_BOOK);
    });

    it('非 UI 命令保留在 core 内执行，不经过注入端口', async () => {
        const { registry, register, ui, refreshInfoDebt } = makeHarness();
        registry.registerInternalCommands();

        const callback = findCallback(register, CommandIds.REFRESH_INFO_DEBT);
        expect(callback).toBeTypeOf('function');
        await callback?.();

        expect(refreshInfoDebt).toHaveBeenCalledTimes(1);
        expect(ui.executeCommand).not.toHaveBeenCalled();
    });
});

describe('命令面板与定义表一致', () => {
    it('addCommand 注册集合 === 非 internalOnly 定义集合', () => {
        const { registry } = makeHarness();
        const ids: string[] = [];
        registry.registerObsidianCommands(cmd => { ids.push(cmd.id); });
        const expected = registry.getAllCommands()
            .filter(cmd => !cmd.internalOnly)
            .map(cmd => cmd.id);
        expect(new Set(ids)).toEqual(new Set(expected));
    });
});
