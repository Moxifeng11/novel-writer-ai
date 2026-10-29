import { App, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { ContextManager, GatheredContext } from '../../engine/context-manager';
import { showProgress, hideProgress, showSuccess, showError } from '../../utils/helpers';
import { CrossVolumeIntegrator } from '../../engine/cross-volume-integration';
import { formatSoulForPrompt, type CharacterSoul } from '../../engine/character-soul';
import { assessContextReadiness } from '../../engine/context-readiness';
import { getChapterFile, CHAPTER_FILE_TYPES } from '../../engine/chapter-utils';
import { isTemplateSkeleton, validateStepResult } from '../../engine/step-validator';
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
    /** 步骤结果落盘（角色灵魂自动提取必须写盘，否则重启后完成态被磁盘模板覆盖） */
    saveStepResult: (stepKey: string, content: string) => Promise<boolean>;
    /** 把加载进度接到主区域时间线；未提供时沿用全局 Notice */
    reportProgress?: (message: string | null) => void;
    /** 把加载结果接到主区域时间线与错误卡 */
    reportNotice?: (level: 'success' | 'warning' | 'error', message: string) => void;
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

        // 采集期间用户可能切章/切项目：所有写入前都要确认目标没变，
        // 否则慢的 A 章结果会覆盖 B 章的上下文与统计（界面显示 B 的标题 + A 的数据）。
        const targetProject = this.deps.state.project;
        const targetChapter = this.deps.state.chapterName;
        const targetChapterNum = this.deps.state.chapterNum;
        const stillCurrent = (): boolean => this.deps.state.project === targetProject
            && this.deps.state.chapterName === targetChapter
            && this.deps.state.chapterNum === targetChapterNum;

        const progress = (message: string) => {
            if (this.deps.reportProgress) this.deps.reportProgress(message);
            else showProgress(message);
        };
        const stopProgress = () => {
            if (this.deps.reportProgress) this.deps.reportProgress(null);
            else hideProgress();
        };
        const notice = (level: 'success' | 'warning' | 'error', message: string) => {
            if (this.deps.reportNotice) {
                this.deps.reportNotice(level, message);
                return;
            }
            if (level === 'success') showSuccess(message);
            else if (level === 'error') showError(message);
            else new Notice(`⚠️ ${message}`, 6000);
        };

        progress('⏳ 加载上下文数据...');

        const cs = this.deps.getChapterStateManager();

        try {
            progress('⏳ 加载上下文数据...');
            const context = await this.deps.contextManager.gatherAll(targetProject, targetChapter, (completed, total, taskName) => {
                progress(`⏳ 加载 ${taskName}... (${completed}/${total})`);
            });
            if (!stillCurrent()) {
                stopProgress();
                return;
            }

            this.deps.setContext(context);

            // Rev 186：把时间线/伏笔 ↔ 设定库/规划的关联索引挂到上下文，供面板展示与生成复用
            if (context?.data && this.deps.state.chapterName) {
                try {
                    context.data.story_linkage = await this.deps.contextManager.buildStoryLinkage(
                        targetProject,
                        targetChapter,
                    );
                } catch (e) {
                    log.warn('[ContextLoader] 关联索引生成失败（不影响上下文加载）:', e);
                }
                if (!stillCurrent()) {
                    stopProgress();
                    return;
                }
            }

            const failedModules = context?.data?.['_failedModules'] as string[] || [];
            if (failedModules.length > 0) {
                notice('warning', `以下模块加载失败（已跳过）: ${failedModules.join('、')}`);
            }

            // Rev 185：完成状态由「必做输入是否齐全」决定，不再无条件 complete。
            // 必做项见 assessContextReadiness：人物 / 大纲 / 世界观或设定库 / 非首章的前章摘要。
            const readiness = assessContextReadiness(context, this.deps.state.chapterNum);
            if (readiness.ready) {
                cs.stepLevels['context'] = 'complete';
                cs.stepMissing['context'] = [];
                cs.stepCompleted.add('context');
                stopProgress();
                notice('success', '上下文加载完成');
            } else {
                cs.stepLevels['context'] = 'partial';
                cs.stepMissing['context'] = readiness.requiredMissing;
                cs.stepCompleted.delete('context');
                stopProgress();
                notice('warning', `上下文缺少必做输入：${readiness.requiredMissing.join('、')}。请补齐后重新加载`);
            }

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
            stopProgress();
            if (!this.deps.getContext()) {
                notice('error', `上下文加载失败: ${errMsg}`);
                return;
            } else {
                notice('warning', `上下文部分加载失败: ${errMsg}`);
            }
        }

        // 跨卷快照可能失败（目录缺失/权限）：不能让它把整个 loadContext 抛出去，
        // 调用方（renderInContainer）已经把容器清空，会留下永久空白页。
        try {
            await this.ensureCrossVolumeSnapshot();
        } catch (e) {
            log.warn('[ContextLoader] 跨卷状态快照加载失败（继续渲染）:', e);
        }
        if (!stillCurrent()) return;

        this.deps.entityStateController.syncInvolvedEntitiesToPlugin();

        // cs 已在加载开始时获取（见上）
        // 磁盘恢复出的真实内容（即使未达 complete）优先于自动提取，避免手工结果被覆盖
        const existingSoul = (cs.stepResults['characterSoul'] || '').trim();
        if (!cs.stepCompleted.has('characterSoul') && !existingSoul && !(await this.hasRealSoulFile())) {
            progress('🫀 提取角色灵魂...');
            try {
                const context = this.deps.getContext();
                const characterCoresData = context?.data?.character_cores as Array<Record<string, unknown>> | undefined;
                if (characterCoresData && characterCoresData.length > 0) {
                    // CharacterSoul 的字段是 desire/fear/...，不是 personality/background；
                    // 旧实现按不存在的字段拼文本，写出的「灵魂层」永远是空的。
                    const souls = characterCoresData as unknown as CharacterSoul[];
                    const allSouls = souls
                        .filter((s) => s.hasSoul)
                        .map((s) => formatSoulForPrompt(s))
                        .join("\n\n");
                    if (allSouls.trim()) {
                        this.deps.state.vars['characterCores'] = allSouls;
                        cs.stepResults['characterSoul'] = allSouls;
                        // 完成性以磁盘为权威：只写内存会让下次 restoreChapterState 读到模板骨架后回退为 ○/◐
                        const saved = await this.deps.saveStepResult('characterSoul', allSouls);
                        // Rev 185：保存成功还要过结构校验——占位字段（>- / 暂无）不算已提取
                        const soulVerdict = validateStepResult('characterSoul', allSouls);
                        if (saved && soulVerdict.level === 'complete') {
                            cs.stepLevels['characterSoul'] = 'complete';
                            cs.stepMissing['characterSoul'] = [];
                            cs.stepCompleted.add('characterSoul');
                            notice('success', '🫀 角色灵魂提取完成');
                        } else if (saved) {
                            cs.stepLevels['characterSoul'] = 'partial';
                            cs.stepMissing['characterSoul'] = soulVerdict.missing;
                            cs.stepCompleted.delete('characterSoul');
                            notice('warning', `角色灵魂已写入但字段不完整：${soulVerdict.missing.join('、')}`);
                        } else {
                            cs.stepLevels['characterSoul'] = 'partial';
                            cs.stepMissing['characterSoul'] = ['保存失败'];
                            cs.stepCompleted.delete('characterSoul');
                            notice('warning', '角色灵魂已提取但保存失败，重启后需重新提取');
                        }
                    } else {
                        log.warn('[ContextLoader] 没有完整的 9 字段角色灵魂层，跳过完成标记');
                    }
                }
            } catch (e) {
                log.warn('[ContextLoader] 自动提取角色灵魂失败:', e);
            }
            stopProgress();
        }

        cs.currentStepIndex = 1;
    }

    /**
     * 磁盘上是否已有真实的角色灵魂文件（非模板骨架）。
     * 自动提取会落盘覆盖同名文件，必须先确认磁盘内容不值得保留。
     */
    private async hasRealSoulFile(): Promise<boolean> {
        const chapDir = this.deps.state.chapDir;
        if (!chapDir) return false;
        const folder = this.deps.app.vault.getAbstractFileByPath(chapDir);
        if (!(folder instanceof TFolder)) return false;
        const file = getChapterFile(folder, CHAPTER_FILE_TYPES.characterSoul);
        if (!(file instanceof TFile)) return false;
        try {
            const raw = await this.deps.app.vault.read(file);
            const pure = raw.replace(/^---[\s\S]*?---/, '').trim();
            return !isTemplateSkeleton(pure, 'characterSoul');
        } catch (e) {
            log.warn('[ContextLoader] 读取既有角色灵魂文件失败（按未存在处理）:', e);
            return false;
        }
    }

    private async ensureCrossVolumeSnapshot(): Promise<void> {
        if (!this.deps.state.chapterNum) return;
        const integrator = new CrossVolumeIntegrator(this.deps.app);
        const isNewVol = await integrator.isNewVolumeFirstChapter(this.deps.state.project, this.deps.state.chapterNum);
        if (isNewVol) {
            const volName = this.deps.state.volume || `第${Math.ceil(this.deps.state.chapterNum / 10)}卷`;
            const snapshot = await integrator.generateSnapshot(this.deps.state.project, volName, `${this.deps.state.project}/04-项目总控`);
            this.deps.state.vars['crossVolumeSnapshot'] = snapshot.slice(0, 3000);
            const message = `📸 已为「${volName}」生成状态快照`;
            if (this.deps.reportNotice) this.deps.reportNotice('success', message);
            else new Notice(message, 4000);
        }
    }
}
