/**
 * notice-helpers.ts — 统一用户提示（Notice）助手
 *
 * 目标：收敛审计 P2「Notice 文案格式不统一」——散落各处的
 * `new Notice('❌/⚠️/✅ 标题：详情')` 改走三类结构化助手，统一渲染为：
 * 加粗标题行（emoji + 标题）→ message 换行 → 可选 detail 灰色小字。
 * 渲染利用 Obsidian Notice 支持 DocumentFragment 的能力（new Notice(fragment, timeout)）。
 *
 * 环境降级：单元测试环境可能没有完整 DOM（document 垫片只提供 createElement），
 * 此时自动退回纯文本 Notice（多行以 \n 连接），保证「提示一定可见、绝不抛错」。
 * 本文件内部不写 console。
 */
import { Notice } from 'obsidian';

/** 错误提示的默认标题 */
const ERROR_DEFAULT_TITLE = '操作失败';
/** 成功提示的默认标题 */
const SUCCESS_DEFAULT_TITLE = '完成';
/** 告警提示的默认标题 */
const WARNING_DEFAULT_TITLE = '注意';

/**
 * 构造结构化提示内容：加粗标题行 + message 行 + 可选灰色小字 detail 行。
 *
 * 样式走既有工具类（`.nw-u-fwt-600` 加粗、`.nw-text-12-muted` 灰色小字），
 * 不做内联样式赋值。宿主缺少 DOM 能力（如测试垫片）时返回 null，
 * 由调用方退回纯文本 Notice。
 *
 * @param emoji - 类别 emoji（❌ / ✅ / ⚠️）
 * @param title - 标题文本（不含 emoji）
 * @param message - 主文案
 * @param detail - 可选补充说明
 * @returns 提示内容片段；DOM 能力不足时返回 null
 */
function buildNoticeFragment(
    emoji: string,
    title: string,
    message: string,
    detail?: string,
): DocumentFragment | null {
    if (typeof document === 'undefined') return null;
    if (typeof document.createDocumentFragment !== 'function') return null;
    if (typeof document.createElement !== 'function') return null;
    try {
        const fragment = document.createDocumentFragment();
        const titleEl = document.createElement('div');
        titleEl.className = 'nw-u-fwt-600';
        titleEl.textContent = `${emoji} ${title}`;
        fragment.appendChild(titleEl);

        const messageEl = document.createElement('div');
        messageEl.textContent = message;
        fragment.appendChild(messageEl);

        if (detail) {
            const detailEl = document.createElement('div');
            detailEl.className = 'nw-text-12-muted';
            detailEl.textContent = detail;
            fragment.appendChild(detailEl);
        }
        return fragment;
    } catch {
        // DOM 垫片行为异常时退回纯文本，保证提示不中断主流程
        return null;
    }
}

/**
 * 三类助手共用的渲染入口。
 *
 * @param emoji - 类别 emoji
 * @param defaultTitle - 未显式传 title 时使用的默认标题
 * @param message - 主文案
 * @param options - title / detail / timeout
 */
function showStructuredNotice(
    emoji: string,
    defaultTitle: string,
    message: string,
    options?: { title?: string; detail?: string; timeout?: number },
): void {
    const title = options?.title ?? defaultTitle;
    const fragment = buildNoticeFragment(emoji, title, message, options?.detail);
    if (fragment) {
        new Notice(fragment, options?.timeout);
        return;
    }
    const lines = [`${emoji} ${title}`, message];
    if (options?.detail) lines.push(options.detail);
    new Notice(lines.join('\n'), options?.timeout);
}

/**
 * 显示错误提示（❌）。
 *
 * 渲染结构：加粗标题行「❌ 标题」（缺省「操作失败」）→ message 换行显示 →
 * 可选 detail 再换行以灰色小字展示。timeout 缺省走 Obsidian Notice 默认时长。
 * message 原样展示，调用方不要再拼 emoji 前缀。
 *
 * @param message - 主文案（必填）
 * @param options - title 加粗标题（不含 emoji）；detail 灰色小字补充说明；timeout 展示时长（毫秒），0 表示常驻
 * @example
 * ```ts
 * showErrorNotice(final.error || '未知错误', { title: '导出失败', timeout: 8000 });
 * showErrorNotice(e instanceof Error ? e.message : String(e), { title: '保存失败', timeout: 6000 });
 * ```
 */
export function showErrorNotice(
    message: string,
    options?: { title?: string; detail?: string; timeout?: number },
): void {
    showStructuredNotice('❌', ERROR_DEFAULT_TITLE, message, options);
}

/**
 * 显示成功提示（✅）。
 *
 * 渲染结构：加粗标题行「✅ 标题」（缺省「完成」）→ message 换行显示。
 * timeout 缺省走 Obsidian Notice 默认时长。
 *
 * @param message - 主文案（必填）
 * @param options - title 加粗标题（不含 emoji）；timeout 展示时长（毫秒），0 表示常驻
 * @example
 * ```ts
 * showSuccessNotice('已保存', { timeout: 3000 });
 * showSuccessNotice(`更新${totalUpdated}项，新建${totalCreated}项`, { title: '结算完成', timeout: 8000 });
 * ```
 */
export function showSuccessNotice(
    message: string,
    options?: { title?: string; timeout?: number },
): void {
    showStructuredNotice('✅', SUCCESS_DEFAULT_TITLE, message, options);
}

/**
 * 显示告警提示（⚠️）。
 *
 * 渲染结构：加粗标题行「⚠️ 标题」（缺省「注意」）→ message 换行显示。
 * timeout 缺省走 Obsidian Notice 默认时长。
 *
 * @param message - 主文案（必填）
 * @param options - title 加粗标题（不含 emoji）；timeout 展示时长（毫秒），0 表示常驻
 * @example
 * ```ts
 * showWarningNotice('未找到项目封面（封面/cover.png 等），已生成无封面 EPUB', { timeout: 4000 });
 * showWarningNotice(`失败 ${failures.length} 项。详见弹窗清单`, { title: '建章完成但存在问题', timeout: 12000 });
 * ```
 */
export function showWarningNotice(
    message: string,
    options?: { title?: string; timeout?: number },
): void {
    showStructuredNotice('⚠️', WARNING_DEFAULT_TITLE, message, options);
}
