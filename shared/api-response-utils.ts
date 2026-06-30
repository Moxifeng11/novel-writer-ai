/**
 * APIResponse 工具函数 — 消除 (response as any)?.content 模式
 * 从 co-writer-engine / emotion-curve-analyzer 等文件提取的公共逻辑
 */
import { APIResponse } from '../engine/ai-engine';

/**
 * 判断是否为 APIResponse（有 content 字段的对象）
 */
export function isAPIResponse(obj: unknown): obj is APIResponse {
    return typeof obj === 'object' && obj !== null && 'content' in obj;
}

/**
 * 从 string | APIResponse 联合类型中提取文本内容
 * 安全替代 (response as any)?.content || ''
 */
export function extractResponseContent(
    response: string | APIResponse | null | undefined,
    fallback: string = ''
): string {
    if (!response) return fallback;
    if (typeof response === 'string') return response;
    return (response as APIResponse).content ?? fallback;
}

/**
 * 提取并 trim（常用模式）
 */
export function extractResponseText(
    response: string | APIResponse | null | undefined,
    fallback: string = ''
): string {
    return extractResponseContent(response, fallback).trim();
}
