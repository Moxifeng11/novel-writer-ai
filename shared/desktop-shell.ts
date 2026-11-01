/**
 * desktop-shell.ts — 桌面端系统命令的窄接口
 *
 * 目的：把「设置文件只读」这类必须调用系统命令的能力，从 UI 代码里收口成一个
 * 受控接口；不让任意 UI 模块直接 `require('child_process')` 或拼接 shell 字符串。
 *
 * 约束：
 * - 只暴露 setPathReadOnly 一个动作，不提供通用命令执行面；
 * - `node:child_process` 只在函数内动态 import，移动端/默认路径不会加载；
 * - 使用 execFile（参数数组），不经过 shell，避免路径拼进命令串。
 *
 * 隔离门禁：`scripts/check-dsh-isolation.mjs` 把本文件与 `engine/agent/dsh/**`
 * 列为 child_process 的显式例外；新增例外必须在脚本里写明理由。
 *
 * 使用方式：
 * ```ts
 * const result = await setPathReadOnly('/vault/元文件');
 * if (!result.ok) new Notice(result.manualHint);
 * ```
 */

/** 桌面端系统命令的返回结构：失败不抛出，统一用 ok/error/manualHint 表达。 */
export interface DesktopCommandResult {
    ok: boolean;
    /** 失败原因（已脱敏，只有命令名与退出信息） */
    error?: string;
    /** 失败时给用户的手动操作提示 */
    manualHint: string;
}

/**
 * 只读保护失败时的手动操作提示（按平台）。
 *
 * @param platform - Node 平台字符串；默认取当前进程
 * @returns 面向用户的单行操作提示
 */
export function readOnlyManualHint(platform: string = process.platform): string {
    return platform === 'win32'
        ? '右键「元文件」→ 属性 → 勾选「只读」→ 应用到所有子文件'
        : '在终端执行：chmod -R a-w "元文件"';
}

/**
 * 把目录（含子文件）设为只读。
 *
 * @param targetPath - 目录的绝对路径；调用方负责确认它位于 vault 内
 * @returns 结构化结果；失败时包含 manualHint，不抛出
 */
export async function setPathReadOnly(targetPath: string): Promise<DesktopCommandResult> {
    const manualHint = readOnlyManualHint();
    if (!targetPath) {
        return { ok: false, error: '路径为空', manualHint };
    }

    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'attrib' : 'chmod';
    const args = isWindows
        ? ['+r', targetPath, '/s', '/d']
        : ['-R', 'a-w', targetPath];

    try {
        // 动态 import：移动端/未调用时不会加载 Node 能力
        const { execFile } = await import('node:child_process');
        await new Promise<void>((resolve, reject) => {
            execFile(command, args, { windowsHide: true }, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        return { ok: true, manualHint };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            manualHint,
        };
    }
}
