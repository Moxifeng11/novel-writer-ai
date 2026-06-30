/**
 * 全屏写作视图运行时样式注入（从 FullWriterView.injectStyles 外迁）。
 *
 * 纯函数：仅依赖 document，向 <head> 注入一次兜底样式（带 id 去重）。
 */
export function injectFullWriterStyles(): void {
    const styleId = 'novel-writer-fw-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = ``;
    document.head.appendChild(style);
}
