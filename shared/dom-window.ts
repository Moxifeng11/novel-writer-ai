/**
 * dom-window.ts — 跨窗口（popout）安全的 document 级监听
 *
 * Obsidian 允许把标签页（ItemView）与 Modal 放进第二窗口；此时全局 `document`
 * 仍指向主窗口，绑定在上面的 pointermove/mousedown/click 收不到 popout 内的事件，
 * 表现为「浮窗拖不动 / 点击外部不收下拉」。
 *
 * 统一从宿主元素解析所属文档：Obsidian 给 Node 注入了 `doc`（= 所属文档，元素被
 * 移动到新窗口后会跟着更新），拿不到时回退标准 `ownerDocument`。绑定与解绑都走
 * 同一个 Document，避免 add/remove 落在不同文档造成泄漏。
 */

/** 可解析所属文档的宿主元素形状（`doc` 是 Obsidian 对 Node 的运行时增强） */
export interface DocAnchor {
    /** Obsidian 注入：节点当前所属 document */
    doc?: Document;
    /** 标准 DOM：节点所属 document（未插入文档时为 null） */
    ownerDocument?: Document | null;
}

/**
 * resolveNodeDoc：解析宿主元素当前所属的 document。
 *
 * @param anchor - 宿主元素（或任何带 doc / ownerDocument 的节点状对象）
 * @returns 所属 document；两者都取不到时返回 null
 */
export function resolveNodeDoc(anchor: DocAnchor | null | undefined): Document | null {
    if (!anchor) return null;
    return anchor.doc ?? anchor.ownerDocument ?? null;
}

/**
 * onNodeDoc：在宿主元素所属的 document 上绑定监听，返回解绑函数。
 *
 * 返回的 disposer 用**同一个** document 解绑，因此可以在 `onClose` / `destroy`
 * 里安全调用；宿主不在任何文档中（测试替身/游离节点）时返回 noop。
 *
 * @param anchor - 宿主元素（决定绑定到哪个窗口的文档）
 * @param type - 事件名（如 click / mousedown / pointermove）
 * @param handler - 事件处理函数
 * @param options - 透传给 addEventListener 的选项
 * @returns 解绑函数
 *
 * @example
 * ```ts
 * const dispose = onNodeDoc(this.containerEl, 'pointermove', (ev) => this.drag(ev));
 * // onClose / destroy 中：
 * dispose();
 * ```
 */
export function onNodeDoc<K extends keyof DocumentEventMap>(
    anchor: DocAnchor | null | undefined,
    type: K,
    handler: (ev: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
): () => void {
    const doc = resolveNodeDoc(anchor);
    if (!doc) return () => undefined;
    doc.addEventListener(type, handler as EventListener, options);
    return () => doc.removeEventListener(type, handler as EventListener, options);
}
