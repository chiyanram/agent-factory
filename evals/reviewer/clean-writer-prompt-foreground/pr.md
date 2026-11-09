# fix(writer): every writer prompt says to run subagents and commands in the foreground (#192) (#210)

The writer's run ends when the model stops. A subagent or a command left
in the background is then lost, or holds the process open (#182).
FOREGROUND in src/core/writer/step.ts is added by promptFor to all four
writer modes, and a test checks each one.
