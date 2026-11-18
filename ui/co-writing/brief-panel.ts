/**
 * brief-panel.ts — 协同写作左栏「本章简报」渲染
 *
 * 从 `ui/co-writing-view.ts` 抽出：进度摘要、场景列表、当前场景卡、信息释放。
 * 场景切换与工作台跳转通过宿主回调注入，DOM 结构与类名保持不变。
 */
import type { BriefScene, ChapterBrief } from '@/engine/chapter-brief';
import { t } from '@/i18n';

/** 本章简报宿主。 */
export interface BriefPanelHost {
    /** 简报挂载容器 */
    container: HTMLElement;
    /** 头部摘要元素（支持 setText） */
    summaryEl: { setText(text: string): void } | null;
    /** 取当前章节简报 */
    getBrief(): ChapterBrief | null;
    /** 打开完整写作工作台 */
    openFullWriterView(): void;
    /** E-09：就地打开工作台的「Scene 展开」步骤（缺规划时不用跳出视图） */
    openSceneStep?(): void;
    /** E-09：就地打开创作流程页签 */
    openFlowTab?(): void;
    /** E-09：把焦点放到编辑器，直接手写第一句 */
    focusEditor?(): void;
    /** 切换当前场景下标 */
    selectScene(index: number): void;
}

/**
 * 生成简报进度摘要。
 *
 * @param total - 场景总数
 * @param currentIndex - 当前场景下标（0-based）
 * @param writtenWords - 已写字数
 * @returns 摘要文本
 * @example
 * ```ts
 * describeBriefProgress(3, 1, 800);
 * ```
 */
export function describeBriefProgress(total: number, currentIndex: number, writtenWords: number): string {
    const currentNo = total > 0 ? Math.min(currentIndex + 1, total) : 0;
    return total > 0
        ? t('cowrite.brief.sceneProgress', { current: currentNo, total, words: writtenWords })
        : t('cowrite.brief.wordsWritten', { words: writtenWords });
}

/**
 * 场景状态标记。
 *
 * @param done - 已完成
 * @param active - 当前场景
 * @returns 标记字符
 * @example
 * ```ts
 * sceneMarker(true, false);
 * ```
 */
export function sceneMarker(done: boolean, active: boolean): string {
    return done ? '✅' : active ? '▶' : '·';
}

/**
 * 场景列表项文本。
 *
 * @param scene - 场景
 * @param done - 已完成
 * @param active - 当前场景
 * @returns 展示文本
 * @example
 * ```ts
 * formatSceneItem(scene, false, true);
 * ```
 */
export function formatSceneItem(scene: BriefScene, done: boolean, active: boolean): string {
    return `${sceneMarker(done, active)} ${t('cowrite.brief.sceneN', { index: scene.index, name: scene.name || t('cowrite.brief.unnamed') })}`;
}

/**
 * 当前场景卡片的字段行（空值不展示）。
 *
 * @param scene - 场景
 * @returns 标签/值数组
 * @example
 * ```ts
 * buildBriefRows(scene);
 * ```
 */
export function buildBriefRows(scene: BriefScene): Array<[string, string]> {
    const rows: Array<[string, string]> = [
        [t('cowrite.brief.fieldObjective'), scene.objective],
        [t('cowrite.brief.fieldConflict'), scene.conflict],
        [t('cowrite.brief.fieldSensory'), scene.sensoryHook],
        [t('cowrite.brief.fieldMemory'), scene.memoryTrigger],
        [t('cowrite.brief.fieldBody'), scene.bodyReaction],
        [t('cowrite.brief.fieldSubtext'), scene.subtext],
        [t('cowrite.brief.fieldRelationship'), scene.relationshipShift],
        [t('cowrite.brief.fieldKeyScene'), scene.keyScene],
    ];
    return rows.filter(([, value]) => !!value);
}

/**
 * 情绪变化行文本。
 *
 * @param scene - 场景
 * @returns 展示文本
 * @example
 * ```ts
 * formatEmotionLine(scene);
 * ```
 */
export function formatEmotionLine(scene: BriefScene): string {
    return t('cowrite.brief.emotionArc', { start: scene.emotionStart || '—', end: scene.emotionEnd || '—', delta: scene.emotionDelta ? t('cowrite.brief.emotionDelta', { delta: scene.emotionDelta }) : '' });
}

/**
 * 空正文是否可从章节规划冷启动。
 *
 * @param brief - 章节简报
 * @returns 是否可冷启动
 * @example
 * ```ts
 * canColdStart(brief);
 * ```
 */
export function canColdStart(brief: ChapterBrief | null): boolean {
    return !!brief && (brief.scenes.length > 0 || !!brief.outlineSummary);
}

/**
 * 空正文时把主按钮改为「生成开头」。
 *
 * @param button - 建议按钮
 * @param isSuggesting - 是否正在生成
 * @param editorText - 编辑器正文
 * @example
 * ```ts
 * updateStartButtonState(button, false, '');
 * ```
 */
export function updateStartButtonState(
    button: HTMLElement | null,
    isSuggesting: boolean,
    editorText: string,
): void {
    if (!button) return;
    // 生成期间按钮文案由 handleTabSuggest 维护为「⏳ 生成中...」，
    // 重渲染（保存、切章预览等）不能把它覆盖回「✍️ 生成开头 / ⇥ 建议」。
    if (isSuggesting) return;
    const empty = !editorText.trim();
    button.textContent = empty ? t('cowrite.brief.genOpeningBtn') : t('cowrite.brief.suggestBtn');
    button.setAttribute(
        'title',
        empty ? t('cowrite.brief.genOpeningTip') : t('cowrite.brief.suggestTip'),
    );
}

/**
 * 渲染本章简报。
 *
 * @param host - 简报宿主
 * @example
 * ```ts
 * renderBriefPanel({ container, summaryEl, getBrief, openFullWriterView, selectScene });
 * ```
 */
export function renderBriefPanel(host: BriefPanelHost): void {
    const brief = host.getBrief();
    host.container.empty();

    if (!brief || (brief.scenes.length === 0 && !brief.outlineSummary)) {
        host.summaryEl?.setText(t('cowrite.brief.noPlan'));
        const empty = host.container.createDiv({ cls: 'nw-cowrite-brief-empty' });
        empty.createDiv({ text: t('cowrite.brief.noSceneExpand') });
        const actions = empty.createDiv({ cls: 'nw-cowrite-brief-empty-actions' });
        if (host.openSceneStep) {
            const sceneBtn = actions.createEl('button', { text: t('cowrite.brief.genSceneBtn'), cls: 'nw-btn nw-btn-primary' });
            sceneBtn.setAttribute('title', t('cowrite.brief.genSceneTip'));
            sceneBtn.addEventListener('click', () => host.openSceneStep?.());
        }
        if (host.openFlowTab) {
            const flowBtn = actions.createEl('button', { text: t('cowrite.brief.viewFlowBtn'), cls: 'nw-btn nw-btn-secondary' });
            flowBtn.setAttribute('title', t('cowrite.brief.viewFlowTip'));
            flowBtn.addEventListener('click', () => host.openFlowTab?.());
        }
        if (host.focusEditor) {
            const writeBtn = actions.createEl('button', { text: t('cowrite.brief.writeDirectBtn'), cls: 'nw-btn nw-btn-ghost' });
            writeBtn.setAttribute('title', t('cowrite.brief.writeDirectTip'));
            writeBtn.addEventListener('click', () => host.focusEditor?.());
        }
        const btn = actions.createEl('button', { text: t('cowrite.brief.workbenchBtn'), cls: 'nw-btn nw-btn-ghost' });
        btn.setAttribute('title', t('cowrite.brief.workbenchTip'));
        btn.addEventListener('click', () => host.openFullWriterView());
        return;
    }

    const total = brief.scenes.length;
    host.summaryEl?.setText(describeBriefProgress(total, brief.currentIndex, brief.writtenWords));

    if (brief.outlineSummary) {
        const outline = host.container.createDiv({ cls: 'nw-cowrite-brief-outline' });
        outline.createDiv({ cls: 'nw-cowrite-brief-label', text: t('cowrite.brief.outlineLabel') });
        outline.createDiv({ cls: 'nw-cowrite-brief-text', text: brief.outlineSummary.slice(0, 240) });
    }

    if (total > 0) {
        const list = host.container.createDiv({ cls: 'nw-cowrite-brief-scenes' });
        brief.scenes.forEach((scene, i) => {
            const done = i < brief.currentIndex;
            const active = i === brief.currentIndex;
            const item = list.createDiv({
                cls: `nw-cowrite-brief-scene${active ? ' is-active' : ''}${done ? ' is-done' : ''}`,
                attr: { title: scene.objective || scene.name || '' },
            });
            item.createSpan({
                cls: 'nw-cowrite-brief-scene-name',
                text: formatSceneItem(scene, done, active),
            });
            item.addEventListener('click', () => host.selectScene(i));
        });
    }

    const cur = brief.currentScene;
    if (cur) {
        const card = host.container.createDiv({ cls: 'nw-cowrite-brief-card' });
        card.createDiv({ cls: 'nw-cowrite-brief-label', text: t('cowrite.brief.currentScene', { name: cur.name || t('cowrite.brief.unnamed') }) });
        for (const [label, value] of buildBriefRows(cur)) {
            const row = card.createDiv({ cls: 'nw-cowrite-brief-row' });
            row.createSpan({ cls: 'nw-cowrite-brief-row-label', text: label });
            row.createSpan({ cls: 'nw-cowrite-brief-row-value', text: value });
        }
        if (cur.emotionStart || cur.emotionEnd) {
            card.createDiv({ cls: 'nw-cowrite-brief-emotion', text: formatEmotionLine(cur) });
        }
        if (cur.cliffhanger) {
            card.createDiv({ cls: 'nw-cowrite-brief-hook', text: t('cowrite.brief.hook', { hook: cur.cliffhanger }) });
        }
    }

    if (brief.infoRelease) {
        const info = host.container.createDiv({ cls: 'nw-cowrite-brief-info' });
        info.createDiv({ cls: 'nw-cowrite-brief-label', text: t('cowrite.brief.infoRelease') });
        info.createDiv({ cls: 'nw-cowrite-brief-text', text: brief.infoRelease.slice(0, 220) });
    }
}
