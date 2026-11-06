# Tokens by phase (ADR-0011 D16; rulebook crq RT1). Source it after runs.sh; do not run it.
#
# Every run's record is kept per head under $FACTORY_REPO/.claude/runs/<mr>/<head>/:
#   reviewer-find.json, reviewer-verify-rule.json, reviewer-verify-logic.json   each pass's `claude -p` answer
#   writer-<session>.jsonl                                                       each writer session's transcript
# A writer runs in the worktree .claude/worktrees/writer-<mr>, so Claude Code keeps its transcripts in
# ${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<that path, each character but a letter, a digit or "-" made "-">/.
# The reviewer copies the ones it has not seen into the head it reviews. A token count is input, cache writes,
# cache reads and output together.

# record_dir MR HEAD : the folder that keeps one head's records.
record_dir() { printf '%s/.claude/runs/%s/%s' "$FACTORY_REPO" "$1" "$2"; }

# writer_transcripts MR : the folder where Claude Code keeps the transcripts of the MR's writer sessions.
writer_transcripts() {
  wt_real=$(cd "$FACTORY_REPO" && pwd -P)/.claude/worktrees/writer-$1
  printf '%s/projects/%s' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$(printf '%s' "$wt_real" | sed 's/[^A-Za-z0-9-]/-/g')"
}

# keep_writer_transcripts MR HEAD : copies each writer transcript of the MR that no head has yet into HEAD's records,
# so the tokens spent on the way to HEAD are counted with it. Prints how many it copied.
keep_writer_transcripts() {
  kw_src=$(writer_transcripts "$1") kw_dir=$(record_dir "$1" "$2") kw_n=0
  for kw_t in "$kw_src"/*.jsonl; do
    [ -f "$kw_t" ] || continue
    kw_name=writer-$(basename "$kw_t")
    ls "$FACTORY_REPO/.claude/runs/$1"/*/"$kw_name" > /dev/null 2>&1 && continue
    mkdir -p "$kw_dir" && cp "$kw_t" "$kw_dir/$kw_name" && kw_n=$((kw_n + 1))
  done
  echo "$kw_n"
}

# tokens_in FILE... : the tokens the records spent; a FILE that does not exist counts 0. A transcript repeats a
# message once per content block, so each message id counts once; a `claude -p` answer counts its usage; a line that
# is not JSON is skipped.
tokens_in() {
  for ti_f in "$@"; do [ -f "$ti_f" ] && cat "$ti_f"; done \
    | jq -cR 'fromjson? | if .type == "assistant" then {id: .message.id, u: .message.usage}
      elif .usage then {id: null, u: .usage} else empty end | select(.u != null)' \
    | jq -s '(map(select(.id == null)) + (map(select(.id != null)) | unique_by(.id)))
      | map(.u | (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)
      + (.output_tokens // 0)) | add // 0'
}
