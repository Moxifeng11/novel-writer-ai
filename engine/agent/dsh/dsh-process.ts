/**
 * dsh-process.ts — dsh 子进程传输（桌面端）
 *
 * 只在真正启动 dsh 时动态 import node:child_process：
 * 移动端/默认 native 路径不会加载，也不会因此把插件打成 Node-only。
 * 不自动安装、不自动升级；命令不存在时抛出可读错误，由健康检查展示。
 */
import type { DshTransport } from './dsh-session';
import type { DshLaunchPlan } from './dsh-launch';

/**
 * 子进程传输选项。
 */
export interface DshProcessOptions {
    cwd: string;
    /** 是否桌面端（移动端必须为 false） */
    isDesktop: boolean;
    /** 透传的环境变量（PATH 等）；除非显式提供，否则不继承整个 process.env */
    passthroughEnv?: Record<string, string | undefined>;
}

/**
 * 子进程需要透传的环境变量白名单（Windows 与 POSIX 合并）。
 *
 * 只给 PATH 不够：cmd.exe 需要 SystemRoot，npm/npx 需要 APPDATA/USERPROFILE
 * 才能找到缓存与配置；缺了它们 npx 会以「找不到包」或直接异常退出。
 * 列表不按运行平台裁剪——单测与 CI 可能在不同平台跑同一份断言；
 * 这里只复制本机确实存在的键，不存在的自然跳过，不含任何凭据。
 */
const PLATFORM_ENV_KEYS = [
    'PATH', 'Path', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT',
    'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'TEMP', 'TMP', 'ProgramFiles', 'ProgramW6432',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'OS',
    'HOME', 'TMPDIR',
];

/**
 * 平台自适应的 spawn 规格。
 */
export interface DshSpawnSpec {
    command: string;
    args: string[];
}

/** cmd 里需要引号的字符（空格、引号、管道、重定向等） */
const CMD_QUOTE_NEEDED = /[\s"&|<>^()]/;

function quoteForCmd(value: string): string {
    if (!CMD_QUOTE_NEEDED.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
}

/**
 * 把「用户填的命令 + 参数」转成可被 spawn 直接执行的形态。
 *
 * Windows 上 `npx` / `npm` / `pnpm` / `dsh.cmd` 都是脚本 shim，不是 PE 可执行文件：
 * `spawn('npx', ...)` 直接 ENOENT；`spawn('npx.cmd', ...)` 在 Node 18.20+/20.12+
 * 会因为 .cmd 必须经 shell 而抛 EINVAL。这里统一改由 ComSpec 执行；
 * .exe 保持直连，不做多余的一层 cmd。
 */
export function buildDshSpawnSpec(
    command: string,
    args: string[],
    platform: NodeJS.Platform = process.platform,
    comSpec: string | undefined = process.env.ComSpec || process.env.COMSPEC,
): DshSpawnSpec {
    if (platform !== 'win32' || /\.exe$/i.test(command)) {
        return { command, args };
    }
    const shell = comSpec || 'cmd.exe';
    return {
        command: shell,
        args: ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')],
    };
}

/** 合并运行环境：平台必需变量 → 调用方透传 → 启动计划（含 DSH_HOME / Key） */
export function buildDshChildEnv(
    planEnv: Record<string, string>,
    passthroughEnv?: Record<string, string | undefined>,
    source: Record<string, string | undefined> = process.env,
): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of PLATFORM_ENV_KEYS) {
        const value = source[key];
        if (typeof value === 'string') env[key] = value;
    }
    // 空串不覆盖：调用方常写 `process.env.PATH || ''`，空串会把已补齐的 PATH 清掉
    for (const [key, value] of Object.entries(passthroughEnv || {})) {
        if (typeof value === 'string' && value !== '') env[key] = value;
    }
    for (const [key, value] of Object.entries(planEnv)) {
        if (typeof value === 'string' && value !== '') env[key] = value;
    }
    return env;
}

export async function createDshProcessTransport(
    plan: DshLaunchPlan,
    options: DshProcessOptions,
): Promise<DshTransport> {
    if (!options.isDesktop) {
        throw new Error('dsh 后端仅支持桌面端；移动端请使用内置 Agent。');
    }

    const childProcess = await import('node:child_process');
    const env = buildDshChildEnv(plan.env, options.passthroughEnv);
    const spec = buildDshSpawnSpec(plan.command, plan.args);

    const child = childProcess.spawn(spec.command, spec.args, {
        cwd: options.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });

    const lineListeners: Array<(line: string) => void> = [];
    const stderrListeners: Array<(line: string) => void> = [];
    const exitListeners: Array<(code: number | null, signal: string | null) => void> = [];

    const attachLineReader = (
        stream: NodeJS.ReadableStream | null,
        listeners: Array<(line: string) => void>,
    ): void => {
        if (!stream) return;
        let buffer = '';
        stream.setEncoding?.('utf8');
        stream.on('data', (chunk: string) => {
            buffer += chunk;
            let index = buffer.indexOf('\n');
            while (index >= 0) {
                const line = buffer.slice(0, index).replace(/\r$/, '');
                buffer = buffer.slice(index + 1);
                for (const listener of listeners) listener(line);
                index = buffer.indexOf('\n');
            }
        });
    };

    attachLineReader(child.stdout, lineListeners);
    attachLineReader(child.stderr, stderrListeners);

    child.on('error', (error: Error) => {
        for (const listener of stderrListeners) listener(`[spawn] ${error.message}`);
        for (const listener of exitListeners) listener(null, null);
    });
    child.on('exit', (code, signal) => {
        for (const listener of exitListeners) listener(code, signal);
    });

    return {
        write(line: string): void {
            if (!child.stdin || child.stdin.destroyed) throw new Error('dsh stdin 已关闭');
            child.stdin.write(line);
        },
        onLine(listener) {
            lineListeners.push(listener);
        },
        onStderr(listener) {
            stderrListeners.push(listener);
        },
        onExit(listener) {
            exitListeners.push(listener);
        },
        kill() {
            try {
                child.kill();
            } catch {
                // 进程已退出
            }
        },
    };
}

/**
 * 可执行性探测结果。
 */
export interface DshProbeResult {
    ok: boolean;
    version?: string;
    error?: string;
}

/**
 * 健康检查：只跑 `<command> ... --version`，不创建会话、不联网（除 npx 首次解析包）。
 * 超时/退出码非 0/命令不存在都返回结构化错误，交给设置页展示。
 */
export async function probeDshVersion(
    plan: DshLaunchPlan,
    options: DshProcessOptions,
    timeoutMs = 20_000,
): Promise<DshProbeResult> {
    if (!options.isDesktop) return { ok: false, error: 'dsh 仅支持桌面端' };
    const childProcess = await import('node:child_process');
    const env = buildDshChildEnv(plan.env, options.passthroughEnv);

    return new Promise<DshProbeResult>(resolve => {
        let settled = false;
        const finish = (result: DshProbeResult): void => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        let stdout = '';
        let stderr = '';
        const versionArgs: string[] = [];
        for (let i = 0; i < plan.args.length; i++) {
            const arg = plan.args[i];
            if (arg === '--profile' || arg === '--patch') { i += 1; continue; }
            versionArgs.push(arg);
        }
        versionArgs.push('--version');
        const spec = buildDshSpawnSpec(plan.command, versionArgs);

        let child;
        try {
            child = childProcess.spawn(spec.command, spec.args, {
                cwd: options.cwd,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (e) {
            finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
            return;
        }
        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* 已退出 */ }
            finish({ ok: false, error: `dsh --version 超时（${timeoutMs}ms）；首次 npx 拉取可能较慢，请稍后重试` });
        }, timeoutMs);
        child.stdout?.on('data', chunk => { stdout += String(chunk); });
        child.stderr?.on('data', chunk => { stderr += String(chunk); });
        child.on('error', (error: Error) => {
            clearTimeout(timer);
            finish({ ok: false, error: `无法启动 dsh：${error.message}。请确认已安装 Node.js 与 @deepseek-ai/dsh` });
        });
        child.on('exit', (code: number | null) => {
            clearTimeout(timer);
            const version = (stdout || stderr).trim().split(/\r?\n/).pop()?.trim();
            if (code === 0 || (version && /\d+\.\d+/.test(version))) {
                finish({ ok: true, version });
            } else {
                finish({ ok: false, error: `dsh --version 退出码 ${code ?? 'null'}${stderr ? `：${stderr.trim().slice(0, 200)}` : ''}` });
            }
        });
    });
}
