# perf(push): match the agent settings without lower-casing every path (#999)

isAgentSetting lower-cased every path of every tree on each push. Git paths are case-sensitive, so the match
is now exact.
