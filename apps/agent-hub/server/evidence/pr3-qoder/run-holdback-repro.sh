#!/usr/bin/env bash
# 审查 6042967785 的真侧车复现（先 pnpm --filter @agent-hub/server build）：
#   evidence/pr3-qoder/run-holdback-repro.sh <a|b|c> <outname>
# 侧车 node dist/main.js + 假 Qoder（test/fakes/fake-acp.mjs），跑完从 hub.db 取落库事件，用 check-db.mjs 找密钥片段。
set -u
WT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
SRV=$WT/apps/agent-hub/server
EV=$SRV/evidence/pr3-qoder
KIND=$1; OUT=$EV/$2.txt
H=/tmp/ah-hb-$2; rm -rf "$H" && mkdir -p "$H/home" "$H/repo" && chmod 700 "$H/home"
git -C "$H/repo" init -q && git -C "$H/repo" -c user.name=x -c user.email=x@x commit -q --allow-empty -m init
SECRETS=$(node "$EV/holdback-scenario.mjs" "$H/qoder.json" "$KIND")
export FAKE_ACP_SCENARIO="$H/qoder.json"
cat > "$H/home/config.json" <<J
{ "agents": [ { "id": "qoder", "kind": "acp", "profile": "qoder", "displayName": "Qoder", "command": "$SRV/test/fakes/fake-acp.mjs", "args": [], "envPassthrough": ["FAKE_ACP_SCENARIO"] } ],
  "repos": [ { "id": "hb-repo", "name": "hb-repo", "path": "$H/repo" } ], "defaultRepoId": "hb-repo" }
J
cd "$SRV"; AGENT_HUB_HOME="$H/home" node dist/main.js >"$H/stdout" 2>"$H/stderr" & PID=$!
for i in $(seq 1 50); do grep -q '"ready"' "$H/stdout" 2>/dev/null && break; sleep 0.2; done
B=$(cat "$H/home/bridge-token")
U="http://127.0.0.1:47821/api/v1"
q() { curl -s -H "Host: 127.0.0.1:47821" -H "Authorization: Bearer $B" -H 'content-type: application/json' "$@"; }
for i in $(seq 1 100); do q $U/agents | grep -q '"status":"ready"' && break; sleep 0.1; done
{
echo "# $(date '+%F %T %Z') 剧本 $KIND  commit=$(git -C $WT rev-parse --short HEAD)  侧车=node dist/main.js  假 Qoder=test/fakes/fake-acp.mjs"
R=$(q -X POST $U/tasks -d '{"agentId":"qoder","prompt":"跑一下，只读。"}')
ID=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin)["task"]["id"])')
echo "task=$ID"
q "$U/tasks/$ID/wait?until=turn_end&timeoutSec=60" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("wait:",json.dumps({k:d[k] for k in d if k in ("reached","status","timedOut")},ensure_ascii=False) if isinstance(d,dict) else d)'
sleep 0.5
echo; echo "## 从 hub.db 取落库事件检查（$H/home/hub.db）"
node "$EV/check-db.mjs" "$H/home/hub.db" "$ID" "$SECRETS"
echo "check-db exit=$?"
echo; echo "## 桥接 REST /events 同样检查（全部事件的 JSON 里找片段）"
q "$U/tasks/$ID/events?limit=1000" > "$H/bridge-events.json"
node -e '
const fs=require("fs");const {secrets}=JSON.parse(process.argv[2]);const s=fs.readFileSync(process.argv[1],"utf8");
let n=0;for(const [k,b] of Object.entries(secrets))for(let i=0;i+8<=b.length;i++)if(s.includes(b.slice(i,i+8))){n++;console.log("LEAK bridge",k,b.slice(i,i+8));break;}
console.log(n?"bridge 有泄漏":"bridge 响应里没有任何密钥片段");' "$H/bridge-events.json" "$SECRETS"
} 2>&1 | sed -E 's/(ahu_|ahb_|aht_)[A-Za-z0-9_-]{20,}/\1<redacted>/g' > "$OUT"
kill -TERM $PID; wait $PID 2>/dev/null; echo "## 侧车 SIGTERM exit=$?" >> "$OUT"
echo done "$OUT"
