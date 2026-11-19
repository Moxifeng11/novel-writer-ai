import { App } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { ALL_FULL_STEPS } from '@/engine/step-runner';
import { findStepByIndex } from './full-writer-utils';
import { FullWriterStore } from './full-writer-store';
import { ChapterStateManager } from '@/ui/states/chapter-state-manager';
import { STORY_STRUCTURES, storyStructureLabel, type StoryStructureId } from '@/shared/story-structure';
import { hasMessage, t } from '@/i18n';

/**
 * StatusBarControllerDeps 类型定义。
 */
export interface StatusBarControllerDeps {
    app: App;
    plugin: NovelWriterPlugin;
    state: FullWriterStore;
    getChapterStateManager: () => ChapterStateManager;
    estimateTotalChars: () => number;
    getNarrativeStructure?: () => StoryStructureId | '';
    onChangeNarrativeStructure?: (id: StoryStructureId) => void;
}

/**
 * StatusBarController 类。
 */
export class StatusBarController {
    private deps: StatusBarControllerDeps;

    constructor(deps: StatusBarControllerDeps) {
        this.deps = deps;
    }

    /**
     * renderStatusBar 方法。
     * @param container - 容器元素
     */
    renderStatusBar(container: HTMLElement): void {
        const sb = container.createDiv({ cls: 'novel-writer-fw-status-bar' });

        const currentStep = findStepByIndex(this.deps.getChapterStateManager().currentStepIndex);
        const ctxLoaded = this.deps.getChapterStateManager().stepCompleted.has('context');

        sb.createSpan({ text: ctxLoaded ? t('fullwriter.statusBar.contextLoaded') : t('fullwriter.statusBar.contextUnloaded'), cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });
        const stepLabel = currentStep
            ? (currentStep.labelKey && hasMessage(currentStep.labelKey) ? t(currentStep.labelKey) : currentStep.label)
            : '—';
        sb.createSpan({ text: t('fullwriter.statusBar.currentStep', { label: stepLabel }), cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const completedCount = Array.from(this.deps.getChapterStateManager().stepCompleted).filter(k => k !== 'context' && k !== 'settlement').length;
        const totalSteps = ALL_FULL_STEPS.filter(s => s.key && !s.auto).length;
        sb.createSpan({ text: t('fullwriter.statusBar.progress', { done: completedCount, total: totalSteps }), cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const totalChars = this.deps.estimateTotalChars();
        const estimatedTokens = Math.floor(totalChars / 4);
        sb.createSpan({ text: t('fullwriter.statusBar.bodyTokens', { count: estimatedTokens.toLocaleString() }), cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const ctxTokens = parseInt(this.deps.state.vars['_contextTokens'] || '0') || 0;
        const maxCtx = this.deps.plugin.settings.maxContext || 128000;
        const pct = maxCtx > 0 ? Math.round(ctxTokens / maxCtx * 100) : 0;
        const ctxCls = pct > 70
            ? 'novel-writer-fw-status-item novel-writer-fw-status-item--hot'
            : pct > 50
                ? 'novel-writer-fw-status-item novel-writer-fw-status-item--warn'
                : 'novel-writer-fw-status-item novel-writer-fw-status-item--muted';
        const ctxSpan = sb.createSpan({ text: t('fullwriter.statusBar.context', { count: ctxTokens.toLocaleString(), pct }), cls: ctxCls });
        ctxSpan.setAttr('title', t('fullwriter.statusBar.contextBudgetTitle', { used: ctxTokens, max: maxCtx }));
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const sceneType = this.deps.state.vars['_sceneType'] || '';
        const sceneLabel = sceneType === 'battle'
            ? t('fullwriter.statusBar.sceneBattle')
            : sceneType === 'emotional'
                ? t('fullwriter.statusBar.sceneEmotional')
                : t('fullwriter.statusBar.sceneDialogue');
        const rhythm = this.deps.state.vars['suggestedRhythm']?.split(' — ')[0] || t('fullwriter.statusBar.rhythmDefault');
        sb.createSpan({
            text: `${sceneLabel} · ${rhythm}`,
            cls: 'novel-writer-fw-status-item',
            attr: { title: t('fullwriter.statusBar.rhythmTitle', { value: this.deps.state.vars['suggestedRhythm'] || t('fullwriter.statusBar.rhythmFallback') }) },
        });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const structureValue = this.deps.getNarrativeStructure?.()
            || (this.deps.state.vars['narrativeStructure'] as StoryStructureId | '')
            || '';
        sb.createSpan({ text: t('fullwriter.statusBar.structure'), cls: 'novel-writer-fw-status-item' });
        const select = sb.createEl('select', {
            cls: 'nw-narrative-select',
            attr: { title: t('fullwriter.statusBar.structureTitle') },
        });
        if (!structureValue) select.createEl('option', { value: '', text: t('fullwriter.statusBar.unset') });
        for (const structure of STORY_STRUCTURES) {
            select.createEl('option', { value: structure.id, text: `${structure.icon} ${storyStructureLabel(structure.id)}` });
        }
        select.value = structureValue;
        select.onchange = () => {
            const id = select.value as StoryStructureId;
            if (id) this.deps.onChangeNarrativeStructure?.(id);
        };
    }
}
