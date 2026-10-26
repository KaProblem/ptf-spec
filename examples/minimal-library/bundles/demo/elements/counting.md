---
type: Learning Element
ptf_version: "0.1"
id: ptf:el/demo/counting
title: Counting
description: Each number is one more than the one before.
lang: en
levels: [child, highschool]
simulators:
  - ref: ptf:sim/counter@^1.0.0
    station: count
    levels: [child]
    role: explore
status: draft
version: 0.1.0
license: CC-BY-SA-4.0
---

# Core

Counting means adding one, again and again.

# Level: child

Put one apple on the table. Now another. How many are there?

# Misconceptions

- **counting-skips**: You can skip numbers when counting fast → every number comes exactly once.

# Questions

```ptf-question
{
  "kind": "guess_next",
  "id": "q1",
  "level": "child",
  "purpose": "warmup",
  "misconception": "counting-skips",
  "intro": "What comes next?",
  "prefix": "1, 2, 3, ",
  "answer": "4",
  "hint": "Add one apple.",
  "explanation": "3 plus one is 4."
}
```

# Further reading

- [Counting on Wikipedia](https://en.wikipedia.org/wiki/Counting): what counting is, from tally marks to number words (article, section "Counting in mathematics"; highschool).
