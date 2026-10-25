/**
 * 工程包（`.kly`）格式标识与外壳校验。
 *
 * 分工要说清：
 * - `format` / `formatVersion` 是**文件外壳**的标识，用来判断「这是不是我们的工程包」；
 * - `project.schemaVersion` 是**项目数据**的版本，负责字段迁移，两者互不干扰。
 *
 * 读取始终宽容：既接受新外壳，也接受旧版直接吐出的裸 Project JSON，
 * 这样老用户的备份文件不会因为改品牌而打不开。
 */

import type { Project } from './types';

export const KINELAYER_BUNDLE_FORMAT = 'kinelayer-bundle';
export const KINELAYER_FILE_EXT = '.kly';
export const KINELAYER_FILE_ACCEPT = `${KINELAYER_FILE_EXT},application/json`;
export const KINELAYER_FORMAT_VERSION = 1;

export interface ProjectBundle {
  format: string;
  formatVersion: number;
  app: string;
  exportedAt: number;
  project: Project;
}

export function packProject(project: Project): ProjectBundle {
  return {
    format: KINELAYER_BUNDLE_FORMAT,
    formatVersion: KINELAYER_FORMAT_VERSION,
    app: 'Kinelayer',
    exportedAt: Date.now(),
    project,
  };
}

/** 把外壳剥掉，返回裸 Project。裸 JSON 原样返回，保证旧备份可读。 */
export function unpackProject(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.format === 'string' && rec.format.endsWith('-bundle')) {
    if (!rec.project || typeof rec.project !== 'object') {
      throw new Error('工程包缺少 project 字段');
    }
    return rec.project;
  }
  return parsed;
}
