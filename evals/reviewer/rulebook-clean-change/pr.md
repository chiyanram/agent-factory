# fix(cli): strip the spaces around FACTORY_CLAIM_LABEL (#999)

A label set as `FACTORY_CLAIM_LABEL=" agent::claimed"` passed the blank check, then never matched the label on
the forge. claimLabel strips it once, and poll, claim, dispatch and the writer all read it from there. A blank
one is still refused where it was refused before.
