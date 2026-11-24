/**
 * 升级 Codex 时的可选核对（D33，不进 CI）：手写的 protocol.ts 与 codex 生成的类型双向兼容。
 *   codex app-server generate-ts --out scripts/codex-compat/generated
 *   pnpm exec tsc -p scripts/codex-compat/tsconfig.json
 * 编译通过 = 兼容；报错的那一行指出哪个类型对不上。generated/ 不提交。
 */
import type * as H from '../../src/adapters/codex/protocol';
import type { ClientRequest } from './generated/ClientRequest';
import type { ClientNotification } from './generated/ClientNotification';
import type { ServerNotification } from './generated/ServerNotification';
import type { ServerRequest } from './generated/ServerRequest';
import type { InitializeParams } from './generated/InitializeParams';
import type { InitializeResponse } from './generated/InitializeResponse';
import type { ExecCommandApprovalResponse } from './generated/ExecCommandApprovalResponse';
import type { ApplyPatchApprovalResponse } from './generated/ApplyPatchApprovalResponse';
import type * as G from './generated/v2/index';

type Assert<T extends true> = T;
type Sub<A, B> = [A] extends [B] ? true : false;

// Hub 发出的东西：手写类型必须能赋给生成类型
type _s1 = Assert<Sub<H.InitializeParams, InitializeParams>>;
type _s2 = Assert<Sub<H.GetAccountParams, G.GetAccountParams>>;
type _s3 = Assert<Sub<H.ModelListParams, G.ModelListParams>>;
type _s4 = Assert<Sub<H.ThreadStartParams, G.ThreadStartParams>>;
type _s5 = Assert<Sub<H.ThreadResumeParams, G.ThreadResumeParams>>;
type _s6 = Assert<Sub<H.ThreadUnsubscribeParams, G.ThreadUnsubscribeParams>>;
type _s7 = Assert<Sub<H.TurnStartParams, G.TurnStartParams>>;
type _s8 = Assert<Sub<H.TurnInterruptParams, G.TurnInterruptParams>>;
type _s9 = Assert<Sub<H.ApprovalDecisionResponse, G.CommandExecutionRequestApprovalResponse>>;
type _s10 = Assert<Sub<H.ApprovalDecisionResponse, G.FileChangeRequestApprovalResponse>>;
type _s11 = Assert<Sub<H.PermissionsRequestApprovalResponse, G.PermissionsRequestApprovalResponse>>;
type _s12 = Assert<Sub<H.ToolRequestUserInputResponse, G.ToolRequestUserInputResponse>>;
type _s13 = Assert<
  Sub<H.McpServerElicitationRequestResponse, G.McpServerElicitationRequestResponse>
>;
type _s14 = Assert<Sub<H.LegacyApprovalResponse, ExecCommandApprovalResponse>>;
type _s15 = Assert<Sub<H.LegacyApprovalResponse, ApplyPatchApprovalResponse>>;
type _s16 = Assert<Sub<Exclude<H.CodexClientMethod, 'initialized'>, ClientRequest['method']>>;
type _s17 = Assert<Sub<'initialized', ClientNotification['method']>>;
type _s18 = Assert<Sub<H.SandboxPolicy, G.SandboxPolicy>>;

// Hub 收到的东西：生成类型必须能赋给手写类型
type _r1 = Assert<Sub<InitializeResponse, H.InitializeResponse>>;
type _r2 = Assert<Sub<G.GetAccountResponse, H.GetAccountResponse>>;
type _r3 = Assert<Sub<G.ModelListResponse, H.ModelListResponse>>;
type _r4 = Assert<Sub<G.ThreadStartResponse, H.ThreadStartResponse>>;
type _r5 = Assert<Sub<G.ThreadResumeResponse, H.ThreadResumeResponse>>;
type _r6 = Assert<Sub<G.TurnStartResponse, H.TurnStartResponse>>;
type _r7 = Assert<Sub<Omit<G.ItemStartedNotification, 'item'>, Omit<H.ItemNotification, 'item'>>>;
type _r8 = Assert<Sub<Omit<G.ItemCompletedNotification, 'item'>, Omit<H.ItemNotification, 'item'>>>;
type HItem<T extends H.ThreadItem['type']> = Extract<H.ThreadItem, { type: T }>;
type GItem<T extends string> = Extract<G.ThreadItem, { type: T }>;
type _i1 = Assert<Sub<GItem<'userMessage'>, HItem<'userMessage'>>>;
type _i2 = Assert<Sub<GItem<'agentMessage'>, HItem<'agentMessage'>>>;
type _i3 = Assert<Sub<GItem<'reasoning'>, HItem<'reasoning'>>>;
type _i4 = Assert<Sub<GItem<'commandExecution'>, HItem<'commandExecution'>>>;
type _i5 = Assert<Sub<GItem<'fileChange'>, HItem<'fileChange'>>>;
type _i6 = Assert<Sub<GItem<'mcpToolCall'>, HItem<'mcpToolCall'>>>;
type _i7 = Assert<Sub<GItem<'dynamicToolCall'>, HItem<'dynamicToolCall'>>>;
type _i8 = Assert<Sub<GItem<'webSearch'>, HItem<'webSearch'>>>;
type _i9 = Assert<Sub<GItem<'imageView'>, HItem<'imageView'>>>;
type _i10 = Assert<Sub<GItem<'contextCompaction'>, HItem<'contextCompaction'>>>;
type _i11 = Assert<Sub<H.ThreadItem['type'], G.ThreadItem['type']>>;
type _r9 = Assert<Sub<G.AgentMessageDeltaNotification, H.DeltaNotification>>;
type _r10 = Assert<Sub<G.ReasoningSummaryTextDeltaNotification, H.DeltaNotification>>;
type _r11 = Assert<Sub<G.CommandExecutionOutputDeltaNotification, H.DeltaNotification>>;
type _r12 = Assert<Sub<G.FileChangeOutputDeltaNotification, H.DeltaNotification>>;
type _r13 = Assert<Sub<G.TurnStartedNotification, H.TurnNotification>>;
type _r14 = Assert<Sub<G.TurnCompletedNotification, H.TurnNotification>>;
type _r15 = Assert<Sub<G.TurnPlanUpdatedNotification, H.TurnPlanUpdatedNotification>>;
type _r16 = Assert<
  Sub<G.ThreadTokenUsageUpdatedNotification, H.ThreadTokenUsageUpdatedNotification>
>;
type _r17 = Assert<Sub<G.ErrorNotification, H.ErrorNotification>>;
type _r18 = Assert<Sub<G.WarningNotification, H.WarningNotification>>;
type _r19 = Assert<Sub<G.ModelReroutedNotification, H.ModelReroutedNotification>>;
type _r20 = Assert<Sub<G.ServerRequestResolvedNotification, H.ServerRequestResolvedNotification>>;
type _r21 = Assert<Sub<G.ThreadClosedNotification, H.ThreadClosedNotification>>;
type _r22 = Assert<
  Sub<G.CommandExecutionRequestApprovalParams, H.CommandExecutionRequestApprovalParams>
>;
type _r23 = Assert<Sub<G.FileChangeRequestApprovalParams, H.FileChangeRequestApprovalParams>>;
type _r24 = Assert<Sub<G.PermissionsRequestApprovalParams, H.PermissionsRequestApprovalParams>>;
type _r25 = Assert<Sub<G.CodexErrorInfo, H.CodexErrorInfo>>;
type _r26 = Assert<Sub<G.Model, H.CodexModel>>;

// 适配器处理的通知与服务端请求方法名都存在
type HandledNotifications =
  | 'item/started'
  | 'item/completed'
  | 'item/agentMessage/delta'
  | 'item/reasoning/summaryTextDelta'
  | 'item/commandExecution/outputDelta'
  | 'item/fileChange/outputDelta'
  | 'turn/started'
  | 'turn/completed'
  | 'turn/plan/updated'
  | 'thread/tokenUsage/updated'
  | 'error'
  | 'warning'
  | 'model/rerouted'
  | 'serverRequest/resolved'
  | 'thread/closed'
  | 'account/updated';
type _m1 = Assert<Sub<HandledNotifications, ServerNotification['method']>>;
type HandledRequests =
  | 'item/commandExecution/requestApproval'
  | 'item/fileChange/requestApproval'
  | 'item/permissions/requestApproval'
  | 'item/tool/requestUserInput'
  | 'mcpServer/elicitation/request'
  | 'execCommandApproval'
  | 'applyPatchApproval';
type _m2 = Assert<Sub<HandledRequests, ServerRequest['method']>>;
