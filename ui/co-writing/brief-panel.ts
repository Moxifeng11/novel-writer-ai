/**
 * brief-panel.ts — 协同写作左栏「本章简报」渲染
 *
 * 从 `ui/co-writing-view.ts` 抽出：进度摘要、场景列表、当前场景卡、信息释放。
 * 场景切换与工作台跳转通过宿主回调注入，DOM 结构与类名保持不变。
 */
import type { BriefScene, ChapterBrief } from '@/engine/chapter-brief';

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
        ? `场景 ${currentNo}/${total} · 已写 ${writtenWords} 字`
        : `已写 ${writtenWords} 字`;
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
    return `${sceneMarker(done, active)} 第${scene.index}场 ${scene.name || '未命名'}`;
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
        ['目标', scene.objective],
        ['冲突', scene.conflict],
        ['感官', scene.sensoryHook],
        ['记忆', scene.memoryTrigger],
        ['身体', scene.bodyReaction],
        ['潜台词', scene.subtext],
        ['关系', scene.relationshipShift],
        ['名场面', scene.keyScene],
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
    return `情绪：${scene.emotionStart || '—'} → ${scene.emotionEnd || '—'}${scene.emotionDelta ? `（${scene.emotionDelta}）` : ''}`;
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
    button.textContent = empty ? '✍️ 生成开头' : '⇥ 建议';
    button.setAttribute(
        'title',
        empty ? '由本章 Scene 展开生成开头候选（不自动写入正文）' : '基于上文生成续写建议（方向可在上方临时指令填写）',
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
        host.summaryEl?.setText('未找到章节规划');
        const empty = host.container.createDiv({ cls: 'nw-cowrite-brief-empty' });
        empty.createDiv({ text: '未找到 Scene 展开，无法从规划直接开头。可先回工作台完成步骤 6，或直接手写第一句。' });
        const btn = empty.createEl('button', { text: '去工作台', cls: 'nw-btn nw-btn-ghost' });
        btn.addEventListener('click', () => host.openFullWriterView());
        return;
    }

    const total = brief.scenes.length;
    host.summaryEl?.setText(describeBriefProgress(total, brief.currentIndex, brief.writtenWords));

    if (brief.outlineSummary) {
        const outline = host.container.createDiv({ cls: 'nw-cowrite-brief-outline' });
        outline.createDiv({ cls: 'nw-cowrite-brief-label', text: '本章大纲' });
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
        card.createDiv({ cls: 'nw-cowrite-brief-label', text: `当前场景：${cur.name || '未命名'}` });
        for (const [label, value] of buildBriefRows(cur)) {
            const row = card.createDiv({ cls: 'nw-cowrite-brief-row' });
            row.createSpan({ cls: 'nw-cowrite-brief-row-label', text: label });
            row.createSpan({ cls: 'nw-cowrite-brief-row-value', text: value });
        }
        if (cur.emotionStart || cur.emotionEnd) {
            card.createDiv({ cls: 'nw-cowrite-brief-emotion', text: formatEmotionLine(cur) });
        }
        if (cur.cliffhanger) {
            card.createDiv({ cls: 'nw-cowrite-brief-hook', text: `钩子：${cur.cliffhanger}` });
        }
    }

    if (brief.infoRelease) {
        const info = host.container.createDiv({ cls: 'nw-cowrite-brief-info' });
        info.createDiv({ cls: 'nw-cowrite-brief-label', text: '信息释放' });
        info.createDiv({ cls: 'nw-cowrite-brief-text', text: brief.infoRelease.slice(0, 220) });
    }
}
