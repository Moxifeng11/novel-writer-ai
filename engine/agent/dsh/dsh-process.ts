/**
 * dsh-process.ts — dsh 子进程传输（桌面端）
 *
 * 只在真正启动 dsh 时动态 import node:child_process：
 * 移动端/默认 native 路径不会加载，也不会因此把插件打成 Node-only。
 * 不自动安装、不自动升级；命令不存在时抛出可读错误，由健康检查展示。
 */
import type { DshTransport } from './dsh-session';
import type { DshLaunchPlan } from './dsh-launch';

export interface DshProcessOptions {
    cwd: string;
    /** 是否桌面端（移动端必须为 false） */
    isDesktop: boolean;
    /** 透传的环境变量（PATH 等）；除非显式提供，否则不继承整个 process.env */
    passthroughEnv?: Record<string, string | undefined>;
}

export async function createDshProcessTransport(
    plan: DshLaunchPlan,
    options: DshProcessOptions,
): Promise<DshTransport> {
    if (!options.isDesktop) {
        throw new Error('dsh 后端仅支持桌面端；移动端请使用内置 Agent。');
    }

    const childProcess = await import('node:child_process');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.passthroughEnv || {})) {
        if (typeof value === 'string') env[key] = value;
    }
    Object.assign(env, plan.env);

    const child = childProcess.spawn(plan.command, plan.args, {
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
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.passthroughEnv || {})) {
        if (typeof value === 'string') env[key] = value;
    }
    Object.assign(env, plan.env);

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

        let child;
        try {
            child = childProcess.spawn(plan.command, versionArgs, {
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
