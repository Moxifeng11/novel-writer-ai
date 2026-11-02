/**
 * 分区标题按钮结构定义。
 */
export interface SectionHeaderButton {
    text: string;
    onClick: () => void;
}

/**
 * v6.0: 渲染可折叠的设置区块
 * 迷你设置和完整设置页共用，保证 CSS 样式和交互一致
 * @param containerEl - 容器元素
 * @param title - 标题
 * @param defaultOpen - 默认展开
 * @param render - 渲染函数
 * @param headerButtons - 标题按钮
 */
export function renderCollapsibleSection(
    containerEl: HTMLElement,
    title: string,
    defaultOpen: boolean,
    render: (section: HTMLElement) => void,
    headerButtons?: SectionHeaderButton[]
): void {
    const wrapper = containerEl.createDiv({ cls: 'nw-settings-section' });
    const header = wrapper.createDiv({
        cls: 'nw-settings-section-header',
    });
    const leftPart = header.createDiv({ cls: 'nw-settings-section-header-left' });
    const arrowEl = leftPart.createEl('span', {
        cls: 'nw-settings-section-arrow',
        text: defaultOpen ? '▼' : '▶',
    });
    leftPart.createEl('h3', { cls: 'nw-settings-section-title', text: title });

    const rightPart = header.createDiv({ cls: 'nw-settings-section-header-right' });
    if (headerButtons) {
        headerButtons.forEach(btn => {
            const button = rightPart.createEl('button', {
                cls: 'nw-settings-section-btn',
                text: btn.text,
                attr: { type: 'button' }
            });
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                btn.onClick();
            });
        });
    }

    const content = wrapper.createDiv({
        cls: 'nw-settings-section-content',
        attr: { style: `display:${defaultOpen ? 'block' : 'none'};` }
    });

    header.addEventListener('click', () => {
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        arrowEl.textContent = isOpen ? '▶' : '▼';
    });

    render(content);
}
