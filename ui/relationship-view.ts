/**
 * Relationship View — V2 关系状态可视化
 * 
 * 在章节结算面板或工作台中渲染角色间关系数值的简易视图。
 * 以 HTML 表格形式显示 trust/attraction/fear/resentment/dependence。
 */

import { App, ItemView, WorkspaceLeaf } from 'obsidian';
import { CharacterPairRelation, loadRelationshipStates } from '../engine/relationship-engine';

export const RELATIONSHIP_VIEW_TYPE = 'novel-writer-relationship-view';

/**
 * 渲染关系状态为 HTML 表格
 */
export function renderRelationshipTable(
    relations: CharacterPairRelation[],
    container: HTMLElement,
): void {
    if (relations.length === 0) {
        container.createEl('p', { text: '暂无关系数据。完成章节结算后自动生成。', cls: 'novel-writer-muted' });
        return;
    }

    const table = container.createEl('table', { cls: 'novel-writer-relation-table' });

    // 表头
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    ['角色对', '信任', '吸引', '恐惧', '怨恨', '依赖', '状态'].forEach(h => {
        headerRow.createEl('th', { text: h });
    });

    // 表格体
    const tbody = table.createEl('tbody');
    for (const rel of relations) {
        const row = tbody.createEl('tr');
        row.createEl('td', { text: `${rel.charA} ↔ ${rel.charB}`, cls: 'novel-writer-relation-pair' });
        row.createEl('td', { text: String(rel.state.trust), cls: getValueClass(rel.state.trust) });
        row.createEl('td', { text: String(rel.state.attraction), cls: getValueClass(rel.state.attraction) });
        row.createEl('td', { text: String(rel.state.fear), cls: getValueClass(rel.state.fear, true) });
        row.createEl('td', { text: String(rel.state.resentment), cls: getValueClass(rel.state.resentment, true) });
        row.createEl('td', { text: String(rel.state.dependence), cls: getValueClass(rel.state.dependence) });
        row.createEl('td', { text: rel.state.status, cls: 'novel-writer-relation-status' });

        // 点击展开历史
        if (rel.state.history.trim()) {
            row.setAttr('title', rel.state.history.trim());
            row.style.cursor = 'pointer';
        }
    }
}

/**
 * 根据数值返回 CSS 类名（高=绿，低=红，中=灰）
 */
function getValueClass(value: number, invert: boolean = false): string {
    if (invert) {
        // 恐惧/怨恨 越高越红
        if (value >= 70) return 'novel-writer-relation-high-bad';
        if (value <= 30) return 'novel-writer-relation-low-good';
    } else {
        // 信任/吸引/依赖 越高越绿
        if (value >= 70) return 'novel-writer-relation-high-good';
        if (value <= 30) return 'novel-writer-relation-low-bad';
    }
    return 'novel-writer-relation-mid';
}

/**
 * Obsidian 关系视图（注册为右侧面板）
 */
export class RelationshipView extends ItemView {
    public project: string = '';

    // 不再以参数属性声明 app：ItemView 已提供 public app，重复声明为 private 会与基类冲突。
    constructor(leaf: WorkspaceLeaf, _app?: App) {
        super(leaf);
    }

    getViewType(): string { return RELATIONSHIP_VIEW_TYPE; }
    getDisplayText(): string { return '角色关系'; }
    getIcon(): string { return 'heart'; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] || this.containerEl;
        container.empty();
        container.createEl('h4', { text: '💞 角色关系状态' });

        if (!this.project) {
            container.createEl('p', { text: '请先在小说工坊工作台中选择项目。' });
            return;
        }

        const contentArea = container.createDiv({ cls: 'novel-writer-relation-content' });
        const relations = await loadRelationshipStates(this.app, this.project);
        renderRelationshipTable(relations, contentArea);
    }

    async onClose(): Promise<void> { /* noop */ }
}
