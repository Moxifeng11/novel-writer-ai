/**
 * true-random.ts — 兼容入口。
 *
 * CSPRNG 实现已迁至 shared/true-random.ts，供 shared 层的故事结构随机选配复用。
 * 保留本文件 re-export，既有 engine/harness 与测试引用无需修改。
 */
export * from '@/shared/true-random';
