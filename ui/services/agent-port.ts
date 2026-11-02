/**
 * agent-port.ts — 对话 Agent 的宿主端口工厂
 *
 * 从 agent-guide-modal 抽出并扩展：除创建/打开界面外，新增
 * 章节读取、项目状态、协同写作与「执行任意插件命令」能力，
 * 让 Agent 能覆盖从新建项目到导出成稿的全部插件功能。
 */
import { App, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import type {
    AgentChapterSummary,
    AgentCommandRunRecord,
    AgentCommandSummary,
    AgentContext,
    AgentFileReadResult,
    AgentProjectStatus,
    AgentVaultSearchHit,
    GuideAgentPort,
} from '../../engine/agent/agent-types';
import { extractLineWindow, sanitizeVaultPath, summarizeHitLine } from '../../shared/file-path-guard';
import { getExecutionLedger } from '../../services/execution-ledger';
import { createLongNovelProject } from './project-create-service';
import { StorySettingsModal } from '../story-settings-modal';
import { OperationConfirmModal } from '../components/progress';
import { DomainProjectFactory } from '../../domains/kernel/domain-project-factory';
import { createDefaultPreResearch, writePreResearchFiles, type ScriptPreResearch, type ShortPreResearch } from '../../shared/pre-research';
import { PreResearchModal } from '../pre-research-modal';
import { CREATION_MODE_SPECS, getCreationModeLabel, parseCreationModeMeta, type CreationModeMeta } from '../../shared/creation-mode';
import { getProjectModeSync, resolveProjectMode } from '../../shared/project-mode';
import { ModeDocumentModal } from '../mode-document-modal';
import { getStoryStructure } from '../../shared/story-structure';
import { createLogger } from '../../shared/logger';
import { FullWriterView } from '../full-writer-view';
import { getChaptersForProject, sortChaptersByNumber, type ChapterListEntry } from '../project-utils';
import { isChapterWritten, summarizeChapterProgress } from '../../shared/chapter-progress';
import { listModeUnits, modeUnitLabel, type ModeUnitInfo } from '../../shared/mode-content';
import { readProjectMeta } from '../../shared/paths';
import { CoWritingView } from '../co-writing-view';
import { listProjects } from '../export-manuscript-modal';

const log = createLogger('AgentPort');

/**
 * getAgentContext 函数。
 * @param app - Obsidian 应用实例
 * @param plugin - 插件实例
  * @returns AgentContext 实例
 */
export function getAgentContext(app: App, plugin: NovelWriterPlugin): AgentContext {
    return { projects: listProjects(app), activeProject: plugin.getActiveProject() };
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
                        await writePreResearchFiles(app.vault.adapter, pid, data);
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
                        await writePreResearchFiles(app.vault.adapter, pid, data);
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
                return {
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
                };
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
                    .filter(cmd => cmd.id.startsWith('novel-writer'))
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
            const guard = sanitizeVaultPath(path, { allowHiddenPrefixes: ['.sessions/'] });
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
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_FILES = 3000;
const SEARCH_DEFAULT_LIMIT = 20;
