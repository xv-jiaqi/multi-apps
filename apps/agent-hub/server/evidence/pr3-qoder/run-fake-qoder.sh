#!/usr/bin/env bash
# usage: evidence/pr3-qoder/run-fake-qoder.sh（先 pnpm --filter @agent-hub/server build） <normal|logged-out> <outname>
set -u
WT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
SRV=$WT/apps/agent-hub/server
EV=$SRV/evidence/pr3-qoder
KIND=$1; OUT=$EV/$2.txt
H=/tmp/ah-ev3-$2; rm -rf "$H" && mkdir -p "$H/home" && chmod 700 "$H/home"
git clone -q "$WT" "$H/repo" 2>/dev/null
node "$EV/qoder-scenario.mjs" "$H/qoder.json" "$KIND"
export FAKE_ACP_SCENARIO="$H/qoder.json"
cat > "$H/home/config.json" <<J
{ "agents": [ { "id": "qoder", "kind": "acp", "profile": "qoder", "displayName": "Qoder", "command": "$SRV/test/fakes/fake-acp.mjs", "args": [], "envPassthrough": ["FAKE_ACP_SCENARIO"] } ],
  "repos": [ { "id": "multi-apps", "name": "multi-apps", "path": "$H/repo" } ], "defaultRepoId": "multi-apps" }
J
cd "$SRV"; AGENT_HUB_HOME="$H/home" node dist/main.js >"$H/stdout" 2>"$H/stderr" & PID=$!
for i in $(seq 1 50); do grep -q '"ready"' "$H/stdout" 2>/dev/null && break; sleep 0.2; done
red() { sed -E 's/(ahu_|ahb_|aht_)[A-Za-z0-9_-]+/\1<redacted>/g; s/"uiToken":"[^"]*"/"uiToken":"<redacted>"/g'; }
B=$(cat "$H/home/bridge-token"); UT=$(python3 -c 'import json,sys;print(json.loads(open(sys.argv[1]).readline())["uiToken"])' "$H/stdout")
U="http://127.0.0.1:47821/api/v1"
j() { python3 -m json.tool --no-ensure-ascii 2>/dev/null; }
c() { local tok=$1 who=$2; shift 2; echo; echo "\$ curl -s -X $1 $U$2 -H 'Authorization: Bearer <$who>' ${3:+-d '$3'}"; curl -s -X "$1" -H "Host: 127.0.0.1:47821" -H "Authorization: Bearer $tok" -H 'content-type: application/json' "$U$2" ${3:+-d "$3"} | j; }
pending() { for i in $(seq 1 100); do A=$(curl -s -H "Host: 127.0.0.1:47821" -H "Authorization: Bearer $UT" "$U/approvals?status=pending&taskId=$1" | python3 -c 'import json,sys;i=json.load(sys.stdin)["items"];print(i[0]["id"] if i else "")'); [ -n "$A" ] && break; sleep 0.1; done; echo "$A"; }
{
echo "# $(date '+%F %T %Z') 假 Qoder（test/fakes/fake-acp.mjs，剧本 $KIND，帧照 Qoder CLI 1.1.80 实测）  commit=$(git -C $WT rev-parse --short HEAD)  侧车=node dist/main.js"
echo "## stdout (ready line)"; red < "$H/stdout"
echo "## listening sockets（ss -ltnp）"; ss -ltnp | grep -E "pid=$PID,"
for i in $(seq 1 100); do curl -s -H "Host: 127.0.0.1:47821" -H "Authorization: Bearer $B" $U/agents | grep -q '"status":"\(ready\|auth_required\|unavailable\)"' && break; sleep 0.1; done
c "$B" bridgeToken GET /agents
R=$(curl -s -X POST -H "Host: 127.0.0.1:47821" -H "Authorization: Bearer $B" -H 'content-type: application/json' $U/tasks -d '{"agentId":"qoder","prompt":"看看健康检查接口能不能通，只读。"}')
echo; echo "\$ curl -s -X POST $U/tasks -H 'Authorization: Bearer <bridgeToken>' -d '{\"agentId\":\"qoder\",\"prompt\":\"看看健康检查接口能不能通，只读。\"}'"; echo "$R" | j
ID=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin)["task"]["id"])')
if [ "$KIND" = normal ]; then
  A=$(pending "$ID")
  c "$B" bridgeToken GET "/approvals?status=pending&taskId=$ID"
  c "$UT" uiToken POST "/approvals/$A/decision" '{"decision":"allow_once"}'
  c "$B" bridgeToken GET "/tasks/$ID/wait?until=turn_end&timeoutSec=30"
  echo; echo "# 桥接 token 读事件：curl -v -u 带出的 Authorization: Basic 已脱敏（审查 6041423500 第 2 条）"
  c "$B" bridgeToken GET "/tasks/$ID/events?limit=500"
  echo; echo "# 同一段工具输出，UI token 看到原文（本机用户自己的输出）："
  curl -s -H "Host: 127.0.0.1:47821" -H "Authorization: Bearer $UT" "$U/tasks/$ID/events?limit=500" | python3 -c 'import json,sys
evs=json.load(sys.stdin)["events"]
print("".join(e["event"].get("text","") for e in evs if e["event"]["type"]=="tool.output.delta"))'
  echo; echo "# 追问：修改 README 的审批被拒（Qoder 的 cancel 选项）；Agent 自己切到 yolo，Hub 切回 default"
  L=$(curl -s -H "Host: 127.0.0.1:47821" -H "Authorization: Bearer $B" "$U/tasks/$ID/events?limit=500" | python3 -c 'import json,sys;print(json.load(sys.stdin)["lastSeq"])')
  c "$B" bridgeToken POST "/tasks/$ID/turns" '{"prompt":"顺手把 README 改一下"}'
  A=$(pending "$ID")
  c "$UT" uiToken POST "/approvals/$A/decision" '{"decision":"reject"}'
  c "$B" bridgeToken GET "/tasks/$ID/wait?until=turn_end&timeoutSec=30"
  echo; echo "# 第 2 轮的事件（seq > $L 的部分）："
  c "$B" bridgeToken GET "/tasks/$ID/events?afterSeq=$L&limit=500"
  echo; echo "\$ git -C <repo> status --porcelain"; git -C "$H/repo" status --porcelain
  echo; echo "# Hub 发给假 Qoder 的请求与回复（<-，fake-acp 的帧日志；只列方法与关键参数）"
  python3 - "$H/qoder.json.log" <<'P'
import json,sys
for line in open(sys.argv[1]):
    if not line.startswith('<- '): continue
    m=json.loads(line[3:])
    if 'method' in m:
        p=m.get('params',{})
        keep={k:p[k] for k in ('sessionId','configId','value','cwd') if k in p}
        if m['method']=='session/prompt': keep['prompt']=p['prompt'][0]['text']
        if m['method']=='initialize': keep={'protocolVersion':p['protocolVersion'],'clientCapabilities':p['clientCapabilities']}
        print('<-', m['method'], json.dumps(keep, ensure_ascii=False))
    else:
        print('<- 回复', m.get('id'), json.dumps(m.get('result', m.get('error')), ensure_ascii=False))
P
else
  c "$B" bridgeToken GET "/tasks/$ID/wait?until=turn_end&timeoutSec=30"
  echo; echo "# 帧日志里没有 authenticate："; grep -c '"method":"authenticate"' "$H/qoder.json.log" || true
fi
echo; echo "## SIGTERM"
} 2>&1 | red > "$OUT"
kill -TERM $PID; wait $PID 2>/dev/null; echo "exit=$?" >> "$OUT"
echo "## stderr" >> "$OUT"; red < "$H/stderr" | tail -5 >> "$OUT"
echo "## 侧车退出后还活着的 fake-acp 进程数：$(pgrep -fc "fake-acp.mjs" || true)" >> "$OUT"
echo done "$OUT"
