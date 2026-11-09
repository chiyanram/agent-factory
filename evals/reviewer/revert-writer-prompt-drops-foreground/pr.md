# refactor(writer): a shorter prompt for every mode (#999)

The completion window (#182) decides a run that hangs after a valid report, so the prompt no longer needs to
say how to run commands. Saves about 40 tokens a run.
