# Set up the Discord door

The Discord door lets a person START a ticket, approve its spec and design, and read the board from Discord. It is
`agent-factory door discord`: a code-only bot, separate from the chat bot the coordinator talks through. It never reads
chat, so typing "approve" in a channel does nothing. It writes the same records as the terminal, with `via: discord`
([ADR-0023](../adr/0023-front-doors-are-engine-commands.md), [ADR-0012](../adr/0012-safety-design-for-unattended-runs.md)
S1).

**Check against #729:** the Developer Portal and invite steps below follow Discord's documentation, and the operator's
hand test has not run them yet. Each step that the hand test checks is marked *(to check)*.

## What you need

- A Discord server you can add a bot to, with one text channel per project. Threads in that channel count as the
  project's.
- On the VM, the `factory` OS user, which owns the factory home. On a laptop your own user runs the door. The developer
  user can then read the token, so the human merge review stays the hard gate.
- Developer Mode in Discord (User Settings → Advanced), so you can copy ids.

## 1. Make the door bot *(to check)*

1. In the [Developer Portal](https://discord.com/developers/applications), make a **New Application**, named for
   example `factory-door`. Make it separate from the coordinator's chat bot.
2. On the **Bot** tab:
   - turn **Public Bot** off;
   - leave every **Privileged Gateway Intent** off, because the door takes the `Guilds` intent only;
   - choose **Reset Token**, and copy the token once.
3. On **OAuth2 → URL Generator**, pick the scopes `bot` and `applications.commands`. It needs no bot permission. Open
   the URL, and add the bot to your server.

Never paste the token into chat, into Claude Code or into a file your coordinator's user can read.

## 2. Store the token

Run this as the user that runs the door (on the VM, `factory`):

```sh
sudo -u factory -H agent-factory setup door-discord
```

Paste the token at the hidden prompt. It is stored in `<factory home>/door/discord/token`, mode `0600`, in a folder
of mode `0700`, and it is never printed. The door refuses to start if group or others can read the file, if another
user owns it, or if group or others can write `<factory home>/door` or `<factory home>/door/discord`.

## 3. Map people and channels

Write `<factory home>/door/discord/people.json`, owned by the same user, and writable by no one else:

```json
{
  "guild": "<server id>",
  "channels": { "<channel id>": "<project>" },
  "people": { "<Discord user id>": "<name, as the records' by>" }
}
```

```sh
sudo -u factory chmod 600 <factory home>/door/discord/people.json
```

The door answers only in that server, in a mapped channel or a thread of one, and only to a mapped person. It refuses
a bot, an unmapped id, a direct message and any other channel. The door reads `people.json` at boot, so restart it
after a change.

## 4. Run it

```sh
sudo -u factory -H agent-factory door discord
```

It connects out to Discord and opens no port. Keep it running under your service manager, for example a systemd unit
with `User=factory`, `ExecStart=agent-factory door discord` and `Restart=on-failure` *(to check)*. It exits 1 only
when Discord refuses its token or intent; a dropped connection, or Discord out of reach, is tried again every 5
seconds.

## 5. Use it *(to check)*

In the project's channel, or a thread of it:

| command | what it does |
|---|---|
| `/start ticket:<id>` | START the ticket. When `factory/<id>` is already on the git host, it asks first: press **Confirm** to START anyway |
| `/approve ticket:<id>` | answers only to you with the lane, the spec's and the design's full hashes, and both texts as files. Read them, then press **Confirm** within 10 minutes. It approves exactly those hashes: an edit to either in between is refused, and you run `/approve` again |
| `/review-again ticket:<id>` | at the design-review round cap: answers only to you with the spec's full hash and its text as a file. **Confirm** within 10 minutes runs one more design-review round at exactly that hash |
| `/board` | the project's board, read only, only to you |

Only the person who ran `/approve` can press its Confirm, and each Confirm works once. A spec or design that holds
text shaped like a secret is refused, because Discord would show it hidden and you would approve words you did not
see: approve that one at the terminal. A restart of the door drops
every pending Confirm. Waive and merge stay at the terminal and on the git host.

## Rotate the token

Reset the token in the Developer Portal, run `setup door-discord` again, then restart the door.
