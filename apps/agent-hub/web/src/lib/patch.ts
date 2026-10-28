import type { DiffFileStatus } from '@agent-hub/contract';

export interface FilePatch {
  path: string;
  oldPath: string | null;
  status: DiffFileStatus;
  text: string;
  lineCount: number;
}

const FILE_FOLD_LINES = 400;

/** 统一 diff 按 `diff --git` 拆成文件块。超过 400 行的块默认折叠。 */
export function pairFilePatches(patch: string): FilePatch[] {
  if (patch.length === 0) return [];
  const starts: number[] = [];
  const header = /^diff --git /gm;
  for (let match = header.exec(patch); match; match = header.exec(patch)) {
    starts.push(match.index);
  }
  if (starts.length === 0) return [];
  const files: FilePatch[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? patch.length;
    if (start === undefined) continue;
    files.push(parseFilePatch(patch.slice(start, end)));
  }
  return files;
}

export function filePatchCollapsed(file: FilePatch, expanded: boolean): boolean {
  if (expanded) return false;
  return file.lineCount > FILE_FOLD_LINES;
}

function parseFilePatch(text: string): FilePatch {
  const lines = text.split('\n');
  const headerLine = lines[0] ?? '';
  const git = /^diff --git a\/(.+) b\/(.+)$/.exec(headerLine);
  const oldRaw = git?.[1] ?? '';
  const newRaw = git?.[2] ?? oldRaw;
  let status: DiffFileStatus = 'modified';
  let oldPath: string | null = null;
  if (lines.some((line) => line.startsWith('new file mode '))) status = 'added';
  else if (lines.some((line) => line.startsWith('deleted file mode '))) status = 'deleted';
  else if (lines.some((line) => line.startsWith('rename from '))) {
    status = 'renamed';
    const from = lines.find((line) => line.startsWith('rename from '));
    oldPath = from ? from.slice('rename from '.length) : stripGitPrefix(oldRaw);
  }
  const path =
    status === 'deleted' ? stripGitPrefix(oldRaw || newRaw) : stripGitPrefix(newRaw || oldRaw);
  const lineCount = lines.filter((line) => line.length > 0).length;
  return { path, oldPath, status, text, lineCount };
}

function stripGitPrefix(path: string): string {
  return path.replace(/\\$/, '');
}
