import { App, Notice } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { ContextManager, GatheredContext } from '../../engine/context-manager';
import { showProgress, hideProgress, showSuccess, showError } from '../../utils/helpers';
import { CrossVolumeIntegrator } from '../../engine/cross-volume-integration';
import { FullWriterStore } from './full-writer-store';
import { ChapterStateManager } from '../states/chapter-state-manager';
import { EntityStateController } from './entity-state-controller';
import { createLogger } from '../../shared/logger';


const log = createLogger('ContextLoaderController');
export interface ContextLoaderControllerDeps {
    app: App;
    plugin: NovelWriterPlugin;
    state: FullWriterStore;
    contextManager: ContextManager;
    getChapterStateManager: () => ChapterStateManager;
    getContext: () => GatheredContext | null;
    setContext: (ctx: GatheredContext | null) => void;
    activateTab: (tabId: string) => Promise<void>;
    entityStateController: EntityStateController;
}

export class ContextLoaderController {
    private deps: ContextLoaderControllerDeps;

    constructor(deps: ContextLoaderControllerDeps) {
        this.deps = deps;
    }

    async loadContext(): Promise<void> {
        if (!this.deps.state.project) {
            await this.deps.activateTab('project-selector');
            return;
        }

        showProgress('⏳ 加载上下文数据...');

        try {
            showProgress('⏳ 加载上下文数据...');
            const context = await this.deps.contextManager.gatherAll(this.deps.state.project, this.deps.state.chapterName, (completed, total, taskName) => {
                showProgress(`⏳ 加载 ${taskName}... (${completed}/${total})`);
            });

            this.deps.setContext(context);

            const failedModules = context?.data?.['_failedModules'] as string[] || [];
            if (failedModules.length > 0) {
                new Notice(`⚠️ 以下模块加载失败（已跳过）: ${failedModules.join('、')}`, 6000);
            }

            this.deps.getChapterStateManager().stepLevels['context'] = 'complete';
            this.deps.getChapterStateManager().stepMissing['context'] = [];
            this.deps.getChapterStateManager().stepCompleted.add('context');
            hideProgress();
            showSuccess('上下文加载完成');

            const infoSummary = this.deps.contextManager.getInfoSummary(context);
            this.deps.state.vars['infoSummary'] = infoSummary;

            if (context?.data?.compressed?.truncationApplied) {
                this.deps.state.vars['contextTruncated'] = 'true';
            } else {
                this.deps.state.vars['contextTruncated'] = 'false';
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error('[小说工坊] 上下文加载异常:', errMsg);
            hideProgress();
            if (!this.deps.getContext()) {
                showError(`上下文加载失败: ${errMsg}`);
                return;
            } else {
                new Notice(`⚠️ 上下文部分加载失败: ${errMsg}`, 6000);
            }
        }

        await this.ensureCrossVolumeSnapshot();

        this.deps.entityStateController.syncInvolvedEntitiesToPlugin();

        const cs = this.deps.getChapterStateManager();
        if (!cs.stepCompleted.has('characterSoul')) {
            showProgress('🫀 提取角色灵魂...');
            try {
                const context = this.deps.getContext();
                const characterCoresData = context?.data?.character_cores as Array<Record<string, unknown>> | undefined;
                if (characterCoresData && characterCoresData.length > 0) {
                    const allSouls = characterCoresData.map((c: Record<string, unknown>) => {
                        const name = c.name || '未知角色';
                        const personality = c.personality || '';
                        const background = c.background || '';
                        return `【${name}】性格：${personality}\n背景：${background}`;
                    }).join('\n\n');
                    cs.stepResults['characterSoul'] = allSouls;
                    this.deps.state.vars['characterCores'] = allSouls;
                    cs.stepLevels['characterSoul'] = 'complete';
                    cs.stepMissing['characterSoul'] = [];
                    cs.stepCompleted.add('characterSoul');
                    showSuccess('🫀 角色灵魂提取完成');
                }
            } catch (e) {
                log.warn('[ContextLoader] 自动提取角色灵魂失败:', e);
            }
            hideProgress();
        }

        cs.currentStepIndex = 1;
    }

    private async ensureCrossVolumeSnapshot(): Promise<void> {
        if (!this.deps.state.chapterNum) return;
        const integrator = new CrossVolumeIntegrator(this.deps.app);
        const isNewVol = await integrator.isNewVolumeFirstChapter(this.deps.state.project, this.deps.state.chapterNum);
        if (isNewVol) {
            const volName = this.deps.state.volume || `第${Math.ceil(this.deps.state.chapterNum / 10)}卷`;
            const snapshot = await integrator.generateSnapshot(this.deps.state.project, volName, `${this.deps.state.project}/04-项目总控`);
            this.deps.state.vars['crossVolumeSnapshot'] = snapshot.slice(0, 3000);
            new Notice(`📸 已为「${volName}」生成状态快照`, 4000);
        }
    }
}
