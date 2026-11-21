/**
 * polish-editor.ts — 文笔润色编辑器 (v3.4.9 从 full-writer-view.ts 提取)
 *
 * 功能: 结算步骤内嵌的正文编辑界面
 * 实体用四色标记（不可编辑），正文可自由编辑，实时自动保存
 *
 * 提取自 full-writer-view.ts:
 *   - buildEntityMarkedFragment (DOM 构建，替代字符串拼 HTML)
 *   - extractPlainTextFromEditor (L4049)
 *   - renderPolishEditor (L3898) → PolishEditor.render()
 */

import { App, Modal, Notice } from 'obsidian';
import { StepRunner } from '@/engine/step-runner';
import { AdaptiveDebounceManager } from '@/shared/adaptive-debounce-manager';
import NovelWriterPlugin from '@/main';
import { RhythmAnalyzer } from '@/engine/rhythm-analyzer';
import '@/engine/style-learner';
import type { RhythmAnalysis } from '@/shared/co-writer-types';
import { StyleFingerprintLibrary, StyleFingerprint } from '@/engine/style-fingerprint-library';
import { getStyleIntensityEngine } from '@/engine/style/style-intensity-engine';
import { createLogger } from '@/shared/logger';
import { resolveNodeWindow } from '@/shared/dom-window';
import { escapeHtml as escapeHtmlText } from '@/utils/helpers';
import { t } from '@/i18n';
import { STEP_KEYS } from '@/shared/step-keys';

/**
 * HTML 实体转义（兼容旧导出；实现统一在 utils/helpers，覆盖 & < > " '）。
 *
 * @param text - 原始文本
 * @returns 转义后的文本
 */
export function escapeHtml(text: string): string {
    return escapeHtmlText(text);
}


const log = createLogger('PolishEditor');

/** 强度映射是纯函数，模块级共享一个实例即可 */
const intensityEngine = getStyleIntensityEngine();
// ============================================================
// 工具函数 (纯函数，无 this 依赖)
// ============================================================

/**
 * 将正文文本转为带实体标记的 DocumentFragment。
 *
 * 不再拼 HTML 字符串：实体名/类型/颜色都来自项目文件（外部数据），
 * 用 DOM 构建可以彻底避开 innerHTML 注入面；实体标记本身不可编辑。
 *
 * @param bodyText - 正文文本
 * @param entityMap - 实体映射
 * @param typeLabels - 类型标签列表
 * @param doc - 编辑器所属 document（popout 安全）
 * @returns 可直接 append 到编辑区的片段
 */
export function buildEntityMarkedFragment(
    bodyText: string,
    entityMap: Map<string, { type: string; color: string }>,
    typeLabels: Record<string, string>,
    doc: Document = document,
): DocumentFragment {
    const fragment = doc.createDocumentFragment();
    const sortedNames = [...entityMap.keys()].sort((a, b) => b.length - a.length);
    if (sortedNames.length === 0) {
        fragment.appendChild(doc.createTextNode(bodyText));
        return fragment;
    }

    // 按长度降序排序，优先匹配长实体名（如"维克多·克劳利" 优先于 "维克多"）
    const escapedNames = sortedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(${escapedNames.join('|')})`, 'g');
    let lastIndex = 0;
    for (const match of bodyText.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
            fragment.appendChild(doc.createTextNode(bodyText.slice(lastIndex, index)));
        }
        const name = match[0];
        const info = entityMap.get(name);
        if (!info) {
            fragment.appendChild(doc.createTextNode(name));
        } else {
            const typeLabel = typeLabels[info.type] || info.type;
            const span = doc.createElement('span');
            span.className = `nw-entity-tag nw-entity-${info.type}`;
            span.contentEditable = 'false';
            span.dataset.entityType = info.type;
            span.dataset.entityName = name;
            span.title = `${typeLabel}: ${name}`;
            span.style.setProperty('--nw-entity-color', info.color);
            span.style.setProperty('--nw-entity-bg', `${info.color}18`);
            span.setText(name);
            fragment.appendChild(span);
        }
        lastIndex = index + name.length;
    }
    if (lastIndex < bodyText.length) {
        fragment.appendChild(doc.createTextNode(bodyText.slice(lastIndex)));
    }
    return fragment;
}

/**
 * 从 contenteditable div 提取纯文本（剥离实体 span 的 HTML 包裹）
 *
 * @param editorDiv - 编辑区元素
 * @param _entityMap - 实体映射
 * @returns 文本结果
 */
export function extractPlainTextFromEditor(
    editorDiv: HTMLDivElement,
    _entityMap: Map<string, { type: string; color: string }>,
): string {
    // 克隆节点避免污染原始 DOM
    const clone = editorDiv.cloneNode(true) as HTMLDivElement;
    // 将所有实体 span 替换为纯文本节点
    const spans = clone.querySelectorAll('.nw-entity-tag');
    spans.forEach(span => {
        const text = span.textContent || '';
        span.replaceWith(document.createTextNode(text));
    });
    // 获取纯文本
    return clone.innerText || clone.textContent || '';
}

// ============================================================
// PolishEditor 类
// ============================================================

/**
 * PolishEditor 类。
 */
export class PolishEditor {
    private stepRunner: StepRunner;
    private plugin: NovelWriterPlugin;
    private debounceManager = new AdaptiveDebounceManager({ debug: false });

    constructor(stepRunner: StepRunner, plugin: NovelWriterPlugin) {
        this.stepRunner = stepRunner;
        this.plugin = plugin;
    }

    /**
     * 销毁编辑器，清理资源
     */
    destroy(): void {
        this.debounceManager.dispose();
    }

    /**
     * 渲染润色编辑器到目标区域
     * @param area 父容器
     * @param stepResults 步骤结果映射（用于读写 bodyGeneration）
     * @param project 项目路径
     * @param chapDir 章节目录
     * @param chapterName 章节名
     * @param volume 卷名
     * @param onSaved 自动保存成功后的回调（A7：用于失效下游审查/分析/结算）
     */
    async render(
        area: HTMLElement,
        stepResults: Record<string, string>,
        project: string,
        chapDir: string,
        chapterName: string,
        volume: string,
        onSaved?: () => void,
    ): Promise<void> {
        const bodyText = stepResults[STEP_KEYS.BODY_GENERATION];
        if (!bodyText || !project) {
            log.warn('[小说工坊] PolishEditor.render: 跳过 (bodyText=%s, project=%s)', !!bodyText, project || '(空)');
            return;
        }
        log.warn('[小说工坊] PolishEditor.render: project=%s bodyLen=%d', project, bodyText.length);


        // 分割线
        area.createEl('hr', { cls: 'nw-pe-divider' });

        // 标题行 + 自动保存状态
        const headerRow = area.createDiv({ cls: 'nw-pe-header' });
        const titleSection = headerRow.createDiv({ cls: 'nw-pe-title-group' });
        titleSection.createEl('h4', { text: t('polishEditor.title'), cls: 'nw-pe-title' });
        const aiPolishBtn = titleSection.createEl('button', {
            text: t('polishEditor.btnPolish'),
            cls: 'nw-btn nw-pe-btn',
        });
        const rhythmBtn = titleSection.createEl('button', {
            text: t('polishEditor.btnRhythm'),
            cls: 'nw-btn nw-pe-btn',
        });
        const styleBtn = titleSection.createEl('button', {
            text: t('polishEditor.btnStyleGuide'),
            cls: 'nw-btn nw-pe-btn',
        });
        const statusSpan = headerRow.createSpan({ text: t('polishEditor.statusSaved'), cls: 'nw-pe-status' });

        // 实体颜色图例（配色由 .nw-pe-legend-item--* 修饰类提供，见 39-polish-editor.css）
        const legendRow = area.createDiv({ cls: 'nw-pe-legend' });
        const legendItems: [string, string][] = [
            [entityLegendLabel('chars'), 'char'],
            [entityLegendLabel('locs'), 'loc'],
            [entityLegendLabel('factions'), 'faction'],
            [entityLegendLabel('items'), 'item'],
        ];
        for (const [label, tone] of legendItems) {
            const item = legendRow.createDiv({ cls: `nw-pe-legend-item nw-pe-legend-item--${tone}` });
            item.setText(label);
        }

        // 加载实体数据
        let entityNames: { chars: string[]; factions: string[]; locs: string[]; items: string[] } | null = null;
        try {
            entityNames = await this.stepRunner.getEntityNames(project);
        } catch (e) {
            log.warn('[小说工坊] 获取实体名称失败:', e);
        }

        // 构造实体映射：名称 → 类型
        const entityMap = new Map<string, { type: string; color: string }>();
        const colorConfig: Record<string, string> = {
            chars: '#e74c3c', factions: '#2ecc71', locs: '#3498db', items: '#f39c12',
        };
        const typeLabels: Record<string, string> = {
            chars: entityTypeLabel('chars'),
            factions: entityTypeLabel('factions'),
            locs: entityTypeLabel('locs'),
            items: entityTypeLabel('items'),
        };
        if (entityNames) {
            for (const [key, names] of Object.entries(entityNames)) {
                for (const name of names) {
                    if (name && name.length >= 2) {
                        entityMap.set(name, { type: key, color: colorConfig[key] || '#999' });
                    }
                }
            }
        }

        log.warn('[小说工坊] PolishEditor.render: entityMap size=%d chars=%d locs=%d factions=%d items=%d bodyPreview=%s',
            entityMap.size,
            entityNames?.chars?.length || 0,
            entityNames?.locs?.length || 0,
            entityNames?.factions?.length || 0,
            entityNames?.items?.length || 0,
            bodyText.replace(/---[\s\S]*?---\n?/, '').substring(0, 80)
        );

        // 创建可编辑区域
        const editorWrapper = area.createDiv({ cls: 'novel-writer-polish-editor-wrapper' });
        const editorDiv = editorWrapper.createDiv({
            cls: 'novel-writer-polish-editor nw-pe-editor',
            attr: { contenteditable: 'true' }
        }) as HTMLDivElement;

        // 将正文转换为带实体标记的 fragment（DOM 构建，不走 innerHTML）
        editorDiv.appendChild(buildEntityMarkedFragment(
            bodyText,
            entityMap,
            typeLabels,
            editorDiv.ownerDocument || document,
        ));

        // 自动保存：debounce 500ms
        const triggerAutoSave = () => {
            statusSpan.setText(t('polishEditor.statusSaving'));
            this.debounceManager.debounceFixed('polish-save', async () => {
                try {
                    // 从 contenteditable 提取纯文本（去掉 HTML 标签 + 实体 span）
                    const plainText = extractPlainTextFromEditor(editorDiv, entityMap);
                    if (plainText.trim().length < 100) {
                        statusSpan.setText(t('polishEditor.statusTooShort'));
                        return;
                    }
                    stepResults[STEP_KEYS.BODY_GENERATION] = plainText;
                    await this.stepRunner.writeFixToBody(plainText, chapDir, chapterName, volume);
                    statusSpan.setText(t('polishEditor.statusSavedAt', { time: new Date().toLocaleTimeString() }));
                    // A7: 正文已实际改动 → 下游审查/分析/结算必须失效（落盘成功后再失效，失败不误伤）
                    onSaved?.();
                    log.warn('[小说工坊] 润色编辑器自动保存:', plainText.length, '字');
                } catch (e) {
                    statusSpan.setText(t('polishEditor.statusSaveFailed'));
                    log.error('[小说工坊] 润色编辑器保存失败:', e);
                }
            }, 500);
        };

        // 监听输入事件实现实时保存
        editorDiv.addEventListener('input', () => {
            triggerAutoSave();
        });

        // 阻止实体 span 内粘贴破坏标记
        editorDiv.addEventListener('paste', (e) => {
            e.preventDefault();
            const win = resolveNodeWindow(editorDiv);
            const text = (e.clipboardData || (win as Window & { clipboardData?: DataTransfer }).clipboardData)?.getData('text/plain') || '';
            // 只粘贴纯文本
            const selection = win.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode((editorDiv.ownerDocument || document).createTextNode(text));
                range.collapse(false);
            }
            triggerAutoSave();
        });

        // ✨ AI 润色按钮：弹出选项 → 调用 AI → 对比 → 应用
        aiPolishBtn.onclick = () => {
            try {
                const fullText = extractPlainTextFromEditor(editorDiv, entityMap);
                const selection = window.getSelection()?.toString() || '';
                new PolishAIPolishModal(
                    this.plugin.app,
                    this.plugin,
                    fullText,
                    selection,
                    (polishedText: string) => {
                        // 重建带实体标记的 fragment 并替换编辑器内容
                        editorDiv.empty();
                        editorDiv.appendChild(buildEntityMarkedFragment(
                            polishedText,
                            entityMap,
                            typeLabels,
                            editorDiv.ownerDocument || document,
                        ));
                        triggerAutoSave();
                    },
                    // D6: 指纹风格必须跟随当前章节所属项目，不能由弹窗再猜 activeFile
                    project,
                ).open();
            } catch (e) {
                log.error('[小说工坊] AI润色按钮点击失败:', e);
                new Notice(t('polishEditor.noticePolishError', { msg: e instanceof Error ? e.message : String(e) }));
            }
        };

        // 📊 节奏分析按钮
        rhythmBtn.onclick = async () => {
            try {
                const fullText = extractPlainTextFromEditor(editorDiv, entityMap);
                if (!fullText || fullText.trim().length < 100) {
                    new Notice(t('polishEditor.noticeBodyTooShort'));
                    return;
                }

                rhythmBtn.setText(t('polishEditor.btnRhythmBusy'));
                rhythmBtn.disabled = true;

                const analyzer = new RhythmAnalyzer();
                const result = await analyzer.analyze(fullText);

                rhythmBtn.setText(t('polishEditor.btnRhythm'));
                rhythmBtn.disabled = false;

                // 展示分析结果
                this.renderRhythmPanel(area, result, editorDiv);
            } catch (e) {
                rhythmBtn.setText(t('polishEditor.btnRhythm'));
                rhythmBtn.disabled = false;
                log.error('[小说工坊] 节奏分析失败:', e);
                new Notice(t('polishEditor.noticeRhythmError', { msg: e instanceof Error ? e.message : String(e) }));
            }
        };

        // 🎨 风格指南按钮
        styleBtn.onclick = async () => {
            try {
                const learner = await this.plugin.engineRegistry.getStyleLearner(project);
                const guide = learner.getStyleGuide();
                this.renderStylePanel(area, guide);
            } catch (e) {
                log.error('[小说工坊] 风格指南获取失败:', e);
                new Notice(t('polishEditor.noticeStyleError', { msg: e instanceof Error ? e.message : String(e) }));
            }
        };
    }

    /** 渲染节奏分析面板 */
    private renderRhythmPanel(area: HTMLElement, result: RhythmAnalysis, editorDiv: HTMLDivElement): void {
        // 移除旧面板
        area.querySelectorAll('.nw-rhythm-panel').forEach(el => el.remove());

        const panel = area.createDiv({ cls: "nw-rhythm-panel nw-pe-panel" });

        // 标题行
        const header = panel.createDiv({ cls: 'nw-pe-panel-header' });
        header.createEl('h5', { text: t('polishEditor.rhythmTitle'), cls: 'nw-pe-panel-title' });
        const closeBtn = header.createEl('button', { text: '✕', cls: 'nw-btn nw-pe-close-btn' });
        closeBtn.onclick = () => panel.remove();

        // 整体节奏
        const overviewRow = panel.createDiv({ cls: 'nw-pe-overview' });
        overviewRow.createSpan({ text: t('polishEditor.rhythm.overall', { pace: paceLabel(result.overallPace) }) });
        overviewRow.createSpan({ text: t('polishEditor.rhythm.segments', { count: result.segments.length }) });
        overviewRow.createSpan({ text: t('polishEditor.rhythm.slow', { count: result.slowSegments.length }), cls: result.slowSegments.length > 0 ? 'nw-pe-text--warning' : '' });
        overviewRow.createSpan({ text: t('polishEditor.rhythm.fast', { count: result.fastSegments.length }), cls: result.fastSegments.length > 0 ? 'nw-pe-text--success' : '' });

        // 建议
        if (result.suggestions.length > 0) {
            const sugSection = panel.createDiv({ cls: 'nw-pe-block' });
            sugSection.createDiv({ text: t('polishEditor.rhythm.suggestions'), cls: 'nw-pe-subtitle' });
            for (const sug of result.suggestions) {
                sugSection.createDiv({ text: `• ${sug}`, cls: 'nw-pe-suggestion' });
            }
        }

        // 段落详情
        if (result.segments.length > 0) {
            const detailSection = panel.createDiv({ cls: 'nw-pe-detail' });
            detailSection.createDiv({ text: t('polishEditor.rhythm.detail'), cls: 'nw-pe-subtitle' });

            const paceIcon: Record<string, string> = { fast: '⚡', medium: '➡️', slow: '🐌' };

            for (let i = 0; i < result.segments.length; i++) {
                const seg = result.segments[i];
                const hasIssue = seg.issues.length > 0;
                const row = detailSection.createDiv({
                    cls: hasIssue ? 'nw-pe-seg-row nw-pe-seg-row--issue' : 'nw-pe-seg-row',
                    attr: { title: seg.issues.join('；') },
                });
                row.createSpan({ text: `${paceIcon[seg.pace] || '➡️'}`, cls: 'nw-pe-seg-icon' });
                row.createSpan({ text: segmentTypeLabel(seg.type), cls: 'nw-pe-seg-type' });
                const densityTone = seg.density < 30 ? ' nw-pe-seg-metric--warning' : seg.density > 85 ? ' nw-pe-seg-metric--error' : '';
                row.createSpan({ text: t('polishEditor.rhythm.density', { value: seg.density }), cls: `nw-pe-seg-metric${densityTone}` });
                row.createSpan({ text: t('polishEditor.rhythm.tension', { value: seg.tensionLevel }), cls: seg.tensionLevel > 80 ? 'nw-pe-seg-metric nw-pe-seg-metric--success' : 'nw-pe-seg-metric' });
                if (hasIssue) {
                    row.createSpan({ text: `⚠️ ${seg.issues[0]}`, cls: 'nw-pe-seg-issue' });
                }
            }
        }
    }

    /** 渲染风格指南面板 */
    private renderStylePanel(area: HTMLElement, guide: string): void {
        // 移除旧面板
        area.querySelectorAll('.nw-style-panel').forEach(el => el.remove());

        const panel = area.createDiv({ cls: "nw-style-panel nw-pe-panel" });

        // 标题行
        const header = panel.createDiv({ cls: 'nw-pe-panel-header' });
        header.createEl('h5', { text: t('polishEditor.styleTitle'), cls: 'nw-pe-panel-title' });
        const closeBtn = header.createEl('button', { text: '✕', cls: 'nw-btn nw-pe-close-btn' });
        closeBtn.onclick = () => panel.remove();

        if (!guide || guide.trim().length === 0) {
            panel.createEl('p', {
                text: t('polishEditor.styleEmpty'),
                cls: 'nw-pe-empty-text'
            });
            return;
        }

        // 解析并展示风格指南
        const lines = guide.split('\n');
        const contentDiv = panel.createDiv({ cls: 'nw-pe-style-content' });

        for (const line of lines) {
            if (line.startsWith('【')) {
                contentDiv.createDiv({ text: line, cls: 'nw-pe-style-heading' });
            } else if (line.startsWith('偏好风格：')) {
                contentDiv.createDiv({ text: t('polishEditor.stylePref'), cls: 'nw-pe-style-pref' });
            } else if (line.startsWith('避免风格：')) {
                contentDiv.createDiv({ text: t('polishEditor.styleAvoid'), cls: 'nw-pe-style-avoid' });
            } else if (line.startsWith('- ')) {
                contentDiv.createDiv({ text: line, cls: 'nw-pe-style-item' });
            } else if (line.trim()) {
                contentDiv.createDiv({ text: line, cls: 'nw-pe-style-line' });
            }
        }
    }
}

// ============================================================
// PolishAIPolishModal — AI 润色弹窗（选项 / 加载 / 对比三阶段）
// ============================================================

type PolishScope = '全文润色' | '选中段落润色';
type PolishStyle = '精简凝练' | '细节丰富' | '情感强化' | '节奏优化';

const POLISH_STYLE_HINTS: Record<PolishStyle, string> = {
    '精简凝练': '删减冗余词句，突出核心情节，让文字更加凝练有力',
    '细节丰富': '在原意基础上丰富细节描写，让场景和人物更立体',
    '情感强化': '加强情感表达，让人物内心活动更细腻动人',
    '节奏优化': '调整叙事节奏，优化段落长短搭配，增强阅读韵律',
};

/** 润色范围显示名（内部值仍是中文，落盘与提示词不受影响） */
function polishScopeLabel(scope: PolishScope): string {
    switch (scope) {
        case '全文润色':
            return t('polishEditor.scope.full');
        case '选中段落润色':
            return t('polishEditor.scope.partial');
        default:
            return scope;
    }
}

/** 润色风格显示名 */
function polishStyleLabel(style: PolishStyle): string {
    switch (style) {
        case '精简凝练':
            return t('polishEditor.style.concise');
        case '细节丰富':
            return t('polishEditor.style.detailed');
        case '情感强化':
            return t('polishEditor.style.emotional');
        case '节奏优化':
            return t('polishEditor.style.rhythm');
        default:
            return style;
    }
}

/** 实体类型短名（实体标签 tooltip 用） */
function entityTypeLabel(type: string): string {
    switch (type) {
        case 'chars':
            return t('polishEditor.entity.char');
        case 'locs':
            return t('polishEditor.entity.loc');
        case 'factions':
            return t('polishEditor.entity.faction');
        case 'items':
            return t('polishEditor.entity.item');
        default:
            return type;
    }
}

/** 实体类型图例名（带图标） */
function entityLegendLabel(type: string): string {
    switch (type) {
        case 'chars':
            return t('polishEditor.legend.char');
        case 'locs':
            return t('polishEditor.legend.loc');
        case 'factions':
            return t('polishEditor.legend.faction');
        case 'items':
            return t('polishEditor.legend.item');
        default:
            return type;
    }
}

/** 节奏速度显示名 */
function paceLabel(pace: string): string {
    switch (pace) {
        case 'fast':
            return t('polishEditor.pace.fast');
        case 'slow':
            return t('polishEditor.pace.slow');
        case 'medium':
        case 'balanced':
            return t('polishEditor.pace.medium');
        default:
            return pace;
    }
}

/** 段落类型显示名 */
function segmentTypeLabel(type: string): string {
    switch (type) {
        case 'action':
            return t('polishEditor.segType.action');
        case 'dialogue':
            return t('polishEditor.segType.dialogue');
        case 'description':
            return t('polishEditor.segType.description');
        case 'introspection':
            return t('polishEditor.segType.introspection');
        default:
            return type;
    }
}

/**
 * PolishAIPolishModal 类。
 */
export class PolishAIPolishModal extends Modal {
    private plugin: NovelWriterPlugin;
    private fullText: string;
    // 字段名不能叫 selection：Obsidian 的 Modal 基类会在 open() 时写入一个同名的
    // 对象属性（DOM 选中相关），覆盖构造函数里的赋值，导致 this.selection.trim 报错。
    private selectedText: string;
    private projectPath: string;

    private polishScope: PolishScope = '全文润色';
    private style: PolishStyle = '精简凝练';
    private resultText: string = '';
    private applyFingerprint: boolean = true;

    private onApply: (polishedText: string) => void;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        fullText: string,
        selectedText: string,
        onApply: (polishedText: string) => void,
        // D6: 项目由调用方显式传入（当前章节所属项目）。协同/工作台视图没有 activeFile，
        // 在这里回落到 getActiveProject() 会把别的书的指纹套到本章正文上。
        projectPath: string,
    ) {
        super(app);
        this.plugin = plugin;
        this.fullText = fullText;
        this.selectedText = selectedText;
        this.onApply = onApply;
        this.projectPath = projectPath;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.renderInputForm();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }

    private renderInputForm(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: t('polishEditor.modalTitle') });

        // 润色范围
        const scopeSection = contentEl.createDiv();
        scopeSection.addClass('nw-section-gap-sm');
        scopeSection.createEl('h4', { text: t('polishEditor.scopeSection') });
        const scopeBtns = scopeSection.createDiv();
        scopeBtns.addClass('nw-btn-row');
        const scopeOptions: PolishScope[] = ['全文润色', '选中段落润色'];
        for (const s of scopeOptions) {
            const btn = scopeBtns.createEl('button', { text: polishScopeLabel(s), cls: 'nw-btn' });
            if (s === this.polishScope) btn.addClass('is-active');
            btn.onclick = () => {
                if (s === '选中段落润色' && (!this.selectedText || this.selectedText.trim().length === 0)) {
                    new Notice(t('polishEditor.noticeSelectParagraph'));
                    return;
                }
                this.polishScope = s;
                scopeBtns.querySelectorAll('button').forEach(b => b.removeClass('is-active'));
                btn.addClass('is-active');
            };
        }
        if (!this.selectedText || this.selectedText.trim().length === 0) {
            const hint = scopeSection.createEl('p', {
                text: t('polishEditor.noSelectionHint'),
                cls: 'nw-pe-hint nw-pe-hint--tight',
            });
            void hint;
        }

        // 润色风格
        const styleSection = contentEl.createDiv();
        styleSection.addClass('nw-section-gap');
        styleSection.createEl('h4', { text: t('polishEditor.styleSection') });
        const styleBtns = styleSection.createDiv();
        styleBtns.addClass('nw-btn-row');
        const styleOptions: PolishStyle[] = ['精简凝练', '细节丰富', '情感强化', '节奏优化'];
        for (const s of styleOptions) {
            const btn = styleBtns.createEl('button', { text: polishStyleLabel(s), cls: 'nw-btn' });
            if (s === this.style) btn.addClass('is-active');
            btn.onclick = () => {
                this.style = s;
                styleBtns.querySelectorAll('button').forEach(b => b.removeClass('is-active'));
                btn.addClass('is-active');
            };
        }

        // 写作指纹应用
        if (this.projectPath) {
            const fingerprintSection = contentEl.createDiv();
            fingerprintSection.addClass('nw-section-gap');
            fingerprintSection.createEl('h4', { text: t('polishEditor.fingerprintSection') });
            const fingerprintDesc = fingerprintSection.createEl('p', {
                text: t('polishEditor.fingerprintDesc'),
                cls: 'nw-pe-hint nw-pe-hint--section'
            });
            void fingerprintDesc;
            
            const fingerprintToggle = fingerprintSection.createDiv();
            fingerprintToggle.addClass('nw-btn-row');
            const checkbox = fingerprintToggle.createEl('input', {
                type: 'checkbox',
                cls: 'nw-pe-checkbox'
            });
            checkbox.checked = this.applyFingerprint;
            checkbox.addEventListener('change', () => {
                this.applyFingerprint = checkbox.checked;
            });
            fingerprintToggle.createSpan({
                text: t('polishEditor.fingerprintToggle'),
                cls: 'nw-pe-toggle-label'
            }).addEventListener('click', () => {
                checkbox.checked = !checkbox.checked;
                this.applyFingerprint = checkbox.checked;
            });
        }

        // 操作按钮
        const actions = contentEl.createDiv();
        actions.addClass('nw-btn-row-end');
        const startBtn = actions.createEl('button', {
            text: t('polishEditor.startBtn'),
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        startBtn.onclick = () => this.runPolish();
        const cancelBtn = actions.createEl('button', { text: t('polishEditor.cancelBtn'), cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
    }

    private renderLoading(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: t('polishEditor.modalTitle') });
        contentEl.createEl('p', {
            text: t('polishEditor.progress', { scope: polishScopeLabel(this.polishScope), style: polishStyleLabel(this.style) }),
            cls: 'nw-pe-muted',
        });
        contentEl.createEl('p', {
            text: t('polishEditor.progressHint'),
            cls: 'nw-pe-hint',
        });
    }

    private async runPolish(): Promise<void> {
        this.renderLoading();

        const systemPrompt = '你是专业小说编辑，负责润色正文。保持原意不变，优化文笔。';
        const styleHint = POLISH_STYLE_HINTS[this.style];
        const isPartial = this.polishScope === '选中段落润色';
        const targetText = isPartial ? this.selectedText : this.fullText;

        let fingerprintStyleHint = '';
        if (this.applyFingerprint && this.projectPath) {
            try {
                fingerprintStyleHint = await this.loadFingerprintStyleHint();
            } catch (e) {
                log.warn('[PolishAIPolishModal] 加载指纹风格失败:', e);
            }
        }

        const userPrompt = `请润色以下${isPartial ? '选中的段落' : '小说正文'}。

风格要求：${this.style}（${styleHint}）
${fingerprintStyleHint}

原文：
---
${targetText}
---

要求：
1. 保持人称和时态一致
2. 不要添加新情节
3. 直接输出润色后的正文，不要添加任何解释、标注或前后缀`;

        try {
            const maxTokens = Math.min(
                8000,
                Math.max(2048, targetText.length * 2),
            );
            const resp = await this.plugin.aiEngine.callAI(
                systemPrompt,
                userPrompt,
                this.plugin.settings.proModel,
                0.7,
                maxTokens,
                { isWritingTask: true },
            );
            if (resp.error || !resp.content) {
                log.error('[小说工坊] AI润色失败:', resp.error);
                new Notice(t('polishEditor.noticePolishFailed', { msg: resp.error || t('polishEditor.returnEmpty') }));
                this.renderInputForm();
                return;
            }
            this.resultText = resp.content.trim();
            this.renderResult();
        } catch (e) {
            log.error('[小说工坊] AI润色调用异常:', e);
            new Notice(t('polishEditor.noticePolishException', { msg: e instanceof Error ? e.message : String(e) }));
            this.renderInputForm();
        }
    }

    private async loadFingerprintStyleHint(): Promise<string> {
        if (!this.projectPath) return '';

        try {
            const fingerprintLibrary = StyleFingerprintLibrary.get(this.app, this.projectPath);
            await fingerprintLibrary.loadGlobal();
            await fingerprintLibrary.loadProject();
            await fingerprintLibrary.loadGlobalState(this.projectPath);
            await fingerprintLibrary.loadIntensityConfigs();

            // 唯一真相源是指纹库的启用状态：`profile.fingerprint.enabledProject/enabledGlobal`
            // 在全仓没有写入方，只读它等于永远拿不到指纹（润色从未用过指纹）。
            // 强度 0（界面「完全禁用」）一并跳过，口径与协同/正文生成一致。
            const enabledFingerprints = (await fingerprintLibrary.getEnabledFingerprints())
                .filter(fp => !intensityEngine
                    .previewIntensity(fingerprintLibrary.getIntensityConfig(fp.id)).disabled);

            if (enabledFingerprints.length === 0) {
                return '';
            }

            const features: string[] = [];
            const featureLabels: Record<string, string> = {
                sentenceRhythm: '句式节奏',
                wordPreference: '用词偏好',
                narrativeStyle: '叙事风格',
                rhetoric: '修辞特点',
                dialogueStyle: '对话风格',
                paragraphStructure: '段落结构',
                overallTone: '整体基调',
            };

            const featureKeys: Array<keyof StyleFingerprint['features']> = [
                'sentenceRhythm', 'wordPreference', 'narrativeStyle',
                'rhetoric', 'dialogueStyle', 'paragraphStructure', 'overallTone'
            ];

            featureKeys.forEach(key => {
                const values = enabledFingerprints
                    .map(fp => fp.features[key])
                    .filter(v => v && v.trim().length > 0);
                
                if (values.length > 0) {
                    const uniqueValues = [...new Set(values)];
                    const valueStr = uniqueValues.slice(0, 2).join('；');
                    features.push(`- ${featureLabels[key]}：${valueStr}`);
                }
            });

            if (features.length === 0) {
                return '';
            }

            return `\n\n写作指纹风格参考（${enabledFingerprints.length}个启用指纹）：\n${features.join('\n')}\n\n请尽量贴合以上写作风格进行润色。`;
        } catch (e) {
            log.warn('[PolishAIPolishModal] 加载指纹风格失败:', e);
            return '';
        }
    }

    private renderResult(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: t('polishEditor.resultTitle') });

        const metaP = contentEl.createEl('p', {
            text: t('polishEditor.resultMeta', { scope: polishScopeLabel(this.polishScope), style: polishStyleLabel(this.style) }),
            cls: 'nw-pe-hint nw-pe-hint--below',
        });
        void metaP;

        // 对比预览（两列）
        const compare = contentEl.createDiv();
        compare.addClass('nw-compare-row');

        const origCol = compare.createDiv();
        origCol.addClass('nw-cols-280');
        origCol.createEl('h4', { text: t('polishEditor.colOriginal') });
        const origBox = origCol.createDiv();
        const origDisplay = this.polishScope === '选中段落润色' ? this.selectedText : this.fullText;
        origBox.setText(origDisplay);
        origBox.addClass('nw-preview-box', 'nw-preview-box-lg');

        const newCol = compare.createDiv();
        newCol.addClass('nw-cols-280');
        newCol.createEl('h4', { text: t('polishEditor.colPolished') });
        const newBox = newCol.createDiv();
        newBox.setText(this.resultText);
        newBox.addClass('nw-preview-box', 'nw-preview-box-lg', 'nw-preview-box-accent');

        // 操作按钮
        const actions = contentEl.createDiv();
        actions.addClass('nw-btn-row-end');
        const applyBtn = actions.createEl('button', {
            text: t('polishEditor.applyBtn'),
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        applyBtn.onclick = () => {
            this.applyResult();
            new Notice(t('polishEditor.noticeApplied'), 2000);
            this.close();
        };
        const retryBtn = actions.createEl('button', { text: t('polishEditor.retryBtn'), cls: 'nw-btn' });
        retryBtn.onclick = () => this.renderInputForm();
        const cancelBtn = actions.createEl('button', { text: t('polishEditor.cancelBtn'), cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
    }

    private applyResult(): void {
        let finalText: string;
        if (this.polishScope === '选中段落润色' && this.selectedText) {
            // 将选中段落替换为润色结果，保留全文其余部分
            finalText = this.fullText.replace(this.selectedText, this.resultText);
            if (finalText === this.fullText) {
                // 替换未命中（如选中文本在编辑器中被实体 span 包裹），回退为直接拼接
                log.warn('[小说工坊] 选中段落替换未命中，回退为追加润色结果');
                finalText = this.fullText + '\n\n' + this.resultText;
            }
        } else {
            finalText = this.resultText;
        }
        this.onApply(finalText);
    }
}
