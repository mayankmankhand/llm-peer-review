---
name: review-page
description: How the standing review page is rendered and how it reaches the user. Loaded by name only when a review's HTML gate fires, right before the render. Not a command.
user-invocable: false
---

# Review Page Rules (loaded by name)

<!-- html-viewing.md is also the whole body of the html-viewing skill, which /explore and /audit-html load for pages with no review shell. It is pasted here as well because an inline is one level deep (a skill cannot pull in another skill's inlines) and one load at the gate is cheaper than two. Edit the fragment, never a copy. -->

!`cat .claude/skills/shared/html-render-review.md`

!`cat .claude/skills/shared/html-viewing.md`
