/**
 * polish-editor.ts — 文笔润色编辑器 (v3.4.9 从 full-writer-view.ts 提取)
 *
 * 功能: 结算步骤内嵌的正文编辑界面
 * 实体用四色标记（不可编辑），正文可自由编辑，实时自动保存
 *
 * 提取自 full-writer-view.ts:
 *   - escapeHtml (L4068)
 *   - injectPolishEditorStyles (L4077)
 *   - buildEntityMarkedHtml (L4025)
 *   - extractPlainTextFromEditor (L4049)
 *   - renderPolishEditor (L3898) → PolishEditor.render()
 */

import { App, Modal, Notice } from 'obsidian';
import { StepRunner } from '@/engine/step-runner';
import { AdaptiveDebounceManager } from '@/shared/adaptive-debounce-manager';
import NovelWriterPlugin from '@/main';
import { RhythmAnalyzer } from '@/engine/rhythm-analyzer';
import { StyleLearner } from '@/engine/style-learner';
import type { RhythmAnalysis } from '@/shared/co-writer-types';
import { StyleFingerprintLibrary, StyleFingerprint } from '@/engine/style-fingerprint-library';
import { getStyleIntensityEngine } from '@/engine/style/style-intensity-engine';
import { createLogger } from '@/shared/logger';


const log = createLogger('PolishEditor');

/** 强度映射是纯函数，模块级共享一个实例即可 */
const intensityEngine = getStyleIntensityEngine();
// ============================================================
// 工具函数 (纯函数，无 this 依赖)
// ============================================================

/**
 * HTML 实体转义（防止 XSS 和标记污染）
 *
 * @param text - 文本内容
 * @returns 文本结果
 */
export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

/** 注入润色编辑器的实体颜色 CSS（幂等） */
export function injectPolishEditorStyles(): void {
    const styleId = 'nw-polish-editor-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .nw-entity-char { color: #e74c3c !important; background: rgba(231,76,60,0.1) !important; }
        .nw-entity-locs { color: #3498db !important; background: rgba(52,152,219,0.1) !important; }
        .nw-entity-factions { color: #2ecc71 !important; background: rgba(46,204,113,0.1) !important; }
        .nw-entity-items { color: #f39c12 !important; background: rgba(243,156,18,0.1) !important; }
        .nw-entity-tag[contenteditable="false"] { cursor: default !important; }
        .novel-writer-polish-editor:focus { outline: 2px solid var(--interactive-accent); }
        .novel-writer-polish-editor .nw-entity-tag:hover { outline: 2px dashed currentColor; }
    `;
    document.head.appendChild(style);
}

/**
 * 将正文文本转为带实体标记的 HTML
 *
 * @param bodyText - 正文文本
 * @param entityMap - 实体映射
 * @param typeLabels - 类型标签列表
 * @returns 文本结果
 */
export function buildEntityMarkedHtml(
    bodyText: string,
    entityMap: Map<string, { type: string; color: string }>,
    typeLabels: Record<string, string>,
): string {
    // 按长度降序排序，优先匹配长实体名（如"维克多·克劳利" 优先于 "维克多"）
    const sortedNames = [...entityMap.keys()].sort((a, b) => b.length - a.length);
    if (sortedNames.length === 0) return escapeHtml(bodyText);

    // 构建正则
    const escapedNames = sortedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(escapedNames.join('|'), 'g');

    return escapeHtml(bodyText).replace(pattern, (match) => {
        const info = entityMap.get(match);
        if (!info) return match;
        const typeLabel = typeLabels[info.type] || info.type;
        return `<span contenteditable="false" class="nw-entity-tag nw-entity-${info.type}" style="color:${info.color};font-weight:600;background:${info.color}18;padding:0 2px;border-radius:2px;cursor:default;user-select:all;" title="${typeLabel}: ${match}" data-entity-type="${info.type}" data-entity-name="${match}">${match}</span>`;
    });
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
        const bodyText = stepResults['bodyGeneration'];
        if (!bodyText || !project) {
            log.warn('[小说工坊] PolishEditor.render: 跳过 (bodyText=%s, project=%s)', !!bodyText, project || '(空)');
            return;
        }
        log.warn('[小说工坊] PolishEditor.render: project=%s bodyLen=%d', project, bodyText.length);

        // 注入实体颜色 CSS
        injectPolishEditorStyles();

        // 分割线
        area.createEl('hr', { cls: 'nw-u-m-16px-0-12px-0 nw-u-bordercolor-background-modifier-bo' });

        // 标题行 + 自动保存状态
        const headerRow = area.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-8px-2' });
        const titleSection = headerRow.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-fwr-wrap-2' });
        titleSection.createEl('h4', { text: '✏️ 文笔润色编辑器', cls: 'nw-u-m-0-2' });
        const aiPolishBtn = titleSection.createEl('button', {
            text: '✨ AI润色',
            cls: "nw-btn nw-u-fs-12px-2 nw-u-p-2px-10px",
            attr: {},
        });
        const rhythmBtn = titleSection.createEl('button', {
            text: '📊 节奏分析',
            cls: "nw-btn nw-u-fs-12px-2 nw-u-p-2px-10px",
            attr: {},
        });
        const styleBtn = titleSection.createEl('button', {
            text: '🎨 风格指南',
            cls: "nw-btn nw-u-fs-12px-2 nw-u-p-2px-10px",
            attr: {},
        });
        const statusSpan = headerRow.createSpan({ text: '💾 已保存', cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2' });

        // 实体颜色图例
        const legendRow = area.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-marginbottom-8px-2 nw-u-fs-11px-2 nw-u-fwr-wrap-2' });
        const legendItems: [string, string, string][] = [
            ['👤 人物', '#e74c3c', '人物'],
            ['📍 地点', '#3498db', '地点'],
            ['🏛️ 势力', '#2ecc71', '势力'],
            ['⚔️ 物品/功法', '#f39c12', '物品功法'],
        ];
        for (const [label, color, _] of legendItems) {
            const item = legendRow.createDiv({ attr: { style: `padding:2px 8px;border-radius:3px;background:${color}22;border:1px solid ${color}44;color:${color};` } });
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
            chars: '人物', factions: '势力', locs: '地点', items: '物品/功法',
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

        // 将正文转换为带实体标记的 HTML
        const markedHtml = buildEntityMarkedHtml(bodyText, entityMap, typeLabels);

        // 创建可编辑区域
        const editorWrapper = area.createDiv({ cls: 'novel-writer-polish-editor-wrapper' });
        const editorDiv = editorWrapper.createDiv({
            cls: 'novel-writer-polish-editor',
            attr: { contenteditable: 'true', style: 'min-height:300px;max-height:500px;overflow-y:auto;padding:12px;border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;line-height:1.8;white-space:pre-wrap;background:var(--background-primary);font-family:var(--font-text);' }
        }) as HTMLDivElement;
        editorDiv.innerHTML = markedHtml;

        // 自动保存：debounce 500ms
        const triggerAutoSave = () => {
            statusSpan.setText('⏳ 保存中...');
            this.debounceManager.debounceFixed('polish-save', async () => {
                try {
                    // 从 contenteditable 提取纯文本（去掉 HTML 标签 + 实体 span）
                    const plainText = extractPlainTextFromEditor(editorDiv, entityMap);
                    if (plainText.trim().length < 100) {
                        statusSpan.setText('⚠️ 内容太短，未保存');
                        return;
                    }
                    stepResults['bodyGeneration'] = plainText;
                    await this.stepRunner.writeFixToBody(plainText, chapDir, chapterName, volume);
                    statusSpan.setText('💾 已保存 ' + new Date().toLocaleTimeString());
                    // A7: 正文已实际改动 → 下游审查/分析/结算必须失效（落盘成功后再失效，失败不误伤）
                    onSaved?.();
                    log.warn('[小说工坊] 润色编辑器自动保存:', plainText.length, '字');
                } catch (e) {
                    statusSpan.setText('❌ 保存失败');
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
            const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
            // 只粘贴纯文本
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(text));
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
                        // 重建带实体标记的 HTML 并替换编辑器内容
                        const newMarkedHtml = buildEntityMarkedHtml(polishedText, entityMap, typeLabels);
                        editorDiv.innerHTML = newMarkedHtml;
                        triggerAutoSave();
                    },
                    // D6: 指纹风格必须跟随当前章节所属项目，不能由弹窗再猜 activeFile
                    project,
                ).open();
            } catch (e) {
                log.error('[小说工坊] AI润色按钮点击失败:', e);
                new Notice(`AI润色出错: ${e instanceof Error ? e.message : String(e)}`);
            }
        };

        // 📊 节奏分析按钮
        rhythmBtn.onclick = async () => {
            try {
                const fullText = extractPlainTextFromEditor(editorDiv, entityMap);
                if (!fullText || fullText.trim().length < 100) {
                    new Notice('正文内容太少，无法分析节奏（至少100字）');
                    return;
                }

                rhythmBtn.setText('⏳ 分析中...');
                rhythmBtn.disabled = true;

                const analyzer = new RhythmAnalyzer();
                const result = await analyzer.analyze(fullText);

                rhythmBtn.setText('📊 节奏分析');
                rhythmBtn.disabled = false;

                // 展示分析结果
                this.renderRhythmPanel(area, result, editorDiv);
            } catch (e) {
                rhythmBtn.setText('📊 节奏分析');
                rhythmBtn.disabled = false;
                log.error('[小说工坊] 节奏分析失败:', e);
                new Notice(`节奏分析出错: ${e instanceof Error ? e.message : String(e)}`);
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
                new Notice(`风格指南出错: ${e instanceof Error ? e.message : String(e)}`);
            }
        };
    }

    /** 渲染节奏分析面板 */
    private renderRhythmPanel(area: HTMLElement, result: RhythmAnalysis, editorDiv: HTMLDivElement): void {
        // 移除旧面板
        area.querySelectorAll('.nw-rhythm-panel').forEach(el => el.remove());

        const panel = area.createDiv({ cls: "nw-rhythm-panel nw-u-m-8px-0 nw-u-p-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-bg-background-secondary-2", attr: {} });

        // 标题行
        const header = panel.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-marginbottom-8px-2' });
        header.createEl('h5', { text: '📊 节奏分析结果', cls: 'nw-u-m-0-2 nw-u-fs-14px-2' });
        const closeBtn = header.createEl('button', { text: '✕', cls: "nw-btn nw-u-fs-11px-2 nw-u-p-1px-6px-2", attr: {} });
        closeBtn.onclick = () => panel.remove();

        // 整体节奏
        const paceLabels: Record<string, string> = { fast: '⚡ 偏快', medium: '⚖️ 均衡', slow: '🐌 偏慢', balanced: '⚖️ 均衡' };
        const overviewRow = panel.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-12px-2 nw-u-marginbottom-8px-2 nw-u-fs-12px-2 nw-u-fwr-wrap-2' });
        overviewRow.createSpan({ text: `整体节奏: ${paceLabels[result.overallPace] || result.overallPace}` });
        overviewRow.createSpan({ text: `段落数: ${result.segments.length}` });
        overviewRow.createSpan({ text: `拖沓段: ${result.slowSegments.length}`, attr: { style: result.slowSegments.length > 0 ? 'color:var(--text-warning);' : '' } });
        overviewRow.createSpan({ text: `紧张段: ${result.fastSegments.length}`, attr: { style: result.fastSegments.length > 0 ? 'color:var(--text-success);' : '' } });

        // 建议
        if (result.suggestions.length > 0) {
            const sugSection = panel.createDiv({ cls: 'nw-u-marginbottom-8px-2' });
            sugSection.createEl('div', { text: '💡 优化建议', cls: 'nw-u-fs-12px-2 nw-u-fwt-600-2 nw-u-marginbottom-4px-2' });
            for (const sug of result.suggestions) {
                sugSection.createEl('div', { text: `• ${sug}`, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-m-2px-0' });
            }
        }

        // 段落详情
        if (result.segments.length > 0) {
            const detailSection = panel.createDiv({ cls: 'nw-u-maxh-200px-2 nw-u-ovy-auto-2' });
            detailSection.createEl('div', { text: '段落详情', cls: 'nw-u-fs-12px-2 nw-u-fwt-600-2 nw-u-marginbottom-4px-2' });

            const typeLabels: Record<string, string> = { action: '⚔️动作', dialogue: '💬对话', description: '📝描写', introspection: '💭内心' };
            const paceIcon: Record<string, string> = { fast: '⚡', medium: '➡️', slow: '🐌' };

            for (let i = 0; i < result.segments.length; i++) {
                const seg = result.segments[i];
                const hasIssue = seg.issues.length > 0;
                const row = detailSection.createDiv({
                    attr: {
                        style: `display:flex;gap:8px;font-size:11px;padding:3px 6px;margin:2px 0;border-radius:3px;${hasIssue ? 'background:rgba(245,158,11,0.1);' : ''}`,
                        title: seg.issues.join('；'),
                    }
                });
                row.createSpan({ text: `${paceIcon[seg.pace] || '➡️'}`, cls: 'nw-u-minw-16px' });
                row.createSpan({ text: `${typeLabels[seg.type] || seg.type}`, cls: 'nw-u-minw-60px nw-u-c-text-muted-2' });
                row.createSpan({ text: `密度${seg.density}`, attr: { style: `min-width:50px;${seg.density < 30 ? 'color:var(--text-warning);' : seg.density > 85 ? 'color:var(--text-error);' : ''}` } });
                row.createSpan({ text: `紧张${seg.tensionLevel}`, attr: { style: `min-width:50px;${seg.tensionLevel > 80 ? 'color:var(--text-success);' : ''}` } });
                if (hasIssue) {
                    row.createSpan({ text: `⚠️ ${seg.issues[0]}`, cls: 'nw-u-c-text-warning nw-u-flex-1-2' });
                }
            }
        }
    }

    /** 渲染风格指南面板 */
    private renderStylePanel(area: HTMLElement, guide: string): void {
        // 移除旧面板
        area.querySelectorAll('.nw-style-panel').forEach(el => el.remove());

        const panel = area.createDiv({ cls: "nw-style-panel nw-u-m-8px-0 nw-u-p-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-bg-background-secondary-2", attr: {} });

        // 标题行
        const header = panel.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-marginbottom-8px-2' });
        header.createEl('h5', { text: '🎨 作者风格指南', cls: 'nw-u-m-0-2 nw-u-fs-14px-2' });
        const closeBtn = header.createEl('button', { text: '✕', cls: "nw-btn nw-u-fs-11px-2 nw-u-p-1px-6px-2", attr: {} });
        closeBtn.onclick = () => panel.remove();

        if (!guide || guide.trim().length === 0) {
            panel.createEl('p', {
                text: 'ℹ️ 暂无风格学习数据。随着写作积累，系统会自动学习您的风格偏好并在此展示。',
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-m-0-2'
            });
            return;
        }

        // 解析并展示风格指南
        const lines = guide.split('\n');
        const contentDiv = panel.createDiv({ cls: 'nw-u-fs-12px-2 nw-u-lh-1-6-2' });

        for (const line of lines) {
            if (line.startsWith('【')) {
                contentDiv.createEl('div', { text: line, cls: 'nw-u-fwt-600-2 nw-u-m-8px-0-4px-0 nw-u-c-text-accent' });
            } else if (line.startsWith('偏好风格：')) {
                contentDiv.createEl('div', { text: '✅ 偏好风格', cls: 'nw-u-fwt-600-2 nw-u-m-6px-0-2px-0 nw-u-c-text-success' });
            } else if (line.startsWith('避免风格：')) {
                contentDiv.createEl('div', { text: '❌ 避免风格', cls: 'nw-u-fwt-600-2 nw-u-m-6px-0-2px-0 nw-u-c-text-error' });
            } else if (line.startsWith('- ')) {
                contentDiv.createEl('div', { text: line, cls: 'nw-u-m-1px-0-1px-8px nw-u-c-text-muted-2' });
            } else if (line.trim()) {
                contentDiv.createEl('div', { text: line, cls: 'nw-u-m-2px-0' });
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

/**
 * PolishAIPolishModal 类。
 */
export class PolishAIPolishModal extends Modal {
    private plugin: NovelWriterPlugin;
    private fullText: string;
    private selection: string;
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
        selection: string,
        onApply: (polishedText: string) => void,
        // D6: 项目由调用方显式传入（当前章节所属项目）。协同/工作台视图没有 activeFile，
        // 在这里回落到 getActiveProject() 会把别的书的指纹套到本章正文上。
        projectPath: string,
    ) {
        super(app);
        this.plugin = plugin;
        this.fullText = fullText;
        this.selection = selection;
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
        contentEl.createEl('h2', { text: '✨ AI 润色' });

        // 润色范围
        const scopeSection = contentEl.createDiv();
        scopeSection.style.cssText = 'margin-top:12px;';
        scopeSection.createEl('h4', { text: '润色范围' });
        const scopeBtns = scopeSection.createDiv();
        scopeBtns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
        const scopeOptions: PolishScope[] = ['全文润色', '选中段落润色'];
        for (const s of scopeOptions) {
            const btn = scopeBtns.createEl('button', { text: s, cls: 'nw-btn' });
            if (s === this.polishScope) btn.addClass('is-active');
            btn.onclick = () => {
                if (s === '选中段落润色' && (!this.selection || this.selection.trim().length === 0)) {
                    new Notice('请先在编辑器中选中段落');
                    return;
                }
                this.polishScope = s;
                scopeBtns.querySelectorAll('button').forEach(b => b.removeClass('is-active'));
                btn.addClass('is-active');
            };
        }
        if (!this.selection || this.selection.trim().length === 0) {
            const hint = scopeSection.createEl('p', {
                text: 'ℹ️ 当前未检测到选中文本，「选中段落润色」需先在编辑器中选中文本。',
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-m-6px-0-0-0',
            });
            void hint;
        }

        // 润色风格
        const styleSection = contentEl.createDiv();
        styleSection.style.cssText = 'margin-top:16px;';
        styleSection.createEl('h4', { text: '润色风格' });
        const styleBtns = styleSection.createDiv();
        styleBtns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
        const styleOptions: PolishStyle[] = ['精简凝练', '细节丰富', '情感强化', '节奏优化'];
        for (const s of styleOptions) {
            const btn = styleBtns.createEl('button', { text: s, cls: 'nw-btn' });
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
            fingerprintSection.style.cssText = 'margin-top:16px;';
            fingerprintSection.createEl('h4', { text: '写作指纹' });
            const fingerprintDesc = fingerprintSection.createEl('p', {
                text: '应用项目启用的写作指纹风格，让润色结果更贴合你的写作习惯',
                cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-m-4px-0-8px-0'
            });
            void fingerprintDesc;
            
            const fingerprintToggle = fingerprintSection.createDiv();
            fingerprintToggle.style.cssText = 'display:flex;align-items:center;gap:8px;';
            const checkbox = fingerprintToggle.createEl('input', {
                type: 'checkbox',
                cls: 'nw-u-cur-pointer-2'
            });
            checkbox.checked = this.applyFingerprint;
            checkbox.addEventListener('change', () => {
                this.applyFingerprint = checkbox.checked;
            });
            fingerprintToggle.createEl('span', {
                text: '应用写作指纹风格',
                cls: 'nw-u-fs-13px-2 nw-u-cur-pointer-2'
            }).addEventListener('click', () => {
                checkbox.checked = !checkbox.checked;
                this.applyFingerprint = checkbox.checked;
            });
        }

        // 操作按钮
        const actions = contentEl.createDiv();
        actions.style.cssText = 'display:flex;gap:8px;margin-top:20px;justify-content:flex-end;';
        const startBtn = actions.createEl('button', {
            text: '开始润色',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        startBtn.onclick = () => this.runPolish();
        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
    }

    private renderLoading(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '✨ AI 润色' });
        contentEl.createEl('p', {
            text: `⏳ 正在调用 AI 润色（${this.polishScope} · ${this.style}），请稍候...`,
            cls: 'nw-u-c-text-muted-2',
        });
        contentEl.createEl('p', {
            text: '润色过程中请勿关闭窗口',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2',
        });
    }

    private async runPolish(): Promise<void> {
        this.renderLoading();

        const systemPrompt = '你是专业小说编辑，负责润色正文。保持原意不变，优化文笔。';
        const styleHint = POLISH_STYLE_HINTS[this.style];
        const isPartial = this.polishScope === '选中段落润色';
        const targetText = isPartial ? this.selection : this.fullText;

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
                new Notice(`润色失败: ${resp.error || '返回为空'}`);
                this.renderInputForm();
                return;
            }
            this.resultText = resp.content.trim();
            this.renderResult();
        } catch (e) {
            log.error('[小说工坊] AI润色调用异常:', e);
            new Notice(`润色出错: ${e instanceof Error ? e.message : String(e)}`);
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
        contentEl.createEl('h2', { text: '✨ AI 润色结果' });

        const metaP = contentEl.createEl('p', {
            text: `范围：${this.polishScope} · 风格：${this.style}`,
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-m-0-0-12px-0-2',
        });
        void metaP;

        // 对比预览（两列）
        const compare = contentEl.createDiv();
        compare.style.cssText = 'display:flex;gap:12px;align-items:stretch;flex-wrap:wrap;';

        const origCol = compare.createDiv();
        origCol.style.cssText = 'flex:1 1 280px;min-width:280px;';
        origCol.createEl('h4', { text: '原文' });
        const origBox = origCol.createEl('div');
        const origDisplay = this.polishScope === '选中段落润色' ? this.selection : this.fullText;
        origBox.setText(origDisplay);
        origBox.style.cssText =
            'border:1px solid var(--background-modifier-border);border-radius:6px;' +
            'padding:10px 12px;max-height:320px;overflow:auto;white-space:pre-wrap;' +
            'word-break:break-word;background:var(--background-secondary);font-size:13px;line-height:1.6;';

        const newCol = compare.createDiv();
        newCol.style.cssText = 'flex:1 1 280px;min-width:280px;';
        newCol.createEl('h4', { text: '润色后' });
        const newBox = newCol.createEl('div');
        newBox.setText(this.resultText);
        newBox.style.cssText =
            'border:1px solid var(--interactive-accent);border-radius:6px;' +
            'padding:10px 12px;max-height:320px;overflow:auto;white-space:pre-wrap;' +
            'word-break:break-word;background:var(--background-secondary);font-size:13px;line-height:1.6;';

        // 操作按钮
        const actions = contentEl.createDiv();
        actions.style.cssText = 'display:flex;gap:8px;margin-top:20px;justify-content:flex-end;flex-wrap:wrap;';
        const applyBtn = actions.createEl('button', {
            text: '✅ 应用润色',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        applyBtn.onclick = () => {
            this.applyResult();
            new Notice('✅ 已应用润色结果', 2000);
            this.close();
        };
        const retryBtn = actions.createEl('button', { text: '🔄 重新润色', cls: 'nw-btn' });
        retryBtn.onclick = () => this.renderInputForm();
        const cancelBtn = actions.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancelBtn.onclick = () => this.close();
    }

    private applyResult(): void {
        let finalText: string;
        if (this.polishScope === '选中段落润色' && this.selection) {
            // 将选中段落替换为润色结果，保留全文其余部分
            finalText = this.fullText.replace(this.selection, this.resultText);
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
