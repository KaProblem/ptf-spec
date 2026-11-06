---
type: Learning Element
ptf_version: "0.1"
id: ptf:el/demo/counting
title: Counting
description: Each number is one more than the one before.
lang: en
levels: [child, highschool]
objectives:
  - id: count
    text: Count a small set of objects without skipping or repeating one.
  - id: next-one
    text: Explain why the next number is always one more.
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
figures:
  - id: count-apples
    objectives: [next-one]
    use_when: before explaining why the next number is one more
media:
  - id: sam-apples
    kind: audio
    title: Sam's apples
    src: media/sam-apples.mp3
    sha256: dc2eee8a6c49b60c93cfbfb3a3f4ca61c269ec48f01a78b676f8c42b4c51ebd1
    bytes: 73053
    duration_s: 12.1
    transcript: media/sam-apples.txt
    language: en-US
    speakers: [narrator]
    generator: { tool: piper, voice: en-us-amy-low }
    license: CC-BY-SA-4.0
    objectives: [count]
    levels: [child]
    use_when: the learner should count from listening, without seeing the apples
status: draft
version: 0.6.0
license: CC-BY-SA-4.0
---

# Introduction

- Counting tells us how many things there are.
- Afterwards the learner can count apples and say what comes next.

# Core

Counting means adding one, again and again.

# Level: child

Put one apple on the table. Now another. How many are there?

# Level: highschool

How many numbers are there from 17 to 42? Guess first. Counting means
adding one each time, so every number from 17 to 42 is counted exactly once:
42 − 17 + 1 = 26. Skipping or repeating one gives a wrong total.

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
  "objectives": ["count", "next-one"],
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

```ptf-question
{
  "kind": "estimate_number",
  "id": "q3",
  "level": "highschool",
  "purpose": "probe",
  "objectives": ["count"],
  "misconception": "counting-skips",
  "question": "How many numbers do you say when you count from 17 to 42?",
  "answer": 26,
  "tolerance": 0,
  "explanation": "Every number comes exactly once: 42 − 17 + 1 = 26."
}
```

```ptf-question
{
  "kind": "free_text",
  "id": "q4",
  "level": "highschool",
  "purpose": "check",
  "objectives": ["next-one"],
  "question": "Why is the number after 99 exactly 100, and not 110 or 1000?",
  "rubric": ["Says that counting adds one each time", "Says that 99 + 1 = 100"],
  "sample_answer": "Counting always adds one, and 99 plus one is 100.",
  "explanation": "The next number in counting is always one more than the last one."
}
```

```ptf-question
{
  "kind": "multiple_choice",
  "id": "q5",
  "level": "child",
  "purpose": "check",
  "objectives": ["count"],
  "media": "sam-apples",
  "plays": 2,
  "question": "How many apples are left on the table?",
  "options": [
    { "text": "4", "correct": true, "feedback": "Yes: three, two more makes five, and one eaten leaves four." },
    { "text": "5", "correct": false, "feedback": "Five were on the table, but Sam ate one." },
    { "text": "6", "correct": false, "feedback": "Three and two make five, not six. Then one is eaten." }
  ],
  "explanation": "3 + 2 = 5 apples, and Sam eats one, so 5 − 1 = 4 are left."
}
```

```ptf-question
{
  "kind": "multiple_choice",
  "id": "q6",
  "level": "child",
  "purpose": "check",
  "objectives": ["count"],
  "media": "sam-apples",
  "plays": 2,
  "question": "Who brings the two extra apples?",
  "options": [
    { "text": "Sam's sister", "correct": true, "feedback": "Yes, his sister brings two more." },
    { "text": "Sam", "correct": false, "feedback": "Sam puts the first three on the table." },
    { "text": "Sam's dad", "correct": false, "feedback": "Sam's dad is not in the story." }
  ],
  "explanation": "The story says: his sister brings two more apples."
}
```

# Further reading

- [Counting on Wikipedia](https://en.wikipedia.org/wiki/Counting): what counting is, from tally marks to number words (article, section "Counting in mathematics"; highschool).
