/** 假 Qoder（ACP）剧本的公共部分：帧照 adapter-acp.md §13 与 §10 的 Qoder CLI 1.1.80 实测编写。 */
export const QODER_INIT = {
  protocolVersion: 1,
  authMethods: [{ id: 'qodercli-login', name: 'Use qodercli login' }],
  agentInfo: { name: 'qoder-cli', title: 'Qoder CLI', version: '1.1.80' },
  agentCapabilities: { loadSession: true, sessionCapabilities: { close: {}, resume: {} } },
};

const MODES = ['default', 'acceptEdits', 'auto', 'dontAsk', 'yolo'];

/** session/new 等响应里的配置：mode（当前值可指定）、model、reasoning_effort，外加旧 models 字段。 */
export function qoderConfig(mode: string) {
  return {
    modes: {
      currentModeId: mode,
      availableModes: MODES.map((id) => ({ id, name: id })),
    },
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
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      },
    ],
    models: {
      currentModelId: 'auto',
      availableModels: [
        { modelId: 'auto', name: 'Auto' },
        { modelId: 'performance', name: 'Performance' },
      ],
    },
  };
}

/** Qoder 的权限选项（§7.2）：proceed_once / cancel，修改文件另有 proceed_always。 */
export const QODER_OPTIONS = [
  { optionId: 'proceed_once', name: 'Yes', kind: 'allow_once' },
  { optionId: 'proceed_always', name: 'Yes, always', kind: 'allow_always' },
  { optionId: 'cancel', name: 'No', kind: 'reject_once' },
];

export const msg = (text: string) => ({
  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});
