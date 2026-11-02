/**
 * scene-confirm-modal.ts — 场景确认式生成向导（故事质量闭环 Task 10）
 *
 * 逐场景生成，每个场景生成后停留，用户确认 / 修正 / 停止后再进下一场景：
 * - AI 生成内容与用户决策入口视觉分离（AI 建议区 vs 决策按钮区，TR-10.2）
 * - 场景生成后停留，需用户确认才继续（TR-10.1）
 * - 失败场景列表 + 重试（TR-10.3 断点恢复入口；vault 落盘见 GenerationCheckpointStore）
 *
 * generateSceneBody 由调用方注入（真实链路由 KnowledgeInjector + AIEngine 组装）。
 */

import { App, Modal, Notice } from 'obsidian';
import { SceneGenerationLoop } from '../engine/scene-generation-loop';
import type {
    SceneLoopOptions,
    SceneLoopItem,
    SceneLoopResult,
    SceneTask,
} from '../engine/scene-generation-loop';
import { GenerationCheckpointStore } from '../engine/generation-checkpoint';
import type { GenerationCheckpoint } from '../engine/generation-checkpoint';
import { ChapterSnapshotBuilder } from '../engine/chapter-snapshot-builder';
import { StoryBeatExtractor } from '../engine/story-beat-extractor';
import { createSceneBodyGenerator } from '../engine/scene-body-generator';
import { BodyWriter, defaultBodyPath } from '../engine/body-writer';
import { findProtagonistName } from '../shared/protagonist';
import { findBodyFileV4 } from '../engine/chapter-utils';
import { mergeSceneBodies } from '../shared/scene-body-merge';
import { SceneExpander } from '../engine/ai-scene-expander';
import { AIApiClient } from '../engine/ai-api-client';
import { resolveTaskModelConfig } from '../shared/task-model';
import { ContextManager } from '../engine/context-manager';
import type { SceneNode } from '../shared/types';
import { computePromptHash } from '../engine/prompt-hash';
import { ENGINE_NAMES } from '../shared/engine-names';
import type NovelWriterPlugin from '../main';

/** 断点恢复配置（可选注入；提供后失败场景保存断点，重试时展示恢复选项） */
export interface SceneConfirmCheckpointConfig {
    store: GenerationCheckpointStore;
    projectId: string;
    chapter: string;
    promptHash: string;
}

/** 场景确认式生成向导的编排入参（Task 10 完整业务接线） */
export interface SceneConfirmWizardOptions {
    plugin: NovelWriterPlugin;
    project: string;
    chapterName: string;
    chapterNumber: number;
    /** sceneExpand 步骤产出的场景规划文本 */
    expansionText: string;
    /** 章节规划文本（outline/plotDistill），供 StoryBeatExtractor 提取任务卡 */
    chapterPlan: string;
    /** 形如 `第1卷`；缺省按第 1 卷处理 */
    volumeName?: string;
}

/** 场景确认向导的外部落盘钩子（由调用方注入，避免 UI 直接拼路径） */
export interface SceneConfirmHooks {
    /** 把整章正文写入 vault，返回实际路径与字数 */
    writeBody?: (body: string) => Promise<{ path: string; wordCount: number }>;
}

/**
 * 打开场景确认式生成向导（组装 KnowledgeInjector + AIEngine 真实链路）。
 *
 * 组装顺序：gatherAll → ChapterSnapshotBuilder 快照 → StoryBeatExtractor 任务卡
 * → createSceneBodyGenerator 正文回调 → 获取 loop/store → 实例化 SceneConfirmModal。
 * 任一依赖缺失时静默降级（注入返回空、任务卡为空数组），不阻塞向导打开。
 * @param opts - 选项
 */
export async function openSceneConfirmWizard(opts: SceneConfirmWizardOptions): Promise<void> {
    const { plugin, project, chapterName, chapterNumber, expansionText, chapterPlan } = opts;

    const gathered = await plugin.ctxManager.gatherAll(project, chapterName);
    const snapshot = new ChapterSnapshotBuilder().buildFromContext(
        chapterNumber,
        gathered,
        { chapterPlan },
    );
    const beats = new StoryBeatExtractor().extract(chapterPlan);

    // 场景正文属于 body 任务：本地/云端路由、输出上限、思考参数都按 body 解析，
    // 不再误用 flash 模型。
    const bodyConfig = resolveTaskModelConfig(
        plugin.settings,
        'body',
        (modelName, endpoint) => plugin.resolveModelLimits(modelName, endpoint),
    );
    const model = bodyConfig.model;
    const bodyCallOptions = {
        endpoint: bodyConfig.endpoint,
        apiKey: bodyConfig.apiKey,
        disableFallback: bodyConfig.sourceType === 'local',
        thinkingMode: bodyConfig.thinkingMode,
        thinkingBudget: bodyConfig.thinkingBudget,
    };
    const injector = plugin.knowledgeInjector;
    const bodyWriter = new BodyWriter({ app: plugin.app });
    const bodyFormat = await bodyWriter.resolveContract(project);
    const primaryGenerator = createSceneBodyGenerator({
        projectPath: project,
        model,
        injectForSceneBody: (ctx, o) => injector ? injector.injectForSceneBody(ctx, o) : Promise.resolve(''),
        injectForSceneBodyLayers: (ctx, o) => injector
            ? injector.injectForSceneBodyLayers(ctx, o)
            : Promise.resolve({ system: '', user: '' }),
        callAI: (sys, usr, m) => plugin.aiEngine.callAI(sys, usr, m, 0.7, Math.min(bodyConfig.maxOutput, 8192), bodyCallOptions),
        snapshot,
        beats,
        bodyFormat,
    });

    // 兜底：主生成链路失败/空结果时，回退到 SceneExpander 的经典扩写提示词
    const expander = new SceneExpander(plugin, new AIApiClient(plugin));
    const data = gathered.data;
    const generateSceneBody = async (
        task: SceneTask,
        prevEnding: string,
        directive?: string,
    ): Promise<{ content: string; error?: string | null }> => {
        const result = await primaryGenerator(task, prevEnding, directive);
        if (!result.error && result.content.trim()) return result;

        const sceneNode: SceneNode = {
            id: `scene-${task.num}`,
            order: task.num,
            title: task.name,
            type: 'action',
            status: 'not_started',
            summary: task.objective,
            characters: [],
            locations: [],
            factions: [],
            items: [],
            foreshadowRefs: [],
            wordCountPlan: 300,
            wordCountActual: 0,
            objective: task.objective,
            obstacle: task.conflict,
            outcome: task.cliffhanger,
            emotionArc: task.emotionArc,
            keyDialogues: [],
        };
        const fallback = await expander.expandScene(sceneNode, {
            projectId: project,
            // 向导入参不含卷号，扩写提示词中的卷号仅作展示，固定为 1
            volumeNumber: 1,
            chapterNumber,
            chapterConflict: chapterPlan,
            chapterSummary: chapterPlan,
            worldview: data.world_view?.raw ?? '',
            characters: ContextManager.formatCharacters(data.character_state ?? []),
            locations: ContextManager.formatEntities(
                (data.locations ?? []) as unknown as Record<string, string>[], 'location'),
            factions: ContextManager.formatEntities(
                (data.factions ?? []) as unknown as Record<string, string>[], 'faction'),
            items: ContextManager.formatEntities(
                (data.items ?? []) as unknown as Record<string, string>[], 'item'),
            powerSystem: data.setting_lib?.raw ?? '',
            // 主角名只从人物列表解析（frontmatter「身份」字段），
            // 不要再读 `_workbenchState`：该字段无写入方，只会退化成「主角」占位
            protagonistName: findProtagonistName(data.character_state as Array<Record<string, unknown>>)
                || '主角',
            emotionPlan: data.emotion_plan?.raw ?? '',
        });
        if (fallback.error) return result;
        return { content: fallback.content };
    };

    const loop = plugin.engineRegistry.get(ENGINE_NAMES.SCENE_GENERATION_LOOP);
    const store = plugin.engineRegistry.get(ENGINE_NAMES.GENERATION_CHECKPOINT_STORE);

    const volumeNum = parseInt((opts.volumeName || '').match(/第(\d+)卷/)?.[1] || '1', 10) || 1;
    const volumeName = opts.volumeName || `第${volumeNum}卷`;
    const bodyPath = findBodyFileV4(plugin.app, project, volumeNum, chapterNumber)?.path
        ?? defaultBodyPath(project, volumeNum, chapterNumber, chapterName);

    new SceneConfirmModal(plugin.app, loop, {
        expansionText,
        snapshot,
        beats,
        generateSceneBody,
    }, {
        store,
        projectId: project,
        chapter: chapterName,
        promptHash: computePromptHash('scene-confirm', expansionText, model, 0.7, 4096),
    }, {
        writeBody: async (body: string) => {
            const written = await bodyWriter.write({
                path: bodyPath,
                raw: body,
                chapterNum: chapterNumber,
                chapterName,
                volume: volumeName,
                project,
                writingMode: 'scene',
                naturalize: plugin.settings.naturalParagraphMode !== false,
            });
            return { path: written.path, wordCount: written.wordCount };
        },
    }).open();
}

/**
 * SceneConfirmModal 类。
 */
export class SceneConfirmModal extends Modal {
    private loop: SceneGenerationLoop;
    private options: SceneLoopOptions;
    private checkpoint: SceneConfirmCheckpointConfig | null;
    private hooks: SceneConfirmHooks;
    /** 恢复模式：sceneNum → scene_done 断点（从断点继续时填充） */
    private resumeMap: Map<number, GenerationCheckpoint> | null = null;

    constructor(
        app: App,
        loop: SceneGenerationLoop,
        options: SceneLoopOptions,
        checkpoint?: SceneConfirmCheckpointConfig,
        hooks: SceneConfirmHooks = {},
    ) {
        super(app);
        this.loop = loop;
        this.options = options;
        this.checkpoint = checkpoint ?? null;
        this.hooks = hooks;
    }

    /**
     * onOpen 方法。
     */
    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '🎬 场景确认式生成' });

        // 断点恢复面板（checklist 待补：继续 / 断点续 / 放弃 / 使用已有结果）
        if (this.checkpoint) {
            const all = await this.checkpoint.store.listCheckpoints(this.checkpoint.projectId);
            const chapterCps = all.filter((c) => c.chapter === this.checkpoint!.chapter);
            if (chapterCps.length > 0) {
                this.renderResumePanel(contentEl, chapterCps);
                return;
            }
        }

        contentEl.createEl('p', { text: '逐场景生成，每个场景由你确认后再继续。' });
        const startBtn = contentEl.createEl('button', { text: '▶ 开始逐场景生成', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        startBtn.onclick = () => this.runGeneration(contentEl);
    }

    /** 断点恢复面板：从断点继续 / 使用已有结果 / 放弃断点 / 跳过正常生成 */
    private renderResumePanel(contentEl: HTMLElement, cps: GenerationCheckpoint[]): void {
        const doneCps = cps.filter((c) => c.finishReason === 'scene_done' && (c.content || '').trim() !== '');
        contentEl.createEl('p', {
            text: `💾 检测到本章 ${cps.length} 个场景断点（${doneCps.length} 个已确认完成，${cps.length - doneCps.length} 个待重新生成）。`,
            cls: 'nw-sc-hint',
        });

        const resumeBtn = contentEl.createEl('button', { text: '▶ 从断点继续生成', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        resumeBtn.onclick = () => {
            this.resumeMap = new Map(doneCps.map((c) => [c.sceneNum, c]));
            this.runGeneration(contentEl);
        };

        const viewBtn = contentEl.createEl('button', { text: '✏️ 使用已有结果', cls: 'nw-btn nw-btn-secondary novel-writer-button' });
        viewBtn.onclick = () => {
            contentEl.empty();
            contentEl.createEl('h3', { text: '已确认完成场景的正文（可复制取用，断点保留）' });
            for (const c of doneCps) {
                const sec = contentEl.createEl('div');
                sec.createEl('strong', { text: `场景 ${c.sceneNum}` });
                sec.createEl('pre', { text: c.content, cls: 'nw-sc-body' });
            }
        };

        const discardBtn = contentEl.createEl('button', { text: '🗑 放弃断点并全新生成', cls: 'nw-btn novel-writer-button' });
        discardBtn.onclick = async () => {
            for (const c of cps) {
                await this.checkpoint!.store.discard({
                    projectId: this.checkpoint!.projectId,
                    chapter: this.checkpoint!.chapter,
                    sceneNum: c.sceneNum,
                    promptHash: c.promptHash,
                });
            }
            new Notice('已清除本章断点');
            await this.onOpen();
        };

        const skipBtn = contentEl.createEl('button', { text: '跳过断点，正常生成', cls: 'nw-btn nw-btn-secondary novel-writer-button' });
        skipBtn.onclick = () => this.runGeneration(contentEl);
    }

    private async runGeneration(contentEl: HTMLElement): Promise<void> {
        contentEl.empty();
        contentEl.createEl('p', {
            text: this.resumeMap
                ? '正在恢复已确认场景，未完成场景重新生成…'
                : '正在解析场景规划…',
        });

        const result = await this.loop.run({
            ...this.options,
            resumeCheckpoints: this.resumeMap ?? undefined,
            onSceneComplete: async (_index, item) => {
                const feedback = await this.awaitDecision(contentEl, item);
                // 场景经用户处理（确认/修正/停止）后落盘 scene_done 断点：
                // 中断后重开向导可从该场景直接恢复，不重复生成（TR-7.2）
                if (this.checkpoint) {
                    await this.checkpoint.store.save({
                        projectId: this.checkpoint.projectId,
                        chapter: this.checkpoint.chapter,
                        sceneNum: item.task.num,
                        promptHash: this.checkpoint.promptHash,
                        content: item.body,
                        lastAcceptedParagraph: item.body.split(/\r?\n/).filter((l) => l.trim() !== '').pop() || '',
                        finishReason: 'scene_done',
                    });
                }
                return feedback;
            },
        });

        await this.renderFinal(contentEl, result);
    }

    /** 场景生成后停留，等待用户决策（返回 false 停止 / string 修正指令 / void 继续） */
    private awaitDecision(contentEl: HTMLElement, item: SceneLoopItem): Promise<boolean | string | void> {
        return new Promise((resolve) => {
            contentEl.empty();

            // —— AI 生成内容区（AI 建议） ——
            const aiSection = contentEl.createEl('div', { cls: 'nw-sc-ai' });
            aiSection.createEl('h3', { text: `🤖 场景 ${item.task.num}${item.task.name ? `：${item.task.name}` : ''}` });
            aiSection.createEl('pre', { text: item.body, cls: 'nw-sc-body' });

            if (item.conflicts.length > 0) {
                aiSection.createEl('div', {
                    text: `⚠️ 冲突提示：${item.conflicts.map((c) => c.message).join('；')}`,
                    cls: 'nw-sc-warn',
                });
            }
            if (!item.beatVerify.passed) {
                aiSection.createEl('div', {
                    text: `⚠️ 必做剧情未覆盖：${item.beatVerify.missingRequired.join('、') || '有缺失'}`,
                    cls: 'nw-sc-warn',
                });
            }

            // —— 用户决策区（视觉分离） ——
            const decision = contentEl.createEl('div', { cls: 'nw-sc-decision' });
            decision.createEl('h4', { text: '你的决定' });

            const confirmBtn = decision.createEl('button', { text: '✅ 确认，继续下一场景', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            confirmBtn.onclick = () => resolve(undefined);

            const fixInput = decision.createEl('input', {
                type: 'text',
                placeholder: '可选：输入修正指令（应用到下一场景）',
                cls: 'nw-sc-input',
            });
            const fixBtn = decision.createEl('button', { text: '✏️ 修正后继续', cls: 'nw-btn nw-btn-secondary novel-writer-button' });
            fixBtn.onclick = () => resolve(fixInput.value.trim() || undefined);

            const stopBtn = decision.createEl('button', { text: '⏹ 停止生成', cls: 'nw-btn nw-btn-secondary novel-writer-button' });
            stopBtn.onclick = () => resolve(false);
        });
    }

    private async renderFinal(contentEl: HTMLElement, result: SceneLoopResult): Promise<void> {
        contentEl.empty();
        const title = result.completedAll
            ? '✅ 全部场景生成完成'
            : result.aborted
                ? '⏹ 已停止（保留已完成场景）'
                : '⚠️ 生成结束';
        contentEl.createEl('h2', { text: title });

        contentEl.createEl('p', { text: `已完成 ${result.scenes.length} 个场景` });

        if (result.failedScenes.length > 0) {
            const failSection = contentEl.createEl('div', { cls: 'nw-sc-failed' });
            failSection.createEl('h3', { text: `失败场景（${result.failedScenes.length}）` });

            // 断点落盘：记录失败现场，供恢复/放弃（TR-10.3）
            let checkpointSaved = false;
            if (this.checkpoint) {
                for (const f of result.failedScenes) {
                    await this.checkpoint.store.save({
                        projectId: this.checkpoint.projectId,
                        chapter: this.checkpoint.chapter,
                        sceneNum: f.task.num,
                        promptHash: this.checkpoint.promptHash,
                        content: '',
                        lastAcceptedParagraph: '',
                        finishReason: 'scene_failed',
                    });
                }
                checkpointSaved = true;
            }

            for (const f of result.failedScenes) {
                failSection.createEl('div', { text: `场景 ${f.task.num}${f.task.name ? `（${f.task.name}）` : ''}：${f.error}` });
            }

            if (checkpointSaved) {
                failSection.createEl('p', { text: '💾 失败现场已保存为断点，可重试或放弃。', cls: 'nw-sc-hint' });
            }

            const retryBtn = failSection.createEl('button', { text: '↻ 重试失败场景', cls: 'nw-btn nw-btn-secondary novel-writer-button' });
            retryBtn.onclick = () => this.runGeneration(contentEl);

            if (this.checkpoint) {
                const discardBtn = failSection.createEl('button', { text: '🗑 放弃断点', cls: 'nw-btn novel-writer-button' });
                discardBtn.onclick = async () => {
                    for (const f of result.failedScenes) {
                        await this.checkpoint!.store.discard({
                            projectId: this.checkpoint!.projectId,
                            chapter: this.checkpoint!.chapter,
                            sceneNum: f.task.num,
                            promptHash: this.checkpoint!.promptHash,
                        });
                    }
                    failSection.createEl('p', { text: '已放弃断点。', cls: 'nw-sc-hint' });
                    discardBtn.remove();
                };
            }
        }

        const mergedBody = mergeSceneBodies(result.scenes);
        if (mergedBody && this.hooks.writeBody) {
            const writeBtn = contentEl.createEl('button', {
                text: '💾 写入正文（覆盖本章正文）',
                cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
            });
            writeBtn.onclick = async () => {
                writeBtn.disabled = true;
                writeBtn.setText('写入中…');
                try {
                    const written = await this.hooks.writeBody!(mergedBody);
                    writeBtn.setText('✅ 已写入正文');
                    new Notice(`已写入正文：${written.path}（${written.wordCount} 字）`);
                } catch (e) {
                    writeBtn.disabled = false;
                    writeBtn.setText('💾 重试写入正文');
                    new Notice(`写入正文失败：${(e as Error).message}`);
                }
            };
        }

        const closeBtn = contentEl.createEl('button', { text: '关闭', cls: 'nw-btn novel-writer-button' });
        closeBtn.onclick = () => this.close();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
