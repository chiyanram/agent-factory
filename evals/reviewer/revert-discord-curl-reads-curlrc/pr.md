# fix(notify): the discord plugin honours the user's curl settings (#999)

A machine behind a corporate proxy sets it in ~/.curlrc; --disable made the ping fail there.
