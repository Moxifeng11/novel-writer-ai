/**
 * 向导步骤执行器（v3.5 向导执行逻辑外迁）
 *
 * 从 FullWriterView 外迁的步骤执行方法（dispatcher + 各 executeXxxStep）。
 * 控制器持有共享的 wizardStepResults / wizardStepExecuting 引用（与 view
 * 同一对象），以及 app / plugin / aiEngine 与 view 回调（findWizardTab /
 * renderTab / checkChaptersComplete）。
 */
import { App, Notice } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { AIEngine } from '../../engine/ai-engine';
import { WizardTab, WizardStep } from './wizard-types';
import { validateFanficSettings, validateWorldviewOutput } from '../../shared/template-validator';
import { readMergedVolumeOutline } from '../../utils/helpers';
import { WritingStyleModal } from '../writing-style-modal';
import { findWritingStyleFile } from '../writing-style-paths';
import { PlanBookModal } from '../plan-book-modal';
import { BatchCreateModal } from '../batch-create-modal';
import { getFanficSettingsPath, isFanficSettingsContentValidEnough } from './fanfic-settings-utils';
import { readProjectMeta, pjFanficDir, SUBDIR_BODY_ROOT, pjCharsDir, pjCharFile, pjFactionsDir, pjFactionFile, pjLocsDir, pjLocFile, pjItemsDir, pjItemFile } from '../../shared/paths';
import { mkdirp } from '../../utils/helpers';
import { WorldviewCacheService } from '../../services/worldview-cache-service';
import { ENGINE_NAMES } from '../../engine/engine-registry';
import { createLogger } from '../../shared/logger';


const log = createLogger('WizardStepExecutors');
export class WizardStepExecutors {
    private app: App;
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private wizardStepResults: Record<string, string>;
    private wizardStepExecuting: Set<string>;
    private findWizardTab: (id: string) => WizardTab | undefined;
    private renderTab: (tab: WizardTab, skipAutoAdvance?: boolean) => void;
    private checkChaptersComplete: (project: string) => Promise<boolean>;
    private getTabContent: () => HTMLDivElement;
    private cacheService: WorldviewCacheService | null = null;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        aiEngine: AIEngine,
        wizardStepResults: Record<string, string>,
        wizardStepExecuting: Set<string>,
        findWizardTab: (id: string) => WizardTab | undefined,
        renderTab: (tab: WizardTab, skipAutoAdvance?: boolean) => void,
        checkChaptersComplete: (project: string) => Promise<boolean>,
        getTabContent: () => HTMLDivElement,
    ) {
        this.app = app;
        this.plugin = plugin;
        this.aiEngine = aiEngine;
        this.wizardStepResults = wizardStepResults;
        this.wizardStepExecuting = wizardStepExecuting;
        this.findWizardTab = findWizardTab;
        this.renderTab = renderTab;
        this.checkChaptersComplete = checkChaptersComplete;
        this.getTabContent = getTabContent;
        this.cacheService = plugin.engineRegistry.getOrNull<WorldviewCacheService>(ENGINE_NAMES.WORLDVIEW_CACHE_SERVICE);
    }

    async executeWizardStep(tab: WizardTab, step: WizardStep): Promise<void> {
        // writing_style/outline/chapters 均为"打开弹窗"步骤：AI 生成由弹窗内部按钮触发，
        // 需用户在弹窗内二次确认，不能进入 executing 状态，否则 nav bar 会误导性显示"生成中...请等待 AI 返回"。
        const isModalStep = step.id === 'writing_style' || step.id === 'outline' || step.id === 'chapters';
        if (!isModalStep) {
            this.wizardStepExecuting.add(step.id);
            step.status = 'executing';
            // 立即重新渲染 UI，让用户"看到"执行中状态，而不是黑盒（outline/chapters 打开 Modal 后用户才能看到变化）
            this.renderTab(tab, true);
            // 让出执行权，让浏览器有机会渲染进度条（否则后续 modal.open / await 会阻塞绘制）
            // P0-2 修复: 后台窗口 rAF 不触发会导致永久挂起，改用 setTimeout 让出执行权
            await new Promise(r => setTimeout(r, 16));
        }

        try {
            switch (step.id) {
                case 'fanfic':
                    await this.executeFanficStep(tab, step);
                    break;
                case 'worldview':
                    await this.executeWorldviewStep(tab, step);
                    break;
                case 'entities':
                    await this.executeEntitiesStep(tab, step);
                    break;
                case 'setting_lib':
                    await this.executeSettingLibStep(tab, step);
                    break;
                case 'writing_style':
                    await this.executeWritingStyleStep(tab, step);
                    break;
                case 'outline':
                    await this.executeOutlineStep(tab, step);
                    break;
                case 'chapters':
                    await this.executeChaptersStep(tab, step);
                    break;
            }
        } catch (e) {
            log.error(`[Wizard] Step ${step.id} execution error:`, e);
            new Notice(`❌ ${step.label} 执行失败: ${e}`, 8000);
            step.status = 'retry';
        } finally {
            this.wizardStepExecuting.delete(step.id);
            // v4.5: 统一渲染出口，避免多个回调叠加导致重复渲染
            // 执行完成后一律停留在当前步骤，由用户手动点击「下一步 →」步进，不再自动跳转
            this.renderTab(tab, true);
        }
    }

    private async executeFanficStep(tab: WizardTab, step: WizardStep): Promise<void> {
        const adapter = this.app.vault.adapter;
        const fanficDir = pjFanficDir(tab.project);
        if (!(await adapter.exists(fanficDir))) {
            await adapter.mkdir(fanficDir);
        }

        const fanficResultKey = `fanfic:${tab.project}`;
        let content = this.wizardStepResults[fanficResultKey] || '';
        if (!content.trim()) {
            const meta = await readProjectMeta(this.app, tab.project);
            const path = meta?.match(/##\s*同人设定路径\s*\r?\n\s*(.+)/)?.[1]?.trim();
            if (path && await adapter.exists(path)) content = await adapter.read(path);
        }
        if (!content.trim()) {
            step.status = 'pending';
            new Notice('⚠️ 请先保存同人设定，再执行此步骤', 6000);
            return;
        }

        const validation = isFanficSettingsContentValidEnough(content);
        if (!validation.valid) {
            step.status = 'pending';
            new Notice(`⚠️ 同人设定缺少字段: ${validation.missingFields.slice(0, 5).join(', ')}`, 8000);
            return;
        }

        const filePath = getFanficSettingsPath(tab.project, content, tab.project);
        await adapter.write(filePath, content);
        this.wizardStepResults[fanficResultKey] = content;

        step.status = 'done';
        new Notice('✅ 同人设定已保存并通过校验', 3000);
        // v3.5: 移除弹窗——内容通过步骤内联展示
    }

    private async executeWorldviewStep(tab: WizardTab, step: WizardStep): Promise<void> {
        // 同人项目使用不同的世界观生成路径：从导入的原作设定中提取
        const isFanfic = tab.projectType === 'fanfic';

        const updateProgress = (text: string) => {
            const tc = this.getTabContent();
            if (!tc) return;
            const progressSpan = tc.querySelector<HTMLElement>('[data-wv-progress]');
            if (progressSpan) {
                progressSpan.textContent = `⏳ ${text}`;
            } else {
                const tabRef = this.findWizardTab(tab.id);
                if (tabRef) this.renderTab(tabRef, true);
            }
        };

        const result = isFanfic
            ? await this.aiEngine.generateFanficWorldviewForProject(
                this.app,
                tab.project,
                (phase: string) => {
                    this.wizardStepResults['_worldviewProgress'] = phase;
                    updateProgress(phase);
                }
            )
            : await this.aiEngine.generateWorldviewForProject(
                this.app,
                tab.project,
                undefined,
                (phase: string, module?: string) => {
                    if (module) {
                        const text = `正在生成：${module}`;
                        this.wizardStepResults['_worldviewProgress'] = text;
                        updateProgress(text);
                    } else {
                        this.wizardStepResults['_worldviewProgress'] = phase;
                        updateProgress(phase);
                    }
                }
            );

        delete this.wizardStepResults['_worldviewProgress'];

        if (result) {
            const validation = validateWorldviewOutput(result);
            this.wizardStepResults['worldview'] = result;
            if (validation.valid) {
                step.status = 'done';
                new Notice('✅ 世界观生成成功，通过校验', 3000);
            } else {
                step.status = 'complete_with_warnings';
                new Notice(`⚠️ 世界观已生成，但缺少: ${validation.missingFields.slice(0, 5).join(', ')}。可点击"重新生成"重试。`, 8000);
            }
            // v3.5: 移除弹窗——Modal 在 Obsidian 主窗口打开，遮挡工作台"下一步"按钮
        } else {
            step.status = 'retry';
            new Notice('❌ 世界观生成失败，请重试', 5000);
        }
    }

    private async executeEntitiesStep(tab: WizardTab, step: WizardStep): Promise<void> {
        const worldview = this.wizardStepResults['worldview'] || '';
        const settingLib = this.wizardStepResults['setting_lib'] || '';
        log.debug(`[Wizard:entities] worldview available: ${!!worldview}, settingLib available: ${!!settingLib}`);

        if (!worldview) {
            new Notice('⚠️ 请先完成世界观生成步骤', 5000);
            step.status = 'pending';
            return;
        }

        const updateProgress = (text: string) => {
            const tc = this.getTabContent();
            if (!tc) return;
            const progressSpan = tc.querySelector<HTMLElement>('[data-entities-progress]');
            if (progressSpan) {
                progressSpan.textContent = `⏳ ${text}`;
            } else {
                const tabRef = this.findWizardTab(tab.id);
                if (tabRef) this.renderTab(tabRef, true);
            }
        };

        const subSteps = step.subSteps || [];
        let generatedCount = 0;
        let totalSubSteps = subSteps.length;

        for (let i = 0; i < subSteps.length; i++) {
            const subStep = subSteps[i];
            if (subStep.status === 'done' || subStep.status === 'skipped') {
                continue;
            }

            subStep.status = 'active';
            updateProgress(`正在生成${subStep.label}... (${i + 1}/${totalSubSteps})`);
            this.renderTab(tab, true);

            try {
                let success = false;
                switch (subStep.id) {
                    case 'characters':
                        success = await this.generateEntitiesForProject(tab.project, 'characters', worldview, settingLib);
                        break;
                    case 'locations':
                        success = await this.generateEntitiesForProject(tab.project, 'locations', worldview, settingLib);
                        break;
                    case 'factions':
                        success = await this.generateEntitiesForProject(tab.project, 'factions', worldview, settingLib);
                        break;
                    case 'items':
                        success = await this.generateEntitiesForProject(tab.project, 'items', worldview, settingLib);
                        break;
                }

                if (success) {
                    subStep.status = 'done';
                    generatedCount++;
                } else {
                    subStep.status = 'pending';
                }
            } catch (e) {
                log.error(`[Wizard:entities] 生成 ${subStep.label} 失败:`, e);
                subStep.status = 'pending';
            }
        }

        delete this.wizardStepResults['_entitiesProgress'];

        const allDone = subSteps.every(s => s.status === 'done' || s.status === 'skipped');
        if (allDone) {
            step.status = 'done';
            new Notice(`✅ 实体生成完成，共生成 ${generatedCount} 类实体`, 3000);
        } else {
            step.status = 'pending';
            const doneCount = subSteps.filter(s => s.status === 'done').length;
            if (doneCount > 0) {
                new Notice(`⚠️ 部分实体生成完成 (${doneCount}/${totalSubSteps})，可手动继续生成`, 5000);
            }
        }
    }

    private async generateEntitiesForProject(
        project: string,
        entityType: 'characters' | 'locations' | 'factions' | 'items',
        worldview: string,
        settingLib: string
    ): Promise<boolean> {
        const EARLY_STAGE_HINTS: Record<string, string> = {
            characters: `【前期内容提示】
这是项目前期的核心人物设定。请确保：
1. 每个人物有清晰的身份定位和核心动机
2. 人物关系有明确的起点（不要设计后期才揭露的秘密）
3. 为后续人物弧光留出成长空间
4. 性格特征要鲜明，有代表性
5. 背景故事要有足够细节支撑人物行为逻辑

`,
            locations: `【前期内容提示】
这是项目前期的核心地点设定。请确保：
1. 每个地点有清晰的地理定位和核心功能
2. 地点间的空间关系要明确（远近/方位/交通）
3. 为后续地点探索和剧情展开留出空间
4. 地点的标志性特征要鲜明（建筑/地貌/氛围）
5. 地点的危险等级和资源分布要合理

`,
            factions: `【前期内容提示】
这是项目前期的核心势力设定。请确保：
1. 每个势力有清晰的定位和核心诉求
2. 势力间关系有明确的起点（盟友/敌对/中立）
3. 为后续势力演变留出空间
4. 势力结构要有层次感（领导层/中层/基层）
5. 势力的核心资源和弱点要明确

`,
            items: `【前期内容提示】
这是项目前期的核心物品/功法设定。请确保：
1. 每个物品/功法有清晰的定位和核心功能
2. 物品/功法的获取途径和使用条件要合理
3. 为后续升级和进化留出空间
4. 物品/功法的稀有度和强度要平衡
5. 与世界观和势力设定保持一致

`,
        };

        const defaultCounts: Record<string, number> = {
            characters: 5,
            locations: 3,
            factions: 3,
            items: 3,
        };

        const count = defaultCounts[entityType];
        const prompt = EARLY_STAGE_HINTS[entityType].trim();

        try {
            let results: Array<{ name: string; content: string }> = [];

            switch (entityType) {
                case 'characters': {
                    const result = await this.aiEngine.generateCharacters(
                        worldview, count, prompt, undefined, true, [], settingLib
                    );
                    if (result.error || !result.content) {
                        log.error(`[Wizard:entities] 人物生成失败:`, result.error);
                        return false;
                    }
                    results = this.parseCharacterBlocks(result.content, count);
                    break;
                }
                case 'locations': {
                    const batchResults = await this.aiEngine.generateLocationsBatch(
                        worldview, [], prompt, count, '', settingLib
                    );
                    results = batchResults;
                    break;
                }
                case 'factions': {
                    const batchResults = await this.aiEngine.generateFactionsBatch(
                        worldview, [], prompt, count, '', settingLib
                    );
                    results = batchResults;
                    break;
                }
                case 'items': {
                    const batchResults = await this.aiEngine.generateItemsBatch(
                        worldview, [], prompt, count, '', undefined, settingLib
                    );
                    results = batchResults;
                    break;
                }
            }

            if (results.length === 0) {
                log.warn(`[Wizard:entities] ${entityType} 生成结果为空`);
                return false;
            }

            const dirPath = this.getEntityDirPath(project, entityType);
            await mkdirp(this.app, dirPath);

            let savedCount = 0;
            // U7（技术审计）：批量单项失败此前仅写日志用户不可见，收集清单供汇总反馈
            const failures: string[] = [];
            for (const entity of results) {
                try {
                    const filePath = this.getEntityFilePath(project, entityType, entity.name);
                    if (!this.app.vault.getAbstractFileByPath(filePath)) {
                        await this.app.vault.create(filePath, entity.content);
                        savedCount++;
                        if (this.cacheService) {
                            await this.cacheService.setEntity(
                                project,
                                entityType as 'characters' | 'locations' | 'factions' | 'items',
                                entity.name,
                                entity.content
                            );
                        }
                    }
                } catch (e) {
                    log.warn(`[Wizard:entities] 保存 ${entity.name} 失败:`, e);
                    failures.push(entity.name);
                }
            }

            const resultKey = `entities:${entityType}:${project}`;
            this.wizardStepResults[resultKey] = JSON.stringify(results.map(r => r.name));

            log.info(`[Wizard:entities] ${entityType} 生成完成，保存 ${savedCount}/${results.length} 个`);
            // U7：部分失败时明确反馈（全失败走下方 return false 的既有错误路径）
            if (failures.length > 0 && savedCount > 0) {
                new Notice(`⚠️ ${entityType} 已保存 ${savedCount}/${results.length} 个，${failures.length} 个失败（${failures.slice(0, 5).join('、')}${failures.length > 5 ? ' 等' : ''}），原因详见控制台`, 10000);
            }
            return savedCount > 0;
        } catch (e) {
            log.error(`[Wizard:entities] ${entityType} 生成异常:`, e);
            return false;
        }
    }

    private getEntityDirPath(project: string, entityType: string): string {
        switch (entityType) {
            case 'characters': return pjCharsDir(project);
            case 'locations': return pjLocsDir(project);
            case 'factions': return pjFactionsDir(project);
            case 'items': return pjItemsDir(project);
            default: return pjCharsDir(project);
        }
    }

    private getEntityFilePath(project: string, entityType: string, name: string): string {
        switch (entityType) {
            case 'characters': return pjCharFile(project, name);
            case 'locations': return pjLocFile(project, name);
            case 'factions': return pjFactionFile(project, name);
            case 'items': return pjItemFile(project, name);
            default: return pjCharFile(project, name);
        }
    }

    private parseCharacterBlocks(content: string, expectedCount: number): Array<{ name: string; content: string }> {
        const results: Array<{ name: string; content: string }> = [];
        const blocks = this.splitCharacterBlocks(content, expectedCount);
        for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;
            const name = this.extractCharacterName(trimmed);
            if (name) {
                results.push({ name, content: trimmed });
            }
        }
        return results;
    }

    private splitCharacterBlocks(content: string, expectedCount?: number): string[] {
        const lines = content.split('\n');
        const dashIndices: number[] = [];
        for (let i = 0; i < lines.length; i++) {
            if (/^---\s*$/.test(lines[i])) dashIndices.push(i);
        }
        if (dashIndices.length < 2) {
            return content.split(/^(?=---\s*$)/m).filter(b => b.trim());
        }
        const expected = typeof expectedCount === 'number' && expectedCount > 0 ? expectedCount : 0;
        const isStandardFormat = expected > 0 ? dashIndices.length >= expected * 2 : dashIndices.length % 2 === 0;
        if (isStandardFormat) {
            const blocks: string[] = [];
            let i = 0;
            while (i < dashIndices.length) {
                const closeIdx = dashIndices[i + 1];
                if (closeIdx === undefined) break;
                let nextOpen = dashIndices.length;
                for (let j = i + 2; j < dashIndices.length; j++) {
                    if (j + 1 < dashIndices.length) { nextOpen = j; break; }
                }
                const blockLines = lines.slice(dashIndices[i], dashIndices[nextOpen] !== undefined ? dashIndices[nextOpen] : lines.length);
                const blockText = blockLines.join('\n').trim();
                if (blockText) blocks.push(blockText);
                i = nextOpen;
            }
            return blocks;
        }
        const blocks: string[] = [];
        for (let k = 0; k < dashIndices.length; k++) {
            const startIdx = dashIndices[k];
            const endIdx = k + 1 < dashIndices.length ? dashIndices[k + 1] : lines.length;
            const blockLines = lines.slice(startIdx, endIdx);
            let blockText = blockLines.join('\n').trim();
            if (!blockText) continue;
            const dashCountInBlock = (blockText.match(/^---\s*$/gm) || []).length;
            if (dashCountInBlock === 1) blockText = blockText + '\n---';
            blocks.push(blockText);
        }
        return blocks;
    }

    private extractCharacterName(content: string): string | null {
        const nameMatch = content.match(/^(?:姓名|名字|名称)[：:]\s*(.+)$/m);
        if (nameMatch) return nameMatch[1].trim();
        const h1Match = content.match(/^#\s+(.+)$/m);
        if (h1Match) return h1Match[1].trim();
        return null;
    }

    private async executeSettingLibStep(tab: WizardTab, step: WizardStep): Promise<void> {
        log.debug('[Wizard:setting_lib] worldview from cache:', !!this.wizardStepResults['worldview']);
        log.warn('[Wizard:setting_lib] 开始执行设定库生成...');
        const cachedWorldview = this.wizardStepResults['worldview'];
        const content = await this.aiEngine.generateSettingLibForProject(this.app, tab.project, cachedWorldview);
        log.warn('[Wizard:setting_lib] AI 返回, content 长度:', content?.length || 0);

        if (content) {
            step.status = 'done';
            log.warn('[Wizard:setting_lib] step.status 设为 done, tab.currentStepIdx=', tab.currentStepIdx);
            this.wizardStepResults['setting_lib'] = content;
            new Notice('✅ 设定库已生成', 3000);
            // v4.5: 不再此处 render，由 finally 统一刷新
        } else {
            step.status = 'retry';
            log.warn('[Wizard:setting_lib] AI 返回空, step.status 设为 retry');
            new Notice('❌ 设定库生成失败，请重试', 5000);
        }
    }

    private async executeWritingStyleStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            const modal = new WritingStyleModal(this.app, this.plugin, tab.project, () => {
                step.status = 'done';
                this.wizardStepResults['writing_style'] = 'done';
            });
            modal.onClose = async () => {
                if (step.status !== 'done') {
                    const wsFile = await findWritingStyleFile(this.app, tab.project);
                    if (wsFile) {
                        step.status = 'done';
                        this.wizardStepResults['writing_style'] = 'done';
                        new Notice('✅ 检测到已有文笔风格文件，标记为完成', 3000);
                    }
                }
                resolve();
            };
            modal.open();
        });
    }

    private async executeOutlineStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            const modal = new PlanBookModal(this.app, this.plugin);
            modal.onClose = async () => {
                // v4.0：分卷大纲按卷归档，合并读取后判断是否非空
                const outlineContent = await readMergedVolumeOutline(this.app, tab.project);
                if (outlineContent.trim().length > 0) {
                    step.status = 'done';
                    new Notice('✅ 全书规划已完成', 3000);
                    // v3.5: 移除弹窗
                } else {
                    step.status = 'pending';
                    new Notice('⚠️ 未检测到分卷大纲文件，请重新生成', 5000);
                }
                resolve();
            };
            modal.open();
        });
    }

    private async executeChaptersStep(tab: WizardTab, step: WizardStep): Promise<void> {
        return new Promise<void>((resolve) => {
            const modal = new BatchCreateModal(this.app, this.plugin);
            modal.onClose = async () => {
                // v4.0：章节正文位于 03-大纲与章节/正文/第N卷/，步骤结果分离在 步骤结果/
                const ok = await this.checkChaptersComplete(tab.project);
                if (ok) {
                    const bodyRoot = `${tab.project}/${SUBDIR_BODY_ROOT}`;
                    const chapterFiles = this.app.vault.getFiles().filter(f =>
                        f.path.startsWith(bodyRoot + '/')
                        && /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
                    );
                    step.status = 'done';
                    // v4.5: 记录 ChapterContext 数据来源 — write-chapter-modal 通过 ContextManager.buildPromptSection 从磁盘读取
                    const hasWorldview = !!this.wizardStepResults['worldview'];
                    const hasSettingLib = !!this.wizardStepResults['setting_lib'];
                    log.debug(`[Wizard:chapters] 已创建 ${chapterFiles.length} 个章节文件，project=${tab.project}`);
                    log.debug(`[Wizard:chapters] ChapterContext 数据来源：write-chapter-modal 将通过 ContextManager.buildPromptSection 从磁盘读取 worldview/settingLib/characters/timeline`);
                    log.debug(`[Wizard:chapters] wizardStepResults 缓存：worldview=${hasWorldview}, settingLib=${hasSettingLib}（写作工作台不依赖此缓存，读磁盘）`);
                    new Notice(`✅ 已创建 ${chapterFiles.length} 个章节文件`, 3000);
                } else {
                    step.status = 'pending';
                    new Notice('⚠️ 未检测到章节文件，请重新创建', 5000);
                }
                resolve();
            };
            modal.open();
        });
    }
}
