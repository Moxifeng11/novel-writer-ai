/**
 * 步骤模态框运行时样式注入（从 step-modal-controller.ts 外迁）。
 *
 * 纯函数：仅依赖 document，向 <head> 注入一次兜底样式（带 id 去重）。
 * 从 engine 层外迁到 ui 层，消除 engine 层直接操作 DOM 的层间违规。
 */

export function injectDeaiModalStyles(): void {
    const styleId = 'novel-writer-fw-deai-modal-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.novel-writer-fw-step-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    z-index: 1000; display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
}
.novel-writer-fw-step-overlay-backdrop {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.35); z-index: 0;
}
.novel-writer-fw-step-overlay-panel {
    position: relative; z-index: 1;
    width: 62%; max-width: 680px; max-height: 72vh; overflow-y: auto;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.25);
    padding: 18px 22px;
}
.novel-writer-fw-step-overlay-panel h3 { padding-right: 36px; }
.novel-writer-fw-deai-container { padding: 12px; max-height: 70vh; overflow-y: auto; }
.novel-writer-fw-deai-report { margin-bottom: 16px; }
.novel-writer-fw-deai-report h4 { margin: 0 0 6px 0; font-size: 14px; }
.novel-writer-fw-deai-text { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px; font-size: 12px; max-height: 200px; overflow-y: auto; white-space: pre-wrap; }
.novel-writer-fw-deai-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.novel-writer-fw-deai-col { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden; }
.novel-writer-fw-deai-col h4 { margin: 0; padding: 8px 10px; font-size: 13px; background: var(--background-secondary-alt); border-bottom: 1px solid var(--background-modifier-border); }
.novel-writer-fw-deai-col-text { padding: 10px; font-size: 12px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; line-height: 1.6; }
.novel-writer-fw-deai-btn-row { display: flex; gap: 10px; justify-content: flex-end; }
`;
    document.head.appendChild(style);
}

export function injectRefineModalStyles(): void {
    const styleId = 'novel-writer-fw-refine-modal-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.novel-writer-fw-refine-container { padding: 12px; }
.novel-writer-fw-refine-summary { margin-bottom: 16px; }
.novel-writer-fw-refine-summary p { margin: 0 0 8px 0; font-size: 14px; font-weight: 500; }
.novel-writer-fw-refine-diff-list { list-style: none; padding: 0; margin: 0; }
.novel-writer-fw-refine-diff-list li { padding: 4px 0; font-size: 13px; color: var(--text-secondary); border-bottom: 1px solid var(--background-modifier-border-hover); }
.novel-writer-fw-refine-btn-row { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
`;
    document.head.appendChild(style);
}

export function injectRoundSelectStyles(): void {
    const styleId = 'novel-writer-fw-round-select-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.novel-writer-fw-round-select { padding: 12px; max-height: 65vh; overflow-y: auto; }
.novel-writer-fw-round-select > p { margin: 0 0 10px 0; font-size: 13px; color: var(--text-muted); }
.novel-writer-fw-round-card { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.novel-writer-fw-round-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.novel-writer-fw-round-label { font-weight: 600; font-size: 13px; }
.novel-writer-fw-round-diff { font-size: 11px; color: var(--text-muted); }
.novel-writer-fw-round-preview { font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; max-height: 120px; overflow-y: auto; margin-bottom: 8px; padding: 6px 8px; background: var(--background-primary); border-radius: 4px; }
`;
    document.head.appendChild(style);
}
