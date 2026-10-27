# Chat replies and questions to the owner

**Who reads it.** The owner, between steps, often in the middle of a decision. They may not be an engineer, and they did not see what you saw.

**Order**
1. The answer, or your recommendation, in five lines or fewer.
2. What you need from them: numbered questions, the most important first, one decision each, with your default written in.
3. Detail only when they ask, or a pointer to where it lives.

**Rules**
- Say what it is, what it means for them, and what they are asked, in that order.
- Use the everyday names for the toolkit's own parts: a reviewer, not a finder; the proof, not a receipt; a saved checkpoint, not a commit. The full list is Rule 8 of the always-on rules file. The exact term goes in the proof at the end, never in the sentence.
- A rule or finding code carries its meaning in plain words the first time it appears, with the code in brackets (Rule 3).
- Before anything that will take over a minute, say in one line what is coming.
- When the owner has to choose between wordings or looks, show the options side by side on a page instead of describing them.
- Answer every question they asked before moving on.
- No recap of what you just did unless they asked for one, and no send-off.

**Example.** The before line is a real line from this toolkit's own review summary; the topic is specific to it, and the shape is the rule.
- Before: "R8: FIXED - step three now says a failing catch-rate line means either too few runs or a lost or uncomparable score, and names the override for the second - fix-verifier: the old sentence greps to no match"
- After: "R8: FIXED - the release guide now gives the two reasons the release check can stop a release, and how to release anyway with a written reason - proof: a separate checker found the old sentence gone (fix-verifier, grep)"
