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

import { StepRunner } from '../engine/step-runner';
import { AdaptiveDebounceManager } from '../shared/adaptive-debounce-manager';

// ============================================================
// 工具函数 (纯函数，无 this 依赖)
// ============================================================

/** HTML 实体转义（防止 XSS 和标记污染） */
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

/** 将正文文本转为带实体标记的 HTML */
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

/** 从 contenteditable div 提取纯文本（剥离实体 span 的 HTML 包裹） */
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

export class PolishEditor {
    private stepRunner: StepRunner;
    private debounceManager = new AdaptiveDebounceManager({ debug: false });

    constructor(stepRunner: StepRunner) {
        this.stepRunner = stepRunner;
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
     */
    async render(
        area: HTMLElement,
        stepResults: Record<string, string>,
        project: string,
        chapDir: string,
        chapterName: string,
        volume: string,
    ): Promise<void> {
        const bodyText = stepResults['bodyGeneration'];
        if (!bodyText || !project) {
            console.warn('[小说工坊] PolishEditor.render: 跳过 (bodyText=%s, project=%s)', !!bodyText, project || '(空)');
            return;
        }
        console.warn('[小说工坊] PolishEditor.render: project=%s bodyLen=%d', project, bodyText.length);

        // 注入实体颜色 CSS
        injectPolishEditorStyles();

        // 分割线
        area.createEl('hr', { attr: { style: 'margin:16px 0 12px 0;border-color:var(--background-modifier-border);' } });

        // 标题行 + 自动保存状态
        const headerRow = area.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' } });
        headerRow.createEl('h4', { text: '✏️ 文笔润色编辑器', attr: { style: 'margin:0;' } });
        const statusSpan = headerRow.createSpan({ text: '💾 已保存', attr: { style: 'font-size:11px;color:var(--text-muted);' } });

        // 实体颜色图例
        const legendRow = area.createDiv({ attr: { style: 'display:flex;gap:12px;margin-bottom:8px;font-size:11px;flex-wrap:wrap;' } });
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
            console.warn('[小说工坊] 获取实体名称失败:', e);
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

        console.warn('[小说工坊] PolishEditor.render: entityMap size=%d chars=%d locs=%d factions=%d items=%d bodyPreview=%s',
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
                    console.warn('[小说工坊] 润色编辑器自动保存:', plainText.length, '字');
                } catch (e) {
                    statusSpan.setText('❌ 保存失败');
                    console.error('[小说工坊] 润色编辑器保存失败:', e);
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
    }
}
