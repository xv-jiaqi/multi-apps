/** 网页 Agent 镜像 ref；PR2 不实现网页适配器，仅供 snapshotRemoteBranch 引用。 */
export function remoteMirrorRef(shortId: string): string {
  return `refs/agent-hub/remote/${shortId}`;
}
