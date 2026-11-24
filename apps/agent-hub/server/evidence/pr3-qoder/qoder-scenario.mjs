// 生成证据用的假 Qoder 剧本：node qoder-scenario.mjs <out.json> <normal|logged-out>
import { writeFileSync } from 'node:fs';
const [out, kind] = process.argv.slice(2);
const MODES = ['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo'];
const cfg = (mode) => ({
  modes: { currentModeId: mode, availableModes: MODES.map((id) => ({ id, name: id })) },
  configOptions: [
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: mode,
      options: MODES.map((value) => ({ value, name: value })),
    },
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'auto',
      options: [
        { value: 'auto', name: 'Auto' },
        { value: 'performance', name: 'Performance' },
      ],
    },
    {
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      category: 'thought_level',
      type: 'select',
      currentValue: 'medium',
      options: ['low', 'medium', 'high'].map((value) => ({ value, name: value })),
    },
  ],
  models: {
    currentModelId: 'auto',
    availableModels: [
      { modelId: 'auto', name: 'Auto' },
      { modelId: 'performance', name: 'Performance' },
    ],
  },
});
const init = {
  protocolVersion: 1,
  authMethods: [{ id: 'qodercli-login', name: 'Use qodercli login' }],
  agentInfo: { name: 'qoder-cli', title: 'Qoder CLI', version: '1.1.80' },
  agentCapabilities: { loadSession: true, sessionCapabilities: { close: {}, resume: {} } },
};
const OPTS = [
  { optionId: 'proceed_once', name: 'Yes', kind: 'allow_once' },
  { optionId: 'proceed_always', name: 'Yes, always', kind: 'allow_always' },
  { optionId: 'cancel', name: 'No', kind: 'reject_once' },
];
const msg = (text) => ({
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});
const CURL = 'curl -sv -u demo:hunter2 https://api.example/health';
// 假凭据：base64("demo:hunter2")。curl -v -u 会把它带进输出。
const curlOut =
  '> GET /health HTTP/1.1\n> Host: api.example\n> Authorization: Basic ZGVtbzpodW50ZXIy\n> User-Agent: curl/8.5.0\n>\n< HTTP/1.1 200 OK\n{"ok":true}\n';
const turn1 = {
  then: [
    {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '先确认健康检查接口能不能通。' },
      },
    },
    msg('我先用 curl 看一下健康检查接口。'),
    {
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_1',
        title: CURL,
        kind: 'execute',
        status: 'pending',
        rawInput: { command: CURL },
      },
    },
    {
      request: 'session/request_permission',
      id: 'perm-1',
      params: {
        toolCall: {
          toolCallId: 'call_1',
          title: CURL,
          kind: 'execute',
          rawInput: { command: CURL },
        },
        options: OPTS.filter((o) => o.kind !== 'allow_always'),
      },
    },
    {
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_1',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: curlOut.slice(0, 60) } }],
      },
    },
    { sleepMs: 300 },
    {
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: curlOut } }],
      },
    },
    {
      update: {
        sessionUpdate: 'plan',
        entries: [{ content: '检查健康接口', priority: 'medium', status: 'completed' }],
      },
    },
    { update: { sessionUpdate: 'usage_update', used: 3200, size: 200000 } },
    msg('接口返回 200，`{"ok":true}`。'),
  ],
  reply: { stopReason: 'end_turn' },
};
const turn2 = {
  then: [
    {
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_2',
        title: 'Edit README.md',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: 'README.md' }],
      },
    },
    {
      request: 'session/request_permission',
      id: 'perm-2',
      params: {
        toolCall: {
          toolCallId: 'call_2',
          title: 'Edit README.md',
          kind: 'edit',
          locations: [{ path: 'README.md' }],
        },
        options: OPTS,
      },
      writeFileIfSelected: { optionId: 'proceed_once', path: 'README.md', content: 'changed\n' },
    },
    { update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_2', status: 'failed' } },
    { update: { sessionUpdate: 'current_mode_update', currentModeId: 'yolo' } },
    { sleepMs: 300 },
    msg('好的，不改 README。'),
  ],
  reply: { stopReason: 'end_turn' },
};
const scenario =
  kind === 'logged-out'
    ? {
        initialize: init,
        handlers: {
          'session/new': {
            error: {
              code: -32000,
              message: 'Authentication required: Authentication is required.',
            },
          },
        },
      }
    : {
        initialize: init,
        handlers: {
          'session/new': { reply: cfg('yolo') },
          'session/resume': { reply: cfg('yolo') },
          'session/set_config_option': { reply: { configOptions: cfg('default').configOptions } },
          'session/close': { reply: {} },
          'session/prompt': [turn1, turn2],
        },
      };
writeFileSync(out, JSON.stringify(scenario, null, 2));
