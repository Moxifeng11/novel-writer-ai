/**
 * dsh-launch.ts — dsh 子进程启动参数（纯函数，便于测试）
 *
 * 约定：
 * - SDK profile 用 stdio JSON-RPC（stdout 只走协议）；
 * - DSH_HOME 指向插件数据目录，会话不落在 vault；
 * - 默认 read-only sandbox，写入必须由用户先在设置中显式放开；
 * - 不自动安装/升级 dsh：命令不存在时由健康检查给出可执行提示。
 */

export type DshSandboxMode = 'read-only' | 'workspace-write';

/**
 * dsh 启动参数。
 */
export interface DshLaunchOptions {
    /** 可执行文件（默认 npx）；支持用户改成绝对路径 */
    command?: string;
    /** 传给可执行文件的参数（默认 -y @deepseek-ai/dsh --profile sdk） */
    commandArgs?: string[];
    profile?: string;
    /** DSH_HOME：插件数据目录下的独立 home */
    home: string;
    /** 会话工作目录（按产品决定：整个 vault） */
    workspace: string;
    sandbox: DshSandboxMode;
    /** sandbox patch 文件路径（由调用方写入 DSH_HOME） */
    sandboxPatchPath?: string;
    /** 运行时注入的 DeepSeek API Key（不写配置文件） */
    apiKey?: string;
    env?: Record<string, string | undefined>;
}

/**
 * 解析后的启动计划（命令、参数、环境）。
 */
export interface DshLaunchPlan {
    command: string;
    args: string[];
    env: Record<string, string>;
}

/** sandbox patch 内容：覆盖 base bundle 的 sandbox-policy 行 */
export function buildSandboxPatch(mode: DshSandboxMode, workspaceRoot: string): string {
    return [
        '- id: sandbox-policy',
        '  config:',
        `    mode: ${mode}`,
        `    workspaceRoot: ${JSON.stringify(workspaceRoot)}`,
    ].join('\n') + '\n';
}

/**
 * 构造 dsh 启动计划（含 Windows 命令解释器处理）。
 *
 * @param options - 启动参数（命令、profile、沙箱补丁路径等）
 * @returns 平台自适应的启动计划
 */
export function buildDshLaunchPlan(options: DshLaunchOptions): DshLaunchPlan {
    const command = (options.command || 'npx').trim();
    const baseArgs = options.commandArgs && options.commandArgs.length > 0
        ? [...options.commandArgs]
        : ['-y', '@deepseek-ai/dsh'];
    const args = [...baseArgs, '--profile', options.profile || 'sdk'];
    if (options.sandboxPatchPath) {
        args.push('--patch', options.sandboxPatchPath);
    }

    const env: Record<string, string> = {};
    // 只透传最小环境：PATH 等由调用方补充；不把整个 process.env 带进子进程
    for (const [key, value] of Object.entries(options.env || {})) {
        if (typeof value === 'string') env[key] = value;
    }
    env.DSH_HOME = options.home;
    if (options.apiKey) env.DEEPSEEK_API_KEY = options.apiKey;
    return { command, args, env };
}
