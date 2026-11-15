/**
 * mcp-launch.ts — 「选一个程序文件 → 怎么启动它」的纯函数
 *
 * 背景：用户接入自己的 MCP 程序时，通常只有一个脚本/可执行文件路径，
 * 但 stdio 传输需要 `command + args`（例如 node server.js）。
 * 这里按扩展名推断运行时，并把路径安全地放进 args（不拼 shell 字符串）。
 */

/** 推断出的运行时类型 */
export type McpRuntimeKind = 'node' | 'python' | 'shell' | 'powershell' | 'cmd' | 'binary';

/** 启动方式（stdio 传输用） */
export interface McpLaunchSpec {
    /** 可执行程序（node / python / bash / powershell / cmd / 二进制本身） */
    command: string;
    /** 参数（脚本绝对路径等） */
    args: string[];
    /** 运行时类型（UI 提示用） */
    runtime: McpRuntimeKind;
    /** 需要用户注意的事项 */
    warning?: string;
}

/** 文件选择器里值得列出的扩展名 */
export const MCP_PROGRAM_EXTENSIONS: readonly string[] = [
    '.js', '.mjs', '.cjs', '.py', '.sh', '.ps1', '.bat', '.cmd', '.exe', '.jar',
];

/**
 * 解析命令行参数文本（支持引号包裹的空格）。
 *
 * @param text - 如 `server.js --port 3000` 或 `"my dir/server.js" -v`
 * @returns 参数数组
 * @example
 * ```ts
 * parseMcpArgs('"C:/my app/server.js" --port 3000');
 * // ['C:/my app/server.js', '--port', '3000']
 * ```
 */
export function parseMcpArgs(text: string): string[] {
    const source = String(text ?? '');
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    for (const char of source) {
        if (quote) {
            if (char === quote) quote = null;
            else current += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === ' ' || char === '\t' || char === '\n') {
            if (current) {
                args.push(current);
                current = '';
            }
            continue;
        }
        current += char;
    }
    if (current) args.push(current);
    return args;
}

/**
 * 把单个参数安全地格式化成可读命令（含空格时加引号）。
 *
 * @param arg - 参数
 * @returns 展示文本
 */
export function quoteLaunchArg(arg: string): string {
    const text = String(arg ?? '');
    if (!text) return '""';
    return /[ \t"]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

/**
 * 生成可读的启动命令预览。
 *
 * @param command - 可执行程序
 * @param args - 参数
 * @returns 预览字符串
 * @example
 * ```ts
 * buildMcpLaunchPreview('node', ['"C:/my app/server.js"']);
 * // node "C:/my app/server.js"
 * ```
 */
export function buildMcpLaunchPreview(command: string, args: readonly string[]): string {
    const head = quoteLaunchArg(String(command ?? '').trim());
    const tail = args.map(arg => quoteLaunchArg(arg)).join(' ');
    return tail ? `${head} ${tail}` : head;
}

/**
 * 由程序文件路径推断启动方式。
 *
 * 规则（常见运行时）：
 * - `.js/.mjs/.cjs` → `node <path>`
 * - `.py` → Windows `python <path>`；其它平台 `python3 <path>`
 * - `.sh` → `bash <path>`
 * - `.ps1` → `powershell -ExecutionPolicy Bypass -File <path>`
 * - `.bat/.cmd` → `cmd /c <path>`
 * - `.exe` 或无扩展名 → 直接把该文件作为命令
 *
 * @param filePath - 用户选择的绝对路径（可为相对路径，原样保留）
 * @param platform - 平台标识（默认 win32 判定用 process.platform）
 * @returns 启动方式；路径为空返回 null
 * @example
 * ```ts
 * resolveMcpLaunchFromPath('C:/tools/server.mjs', 'win32');
 * // { command: 'node', args: ['C:/tools/server.mjs'], runtime: 'node' }
 * ```
 */
export function resolveMcpLaunchFromPath(filePath: string, platform?: string): McpLaunchSpec | null {
    const target = String(filePath ?? '').trim();
    if (!target) return null;
    const os = platform ?? (typeof process !== 'undefined' ? process.platform : 'win32');
    const lower = target.toLowerCase();
    const ext = lower.slice(lower.lastIndexOf('.') >= 0 ? lower.lastIndexOf('.') : lower.length);

    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        return {
            command: 'node',
            args: [target],
            runtime: 'node',
            warning: '需要本机已安装 Node.js（PATH 里有 node 命令）；没有可用「命令」栏改成 node 的绝对路径',
        };
    }
    if (ext === '.py') {
        return {
            command: os === 'win32' ? 'python' : 'python3',
            args: [target],
            runtime: 'python',
            warning: '需要本机已安装 Python；没有可在「命令」栏改成 python 的绝对路径',
        };
    }
    if (ext === '.sh') {
        return { command: 'bash', args: [target], runtime: 'shell', warning: 'Windows 需已安装 Git Bash / WSL 的 bash' };
    }
    if (ext === '.ps1') {
        return {
            command: 'powershell',
            args: ['-ExecutionPolicy', 'Bypass', '-File', target],
            runtime: 'powershell',
        };
    }
    if (ext === '.bat' || ext === '.cmd') {
        return {
            command: 'cmd',
            args: ['/c', target],
            runtime: 'cmd',
            warning: '批处理文件不能直接读取 stdin/stdout 时无法用于 stdio 传输，建议改用 node/ python 脚本',
        };
    }
    return { command: target, args: [], runtime: 'binary' };
}

/**
 * 该路径看起来是不是可以接入的 MCP 程序文件。
 *
 * @param filePath - 路径
 * @returns 是则 true
 */
export function looksLikeMcpProgram(filePath: string): boolean {
    const lower = String(filePath ?? '').trim().toLowerCase();
    if (!lower) return false;
    return MCP_PROGRAM_EXTENSIONS.some(ext => lower.endsWith(ext));
}
