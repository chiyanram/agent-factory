// ticket-cap — whether a ticket's runs spent its cap (#131; caps.ts holds the caps and how they are read). Pure, and it
// reaches no disk, so the decision table can read it and stay pure (P1).

import { settingName } from "../settings/machine.js";
import type { Caps, Limit } from "./caps.js";
import type { Spend } from "./spend.js";

export function reached(spent: number, limit: Limit): boolean {
  return limit !== "none" && spent >= limit;
}

export function spentLine(spend: Spend): string {
  return `$${spend.usd.toFixed(2)} and ${spend.tokens} tokens`;
}

export function ticketCapped(spent: Spend, caps: Caps): string {
  const { usd, tokens } = caps.ticket;
  const over = reached(spent.usd, usd)
    ? `$${String(usd)} (${settingName("caps.usdPerTicket")})`
    : reached(spent.tokens, tokens)
      ? `${String(tokens)} tokens (${settingName("caps.tokensPerTicket")})`
      : "";
  return over === "" ? "" : `the ticket spent ${spentLine(spent)} since its approval, at its cap of ${over}`;
}
