/**
 * MCP 管理界面：ID/名称推断 + 模块可导入（视图门禁）
 */

import { describe, expect, it } from 'vitest';
import { defaultIdFromPath, defaultNameFromPath, McpServerFormModal } from '@/ui/mcp-server-form-modal';
import { McpManagerModal } from '@/ui/mcp-manager-modal';
import { McpFilePickerModal, parentOf } from '@/ui/mcp-file-picker-modal';

describe('界面模块可导入（视图门禁）', () => {
    it('三个 MCP 界面类都是构造函数', () => {
        expect(typeof McpServerFormModal).toBe('function');
        expect(typeof McpManagerModal).toBe('function');
        expect(typeof McpFilePickerModal).toBe('function');
    });
});

describe('defaultIdFromPath', () => {
    it('取文件名并清洗成合法 ID', () => {
        expect(defaultIdFromPath('C:\\tools\\my-mcp.mjs')).toBe('my-mcp');
        expect(defaultIdFromPath('/opt/MCP Server.py')).toBe('MCP-Server');
        expect(defaultIdFromPath('/opt/中文名.js')).toBe('mcp');
    });

    it('结果为合法工具名前缀（字母数字下划线短横线）', () => {
        const id = defaultIdFromPath('/a/b.tools/server(1).js');
        expect(id).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    });
});

describe('defaultNameFromPath', () => {
    it('去掉扩展名作为显示名', () => {
        expect(defaultNameFromPath('/x/server.mjs')).toBe('server');
        expect(defaultNameFromPath('C:\\x\\demo.exe')).toBe('demo');
    });

    it('没有扩展名时原样返回', () => {
        expect(defaultNameFromPath('/x/mcp-server')).toBe('mcp-server');
    });
});

describe('parentOf', () => {
    it('普通目录取上一级', () => {
        expect(parentOf('C:/tools/mcp')).toBe('C:/tools');
        expect(parentOf('/usr/local/bin')).toBe('/usr/local');
    });

    it('Windows 盘根与 POSIX 根保持根形态', () => {
        expect(parentOf('C:/tools')).toBe('C:/');
        expect(parentOf('/usr')).toBe('/');
    });

    it('空路径返回空串', () => {
        expect(parentOf('')).toBe('');
    });
});
