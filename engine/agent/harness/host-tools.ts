/**
 * host-tools.ts — Harness 宿主工具集
 *
 * 把 GuideAgentPort（项目创建/界面打开）与故事结构随机、记忆槽位包装成
 * 模型可调用的受守卫工具。工具只做「参数整理 + 端口调用 + 结果摘要」，
 * 业务校验仍由端口背后的创建服务负责。
 */
import type { GuideAgentPort } from '@/engine/agent/agent-types';
import type { AgentContext } from '@/engine/agent/agent-types';
import type { HarnessMemoryState, HarnessTool } from './harness-types';
import { parsePlanSteps, summarizePlanUpdate, type PlanStep } from './creation-plan';
import {
    createDefaultStorySettings,
    generateRandomStorySettings,
    STORY_STRUCTURES,
    type StoryStructureId,
} from '@/shared/story-structure';
import { SCRIPT_GENRES, SHORT_STORY_CATEGORIES, getCreationModeLabel } from '@/shared/creation-mode';
import { commandAllowedModes } from '@/shared/command-mode-rules';
import { DEFAULT_READ_LINES } from '@/shared/file-path-guard';

/** 记忆槽位白名单：update_memory 只能写这些键 */
const MEMORY_KEYS = [
    'creationType', 'executionMode', 'projectName', 'genre', 'projectType',
    'longVariant', 'channel', 'sourceWork', 'fanficType', 'canonScope',
    'structureId', 'tone', 'goldenFinger', 'shortCategory', 'premise',
    'coreConflict', 'emotionalPromise', 'reversals', 'endingPayoff',
    'characterCore', 'scriptGenre', 'logline', 'hook3s', 'payoff',
    'characters', 'scenes', 'targetEpisodes', 'paywallEpisode', 'pickedProject',
] as const;

/**
 * Harness 记忆槽键。
 */
export type MemorySlotKey = typeof MEMORY_KEYS[number];

/**
 * 记忆键类型守卫。
 *
 * @param key - 键
 * @returns 布尔值
 */
export function isMemoryKey(key: string): key is MemorySlotKey {
    return (MEMORY_KEYS as readonly string[]).includes(key);
}

/**
 * 读取记忆槽。
 *
 * @param memory - 记忆
 * @param key - 键
 * @returns 槽内容
 */
export function readSlot(memory: HarnessMemoryState, key: MemorySlotKey): string {
    const value = memory.slots[key];
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 宿主工具依赖。
 */
export interface HostToolDeps {
    port: GuideAgentPort;
    ctx: AgentContext;
    memory: HarnessMemoryState;
    /** 创作计划状态（update_plan 工具读写；工作台左栏实时渲染） */
    plan?: { steps: PlanStep[] };
}

/**
 * 创建宿主工具集（读写/检索/计划等）。
 *
 * @param deps - 依赖
 * @returns 工具数组
 */
export function createHostTools(deps: HostToolDeps): HarnessTool[] {
    const { port, ctx, memory } = deps;
    const tools: HarnessTool[] = [];

    // ─── 记忆 ───
    tools.push({
        name: 'update_memory',
        description: '把用户确认过的信息记入长期记忆（创建项目时以此为准）。每次把 newly 确认的字段合并进来即可，不必重传全部。',
        parameters: {
            slots: {
                type: 'object',
                description: `要记录的字段与值，可用字段：${MEMORY_KEYS.join('、')}`,
                required: true,
            },
        },
        required: ['slots'],
        sideEffect: 'none',
        execute: async (args) => {
            const slots = args.slots;
            if (!slots || typeof slots !== 'object' || Array.isArray(slots)) {
                return { ok: false, content: 'slots 必须是对象' };
            }
            let applied = 0;
            const ignored: string[] = [];
            for (const [key, value] of Object.entries(slots as Record<string, unknown>)) {
                if (!isMemoryKey(key)) {
                    ignored.push(key);
                    continue;
                }
                if (value === null || value === undefined) continue;
                memory.slots[key] = typeof value === 'string' ? value.trim() : value;
                applied++;
            }
            return {
                ok: applied > 0,
                content: applied > 0
                    ? `已记录 ${applied} 项${ignored.length > 0 ? `；忽略未知字段：${ignored.join('、')}` : ''}。当前记忆：${Object.keys(memory.slots).join('、')}`
                    : '没有可记录的字段',
            };
        },
    });

    // ─── 创作计划（吸收 dsh plan-mode：计划呈现 → 工具维护 → UI 实时渲染）───
    tools.push({
        name: 'update_plan',
        description: '维护一份有序的创作计划（最多 8 步）。多步任务（新建→大纲→写章→质检→导出）开始时建立计划；每完成一步就把该步标为 done、下一步标为 in_progress。步骤要具体（如「写第2章正文」而不是「继续」）。',
        parameters: {
            steps: {
                type: 'array',
                description: '计划步骤数组，每项 {"step": 步骤描述, "status": "pending"|"in_progress"|"done"}',
                required: true,
            },
        },
        required: ['steps'],
        sideEffect: 'none',
        execute: async (args, toolCtx) => {
            const planState = (toolCtx as unknown as { plan?: { steps: PlanStep[] } }).plan;
            if (!planState) return { ok: false, content: '计划状态不可用' };
            const steps = parsePlanSteps(args.steps);
            if (!steps) {
                return { ok: false, content: 'steps 必须是非空数组，每项含 step（描述）与 status（pending/in_progress/done）' };
            }
            planState.steps = steps;
            const lines = steps.map((step, index) => `${index + 1}. [${step.status}] ${step.step}`);
            return { ok: true, content: `创作计划已更新（${summarizePlanUpdate(steps)}）：\n${lines.join('\n')}` };
        },
    });

    // ─── 项目目录 ───
    tools.push({
        name: 'list_projects',
        description: '查看用户当前的全部项目与正在打开的项目。',
        parameters: {},
        required: [],
        sideEffect: 'none', timeoutMs: 10_000,
        execute: async () => ({
            ok: true,
            content: ctx.projects.length > 0
                ? `共 ${ctx.projects.length} 个项目：${ctx.projects.join('、')}${ctx.activeProject ? `；当前打开：${ctx.activeProject}` : ''}`
                : '用户还没有项目',
            data: { projects: ctx.projects, activeProject: ctx.activeProject },
        }),
    });

    // ─── 随机设定 ───
    tools.push({
        name: 'random_story_settings',
        description: '生成一套自洽的长篇故事设定随机组合（结构/主角起点/冲突/力量体系/金手指/原型/性格/基调/感情线/节奏）。用户说「随便/你推荐/随机」时使用。',
        parameters: {
            genre: { type: 'string', description: '题材，可留空' },
            structureId: {
                type: 'string',
                description: '锁定某个故事结构，可留空',
                enum: STORY_STRUCTURES.map(s => s.id),
            },
        },
        required: [],
        sideEffect: 'none',
        execute: async (args) => {
            const settings = generateRandomStorySettings({
                genre: typeof args.genre === 'string' ? args.genre : undefined,
                structureId: typeof args.structureId === 'string' ? (args.structureId as StoryStructureId) : undefined,
            });
            memory.slots.randomSettings = settings;
            return {
                ok: true,
                content: [
                    `结构：${settings.structureId}`,
                    `主角起点：${settings.protagonistStart}`,
                    `核心冲突：${settings.coreConflict}`,
                    `力量体系：${settings.powerSystem}`,
                    `金手指：${settings.goldenFinger}`,
                    `人物原型：${settings.archetype}`,
                    `性格：${settings.temperament}`,
                    `基调：${settings.tone}`,
                    `感情线：${settings.romance}`,
                    `节奏：${settings.pacing}`,
                ].join('；'),
                data: { settings },
            };
        },
    });

    // ─── 长篇创建 ───
    tools.push({
        name: 'create_long_project',
        description: '创建长篇小说项目。调用前必须已向用户展示设定摘要并获得确认。参数缺省时从记忆回填。',
        parameters: {
            projectName: { type: 'string', description: '项目名（2-20 字符）', required: true },
            genre: { type: 'string', description: '题材（1-12 字）', required: true },
            projectType: { type: 'string', description: 'original（原创）或 fanfic（同人）', enum: ['original', 'fanfic'] },
            sourceWork: { type: 'string', description: '原作名称（同人必填）' },
            channel: { type: 'string', description: '男频/女频/通用', enum: ['男频', '女频', '通用'] },
            fanficType: { type: 'string', description: '同人类型（同人时）' },
            canonScope: { type: 'string', description: '对原作改动范围（同人时）' },
            structureId: { type: 'string', description: '故事结构 id', enum: STORY_STRUCTURES.map(s => s.id) },
            tone: { type: 'string', description: '叙事基调' },
            goldenFinger: { type: 'string', description: '金手指' },
        },
        // 全部字段都可从记忆回填；缺失时工具体内返回定向错误让模型补问
        required: [],
        sideEffect: 'write', timeoutMs: 20_000,
        execute: async (args, toolCtx) => {
            const pick = (key: MemorySlotKey, argKey: string): string => {
                const arg = args[argKey];
                if (typeof arg === 'string' && arg.trim()) return arg.trim();
                return readSlot(toolCtx.memory, key);
            };
            const projectName = pick('projectName', 'projectName');
            const genre = pick('genre', 'genre');
            if (!projectName || !genre) {
                return { ok: false, content: '缺少项目名或题材，先向用户询问并用 update_memory 记录' };
            }

            const projectType = (pick('projectType', 'projectType') === 'fanfic' || pick('longVariant', 'longVariant') === 'fanfic') ? 'fanfic' : 'original';
            const sourceWork = pick('sourceWork', 'sourceWork');
            if (projectType === 'fanfic' && !sourceWork) {
                return { ok: false, content: '同人项目缺少原作名称，先向用户询问' };
            }

            // 结构：显式参数 > 随机设定 > 记忆 > 默认
            // （旧实现把记忆排在随机之前，用户明确要「随机」时会沿用旧结构，
            //   而 settings 来自另一套随机结果 → 结构 id 与阶段/基调互相矛盾并落盘）
            const random = (memory.slots.randomSettings && typeof memory.slots.randomSettings === 'object')
                ? memory.slots.randomSettings as ReturnType<typeof createDefaultStorySettings>
                : null;
            const structureArg = typeof args.structureId === 'string' && args.structureId.trim()
                ? args.structureId.trim() as StoryStructureId
                : '';
            const structureId: StoryStructureId = (structureArg
                || random?.structureId
                || (readSlot(toolCtx.memory, 'structureId') as StoryStructureId)
                || 'qichengzhuanhe') as StoryStructureId;
            if (!STORY_STRUCTURES.some(s => s.id === structureId)) {
                return { ok: false, content: `故事结构 ${structureId} 无效，可用：${STORY_STRUCTURES.map(s => s.id).join('/')}` };
            }

            const settings = random && !structureArg ? { ...random } : createDefaultStorySettings(structureId);
            settings.structureId = structureId;
            const tone = pick('tone', 'tone') || settings.tone;
            if (tone) settings.tone = tone;
            const goldenFinger = pick('goldenFinger', 'goldenFinger') || settings.goldenFinger;
            if (goldenFinger) settings.goldenFinger = goldenFinger;

            memory.slots.creationType = 'long';
            memory.slots.projectName = projectName;
            memory.slots.genre = genre;
            memory.slots.structureId = structureId;

            const outcome = await port.createProject({
                projectName,
                genre,
                projectType,
                sourceWork: projectType === 'fanfic' ? sourceWork : undefined,
                channel: pick('channel', 'channel') || undefined,
                fanficType: projectType === 'fanfic' ? (pick('fanficType', 'fanficType') || undefined) : undefined,
                canonScope: projectType === 'fanfic' ? (pick('canonScope', 'canonScope') || undefined) : undefined,
                storySettings: settings,
            });
            if (outcome.created) {
                memory.slots.pickedProject = outcome.projectId;
            }
            return {
                ok: outcome.created,
                content: outcome.created
                    ? `长篇项目「${projectName}」创建成功（${outcome.fileCount} 个文件），项目 ID：${outcome.projectId}`
                    : `创建失败：${outcome.reason || '未知原因'}`,
                data: { ...outcome },
            };
        },
    });

    // ─── 短篇创建 ───
    tools.push({
        name: 'create_short_project',
        description: '创建短篇小说项目（番茄短篇规格：8 万字 / 20 节由工具默认）。调用前必须已获得用户确认。',
        parameters: {
            projectName: { type: 'string', description: '项目名', required: true },
            primaryCategory: { type: 'string', description: '番茄短篇分类名', required: true },
            premise: { type: 'string', description: '一句话故事', required: true },
            coreConflict: { type: 'string', description: '核心冲突', required: true },
            emotionalPromise: { type: 'string', description: '情绪承诺', required: true },
            reversals: { type: 'string', description: '反转设计', required: true },
            endingPayoff: { type: 'string', description: '结尾兑现', required: true },
            characterCore: { type: 'string', description: '主角核心欲望与软肋', required: true },
        },
        required: [],
        sideEffect: 'write', timeoutMs: 20_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory;
            const pick = (key: MemorySlotKey, argKey: string): string => {
                const arg = args[argKey];
                if (typeof arg === 'string' && arg.trim()) return arg.trim();
                return readSlot(mem, key);
            };
            const projectName = pick('projectName', 'projectName');
            const primaryCategory = pick('shortCategory', 'primaryCategory');
            if (!projectName || !primaryCategory) {
                return { ok: false, content: '缺少项目名或短篇分类' };
            }
            if (!SHORT_STORY_CATEGORIES.some(c => c.name === primaryCategory)) {
                return { ok: false, content: `「${primaryCategory}」不是有效的番茄短篇分类，可用：${SHORT_STORY_CATEGORIES.map(c => c.name).join('、')}` };
            }

            memory.slots.creationType = 'short';
            memory.slots.projectName = projectName;

            // 前期调研是后续大纲/正文的硬约束：缺任何一项都不能「创建成功」，
            // 旧实现会写入空栏并回报成功，模型因此不会补问。
            const preResearch = {
                primaryCategory,
                premise: pick('premise', 'premise'),
                coreConflict: pick('coreConflict', 'coreConflict'),
                emotionalPromise: pick('emotionalPromise', 'emotionalPromise'),
                reversals: pick('reversals', 'reversals'),
                endingPayoff: pick('endingPayoff', 'endingPayoff'),
                characterCore: pick('characterCore', 'characterCore'),
            };
            const missingPillars = Object.entries(preResearch)
                .filter(([key, value]) => key !== 'primaryCategory' && !String(value || '').trim())
                .map(([key]) => key);
            if (missingPillars.length > 0) {
                return {
                    ok: false,
                    content: `短篇前期调研还缺：${missingPillars.join('、')}。先向用户询问并 update_memory 记录，再创建项目。`,
                };
            }

            const outcome = await port.createShortProject?.({
                projectName,
                targetWords: 80000,
                targetSections: 20,
                preResearch,
            });
            if (!outcome) return { ok: false, content: '当前环境不支持创建短篇项目' };
            if (outcome.created) memory.slots.pickedProject = outcome.projectId;
            return {
                ok: outcome.created,
                content: outcome.created
                    ? `短篇项目「${projectName}」创建成功，已写入前期调研`
                    : `创建失败：${outcome.reason || '未知原因'}`,
                data: { ...outcome },
            };
        },
    });

    // ─── 剧本创建 ───
    tools.push({
        name: 'create_script_project',
        description: '创建短剧剧本项目（红果规格）。调用前必须已获得用户确认。',
        parameters: {
            projectName: { type: 'string', description: '项目名', required: true },
            scriptGenre: { type: 'string', description: '红果短剧类型名', required: true },
            logline: { type: 'string', description: '一句话 logline', required: true },
            hook3s: { type: 'string', description: '前3秒钩子', required: true },
            coreConflict: { type: 'string', description: '核心冲突', required: true },
            payoff: { type: 'string', description: '核心爽点/兑现', required: true },
            characters: { type: 'string', description: '主要角色与关系', required: true },
            scenes: { type: 'string', description: '核心场景/名场面', required: true },
            targetEpisodes: { type: 'number', description: '目标集数（40-120）', required: true },
            paywallEpisode: { type: 'number', description: '付费卡点集数', required: true },
        },
        required: [],
        sideEffect: 'write', timeoutMs: 20_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory;
            const pick = (key: MemorySlotKey, argKey: string): string => {
                const arg = args[argKey];
                if (typeof arg === 'string' && arg.trim()) return arg.trim();
                if (typeof arg === 'number') return String(arg);
                return readSlot(mem, key);
            };
            const projectName = pick('projectName', 'projectName');
            const scriptGenre = pick('scriptGenre', 'scriptGenre');
            if (!projectName || !scriptGenre) {
                return { ok: false, content: '缺少项目名或短剧类型' };
            }
            if (!SCRIPT_GENRES.some(g => g.name === scriptGenre)) {
                return { ok: false, content: `「${scriptGenre}」不是有效的红果短剧类型，可用：${SCRIPT_GENRES.map(g => g.name).join('、')}` };
            }
            const targetEpisodes = clampInt(args.targetEpisodes ?? mem.slots.targetEpisodes, 40, 120, 80);
            const paywallEpisode = clampInt(args.paywallEpisode ?? mem.slots.paywallEpisode, 1, 120, 12);

            memory.slots.creationType = 'script';
            memory.slots.projectName = projectName;

            // 与短篇同源：前期调研缺项不能「创建成功」（空栏会一路带到分集大纲）
            const preResearch = {
                scriptGenre,
                logline: pick('logline', 'logline'),
                hook3s: pick('hook3s', 'hook3s'),
                coreConflict: pick('coreConflict', 'coreConflict'),
                payoff: pick('payoff', 'payoff'),
                characters: pick('characters', 'characters'),
                scenes: pick('scenes', 'scenes'),
                targetEpisodes,
                paywallEpisode,
            };
            const missingPillars = ['logline', 'hook3s', 'coreConflict', 'payoff', 'characters', 'scenes']
                .filter(key => !String(preResearch[key as keyof typeof preResearch] || '').trim());
            if (missingPillars.length > 0) {
                return {
                    ok: false,
                    content: `剧本前期调研还缺：${missingPillars.join('、')}。先向用户询问并 update_memory 记录，再创建项目。`,
                };
            }

            const outcome = await port.createScriptProject?.({
                projectName,
                genre: scriptGenre,
                preResearch,
            });
            if (!outcome) return { ok: false, content: '当前环境不支持创建剧本项目' };
            if (outcome.created) memory.slots.pickedProject = outcome.projectId;
            return {
                ok: outcome.created,
                content: outcome.created
                    ? `剧本项目「${projectName}」创建成功（${targetEpisodes} 集，卡点第 ${paywallEpisode} 集）`
                    : `创建失败：${outcome.reason || '未知原因'}`,
                data: { ...outcome },
            };
        },
    });

    // ─── 界面打开 ───
    tools.push({
        name: 'open_wizard',
        description: '打开长篇项目的初始化向导。仅适用于长篇；短篇/剧本请用 open_flow。',
        parameters: { project: { type: 'string', description: '项目 ID 或名称，可留空表示用记忆中的当前项目' } },
        required: [],
        sideEffect: 'none', timeoutMs: 10_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = resolveProject(args, mem, ctx);
            if (!project) return { ok: false, content: '项目不存在或未指定；先向用户确认要打开哪个项目' };
            const projectStatus = port.getProjectStatus ? await port.getProjectStatus(project) : null;
            if (projectStatus && projectStatus.mode !== 'long') {
                const label = projectStatus.mode === 'short' ? '短篇' : '剧本';
                const unit = projectStatus.mode === 'short' ? '节' : '集';
                return {
                    ok: false,
                    content: `「${project}」是${label}项目，没有长篇的初始化向导。请改用 open_flow 查看创作流程，或 open_pre_research 补前期调研，再逐${unit}写作。`,
                    data: { mode: projectStatus.mode },
                };
            }
            const ok = await port.openWizard(project);
            return { ok, content: ok ? `已打开「${project}」的项目向导` : `打开向导失败，请让用户在项目页手动点击「向导」` };
        },
    });
    tools.push({
        name: 'open_flow',
        description: '打开项目的「创作流程」页：显示当前阶段、进度与下一步动作。长篇、短篇、剧本都适用。',
        parameters: { project: { type: 'string', description: '项目 ID 或名称，可留空用当前项目' } },
        required: [],
        sideEffect: 'none', timeoutMs: 10_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = resolveProject(args, mem, ctx);
            if (!port.openFlow) return { ok: false, content: '当前环境不支持打开创作流程' };
            const ok = await port.openFlow(project || undefined);
            return { ok, content: ok ? `已打开${project ? `「${project}」的` : ''}创作流程` : '打开创作流程失败' };
        },
    });
    tools.push({
        name: 'open_full_writer',
        description: '打开项目与章节工作台。',
        parameters: { project: { type: 'string', description: '项目 ID 或名称，可留空' } },
        required: [],
        sideEffect: 'none', timeoutMs: 10_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = resolveProject(args, mem, ctx);
            // 项目参数必须真的生效：旧实现端口丢弃参数，打开的是「当前活动项目」，
            // 新建项目后调用会把用户带到旧项目，后续写作/批量命令也作用在旧项目上。
            const ok = project ? await port.openFullWriter(project) : await port.openFullWriter();
            return { ok, content: ok ? `已打开${project ? `「${project}」的` : ''}项目与章节工作台` : '打开失败' };
        },
    });
    tools.push({
        name: 'open_story_settings',
        description: '打开项目的设定界面：长篇是故事结构与九组设定；短篇打开故事核，剧本打开场景圣经。',
        parameters: { project: { type: 'string', description: '项目 ID 或名称，可留空' } },
        required: [],
        sideEffect: 'none',
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = resolveProject(args, mem, ctx);
            if (!project) return { ok: false, content: '没有指定项目；先向用户确认' };
            const ok = port.openStorySettings(project);
            return { ok, content: ok ? `已打开「${project}」的故事结构设置` : '打开失败' };
        },
    });
    tools.push({
        name: 'open_pre_research',
        description: '打开短篇/剧本的前期调研界面。',
        parameters: {
            mode: { type: 'string', description: 'short（短篇）或 script（剧本）', enum: ['short', 'script'], required: true },
            project: { type: 'string', description: '项目 ID 或名称，可留空' },
        },
        required: ['mode'],
        sideEffect: 'none',
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const mode = String(args.mode) === 'script' ? 'script' : 'short';
            const project = resolveProject(args, mem, ctx);
            const ok = port.openPreResearch(mode, project || undefined);
            return { ok, content: ok ? `已打开${mode === 'script' ? '剧本' : '短篇'}前期调研` : '打开失败' };
        },
    });
    tools.push({
        name: 'open_co_writing',
        description: '打开句级协同写作工作台（需要先有打开的章节）。',
        parameters: {},
        required: [],
        sideEffect: 'none',
        execute: async () => {
            if (!port.openCoWriting) return { ok: false, content: '当前环境不支持协同写作' };
            const ok = port.openCoWriting();
            return { ok, content: ok ? '已打开句级协同写作' : '打开失败；请先在工作台打开一个章节' };
        },
    });

    // ─── 章节与项目状态 ───
    tools.push({
        name: 'list_chapters',
        description: '列出指定项目的章节（或短篇的节/剧本的集）与状态（pending/written/settled）。用于判断创作进度和下一步建议。',
        parameters: { project: { type: 'string', description: '项目 ID 或名称，可留空用当前项目' } },
        required: [],
        sideEffect: 'none', timeoutMs: 15_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = resolveProject(args, mem, ctx);
            if (!project) return { ok: false, content: '没有指定项目，也没有已选中的项目' };
            if (!port.listChapters) return { ok: false, content: '当前环境不支持读取章节' };
            const chapters = await port.listChapters(project);
            if (chapters.length === 0) return { ok: true, content: `「${project}」还没有任何章节` };
            const written = chapters.filter(chapter => chapter.written);
            const latestWritten = written.length > 0 ? written[written.length - 1].chapter : '（无）';
            const lines = chapters.slice(0, 30).map(chapter => {
                const tag = chapter.written
                    ? `已写，${Math.round(chapter.size / 1000)}KB`
                    : '待写骨架，未完成';
                return `- ${chapter.chapter}${chapter.title ? `「${chapter.title}」` : ''}（${tag}）`;
            });
            return {
                ok: true,
                content: [
                    `「${project}」共 ${chapters.length} 个章节条目，其中已写 ${written.length} 章（最后一章已写：${latestWritten}）。`,
                    '注意：标为「待写骨架」的章节只是批量建章生成的空文件，不算完成，也不能当作续写起点。',
                    lines.join('\n') + (chapters.length > 30 ? `\n…等共 ${chapters.length} 个` : ''),
                ].join('\n'),
                data: { chapters: chapters.slice(0, 30), writtenCount: written.length, latestWritten },
            };
        },
    });
    tools.push({
        name: 'open_chapter',
        description: '在工作台打开指定章节（如「第3章」）或短篇/剧本的单元（如「第3节」「第3集」）。打开后用户可继续写作或执行该单元的生成步骤。',
        parameters: {
            chapter: { type: 'string', description: '章节名，如「第3章」', required: true },
            project: { type: 'string', description: '项目 ID 或名称，可留空用当前项目' },
        },
        required: ['chapter'],
        sideEffect: 'none', timeoutMs: 10_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = resolveProject(args, mem, ctx);
            const chapter = String(args.chapter || '').trim();
            if (!project || !chapter) return { ok: false, content: '需要项目与章节名' };
            if (!port.openChapter) return { ok: false, content: '当前环境不支持打开章节' };
            const ok = port.openChapter(project, chapter);
            return { ok, content: ok ? `已打开「${project}」的 ${chapter}` : `未找到 ${chapter}` };
        },
    });
    tools.push({
        name: 'get_project_status',
        description: '读取项目状态摘要：创作模式、故事结构、规划单元数、已写单元数、待写骨架数、最后一个已写单元、建议接下来写的单元。长篇的单位是章，短篇是节，剧本是集。用于判断真实创作进度与下一步，不要用条目总数当已完成数。',
        parameters: { project: { type: 'string', description: '项目 ID 或名称，可留空用当前项目' } },
        required: [],
        sideEffect: 'none', timeoutMs: 15_000,
        execute: async (args, toolCtx) => {
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = resolveProject(args, mem, ctx);
            if (!project) return { ok: false, content: '没有指定项目，也没有已选中的项目' };
            if (!port.getProjectStatus) return { ok: false, content: '当前环境不支持读取项目状态' };
            const status = await port.getProjectStatus(project);
            if (!status) return { ok: false, content: `读取「${project}」状态失败` };
            const modeLabel = status.mode === 'long' ? '长篇' : status.mode === 'short' ? '短篇' : '剧本';
            const unitLabel = status.mode === 'long' ? '章' : status.mode === 'short' ? '节' : '集';
            const statusText = Object.entries(status.byStatus).map(([key, count]) => `${key} ${count}`).join('、') || `无${unitLabel}`;
            const latest = status.latestWrittenChapter || `（尚无已写${unitLabel}）`;
            return {
                ok: true,
                content: [
                    `「${project}」：${modeLabel}；结构 ${status.structureId || '未设置'}`,
                    `规划 ${status.plannedChapters} ${unitLabel}；已写 ${status.writtenChapters} ${unitLabel}；待写骨架 ${status.skeletonChapters} ${unitLabel}`,
                    `最后一个已写${unitLabel}：${latest}；建议接下来写：${status.nextChapterToWrite}`,
                    `（状态明细：${statusText}。注意：status=pending 的是批量建${unitLabel}生成的空骨架，不算已完成。）`,
                ].join('\n'),
                data: status as unknown as Record<string, unknown>,
            };
        },
    });

    // ─── 文件检索（吸收 dsh context/file-reference：按需读，不整库塞上下文）───
    tools.push({
        name: 'read_file',
        description: '读取库里某个文件的一段内容（按行分页）。用于查看章节正文、大纲、设定、结算表、spill 存档等。只支持文本文件；单次最多 200 行/8192 字符，返回里若提示还有后续，用 offset 继续读。',
        parameters: {
            path: { type: 'string', description: '库内相对路径（如「项目名/03-大纲与章节/正文/第1章.md」）', required: true },
            offset: { type: 'number', description: '起始行（1-based，默认 1）' },
            limit: { type: 'number', description: '读取行数（默认 200，最多 2000）' },
        },
        required: ['path'],
        sideEffect: 'none', timeoutMs: 10_000,
        execute: async (args) => {
            if (!port.readFile) return { ok: false, content: '当前环境不支持读取文件' };
            const path = String(args.path || '').trim();
            const result = await port.readFile(path, {
                offset: clampInt(args.offset, 1, 10_000_000, 1),
                limit: clampInt(args.limit, 1, 2000, DEFAULT_READ_LINES),
            });
            if (!result) {
                return {
                    ok: false,
                    content: `未找到文件「${path}」。请先用 list_projects / list_chapters 或 search_vault 确认路径，不要臆造路径。`,
                };
            }
            const head = `【${result.path}】第 ${result.startLine}-${result.endLine} 行，共 ${result.totalLines} 行`;
            const tail = result.truncated ? `\n……（后面还有内容，用 offset=${result.endLine + 1} 继续读）` : '';
            return {
                ok: true,
                content: `${head}\n${result.content}${tail}`,
                data: {
                    path: result.path,
                    startLine: result.startLine,
                    endLine: result.endLine,
                    totalLines: result.totalLines,
                    truncated: result.truncated,
                },
            };
        },
    });
    tools.push({
        name: 'search_vault',
        description: '在库中按关键词检索文本文件，返回「路径:行号:摘要」（默认最多 20 条）。用于定位人名/物品/伏笔/设定出现的位置，然后再用 read_file 精读那一段。只读，不改动任何文件。',
        parameters: {
            query: { type: 'string', description: '关键词（中文不需要分词，按原文子串匹配；大小写不敏感）', required: true },
            folder: { type: 'string', description: '限定检索目录（库内相对路径，如「项目名/05-设定库」）' },
            limit: { type: 'number', description: '最多返回条数（默认 20，最多 50）' },
        },
        required: ['query'],
        sideEffect: 'none', timeoutMs: 20_000,
        execute: async (args) => {
            if (!port.searchVault) return { ok: false, content: '当前环境不支持库内检索' };
            const query = String(args.query || '').trim();
            if (!query) return { ok: false, content: '缺少关键词' };
            const hits = await port.searchVault(query, {
                limit: clampInt(args.limit, 1, 50, 20),
                folder: typeof args.folder === 'string' ? args.folder : undefined,
            });
            if (hits.length === 0) {
                return {
                    ok: true,
                    content: `没有找到「${query}」。可以换同义词/更短的关键词，或先 list_chapters 看目录结构。`,
                };
            }
            const lines = hits.map(hit => `${hit.path}:${hit.line}: ${hit.text}`);
            return {
                ok: true,
                content: `「${query}」命中 ${hits.length} 处：\n${lines.join('\n')}`,
                data: { count: hits.length },
            };
        },
    });

    // ─── 文件/项目写操作（Agent 全权限：写文件、删文件、移动、删项目）───
    tools.push({
        name: 'write_file',
        description: '创建/覆盖/追加库内文本文件（md/txt/json/yaml 等）。用于写设定、大纲、笔记、配置或用户明确要求直接改正文；写正文优先走写作命令以保留 frontmatter/格式契约。路径必须是库内相对路径。',
        parameters: {
            path: { type: 'string', description: '库内相对路径（如「长篇小说/书A/01-世界架构/设定库.md」）', required: true },
            content: { type: 'string', description: '完整文本内容（追加模式下为追加片段）', required: true },
            append: { type: 'boolean', description: 'true = 追加到文件末尾；默认覆盖' },
        },
        required: ['path', 'content'],
        sideEffect: 'write', timeoutMs: 20_000,
        execute: async (args) => {
            if (!port.writeFile) return { ok: false, content: '当前环境不支持写文件' };
            const path = String(args.path || '').trim();
            if (!path) return { ok: false, content: '缺少文件路径' };
            const result = await port.writeFile(path, String(args.content ?? ''), { append: args.append === true });
            return {
                ok: true,
                content: `${result.created ? '已创建' : '已写入'}「${result.path}」（${result.bytes} 字节）`,
                data: { ...result },
            };
        },
    });
    tools.push({
        name: 'delete_file',
        description: '删除库内单个文件。默认进系统回收站；permanent=true 时永久删除。删除前必须向用户说明路径；目录请用 delete_project 或 run_command。',
        parameters: {
            path: { type: 'string', description: '库内相对路径', required: true },
            permanent: { type: 'boolean', description: 'true = 永久删除（不进回收站）' },
        },
        required: ['path'],
        sideEffect: 'dangerous', timeoutMs: 20_000,
        execute: async (args) => {
            if (!port.deleteFile) return { ok: false, content: '当前环境不支持删除文件' };
            const path = String(args.path || '').trim();
            if (!path) return { ok: false, content: '缺少文件路径' };
            const result = await port.deleteFile(path, { permanent: args.permanent === true });
            if (!result.deleted) return { ok: false, content: `文件不存在或无法删除：${result.path}` };
            return {
                ok: true,
                content: `${result.trashed ? '已移入回收站' : '已永久删除'}「${result.path}」`,
                data: { ...result },
            };
        },
    });
    tools.push({
        name: 'move_file',
        description: '移动或重命名库内文件。用于整理章节/设定/导出稿；目标目录会自动创建。',
        parameters: {
            from: { type: 'string', description: '源路径（库内相对路径）', required: true },
            to: { type: 'string', description: '目标路径（库内相对路径）', required: true },
        },
        required: ['from', 'to'],
        sideEffect: 'write', timeoutMs: 20_000,
        execute: async (args) => {
            if (!port.moveFile) return { ok: false, content: '当前环境不支持移动文件' };
            const from = String(args.from || '').trim();
            const to = String(args.to || '').trim();
            if (!from || !to) return { ok: false, content: '需要源路径与目标路径' };
            const result = await port.moveFile(from, to);
            return { ok: true, content: `已移动「${result.from}」→「${result.to}」`, data: { ...result } };
        },
    });
    tools.push({
        name: 'delete_project',
        description: '彻底删除一个项目及其全部文件（正文、大纲、设定、版本、会话存档不在删除范围内）。删除前必须向用户说明项目名并获得确认；这是不可恢复操作。',
        parameters: {
            project: { type: 'string', description: '项目 ID 或名称，可留空用当前项目' },
        },
        required: [],
        sideEffect: 'dangerous', timeoutMs: 60_000,
        execute: async (args, toolCtx) => {
            if (!port.deleteProject) return { ok: false, content: '当前环境不支持删除项目' };
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const requested = typeof args.project === 'string' ? args.project.trim() : '';
            // 已从项目列表消失、但目录仍残留的项目（ghost）允许用完整路径直接删除；
            // 只给显示名时仍走会话快照，避免误删同名目录。
            const project = resolveProject(args, mem, ctx) || (requested.includes('/') ? requested : '');
            if (!project) return { ok: false, content: '没有指定项目，也没有已选中的项目；清理残留请给出完整路径（如 长篇小说/旧项目）' };
            const result = await port.deleteProject(project);
            if (!result.deleted) {
                return { ok: false, content: `未删除「${project}」：${result.reason || '未知原因'}` };
            }
            // 同一会话里的项目快照必须立即刷新，否则后续 list_projects / get_project_status
            // 仍会看到已删除项目（Agent 工作台与其他视图不同步的根因之一）。
            ctx.projects = port.listProjects?.() ?? ctx.projects.filter(item => item !== project);
            if (ctx.activeProject === project) ctx.activeProject = null;
            return {
                ok: true,
                content: `已彻底删除项目「${project}」及其全部文件`,
                data: { ...result, projects: ctx.projects },
            };
        },
    });

    // ─── 长流程执行结果（v4.21：run_command 之后的闭环）───
    tools.push({
        name: 'get_execution_status',
        description: '查询最近的长流程执行结果（一键成文/章节结算/导出/看板等）：状态、耗时、失败原因、结算回写量（更新/新建/搁置/伏笔闭环）。用 run_command 触发过长流程后必须调用它核对结果，再向用户汇报进展，不要只说「请去界面查看」。',
        parameters: {
            limit: { type: 'number', description: '返回条数（默认 5，最多 20）' },
            project: { type: 'string', description: '只看某个项目（可留空看全部）' },
        },
        required: [],
        sideEffect: 'none', timeoutMs: 5_000,
        execute: async (args, toolCtx) => {
            if (!port.getExecutionLedger) return { ok: false, content: '当前环境不支持读取执行记录' };
            const limit = clampInt(args.limit, 1, 20, 5);
            const mem = toolCtx.memory as unknown as HarnessMemoryState;
            const project = typeof args.project === 'string' && args.project.trim()
                ? resolveProject(args, mem, ctx)
                : '';
            const records = port.getExecutionLedger(limit).filter(record => !project || record.project === project);
            if (records.length === 0) {
                return {
                    ok: true,
                    content: project
                        ? `「${project}」还没有长流程执行记录。若刚用 run_command 触发过，可能仍在运行或该命令不需要登记（如纯界面跳转）。`
                        : '还没有长流程执行记录。批量生成/结算/导出完成后会自动登记。',
                };
            }
            const lines = records.map((record, index) => {
                const statusText = record.status === 'running' ? '进行中' : record.status === 'done' ? '完成' : '失败';
                const duration = typeof record.finishedAt === 'number'
                    ? `，耗时 ${Math.max(1, Math.round((record.finishedAt - record.startedAt) / 1000))}s`
                    : '';
                const head = `${index + 1}. [${statusText}] ${record.label || record.commandId}${record.project ? ` · ${record.project}` : ''}${duration}`;
                const extras: string[] = [];
                if (record.detail) extras.push(record.detail);
                if (record.failure) extras.push(`失败原因：${record.failure}`);
                if (record.settlement) {
                    const s = record.settlement;
                    const parts = [`更新 ${s.updated}`, `新建 ${s.created}`, `伏笔推进 ${s.updatedForeshadows}`];
                    if (s.missingEntities > 0) parts.push(`搁置 ${s.missingEntities}`);
                    if (s.rejected > 0) parts.push(`拒绝字段 ${s.rejected}`);
                    if (s.linkFieldWrites > 0) parts.push(`链接化 ${s.linkFieldWrites}`);
                    if (s.recordedBehaviors > 0) parts.push(`出场记录 ${s.recordedBehaviors}`);
                    if (s.foreshadowLoop) parts.push(`伏笔闭环${s.foreshadowLoop.pass ? '通过' : '未通过：' + s.foreshadowLoop.summary}`);
                    extras.push(`结算：${parts.join('、')}`);
                }
                return extras.length > 0 ? `${head}\n   ${extras.join('；')}` : head;
            });
            return {
                ok: true,
                content: `最近 ${records.length} 条长流程记录：\n${lines.join('\n')}`,
                data: { count: records.length },
            };
        },
    });

    // ─── 全功能命令 ───
    tools.push({
        name: 'list_commands',
        description: '列出本插件全部可用命令（批量建章/一键成文/质检/结算/导出/世界观生成等）。在用 run_command 之前先用它确认命令 ID。',
        parameters: {},
        required: [],
        sideEffect: 'none',
        execute: async () => {
            if (!port.listCommands) return { ok: false, content: '当前环境不支持列出命令' };
            const commands = port.listCommands();
            if (commands.length === 0) return { ok: true, content: '没有可用命令' };
            const byGroup = new Map<string, string[]>();
            for (const cmd of commands) {
                const list = byGroup.get(cmd.group) || [];
                list.push(`${cmd.name} → ${cmd.id}`);
                byGroup.set(cmd.group, list);
            }
            const parts = [...byGroup.entries()].map(([group, list]) => `【${group}】\n${list.join('\n')}`);
            return { ok: true, content: parts.join('\n\n') };
        },
    });
    tools.push({
        name: 'run_command',
        description: '执行插件的任意命令（批量建章、一键成文、章节结算、导出成稿等）。执行前必须向用户说明将要运行的命令并确认。先 list_commands 拿到准确命令 ID。',
        parameters: {
            commandId: { type: 'string', description: '命令 ID（来自 list_commands）', required: true },
            reason: { type: 'string', description: '一句话说明为什么要执行该命令' },
        },
        required: ['commandId'],
        sideEffect: 'dangerous', timeoutMs: 30_000,
        execute: async (args, toolCtx) => {
            const commandId = String(args.commandId || '').trim();
            if (!commandId) return { ok: false, content: '缺少 commandId' };
            if (!port.runCommand) return { ok: false, content: '当前环境不支持执行命令' };
            // 只允许执行本插件命令：旧实现会把任意 ID 透传给 Obsidian 命令系统，
            // 模型（或提示注入）可以借此执行 app:delete-file 等破坏性命令。
            if (!/^novel-writer[-:]/.test(commandId)) {
                return {
                    ok: false,
                    content: `拒绝执行 ${commandId}：只能执行本插件命令（novel-writer-*）。请用 list_commands 获取可用 ID。`,
                };
            }
            // 模式守卫：长篇命令在短篇/剧本项目下会写错目录，直接拒绝并给出替代路径。
            // 命令面板已用 checkCallback 隐藏，但 Agent 走 registry，必须在这里再拦一次。
            const allowedModes = commandAllowedModes(commandId);
            if (allowedModes && port.getProjectStatus) {
                const mem = toolCtx.memory as unknown as HarnessMemoryState;
                const project = resolveProject({}, mem, ctx);
                if (project) {
                    const status = await port.getProjectStatus(project);
                    if (status && !allowedModes.includes(status.mode)) {
                        const expected = allowedModes.map(mode => getCreationModeLabel(mode)).join(' / ');
                        return {
                            ok: false,
                            content: `命令 ${commandId} 仅适用于${expected}项目；当前「${project}」是${getCreationModeLabel(status.mode)}。请改用 open_flow 查看下一步，或调用短篇/剧本对应的工具。`,
                        };
                    }
                }
            }
            // 危险命令必须让用户确认（吸收 dsh user-approval）；没有确认端口时拒绝执行。
            // 若回合层已通过 HarnessApprovalRequest 批准过，这里不再二次弹窗。
            if (isDangerousCommand(commandId) && toolCtx.approvalGranted !== true) {
                if (!port.confirmDangerousAction) {
                    return {
                        ok: false,
                        content: `「${commandId}」属于高成本/破坏性操作，当前界面不支持确认，已拒绝执行。请让用户在界面上手动触发。`,
                    };
                }
                const approved = await port.confirmDangerousAction({
                    title: 'Agent 请求执行高成本命令',
                    detail: `${commandId}${args.reason ? `\n原因：${String(args.reason)}` : ''}`,
                });
                if (!approved) {
                    return {
                        ok: false,
                        content: `用户拒绝执行「${commandId}」。不要重复尝试；询问用户希望改用哪种方式继续。`,
                    };
                }
            }
            const ok = await Promise.resolve(port.runCommand(commandId));
            return {
                ok,
                content: ok
                    ? `已执行命令 ${commandId}${args.reason ? `（${String(args.reason)}）` : ''}；长流程（成文/结算/导出）的真实结果稍后用 get_execution_status 查询，不要只说「请去界面看」。`
                    : `命令 ${commandId} 执行失败；请用 list_commands 确认 ID 后重试`,
            };
        },
    });

    return tools;
}

/**
 * 破坏性/高成本命令（dsh user-approval 的精简版）：
 * 批量生成/重建/结算/导出会在后台写大量文件或消耗大量额度，
 * 执行前必须让用户看到「将要对哪个项目做什么」并确认。
 */
const DANGEROUS_COMMAND_PATTERN = /(batch|auto-writer|write-chapter|continue-chapters|settle|settlement|export|rebuild|backup|protect|deconstruct)/i;

/**
 * 判断命令是否属于危险操作。
 *
 * @param commandId - 命令 ID
 * @returns 布尔值
 */
export function isDangerousCommand(commandId: string): boolean {
    return DANGEROUS_COMMAND_PATTERN.test(commandId);
}

function resolveProject(args: Record<string, unknown>, memory: HarnessMemoryState, ctx: AgentContext): string {
    // 项目名来自模型输出，按不可信输入处理：只接受「项目列表里真实存在」的路径。
    // 旧实现对未命中的显式参数原样返回，`../..`/任意目录会被当成项目去读写
    // （open_story_settings 会往 `${project}/.project` 写文件）。
    const safeLibraryPath = (value: string): boolean => {
        // 至少「库/项目」两段，且不含空段、`.`/`..`、隐藏目录
        if (!/^[^/\\]+(\/[^/\\]+)+$/.test(value)) return false;
        return !value.split('/').some(seg => seg === '.' || seg === '..' || seg.startsWith('.'));
    };
    const match = (value: string): string => {
        const matched = ctx.projects.find(p => p === value || p.endsWith(`/${value}`));
        return matched || '';
    };

    const explicit = typeof args.project === 'string' ? args.project.trim() : '';
    if (explicit) {
        // 未命中就视为不存在，绝不把原始字符串透传成路径
        return match(explicit);
    }

    const picked = readSlot(memory, 'pickedProject');
    if (picked) {
        // 新创建的项目可能还没进入会话启动时的列表：仅在路径形状合法时接受
        return match(picked) || (safeLibraryPath(picked) ? picked : '');
    }
    if (ctx.projects.length === 1) return ctx.projects[0];
    return ctx.activeProject || '';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.round(num)));
}
