/**
 * mcp-launch：选程序文件 → 启动方式推断；参数解析；命令预览
 */

import { describe, expect, it } from 'vitest';
import {
    buildMcpLaunchPreview,
    looksLikeMcpProgram,
    MCP_PROGRAM_EXTENSIONS,
    parseMcpArgs,
    quoteLaunchArg,
    resolveMcpLaunchFromPath,
} from '@/shared/mcp-launch';

describe('parseMcpArgs', () => {
    it('按空格拆分，保留引号内的空格', () => {
        expect(parseMcpArgs('server.js --port 3000')).toEqual(['server.js', '--port', '3000']);
        expect(parseMcpArgs('"C:/my app/server.js" -v')).toEqual(['C:/my app/server.js', '-v']);
        expect(parseMcpArgs("'a b' c")).toEqual(['a b', 'c']);
    });

    it('空串与多余空白', () => {
        expect(parseMcpArgs('')).toEqual([]);
        expect(parseMcpArgs('   ')).toEqual([]);
        expect(parseMcpArgs('  a   b  ')).toEqual(['a', 'b']);
    });
});

describe('resolveMcpLaunchFromPath', () => {
    it('.js/.mjs/.cjs → node', () => {
        for (const path of ['/x/server.js', '/x/server.mjs', '/x/server.cjs']) {
            const spec = resolveMcpLaunchFromPath(path, 'linux');
            expect(spec?.command).toBe('node');
            expect(spec?.args).toEqual([path]);
            expect(spec?.runtime).toBe('node');
        }
    });

    it('.py 按平台选 python / python3', () => {
        expect(resolveMcpLaunchFromPath('/x/s.py', 'win32')?.command).toBe('python');
        expect(resolveMcpLaunchFromPath('/x/s.py', 'darwin')?.command).toBe('python3');
    });

    it('.sh → bash；.ps1 → powershell -File；.bat/.cmd → cmd /c', () => {
        expect(resolveMcpLaunchFromPath('/x/s.sh', 'linux')).toEqual({
            command: 'bash', args: ['/x/s.sh'], runtime: 'shell',
            warning: expect.any(String),
        });
        expect(resolveMcpLaunchFromPath('/x/s.ps1', 'win32')?.args).toEqual(['-ExecutionPolicy', 'Bypass', '-File', '/x/s.ps1']);
        expect(resolveMcpLaunchFromPath('/x/s.cmd', 'win32')?.args).toEqual(['/c', '/x/s.cmd']);
    });

    it('.exe 或无扩展名 → 直接作为命令', () => {
        expect(resolveMcpLaunchFromPath('C:/tools/server.exe', 'win32')).toEqual({
            command: 'C:/tools/server.exe', args: [], runtime: 'binary',
        });
        expect(resolveMcpLaunchFromPath('/opt/mcp-server', 'linux')?.runtime).toBe('binary');
    });

    it('空路径返回 null', () => {
        expect(resolveMcpLaunchFromPath('')).toBeNull();
        expect(resolveMcpLaunchFromPath('   ')).toBeNull();
    });
});

describe('命令预览与判定', () => {
    it('含空格的参数加引号', () => {
        expect(quoteLaunchArg('a b')).toBe('"a b"');
        expect(quoteLaunchArg('plain')).toBe('plain');
        expect(buildMcpLaunchPreview('node', ['C:/my app/server.js']))
            .toBe('node "C:/my app/server.js"');
        expect(buildMcpLaunchPreview('node', [])).toBe('node');
    });

    it('looksLikeMcpProgram 只认支持的扩展名', () => {
        for (const ext of MCP_PROGRAM_EXTENSIONS) {
            expect(looksLikeMcpProgram(`x${ext}`), ext).toBe(true);
        }
        expect(looksLikeMcpProgram('x.txt')).toBe(false);
        expect(looksLikeMcpProgram('')).toBe(false);
    });
});
