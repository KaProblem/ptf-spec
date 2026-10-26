# PTF Content Policy and Review

**Version 0.1 (draft)** · part of the [Personal Tutor Format](SPEC.md)

Shared PTF libraries accept contributions from people and from AI agents.
Manual review does not scale to that, so every contribution goes through
automated gates, and only content that passes them is merged. This document
says what a library accepts, and how a reviewer (human or model) decides.

A library MAY adopt a stricter policy. It SHOULD NOT adopt a weaker one if it
is public.

---

## 1. What a library accepts

PTF content teaches understanding. Any subject can be taught **factually**,
including difficult ones: the history of National Socialism, how propaganda
works, how diseases spread, how encryption is broken, how drugs act on the
body. The question is not the topic but what the content makes the learner
able and willing to do.

A library MUST NOT accept content that:

1. **Promotes or glorifies** hatred, extremism, terrorism or violence against
   people or groups, or presents such ideologies as desirable (e.g. a path
   "how to become a good Nazi"). Explaining what these ideologies claim, why
   people fall for them and what they led to is fine.
2. **Gives operational uplift for serious harm**: weapons capable of mass
   casualties, synthesis of dangerous substances, attacks on infrastructure,
   malware, evading law enforcement, self-harm methods.
3. **Demeans people** for protected characteristics, or harasses real,
   identifiable individuals.
4. **Is sexual**, or otherwise unsuitable for the levels it declares. Content
   with `child` or `highschool` levels MUST be suitable for children.
5. **Deceives**: presents falsehoods, pseudoscience or conspiracy theories as
   fact. Teaching *about* them, clearly framed, is fine.
6. **Collects personal data** or tries to reach the learner outside the
   lesson (links to sign-up pages, contact requests).
7. **Infringes rights**: copies copyrighted text, images or code that the
   contributor may not license under the library's licenses. Sources are for
   grounding; the text is written fresh.

Content that touches a sensitive topic SHOULD say so in its frontmatter
(`tags: [sensitive]`) and SHOULD set a minimum level (no `child` level).

---

## 2. Review gates

A contribution is a pull request. It is merged only when all gates pass.

| Gate | Checks | Who |
| --- | --- | --- |
| 1. Format | `ptf-check`: schemas, required headings, IDs, ranges resolve, integrity, forbidden APIs in simulators, size | CI |
| 2. Self-test | `ptf-selftest` for every new or changed simulator version | CI |
| 3. Policy | §1 above. Any violation rejects the PR. | Model reviewer in CI |
| 4. Quality | The rubric in §3. Each criterion is scored; the PR needs all "must" criteria and a total of at least 70 %. | Model reviewer in CI |
| 5. Human | Required only when gate 3 is unsure, when a published simulator's behaviour or a `reviewed`/`proven` element's Core changes, or when the contributor is new to the library. | Maintainer |

The model reviewer reads the diff and the full changed files, gives a verdict
per criterion with a one-line reason, and posts it as a PR review. It MUST
NOT see learner records. It SHOULD use a different model (or at least a fresh
context) from the one that wrote the content.

Merged content keeps `status: draft` until learner data shows it works
(SPEC.md §10). A human sets `reviewed`; learner data promotes to `proven`.

---

## 3. Quality rubric

**Must** (any failure blocks the merge):

1. **Correct.** Core, Key facts and every question's answer are factually
   right at the level they are written for. Simplifications are allowed, false
   statements are not. Numbers and formulas are checked.
2. **Self-contained.** Learner-facing text never refers to the source
   material ("as in the video"); a learner who never saw it can follow.
3. **Policy.** Nothing in §1.
4. **Stable IDs.** Changes keep existing element, question and misconception
   IDs, or bump the major version and say why.

**Should** (scored):

5. **Starts with an experience.** Level texts and simulator stations begin
   with something to try or guess.
6. **Level fit.** Vocabulary, length and depth match each declared level.
7. **Misconceptions.** Real, commonly held wrong beliefs, each with a short ID,
   the wrong belief and the correct view; questions target them.
8. **Questions.** Each has an explanation; wrong options have useful feedback.
9. **Small steps.** One concept per element; prerequisites listed in
   `requires`.
10. **Versioned honestly.** `version` bumped by the rules in SPEC.md §9 and
    SIMULATOR-SPEC.md §3; `log.md` and `CHANGELOG.md` updated.
11. **Improves on what exists.** A change to an existing element states what
    problem it fixes (e.g. "learners often chose the `softmax-makes-zeros`
    option"), using only aggregated, anonymous data.

---

## 4. Tutors

A tutor (an agent teaching from a library) applies §1 to the **learning goal**,
not only to the content: it does not teach a goal whose purpose is to harm
people, even if related material exists, and it offers a legitimate angle
instead. A tutor SHOULD load libraries only from sources the learner trusts.
