/**
 * dsh-launch.ts — dsh 子进程启动参数（纯函数，便于测试）
 *
 * 约定：
 * - SDK profile 用 stdio JSON-RPC（stdout 只走协议）；
 * - DSH_HOME 指向插件数据目录，会话不落在 vault；
 * - 默认 read-only sandbox，写入必须由用户先在设置中显式放开；
 * - 不自动升级 dsh：默认固定 @deepseek-ai/dsh@0.2.1-rc.5；命令不存在时由健康检查给出提示。
 */

export type DshSandboxMode = 'read-only' | 'workspace-write';

/** 默认 dsh 版本：固定版本，避免 npx 运行时拉取最新包 */
export const DSH_PACKAGE_VERSION = '0.2.1-rc.5';

/** 凭据类环境变量：buildDshLaunchPlan 会从 options.env 里剔除（S3-5） */
export const CREDENTIAL_ENV_KEYS = /(_API_KEY|_TOKEN|_SECRET|_PASSWORD|AUTHORIZATION)$/i;

/**
 * dsh 启动参数。
 */
export interface DshLaunchOptions {
    /** 可执行文件（默认 npx）；支持用户改成绝对路径 */
    command?: string;
    /** 传给可执行文件的参数（默认 -y @deepseek-ai/dsh@<version> --profile sdk） */
    commandArgs?: string[];
    /** 固定 dsh 版本；默认 DSH_PACKAGE_VERSION（仅在未显式传 commandArgs 时生效） */
    packageVersion?: string;
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

/**
 * sandbox patch 内容：覆盖 base bundle 的 sandbox-policy 行
 *
 * @param mode - 模式
 * @param workspaceRoot - 工作区根路径
 * @returns 文本结果
 */
export function buildSandboxPatch(mode: DshSandboxMode, workspaceRoot: string): string {
    return [
        '- id: sandbox-policy',
        '  config:',
        `    mode: ${mode}`,
        `    workspaceRoot: ${JSON.stringify(workspaceRoot)}`,
    ].join('\n') + '\n';
}

/**
 * 解析 dsh 写入工作区：写入模式只允许当前项目目录，避免 workspace-write
 * 覆盖 `.obsidian`（插件代码/密钥）与其它项目；无法定位项目时返回空串由调用方降级。
 *
 * @param base - vault 根绝对路径
 * @param activeProject - 当前项目 ID（模式库/书名）
 * @param allowWrite - 是否允许写入
 * @returns 工作区根路径；空串表示写入模式不可用
 */
export function resolveDshWorkspaceRoot(base: string, activeProject: string, allowWrite: boolean): string {
    const root = base.replace(/[\\/]+$/, '');
    if (!allowWrite) return root;
    const project = String(activeProject || '').trim().replace(/\\/g, '/');
    if (!project || project.startsWith('/') || project.includes('..') || /^[A-Za-z]:/.test(project)) return '';
    return `${root}/${project}`;
}

/**
 * 只在 dsh 路由与当前提供商都是 DeepSeek 时注入 API Key；
 * 否则把非 DeepSeek 的 Key 发给 dsh 既无效也可能造成凭据误用。
 *
 * @param dshProvider - dsh 的路由 provider
 * @param currentProviderId - 插件当前提供商 ID
 * @returns 是否注入
 */
export function shouldInjectDshApiKey(dshProvider: string, currentProviderId: string): boolean {
    const isDeepSeek = (value: string): boolean => String(value || '').toLowerCase().includes('deepseek');
    return isDeepSeek(dshProvider) && isDeepSeek(currentProviderId);
}

/**
 * 构造 dsh 启动计划（含 Windows 命令解释器处理）。
 *
 * @param options - 启动参数（命令、profile、沙箱补丁路径等）
 * @returns 平台自适应的启动计划
 */
export function buildDshLaunchPlan(options: DshLaunchOptions): DshLaunchPlan {
    const command = (options.command || 'npx').trim();
    // 版本号来自设置，只允许 semver 安全字符：Windows 走 ComSpec 时防止参数注入/拼接失败。
    const rawVersion = String(options.packageVersion || '').trim();
    const version = /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(rawVersion) ? rawVersion : DSH_PACKAGE_VERSION;
    const baseArgs = options.commandArgs && options.commandArgs.length > 0
        ? [...options.commandArgs]
        : ['-y', `@deepseek-ai/dsh@${version}`];
    const args = [...baseArgs, '--profile', options.profile || 'sdk'];
    if (options.sandboxPatchPath) {
        args.push('--patch', options.sandboxPatchPath);
    }

    const env: Record<string, string> = {};
    // 只透传最小环境：PATH 等由调用方补充；不把整个 process.env 带进子进程
    for (const [key, value] of Object.entries(options.env || {})) {
        if (typeof value === 'string') env[key] = value;
    }
    // S3-5（安全 r3）：凭据类环境变量一律剔除——凭据只能来自显式 apiKey 注入，
    // 调用方不能再经 options.env 夹带（避免把其它提供商的 Key 带进 dsh 进程树）。
    for (const key of Object.keys(env)) {
        if (CREDENTIAL_ENV_KEYS.test(key)) delete env[key];
    }
    env.DSH_HOME = options.home;
    if (options.apiKey) env.DEEPSEEK_API_KEY = options.apiKey;
    return { command, args, env };
}
