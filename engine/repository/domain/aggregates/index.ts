/**
 * domain/aggregates/index.ts — 聚合根统一导出
 */

export { BaseEntity } from './base-entity';
export type { BaseEntityProps, EntityCategory } from './base-entity';

export { Project } from './project-aggregate';
export type { ProjectProps, ProjectMeta } from './project-aggregate';

export { Chapter } from './chapter-aggregate';
export type { ChapterProps, ChapterMeta } from './chapter-aggregate';

export { Character } from './character-aggregate';
export type { CharacterProps } from './character-aggregate';

export { Faction } from './faction-aggregate';
export type { FactionProps } from './faction-aggregate';

export { Location } from './location-aggregate';
export type { LocationProps } from './location-aggregate';

export { Item } from './item-aggregate';
export type { ItemProps } from './item-aggregate';
