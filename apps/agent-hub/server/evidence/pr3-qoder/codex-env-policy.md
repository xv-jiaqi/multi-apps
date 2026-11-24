# 真 codex-cli 0.164.0：shell_environment_policy 与守卫变量（PR3 待办 5）

2026-11-24 23:17 (Asia/Shanghai) 在开发机上用 `CODEX_BIN=<codex 0.164.0> node codex-env-policy.mjs` 采集。
每行起一个真 `codex app-server`（`CODEX_HOME` 是只含该行 config.toml 的空目录，未登录），进程环境里带着 Hub 的守卫变量，
`thread/start` 后用 `thread/shellCommand` 在本机跑一条 echo，看命令进程实际拿到的变量。路径是示例值。

结论：`inherit = "none"` / `"core"`、`exclude` 会剥掉守卫变量，`set` 能盖回来；`include_only` 在 `set` 之后过滤，只 `set` 不够。
Hub 的做法（`set` 守卫变量 + `include_only = []`）在所有组合下命令都拿到守卫变量。

命令: echo "GAP=${GIT_ALLOW_PROTOCOL:-unset} GCC=${GIT_CONFIG_COUNT:-unset} HOOKS=${GIT_CONFIG_VALUE_0:-unset} ASKPASS=${GIT_ASKPASS:-unset}"

| config.toml 的 shell_environment_policy | thread/start 的 config              | 命令看到的守卫变量                                                  |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| （不设）                                | none                                | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| （不设）                                | set only                            | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| （不设）                                | set + include_only=[]（Hub 的做法） | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| inherit = "none"                        | none                                | GAP=unset GCC=unset HOOKS=unset ASKPASS=unset                       |
| inherit = "none"                        | set only                            | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| inherit = "none"                        | set + include_only=[]（Hub 的做法） | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| include_only = ["PATH","HOME"]          | none                                | GAP=unset GCC=unset HOOKS=unset ASKPASS=unset                       |
| include_only = ["PATH","HOME"]          | set only                            | GAP=unset GCC=unset HOOKS=unset ASKPASS=unset                       |
| include_only = ["PATH","HOME"]          | set + include_only=[]（Hub 的做法） | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| exclude = ["GIT_*","GH_*","SSH_*"]      | none                                | GAP=unset GCC=unset HOOKS=unset ASKPASS=unset                       |
| exclude = ["GIT_*","GH_*","SSH_*"]      | set only                            | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| exclude = ["GIT_*","GH_*","SSH_*"]      | set + include_only=[]（Hub 的做法） | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| inherit = "core"                        | none                                | GAP=unset GCC=unset HOOKS=unset ASKPASS=unset                       |
| inherit = "core"                        | set only                            | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
| inherit = "core"                        | set + include_only=[]（Hub 的做法） | GAP=file GCC=1 HOOKS=/hub/guard/hooks ASKPASS=/hub/guard/askpass.sh |
