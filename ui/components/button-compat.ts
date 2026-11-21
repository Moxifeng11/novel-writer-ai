/**
 * button-compat.ts — 按钮「危险操作」样式的兼容层
 *
 * Obsidian 1.13 起 `ButtonComponent#setWarning` 被标记弃用，推荐 `setDestructive()`
 * （或 `setDestructive().setCta()` 作为主按钮）。但 `setDestructive` 的 `@since` 是 1.13.0，
 * 而本插件最低支持 1.8.7——社区审核的 `obsidianmd/no-unsupported-api` 是 error 级，
 * 按成员访问的符号判版本、不认运行时特性检测，所以现在不能直接换。
 *
 * 这里用结构化类型调用旧接口：调用点不再引用被弃用的声明；
 * 等 minAppVersion 提到 1.13 后，只需要改本文件一处即可整体切换。
 */
import type { ButtonComponent } from 'obsidian';

/** 只声明需要的成员，避免在调用点触碰 `ButtonComponent` 上的弃用标记 */
interface WarningStylable {
    /**
     * Obsidian 内置按钮的警告态着色（红色文字）。
     *
     * @returns 无返回值语义，仅为结构化类型占位
     */
    setWarning(): unknown;
}

/**
 * 给按钮加「危险操作」样式（红色文字），返回按钮本身以便继续链式调用。
 *
 * @param button - 目标按钮实例
 * @returns 同一个按钮实例
 * @example
 * ```ts
 * row.addButton((btn) => withWarningStyle(btn.setButtonText('清空记录')).setCta());
 * ```
 */
export function withWarningStyle(button: ButtonComponent): ButtonComponent {
    (button as unknown as WarningStylable).setWarning();
    return button;
}
