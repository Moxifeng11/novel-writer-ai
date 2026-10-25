import { App, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { AIEngine } from '../../engine/ai-engine';
import { EntityStateManager } from '../../engine/entity-state-manager';
import { findBodyFileV4 } from '../../engine/chapter-utils';
import { getInvolvedEntities } from '../../engine/chapter-context-builder';
import { ContextPanel } from '../rendering/context-panel';
import { FullWriterStore } from './full-writer-store';
import { createLogger } from '../../shared/logger';


const log = createLogger('EntityStateController');
export interface EntityStateControllerDeps {
    app: App;
    plugin: NovelWriterPlugin;
    aiEngine: AIEngine;
    state: FullWriterStore;
    getContext: () => any;
    getContextPanel: () => ContextPanel;
    getWorkspace: () => HTMLElement | null;
    estimateTotalChars: () => number;
}

export class EntityStateController {
    private deps: EntityStateControllerDeps;

    constructor(deps: EntityStateControllerDeps) {
        this.deps = deps;
    }

    syncInvolvedEntitiesToPlugin(): void {
        this.deps.plugin._involvedChars = new Set<string>();
        this.deps.plugin._involvedLocs = new Set<string>();
        this.deps.plugin._involvedFactions = new Set<string>();
        this.deps.plugin._involvedItems = new Set<string>();

        if (this.deps.plugin.settings.contextScope !== 'compact') return;

        try {
            const volN = parseInt(this.deps.state.volume.match(/第(\d+)卷/)?.[1] || '0', 10);
            const bodyFile = findBodyFileV4(this.deps.app, this.deps.state.project, volN, this.deps.state.chapterNum);
            if (bodyFile instanceof TFile) {
                const involved = getInvolvedEntities(this.deps.app, bodyFile);
                this.deps.plugin._involvedChars = new Set(involved.chars);
                this.deps.plugin._involvedLocs = new Set(involved.locs);
                this.deps.plugin._involvedFactions = new Set(involved.factions);
                this.deps.plugin._involvedItems = new Set(involved.items);
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn('[EntityStateController] 同步涉及实体失败:', errMsg);
        }
    }

    async detectAndUpdateEntityStates(bodyContent: string): Promise<void> {
        if (!this.deps.state.project || !this.deps.state.chapterNum) return;

        try {
            const manager = new EntityStateManager({
                app: this.deps.app,
                plugin: this.deps.plugin,
                aiEngine: this.deps.aiEngine,
            });

            const changes = await manager.detectStateChanges(
                bodyContent,
                this.deps.state.project,
                this.deps.state.chapterNum,
                this.deps.state.chapterName
            );

            if (changes.length > 0) {
                await manager.applyStateChanges(
                    this.deps.state.project,
                    changes,
                    this.deps.state.chapterNum,
                    this.deps.state.chapterName
                );

                const volN = parseInt(this.deps.state.volume.match(/第(\d+)卷/)?.[1] || '0', 10);
                const bodyFile = findBodyFileV4(this.deps.app, this.deps.state.project, volN, this.deps.state.chapterNum);
                if (bodyFile instanceof TFile) {
                    const bodyPath = bodyFile.path;
                    await manager.updateInvolvedEntities(
                        this.deps.state.project,
                        bodyPath,
                        bodyContent
                    );
                }

                new Notice(`✅ 已自动更新 ${changes.length} 位角色的状态`);
                
                this.refreshContextBar();
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn('[EntityStateController] 实体状态检测失败:', errMsg);
            new Notice('⚠️ 实体状态自动更新失败，将在结算时重试', 5000);
        }
    }

    refreshContextBar(): void {
        try {
            const workspace = this.deps.getWorkspace();
            if (!workspace) return;
            this.syncInvolvedEntitiesToPlugin();
            // Rev 189：上下文面板的真实类名是 .novel-writer-fw-context-panel；
            // 旧代码移除的 .novel-writer-fw-context-card 在全库没有任何创建点，等于空操作。
            // 旧面板不删就 append 新面板 → workspace grid 多出第 4 个子元素，
            // grid-template-rows 变成 "0px 692px"，第一章整体塌成一条缝。
            workspace.querySelectorAll('.novel-writer-fw-context-panel').forEach(el => el.remove());
            this.deps.getContextPanel().render(workspace, this.deps.getContext(), this.deps.state.project, this.deps.state.chapterNum, this.deps.plugin, () => this.deps.estimateTotalChars());
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn('[EntityStateController] refreshContextBar 异常:', errMsg);
        }
    }
}
