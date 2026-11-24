/** Nest provider tokens（单独成文件，避免 app.module 与服务互相 import）。 */
export const HUB_DB = Symbol('HUB_DB');
export const HUB_LOGGER = Symbol('HUB_LOGGER');
export const HUB_GIT = Symbol('HUB_GIT');
export const PROCESS_SUPERVISOR = Symbol('PROCESS_SUPERVISOR');
export const GIT_GUARD = Symbol('GIT_GUARD');
