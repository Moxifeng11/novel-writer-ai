/**
 * agent-port.ts — 对话 Agent 的宿主端口工厂
 *
 * 从 agent-guide-modal 抽出并扩展：除创建/打开界面外，新增
 * 章节读取、项目状态、协同写作与「执行任意插件命令」能力，
 * 让 Agent 能覆盖从新建项目到导出成稿的全部插件功能。
 */
import { App, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '@/main';
import type {
    AgentChapterSummary,
    AgentCommandRunRecord,
    AgentCommandSummary,
    AgentContext,
    AgentFileReadResult,
    AgentProjectStatus,
    AgentVaultSearchHit,
    GuideAgentPort,
} from '@/engine/agent/agent-types';
import { extractLineWindow, sanitizeVaultPath, summarizeHitLine } from '@/shared/file-path-guard';
import { withWriteLock } from '@/shared/write-lock';
import { getExecutionLedger } from '@/services/execution-ledger';
import { createLongNovelProject } from './project-create-service';
import { StorySettingsModal } from '@/ui/story-settings-modal';
import { OperationConfirmModal } from '@/ui/components/progress';
import { DomainProjectFactory } from '@/domains/kernel/domain-project-factory';
import { createDefaultPreResearch, writePreResearchFiles, type ScriptPreResearch, type ShortPreResearch } from '@/shared/pre-research';
import { PreResearchModal } from '@/ui/pre-research-modal';
import { CREATION_MODE_SPECS, getCreationModeLabel, parseCreationModeMeta, type CreationModeMeta } from '@/shared/creation-mode';
import { collectCreationFlowState } from '@/ui/full-writer/creation-flow-state';
import type { CreationFlowSnapshot } from '@/shared/creation-flow';
import { getProjectModeSync, resolveProjectMode } from '@/shared/project-mode';
import { ModeDocumentModal } from '@/ui/mode-document-modal';
import { getStoryStructure } from '@/shared/story-structure';
import { createLogger } from '@/shared/logger';
import { spillFolderFor } from './agent-spill-store';
import { FullWriterView } from '@/ui/full-writer-view';
import { getChaptersForProject, sortChaptersByNumber, type ChapterListEntry } from '@/ui/project-utils';
import { isChapterWritten, summarizeChapterProgress } from '@/shared/chapter-progress';
import { listModeUnits, modeUnitLabel, type ModeUnitInfo } from '@/shared/mode-content';
import { readProjectMeta } from '@/shared/paths';
import { CoWritingView } from '@/ui/co-writing-view';
import { listProjectIds, removeProjectDirectory } from '@/shared/project-catalog';
import { MODE_LIBRARY_ROOT_LIST } from '@/shared/creation-mode';
import { writeVaultText } from '@/shared/file-system-port';
import { BodyWriter } from '@/engine/body-writer';
import { isChapterBodyPath } from '@/shared/body-path';
import { projectIdFromPath } from '@/shared/paths';

const log = createLogger('AgentPort');

/**
 * getAgentContext 函数。
 * @param app - Obsidian 应用实例
 * @param plugin - 插件实例
  * @returns AgentContext 实例
 */
export function getAgentContext(app: App, plugin: NovelWriterPlugin): AgentContext {
    return { projects: listProjectIds(app), activeProject: plugin.getActiveProject() };
}

void CoWritingView;

function parseChapterNumber(chapter: string): number {
    return parseInt(chapter.match(/\d+/)?.[0] || '0', 10) || 0;
}

/**
 * 章节条目 → Agent 摘要（截断字段，控制 token）
 *
 * @param entry - 条目
  * @returns AgentChapterSummary 实例
 */
function toChapterSummary(entry: ChapterListEntry): AgentChapterSummary {
    return {
        chapter: entry.chapter,
        volume: entry.volume || '',
        title: (entry.title || '').slice(0, 40),
        status: entry.status || 'pending',
        hasBody: entry.hasBody,
        written: entry.written,
        size: entry.size,
    };
}

/**
 * createAgentPort 函数。
 * @param app - Obsidian 应用实例
 * @param plugin - 插件实例
  * @returns GuideAgentPort 实例
 */
export function createAgentPort(app: App, plugin: NovelWriterPlugin): GuideAgentPort {
    // 只允许访问当前项目自己的 spill 溢出目录；会话存档 `.sessions/agent/*.jsonl`
    // 与其它项目 spill 一律不可读写删移（安全审计 SEC-8）。
    const sessionSpillPrefix = (): string => {
        const project = plugin.getActiveProject?.() || '';
        return `${spillFolderFor(project || 'default')}/`;
    };

    /** 打开短篇/剧本的单元写作页签（异步落位，失败时提示） */
    const openUnitTab = async (project: string, unitNumber: number): Promise<boolean> => {
        try {
            await plugin.openFullWriterView();
            const leaf = app.workspace.getLeavesOfType('novel-writer-full-writer')[0];
            const view = leaf?.view;
            if (view instanceof FullWriterView) {
                await view.openUnitTab(project, unitNumber);
                return true;
            }
            return false;
        } catch (e) {
            log.warn('[AgentPort] 打开单元写作失败:', e);
            return false;
        }
    };

    return {
        createProject: async (params) => {
            const creationMeta: CreationModeMeta = {
                mode: 'long',
                shortCategory: '',
                scriptGenre: '',
                targetWords: CREATION_MODE_SPECS.long.targetWords.default,
                targetUnits: CREATION_MODE_SPECS.long.targetUnits.default,
                storyStructure: params.storySettings.structureId,
                storySettings: params.storySettings,
            };
            const result = await createLongNovelProject(app, plugin, {
                projectName: params.projectName,
                genre: params.genre,
                projectType: params.projectType,
                sourceWork: params.sourceWork,
                fanficSettingPath: undefined,
                creationMeta,
                // Agent 永远不覆盖已有项目：同名时返回失败，让模型换名或先问用户。
                // 旧实现恒返回 true，模型重试一次就会递归删除刚建好的项目（含已写正文）。
                confirmOverwrite: async () => false,
            });
            return {
                created: result.created,
                projectId: result.projectId,
                fileCount: result.fileCount,
                reason: result.reason,
            };
        },
        openWizard: async (project) => {
            try {
                const mode = await resolveProjectMode(app, project);
                if (mode !== 'long') {
                    // 初始化向导是长篇的 9 步流程；短篇/剧本的对应入口是创作流程页
                    await plugin.openCreationFlow(project);
                    new Notice(
                        `「${project}」是${getCreationModeLabel(mode)}项目，初始化向导仅适用于长篇；已为你打开创作流程。`,
                        6000,
                    );
                    return true;
                }
                await plugin.openFullWriterView();
                const leaf = app.workspace.getLeavesOfType('novel-writer-full-writer')[0];
                const view = leaf?.view;
                if (view instanceof FullWriterView) {
                    await view.openWizardForProjectById(project);
                    return true;
                }
                return false;
            } catch (e) {
                log.warn('[AgentPort] 打开向导失败:', e);
                return false;
            }
        },
        openFlow: async (project?: string) => {
            try {
                await plugin.openCreationFlow(project);
                return true;
            } catch (e) {
                log.warn('[AgentPort] 打开创作流程失败:', e);
                return false;
            }
        },
        openStorySettings: (project) => {
            const mode = getProjectModeSync(project);
            if (mode === 'short') {
                new ModeDocumentModal(app, plugin, 'short', 'storyCore', project).open();
                return true;
            }
            if (mode === 'script') {
                new ModeDocumentModal(app, plugin, 'script', 'bible', project).open();
                return true;
            }
            new StorySettingsModal(app, plugin, project).open();
            return true;
        },
        openFullWriter: async (project?: string) => {
            try {
                await plugin.openFullWriterView();
                // 传了项目就定位到该项目（旧实现丢弃参数，打开的永远是当前活动项目）
                if (project) {
                    const leaf = app.workspace.getLeavesOfType('novel-writer-full-writer')[0];
                    const view = leaf?.view;
                    if (view instanceof FullWriterView) {
                        await view.openFirstUnwrittenChapter(project);
                    }
                }
                return true;
            } catch (e) {
                log.warn('[AgentPort] 打开工作台失败:', e);
                return false;
            }
        },
        openCoWriting: () => {
            try {
                const active = plugin.getActiveProject();
                const activeMode = getProjectModeSync(active);
                if (active && activeMode !== 'long') {
                    new Notice(
                        `句级协同写作只绑定长篇章节路径；当前是${getCreationModeLabel(activeMode)}项目，请用「创作流程」进入单元写作。`,
                        6000,
                    );
                    return false;
                }
                void plugin.openCoWritingFromActiveContext().catch(e => log.warn('[AgentPort] 打开协同写作失败:', e));
                return true;
            } catch (e) {
                log.warn('[AgentPort] 打开协同写作失败:', e);
                return false;
            }
        },
        createShortProject: async (params) => {
            const data: ShortPreResearch = {
                ...(createDefaultPreResearch('short', params.projectName) as ShortPreResearch),
                primaryCategory: params.preResearch.primaryCategory,
                targetWords: params.targetWords,
                targetSections: params.targetSections,
                premise: params.preResearch.premise,
                coreConflict: params.preResearch.coreConflict,
                emotionalPromise: params.preResearch.emotionalPromise,
                reversals: params.preResearch.reversals,
                endingPayoff: params.preResearch.endingPayoff,
                characterCore: params.preResearch.characterCore,
            };
            try {
                const factory = new DomainProjectFactory(app, plugin, app.vault.adapter);
                const projectId = await factory.create({
                    name: params.projectName,
                    mode: 'short',
                    genre: data.primaryCategory || '短篇',
                    description: data.premise,
                    targetWords: data.targetWords,
                    targetUnits: data.targetSections,
                    shortCategory: data.primaryCategory,
                    projectType: 'original',
                    onCreated: async (pid: string) => {
                        await writePreResearchFiles(app.vault.adapter, pid, data, app);
                        // 导航失败不能让「项目已创建」变成失败
                        await plugin.openCreationFlow(pid).catch(e => log.warn('[AgentPort] 打开创作流程失败:', e));
                    },
                });
                return { created: true, projectId, fileCount: 0 };
            } catch (e) {
                log.warn('[AgentPort] 创建短篇失败:', e);
                return { created: false, projectId: '', fileCount: 0, reason: e instanceof Error ? e.message : String(e) };
            }
        },
        createScriptProject: async (params) => {
            const data: ScriptPreResearch = {
                ...(createDefaultPreResearch('script', params.projectName) as ScriptPreResearch),
                genre: params.preResearch.scriptGenre,
                targetEpisodes: params.preResearch.targetEpisodes,
                logline: params.preResearch.logline,
                hook3s: params.preResearch.hook3s,
                coreConflict: params.preResearch.coreConflict,
                payoff: params.preResearch.payoff,
                paywallEpisode: params.preResearch.paywallEpisode,
                characters: params.preResearch.characters,
                scenes: params.preResearch.scenes,
            };
            try {
                const factory = new DomainProjectFactory(app, plugin, app.vault.adapter);
                const projectId = await factory.create({
                    name: params.projectName,
                    mode: 'script',
                    genre: data.genre,
                    description: data.logline,
                    targetWords: data.targetWords,
                    targetUnits: data.targetEpisodes,
                    scriptGenre: data.genre,
                    projectType: 'original',
                    onCreated: async (pid: string) => {
                        await writePreResearchFiles(app.vault.adapter, pid, data, app);
                        // 导航失败不能让「项目已创建」变成失败
                        await plugin.openCreationFlow(pid).catch(e => log.warn('[AgentPort] 打开创作流程失败:', e));
                    },
                });
                return { created: true, projectId, fileCount: 0 };
            } catch (e) {
                log.warn('[AgentPort] 创建剧本失败:', e);
                return { created: false, projectId: '', fileCount: 0, reason: e instanceof Error ? e.message : String(e) };
            }
        },
        openPreResearch: (mode, project) => {
            new PreResearchModal(app, plugin, mode, project ? { project } : {}).open();
            return true;
        },
        listChapters: async (project) => {
            try {
                const meta = parseCreationModeMeta(await readProjectMeta(app, project) || '');
                if (meta.mode === 'long') {
                    return sortChaptersByNumber(getChaptersForProject(app, project)).map(toChapterSummary);
                }
                return listModeUnits(app, project, meta.mode).map((unit: ModeUnitInfo) => toChapterSummary({
                    chapter: unit.unitName,
                    volume: '',
                    title: unit.title,
                    status: unit.status,
                    file: unit.file,
                    hasBody: !!unit.file,
                    written: isChapterWritten(unit.status, !!unit.file, unit.file?.stat?.size ?? 0),
                    size: unit.file?.stat?.size ?? 0,
                }));
            } catch (e) {
                log.warn('[AgentPort] 读取章节失败:', e);
                // 读失败 ≠ 项目为空：返回空数组会被工具当成「还没有任何章节」，
                // 模型据此继续批量建章/生成。抛出让工具层返回明确的失败。
                throw new Error(`读取章节失败：${e instanceof Error ? e.message : String(e)}`);
            }
        },
        openChapter: (project, chapterName) => {
            const mode = getProjectModeSync(project);
            if (mode !== 'long') {
                const unitNumber = parseInt(chapterName.match(/第\s*(\d+)/)?.[1] || '0', 10);
                if (unitNumber > 0) {
                    void openUnitTab(project, unitNumber);
                    return true;
                }
                new Notice(`未找到「${chapterName}」对应的${modeUnitLabel(mode)}号`, 4000);
                return false;
            }
            const chapters = getChaptersForProject(app, project);
            const match = sortChaptersByNumber(chapters).find(entry => entry.chapter === chapterName)
                || chapters.find(entry => entry.chapter.includes(chapterName));
            if (match?.file instanceof TFile) {
                void app.workspace.getLeaf(false).openFile(match.file);
                if (!match.written) {
                    new Notice(`「${match.chapter}」目前只是骨架（未写正文），打开后可直接生成`, 5000);
                }
                return true;
            }
            new Notice(`未找到「${chapterName}」的正文文件`, 4000);
            return false;
        },
        getProjectStatus: async (project) => {
            try {
                const rawMeta = await readProjectMeta(app, project) || '';
                const meta = parseCreationModeMeta(rawMeta);
                const mode = meta.mode;
                let chapters: ChapterListEntry[];
                if (mode === 'long') {
                    chapters = sortChaptersByNumber(getChaptersForProject(app, project));
                } else {
                    chapters = listModeUnits(app, project, mode).map((unit: ModeUnitInfo) => ({
                        chapter: unit.unitName,
                        volume: '',
                        title: unit.title,
                        status: unit.status,
                        file: unit.file,
                        hasBody: !!unit.file,
                        written: isChapterWritten(unit.status, !!unit.file, unit.file?.stat?.size ?? 0),
                        size: unit.file?.stat?.size ?? 0,
                    }));
                }
                const progress = summarizeChapterProgress(chapters.map(chapter => ({
                    chapter: chapter.chapter,
                    status: chapter.status,
                    hasBody: chapter.hasBody,
                    size: chapter.size,
                })), { unitLabel: modeUnitLabel(mode) });
                let flow: CreationFlowSnapshot | undefined;
                try {
                    // P2-4：刚算完的章节直接传给流程采集，避免内部再跑两次全库遍历
                    flow = (await collectCreationFlowState(app, project, {
                        mode,
                        longChapters: mode === 'long' ? chapters : undefined,
                    })).snapshot;
                } catch (e) {
                    // 阶段采集失败不影响基础进度：老项目/异常项目仍能看到章节统计
                    log.warn('[AgentPort] 采集创作阶段失败:', e);
                }
                const status: AgentProjectStatus = {
                    project,
                    mode,
                    structureId: meta.storySettings ? getStoryStructure(meta.storySettings.structureId).id : '',
                    totalChapters: progress.total,
                    plannedChapters: progress.plannedChapters,
                    writtenChapters: progress.written,
                    skeletonChapters: progress.skeletons,
                    byStatus: progress.byStatus,
                    latestWrittenChapter: progress.latestWrittenChapter,
                    nextChapterToWrite: progress.nextChapterToWrite,
                    flow,
                };
                return status;
            } catch (e) {
                log.warn('[AgentPort] 读取项目状态失败:', e);
                return null;
            }
        },
        confirmDangerousAction: async (request) => {
            // 吸收 dsh user-approval：Agent 请求批量生成/结算/导出等高成本命令时，
            // 由用户看到具体命令与原因后决定，而不是直接执行。
            try {
                return await OperationConfirmModal.confirm(app, {
                    title: request.title,
                    description: request.detail,
                    warning: '该操作会在后台写入文件或消耗较多 API 额度',
                    confirmText: '允许执行',
                    cancelText: '拒绝',
                });
            } catch (e) { // silent-ok: 确认弹窗异常按「拒绝执行」处理，属安全兜底
                log.warn('[AgentPort] 危险命令确认弹窗失败:', e);
                return false;
            }
        },
        runCommand: async (commandId) => {
            const ledger = getExecutionLedger();
            const project = plugin.getActiveProject() || '';
            try {
                // 只走插件自己的注册表：plugin.executeCommand 在未命中时会回退到
                // Obsidian 命令系统，等于允许 Agent 执行任意第三方命令。
                if (!plugin.registry.has(commandId)) {
                    log.warn('[AgentPort] 命令未在插件注册表:', commandId);
                    ledger.recordFailed({
                        commandId, project, source: 'agent', label: 'Agent 派发',
                        failure: '命令未在插件注册表（可能 id 写错）',
                    });
                    return false;
                }
                // 可等待版本：长流程命令的真实完成点会自己登记结果，
                // 这里只捕获「派发即抛错」的情况。
                const ok = await plugin.executeCommandAsync(commandId);
                if (!ok) {
                    ledger.recordFailed({
                        commandId, project, source: 'agent', label: 'Agent 派发',
                        failure: '命令执行抛错，详见开发者控制台',
                    });
                }
                return ok;
            } catch (e) {
                log.warn('[AgentPort] 执行命令失败:', commandId, e);
                ledger.recordFailed({
                    commandId, project, source: 'agent', label: 'Agent 派发',
                    failure: e instanceof Error ? e.message : String(e),
                });
                new Notice(`执行命令 ${commandId} 失败`, 4000);
                return false;
            }
        },
        listCommands: () => {
            try {
                const commands = app.commands.listCommands() as Array<{ id: string; name: string }>;
                return commands
                    // 只列 run_command 真正可执行的命令：两者都以 registry 为准，
                    // 避免「列表能看到、执行必失败」或反之。
                    .filter(cmd => plugin.registry.has(cmd.id))
                    .map(cmd => ({
                        id: cmd.id,
                        name: cmd.name.replace(/^小说工坊[·:]?\s*/, ''),
                        group: cmd.id.includes('chapter') || cmd.id.includes('write') || cmd.id.includes('batch')
                            ? '写作'
                            : cmd.id.includes('knowledge') || cmd.id.includes('fingerprint') || cmd.id.includes('entity')
                                ? '资料'
                                : '工具',
                    }));
            } catch (e) {
                log.warn('[AgentPort] 列出命令失败:', e);
                return [];
            }
        },
        readFile: async (path, options): Promise<AgentFileReadResult | null> => {
            // 吸收 dsh context/file-reference：模型按需读物，路径先过守卫。
            // `.sessions/` 是插件自己落的 spill 大结果，必须允许回读。
            const guard = sanitizeVaultPath(path, { allowHiddenPrefixes: [sessionSpillPrefix()] });
            if (!guard.ok) throw new Error(guard.reason);
            if (!isTextPath(guard.path)) {
                throw new Error(`只支持读取文本文件（md/txt/json/yaml 等）：${guard.path}`);
            }
            const file = app.vault.getAbstractFileByPath(guard.path);
            if (!(file instanceof TFile)) return null;
            if (file.stat.size > MAX_READ_FILE_BYTES) {
                throw new Error(`文件过大（${Math.round(file.stat.size / 1024)}KB）；请改用 search_vault 定位，或读大纲/摘要类文件`);
            }
            const raw = await app.vault.cachedRead(file);
            const window = extractLineWindow(raw, { offset: options?.offset, limit: options?.limit });
            return {
                path: guard.path,
                content: window.text,
                startLine: window.startLine,
                endLine: window.endLine,
                totalLines: window.totalLines,
                truncated: window.truncated,
                size: file.stat.size,
            };
        },
        getExecutionLedger: (limit): AgentCommandRunRecord[] => {
            try {
                return getExecutionLedger().getRecent(limit).map(record => ({
                    commandId: record.commandId,
                    label: record.label,
                    project: record.project,
                    source: record.source,
                    status: record.status,
                    startedAt: record.startedAt,
                    finishedAt: record.finishedAt,
                    detail: record.detail,
                    failure: record.failure,
                    settlement: record.settlement,
                }));
            } catch (e) {
                log.warn('[AgentPort] 读取执行登记表失败:', e);
                return [];
            }
        },
        searchVault: async (query, options): Promise<AgentVaultSearchHit[]> => {
            const needle = String(query || '').trim().toLowerCase();
            if (!needle) return [];
            const limit = Math.max(1, Math.min(50, Math.round(options?.limit ?? SEARCH_DEFAULT_LIMIT)));
            const folderGuard = options?.folder ? sanitizeVaultPath(options.folder) : null;
            if (folderGuard && !folderGuard.ok) throw new Error(folderGuard.reason);
            const folder = folderGuard && folderGuard.ok ? folderGuard.path : '';
            const hits: AgentVaultSearchHit[] = [];
            let scanned = 0;
            for (const file of app.vault.getFiles()) {
                if (hits.length >= limit || scanned >= SEARCH_MAX_FILES) break;
                if (!isTextPath(file.path)) continue;
                if (file.path.split('/').some(segment => segment.startsWith('.'))) continue;
                if (folder && file.path !== folder && !file.path.startsWith(`${folder}/`)) continue;
                if (file.stat.size > SEARCH_MAX_FILE_BYTES) continue;
                scanned++;
                let content: string;
                try {
                    content = await app.vault.cachedRead(file);
                } catch {
                    continue;
                }
                if (!content.toLowerCase().includes(needle)) continue;
                const lines = content.split(/\r?\n/);
                for (let i = 0; i < lines.length && hits.length < limit; i++) {
                    if (!lines[i].toLowerCase().includes(needle)) continue;
                    hits.push({ path: file.path, line: i + 1, text: summarizeHitLine(lines[i]) });
                }
            }
            return hits;
        },
        listProjects: () => listProjectIds(app),
        writeFile: async (path, content, options) => {
            const guard = sanitizeVaultPath(path, { allowHiddenPrefixes: [sessionSpillPrefix()] });
            if (!guard.ok) throw new Error(guard.reason);
            if (!isTextPath(guard.path)) {
                throw new Error(`只支持写入文本文件（md/txt/json/yaml 等）：${guard.path}`);
            }
            if (new TextEncoder().encode(content).length > MAX_WRITE_FILE_BYTES) {
                throw new Error(`单次写入超过 ${Math.round(MAX_WRITE_FILE_BYTES / 1024)}KB，请拆分或改用命令生成`);
            }
            // 长篇正文必须走 BodyWriter：保留 frontmatter、标题、格式契约，并阻止删除项目后复活。
            if (isChapterBodyPath(guard.path) && guard.path.includes('/03-大纲与章节/正文/')) {
                if (options?.append) throw new Error('正文不支持追加写入；请整篇提交或使用写作命令');
                const match = guard.path.match(/\/03-大纲与章节\/正文\/(第\d+卷)\/第(\d+)章/);
                if (!match) throw new Error(`无法识别正文章节路径：${guard.path}`);
                await new BodyWriter({ app }).write({
                    path: guard.path,
                    raw: content,
                    chapterNum: parseInt(match[2], 10),
                    chapterName: `第${match[2]}章`,
                    volume: match[1],
                    project: projectIdFromPath(guard.path),
                    writingMode: 'manual',
                });
                return { path: guard.path, created: false, bytes: new TextEncoder().encode(content).length };
            }
            const existed = await app.vault.adapter.exists(guard.path);
            // S2-8：端口层兜底——新文件只能落在当前项目或本会话 spill；
            // 即使上层审批被提示注入绕过，也不能在库根/其它项目新建文件。
            if (!existed && !guard.path.startsWith(sessionSpillPrefix())) {
                const activeProject = plugin.getActiveProject?.() || '';
                if (!activeProject || !(guard.path === activeProject || guard.path.startsWith(`${activeProject}/`))) {
                    throw new Error('新文件只能写入当前项目目录；跨项目/库根新建请手动操作');
                }
            }
            let next = content;
            // D3-14（维度② r3）：追加是读—改—写，必须与结算/分析/自动保存共用路径锁；
            // 锁内重新读取，避免用审批前的旧内容覆盖并发写入。
            await withWriteLock(guard.path, async () => {
                if (options?.append && existed) {
                    next = `${await app.vault.adapter.read(guard.path)}${content}`;
                }
                await writeVaultText(app, guard.path, next);
            });
            return { path: guard.path, created: !existed, bytes: new TextEncoder().encode(next).length };
        },
        deleteFile: async (path, options) => {
            const guard = sanitizeVaultPath(path, { allowHiddenPrefixes: [sessionSpillPrefix()] });
            if (!guard.ok) throw new Error(guard.reason);
            const file = app.vault.getAbstractFileByPath(guard.path);
            if (file instanceof TFile) {
                if (options?.permanent) await app.vault.delete(file, true);
                else await app.vault.trash(file, true);
                return { path: guard.path, deleted: true, trashed: !options?.permanent };
            }
            if (await app.vault.adapter.exists(guard.path)) {
                // 非索引文件无法进回收站；默认不删除，必须显式 permanent=true。
                if (options?.permanent !== true) {
                    throw new Error('该文件未进入 vault 索引，无法移入回收站；如确认永久删除请设置 permanent=true');
                }
                await app.vault.adapter.remove(guard.path);
                return { path: guard.path, deleted: true, trashed: false };
            }
            return { path: guard.path, deleted: false, trashed: false };
        },
        moveFile: async (from, to) => {
            const source = sanitizeVaultPath(from, { allowHiddenPrefixes: [sessionSpillPrefix()] });
            const target = sanitizeVaultPath(to, { allowHiddenPrefixes: [sessionSpillPrefix()] });
            if (!source.ok) throw new Error(source.reason);
            if (!target.ok) throw new Error(target.reason);
            const file = app.vault.getAbstractFileByPath(source.path);
            if (file instanceof TFolder) {
                throw new Error('move_file 只支持文件，不支持目录；整理目录请用命令或手动操作');
            }
            if (file instanceof TFile) {
                await app.fileManager.renameFile(file, target.path);
            } else if (await app.vault.adapter.exists(source.path)) {
                const parent = target.path.substring(0, target.path.lastIndexOf('/'));
                if (parent) await app.vault.adapter.mkdir(parent);
                await app.vault.adapter.rename(source.path, target.path);
            } else {
                throw new Error(`文件不存在：${source.path}`);
            }
            return { from: source.path, to: target.path };
        },
        deleteProject: async (project) => {
            const guard = sanitizeVaultPath(project);
            if (!guard.ok) return { project, deleted: false, reason: guard.reason };
            const target = guard.path;
            const known = listProjectIds(app).includes(target);
            // ghost 只允许「模式库根/项目名」恰好两段；更深层目录可能是章节目录/正文，
            // 不能被 delete_project 递归误删（安全审计 SEC-9）。
            const segments = target.split('/');
            const underLibrary = segments.length === 2
                && MODE_LIBRARY_ROOT_LIST.includes(segments[0]);
            if (!known && !underLibrary) {
                return { project: target, deleted: false, reason: '不是可识别的项目目录' };
            }
            await removeProjectDirectory(app, target);
            return { project: target, deleted: true };
        },
    };
}

/** 可被 read_file/search_vault 处理的文本扩展名（二进制一律拒绝） */
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'jsonl', 'yaml', 'yml', 'base', 'csv', 'tsv', 'tex', 'html']);

function isTextPath(path: string): boolean {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    return TEXT_EXTENSIONS.has(ext);
}

/** 单文件读取上限：超过就要求改用检索（避免一次把整本书塞进上下文） */
const MAX_READ_FILE_BYTES = 512 * 1024;
const MAX_WRITE_FILE_BYTES = 1024 * 1024;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_FILES = 3000;
const SEARCH_DEFAULT_LIMIT = 20;
