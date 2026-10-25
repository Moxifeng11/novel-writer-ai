/**
 * full-writer-state.ts — 工作台状态兼容层
 *
 * 历史原因曾与 full-writer-store.ts 各维护一份实现（FR-F-10 重复实现）。
 * 现统一由 FullWriterStoreImpl 提供，本文件仅保留旧导入路径的别名，
 * 避免新增第二份状态实现。
 *
 * @deprecated 请直接从 `./full-writer-store` 导入 FullWriterStore / FullWriterStoreImpl。
 */

export type {
    TabType,
    WriterTab,
    FullWriterStateSnapshot,
} from './full-writer-store';
export { FullWriterStoreImpl as FullWriterState } from './full-writer-store';
