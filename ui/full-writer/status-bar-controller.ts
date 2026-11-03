import { App } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { ALL_FULL_STEPS } from '@/engine/step-runner';
import { findStepByIndex } from './full-writer-utils';
import { FullWriterStore } from './full-writer-store';
import { ChapterStateManager } from '@/ui/states/chapter-state-manager';
import { STORY_STRUCTURES, type StoryStructureId } from '@/shared/story-structure';

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

        sb.createSpan({ text: ctxLoaded ? '🟢 上下文已加载' : '🔴 上下文未加载', cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });
        sb.createSpan({ text: `当前步骤: ${currentStep?.label ?? '—'}`, cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const completedCount = Array.from(this.deps.getChapterStateManager().stepCompleted).filter(k => k !== 'context' && k !== 'settlement').length;
        const totalSteps = ALL_FULL_STEPS.filter(s => s.key && !s.auto).length;
        sb.createSpan({ text: `进度: ${completedCount}/${totalSteps}`, cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const totalChars = this.deps.estimateTotalChars();
        const estimatedTokens = Math.floor(totalChars / 4);
        sb.createSpan({ text: `正文 tokens: ~${estimatedTokens.toLocaleString()}`, cls: 'novel-writer-fw-status-item' });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const ctxTokens = parseInt(this.deps.state.vars['_contextTokens'] || '0') || 0;
        const maxCtx = this.deps.plugin.settings.maxContext || 128000;
        const pct = maxCtx > 0 ? Math.round(ctxTokens / maxCtx * 100) : 0;
        const ctxColor = pct > 70 ? 'var(--text-error)' : pct > 50 ? 'var(--text-warning)' : 'var(--text-muted)';
        const ctxSpan = sb.createSpan({ text: `上下文: ~${ctxTokens.toLocaleString()}t (${pct}%)`, cls: 'novel-writer-fw-status-item', attr: { style: `color:${ctxColor};` } });
        ctxSpan.setAttr('title', `上下文预算: ${ctxTokens}/${maxCtx} tokens`);
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const sceneType = this.deps.state.vars['_sceneType'] || '';
        const sceneLabel = sceneType === 'battle' ? '⚔️ 战斗' : sceneType === 'emotional' ? '💭 情感' : '💬 对话';
        const rhythm = this.deps.state.vars['suggestedRhythm']?.split(' — ')[0] || '自然节奏';
        sb.createSpan({ text: `${sceneLabel} · ${rhythm}`, cls: 'novel-writer-fw-status-item', attr: { title: `场景节奏建议: ${this.deps.state.vars['suggestedRhythm'] || '按当前内容自然推进'}` } });
        sb.createSpan({ text: ' | ', cls: 'novel-writer-fw-status-sep' });

        const structureValue = this.deps.getNarrativeStructure?.()
            || (this.deps.state.vars['narrativeStructure'] as StoryStructureId | '')
            || '';
        sb.createSpan({ text: '🧬 叙事结构', cls: 'novel-writer-fw-status-item' });
        const select = sb.createEl('select', {
            cls: 'nw-narrative-select',
            attr: { title: '切换本章后续生成使用的叙事结构；已生成内容不会自动改写' },
        });
        if (!structureValue) select.createEl('option', { value: '', text: '未设置' });
        for (const structure of STORY_STRUCTURES) {
            select.createEl('option', { value: structure.id, text: `${structure.icon} ${structure.name}` });
        }
        select.value = structureValue;
        select.onchange = () => {
            const id = select.value as StoryStructureId;
            if (id) this.deps.onChangeNarrativeStructure?.(id);
        };
    }
}
