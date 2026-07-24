#!/bin/zsh
# Unattended session keep-alive, run on a schedule (launchd). Refreshes the
# JWT/session/Cloudflare cookies without any human whenever possible — only
# escalates to Slack when a real password + 2FA login is due: either the
# Auth0 remembered-device cookie (~6 day TTL) has expired (LOGIN_REQUIRED),
# or the refresh reported success but a real API call still failed
# (VALIDATION_FAILED — seen live 2026-07-23, `kajabi refresh` now checks
# for this itself instead of trusting the browser flow's own say-so).
#
# Slack transport is borrowed from metrics-engine (core.escalate.escalate),
# same pattern loop-ops/heartbeat_alert.py uses — kajabi-cli holds no Slack
# token of its own. Degrades to the log file if that's unavailable; never
# crashes the refresh itself.
set -uo pipefail
cd "$(dirname "$0")/.."

NVM_BIN="$HOME/.nvm/versions/node/v22.20.0/bin"
LOG="logs/refresh-cron.log"
mkdir -p logs

METRICS_HOME="$HOME/projects/meta-build/metrics-engine"
METRICS_PY="$METRICS_HOME/.venv/bin/python"

OUT=$(KAJABI_LOGIN_TIMEOUT_MS=15000 PATH="$NVM_BIN:$PATH" "$NVM_BIN/node" bin/kajabi refresh 2>>"$LOG")
STATUS=$?
echo "$(date -u +%FT%TZ) refresh -> ${OUT:-<empty>} (exit $STATUS)" >>"$LOG"

if [ ! -x "$METRICS_PY" ]; then
  echo "$(date -u +%FT%TZ) metrics-engine venv not found — cannot escalate" >>"$LOG"
  exit 0
fi

"$METRICS_PY" -c "
import sys
sys.path.insert(0, '$METRICS_HOME')
from core.escalate import escalate, current_state

result = '''$OUT'''.strip()
key = 'kajabi-cli:login_required'

if result == 'LOGIN_REQUIRED':
    escalate(key, 'open',
        ':rotating_light: *Kajabi session:* the ~6-day remembered-device cookie '
        'expired — a real password + 2FA login is due.\n'
        '> what to do: *run \`kajabi stats\` in a terminal on this Mac to re-login (~60s)*')
elif result == 'VALIDATION_FAILED':
    escalate(key, 'open',
        ':rotating_light: *Kajabi session:* auto-refresh reported success but a real '
        'API call still failed (stale/invalid session) — a real password + 2FA login is due.\n'
        '> what to do: *run \`kajabi stats\` in a terminal on this Mac to re-login (~60s)*')
elif result == 'REFRESHED' and current_state(key) == 'open':
    escalate(key, 'recovered',
        ':white_check_mark: *Kajabi session:* re-logged in, auto-refresh resumed.')
" >> "$LOG" 2>&1

exit 0
