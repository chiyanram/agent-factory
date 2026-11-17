# Set up the coordinator in Discord

`agent-factory coordinator <project> --discord` runs the project coordinator in the project's Discord channel, so you
can talk to it from a phone. It is Claude Code with its official Discord channel plugin
(`discord@claude-plugins-official`), in the coordinator's folder, behind the same wall as in a terminal
([ADR-0012](../adr/0012-safety-design-for-unattended-runs.md) S2). START and approve never go through it: they go
through the separate door bot ([Set up the Discord door](set-up-discord-door.md)).

- One channel per project, and one bot and one coordinator session per channel.
- You make one thread per ticket by hand. The session sees the channel and all its threads, and relays your words to
  each ticket's own session, quoting them exactly.
- Chat is data (P5). A permission button the bot sends you by DM is consent to one tool call, never an approval.

**Check against #729:** the operator's hand test has not run these steps yet. Each step it checks is marked *(to
check)*. **Today:** the service that keeps the session up is #748, so for now run it in a terminal.

## What you need

- Claude Code with a claude.ai login (channels need one), and the plugin installed at **user** scope:
  `claude plugin install discord@claude-plugins-official --scope user`. Never install it at project scope, which writes
  into the folder. **Today:** the launch does not yet refuse a plugin that is off (#555).
- `agent-factory setup coordinator` run once, so the coordinator's folder holds its wall.
- On the VM, the coordinator's own OS user, which is not `factory`. On a laptop, your own user.
- Developer Mode in Discord (User Settings → Advanced), so you can copy ids.

## 1. Make the channel bot *(to check)*

1. In the [Developer Portal](https://discord.com/developers/applications), make a **New Application**, named for
   example `ledger-coordinator`. It is separate from the door bot.
2. On the **Bot** tab: turn **Public Bot** off, turn **Message Content Intent** on, then **Reset Token** and copy the
   token once.
3. On **OAuth2 → URL Generator**, pick the scope `bot` and the permissions View Channels, Send Messages, Send Messages
   in Threads, Read Message History, Add Reactions, Attach Files and Embed Links. Open the URL, and add the bot to your
   server.

Never paste the token into chat or into Claude Code: `/discord:configure <token>` would put it in the transcript.

## 2. Store the token by hand

As the coordinator's OS user, in the project's own state folder:

```sh
mkdir -p ~/.claude/channels/discord-ledger && cd ~/.claude/channels/discord-ledger && chmod 700 .
umask 077; read -rs T; printf 'DISCORD_BOT_TOKEN=%s\n' "$T" > .env; unset T; ls -l .env   # expect -rw-------
```

The launch refuses a `.env` that is missing, a link, another user's (the plugin would silently skip it) or readable by
group or others. It never reads the token itself.

## 3. Write access.json

In the same folder, with the server's people and the project's channel id:

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["<your user id>"],
  "groups": { "<channel id>": { "requireMention": false, "allowFrom": ["<your user id>"] } },
  "pending": {}
}
```

The launch refuses, before Claude starts:

- a `dmPolicy` other than `allowlist`, or an empty `allowFrom`;
- `groups` with anything but the one project channel;
- a channel `allowFrom` that is empty or not the same people as `allowFrom`. The plugin lets anyone who passes the
  channel's gate answer a permission prompt by text (`yes <id>`), so with an empty list anyone in the channel could
  allow a tool call. **Today:** this rests on a reading of the plugin's code that #729 confirms;
- pending pairings, and a file or folder that group or others can write.

List the same people as the door's `people.json`. The guided setup that writes both from one list is #744.

On the VM, make the file root's and read-only, so the coordinator's user cannot loosen it:

```sh
sudo chown root:root ~coordinator/.claude/channels/discord-ledger/access.json
sudo chmod 444 ~coordinator/.claude/channels/discord-ledger/access.json
```

On a laptop your own user owns it, and the launch warns: it checks the file again at every start.

## 4. Give the coordinator its own model token

So that a usage limit the runs hit does not silence the chat, give the coordinator its own token
([#550](https://github.com/chiyanram/agent-factory/issues/550)). As the coordinator's OS user:

```sh
claude setup-token
agent-factory setup claude --seat coordinator
```

It is stored in that user's `~/.config/agent-factory/secrets` (the Keychain on macOS), apart from the runs' token, and
goes to Claude Code in the environment, never on the command line. `agent-factory setup status` shows it. With none,
the coordinator uses its own claude login and warns.

## 5. Start it *(to check)*

```sh
agent-factory coordinator ledger --discord
```

It starts fresh every time, never with `--continue`, and a SessionStart hook gives the session its role, its wall and
`agent-factory handoff ledger`. Write in the channel, or in a ticket's thread.

## Rotate the token

Reset it in the Developer Portal, write `.env` again as in step 2, and restart the session: static mode reads its
files only at start.
