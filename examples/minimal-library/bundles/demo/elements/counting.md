---
type: Learning Element
ptf_version: "0.1"
id: ptf:el/demo/counting
title: Counting
description: Each number is one more than the one before.
lang: en
levels: [child, highschool]
objectives:
  - Count a small set of objects without skipping or repeating one.
  - Explain why the next number is always one more.
about:
  - wikidata: Q247154
    label: counting
simulators:
  - ref: ptf:sim/counter@^1.0.0
    station: count
    levels: [child]
    role: explore
    use_when: the learner wants to see the apples instead of imagining them
code:
  - ref: ptf:code/counting@^1.0.0
    step: count
    levels: [highschool]
    note: Let the learner change the number and run it again.
status: draft
version: 0.1.0
license: CC-BY-SA-4.0
---

# Introduction

- Counting tells us how many things there are.
- Afterwards the learner can count apples and say what comes next.

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

```ptf-question
{
  "kind": "multiple_choice",
  "id": "q2",
  "level": "child",
  "purpose": "check",
  "misconception": "counting-skips",
  "question": "You count 5, 6, … Which number comes after 6?",
  "options": [
    { "text": "7", "correct": true, "feedback": "Yes: 6 plus one is 7." },
    { "text": "8", "correct": false, "feedback": "That skips 7. Every number comes exactly once." },
    { "text": "6", "correct": false, "feedback": "6 is the number you are at. Add one more." }
  ],
  "explanation": "When you count, the next number is always one more."
}
```

# Further reading

- [Counting on Wikipedia](https://en.wikipedia.org/wiki/Counting): what counting is, from tally marks to number words (article, section "Counting in mathematics"; highschool).
