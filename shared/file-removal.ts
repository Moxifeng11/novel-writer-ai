/**
 * file-removal.ts — vault 内文件删除的唯一入口
 *
 * 为什么不让各处直接调 `vault.delete` / `vault.trash`：
 * - `FileManager.trashFile` 会遵循用户在「文件与链接 → 删除文件」里的偏好（回收站 / 永久删除），
 *   `vault.delete` 则是无条件硬删，用户改过的偏好被绕过；
 * - `vault.delete` / `vault.trash` 已被 Obsidian 标记废弃，社区审核的 `prefer-file-manager-trash-file` 也会报出。
 *
 * 内部临时文件（事务日志、结算日志、派生缓存）例外：它们每步都会重建，
 * 进回收站只会把用户的 `.trash` 刷满噪声，因此提供 `hardDeleteVaultPath` 直接删除。
 */

import type { App, TAbstractFile } from 'obsidian';

/** 只需要 fileManager 的宿主（便于测试注入） */
export type TrashCapableHost = Pick<App, 'fileManager'>;

/** 只需要 vault 的宿主（便于测试注入） */
export type HardDeleteHost = Pick<App, 'vault'>;

/**
 * 删除 vault 内的文件或文件夹，遵循用户的删除偏好（默认移入回收站）。
 *
 * @param app - 宿主应用（只用到 fileManager）
 * @param entry - 待删除的文件或文件夹
 * @returns 删除完成的 Promise
 */
export async function trashVaultEntry(app: TrashCapableHost, entry: TAbstractFile): Promise<void> {
    await app.fileManager.trashFile(entry);
}

/**
 * 直接删除路径，不经回收站。
 *
 * 仅用于两类场景：用户显式要求「永久删除」；插件内部临时文件（事务日志、结算日志、派生缓存），
 * 它们每步重建，进回收站只会刷满用户的 `.trash`。其余一律用 `trashVaultEntry`。
 *
 * @param app - 宿主应用（只用到 vault）
 * @param path - 待删除的 vault 内路径
 * @returns 删除完成的 Promise
 */
export async function hardDeleteVaultPath(app: HardDeleteHost, path: string): Promise<void> {
    await app.vault.adapter.remove(path);
}
