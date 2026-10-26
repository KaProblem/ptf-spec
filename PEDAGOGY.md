# PTF Pedagogy Guide

**Version 0.1 (draft)** · part of the [Personal Tutor Format](SPEC.md)

How to build learning elements, paths and simulators that people understand and
remember. This guide is a **recommendation**, not a conformance requirement: a
bundle that ignores it is still valid PTF. Authors, generators and the tutor
skill SHOULD follow it, and the LLM review in CONTENT-POLICY.md §2 MAY use it
as part of its rubric.

Every rule names the research it rests on (§6), so it can be challenged and
replaced when better evidence turns up.

---

## 1. Principles

1. **Start from what the learner already knows.** New knowledge sticks when it
   is attached to something familiar (Ausubel). Open with an everyday
   experience, an object or a question most people can answer, then move
   towards the new idea. For a known learner, the tutor picks the anchor from
   their profile (`interests`, `notes`).
2. **Let them try before you tell.** A short prediction, guess or attempt
   before the explanation makes the explanation land better, even when the
   guess is wrong (generation effect, productive failure). Predict, observe,
   explain.
3. **One idea per step.** Working memory holds only a few new elements at a
   time (cognitive load theory). Split a concept until every step adds one new
   idea; show only what that step needs.
4. **Explain simply, then honestly.** Explain in plain words as if to a
   newcomer, and notice where the plain version is wrong (the "Feynman
   technique"). Every analogy gets a sentence on where it breaks down.
5. **Concrete first, then abstract.** Begin with a concrete case, then fade
   towards the general rule or formula (concreteness fading).
6. **Words and pictures together.** Combine an explanation with a matching
   visual or simulation; do not split attention between text and a distant
   figure (dual coding, Mayer's multimedia principles).
7. **Confront misconceptions directly.** Name the wrong belief, let the
   learner see where it fails, then give the correct view (conceptual change).
   This is why every element has `# Misconceptions`.
8. **Retrieve, don't reread.** Asking the learner to recall or apply something
   strengthens memory far more than showing it again (testing effect). Each
   step ends with a question, not a summary.
9. **Space and mix.** Review after growing intervals instead of all at once
   (spacing effect), and mix related problem types in reviews (interleaving).
   `mastery.json` carries `next_review` for this.
10. **Make the learner explain.** "Why does this happen?" and "explain it in
    your own words" deepen understanding (self-explanation, elaborative
    interrogation).
11. **Master before moving on.** Move to a step only when its prerequisites
    (`requires`) are secure; give more practice where they are not (mastery
    learning).

**Not a principle: matching "learning styles".** Teaching visual learners only
visually and so on has not been shown to improve learning (Pashler et al.,
2008). The profile's `style.modality` is a preference that helps engagement
and the choice of a first representation. Every learner still gets words *and*
visuals and something to try.

---

## 2. The arc of one step

A step is one learning element, or one station of a simulator. Use this order
as a default:

| Phase | What happens | Where it lives in PTF |
| --- | --- | --- |
| Anchor | Something familiar: an experience, an object, a question | Start of a level text, `warmup` question |
| Try | Predict, guess or play with one control | Simulator station, `warmup` question |
| Observe | See what really happens | Simulator station |
| Explain | Plain words, one idea, one analogy and its limit | `# Core`, `# Level: <id>`, `# Examples` |
| Confront | The typical wrong belief and why it fails | `# Misconceptions` |
| Retrieve | Recall or apply without looking | `check` questions |
| Connect | What this enables next | `leads_to`, the next step in the path |

Later sessions add **Review** (spaced `check` questions, mixed with related
elements).

---

## 3. Learning elements

- **Granularity.** One element teaches one concept that can be checked on its
  own. If `# Core` needs more than about five sentences or the element has more
  than one central misconception, split it and connect the parts with
  `requires`.
- **Anchors and analogies** go into `# Examples`, each with a "breaks down
  when" line, so the tutor can choose one that fits the learner.
- **Level texts** start with something to try or picture (SPEC.md §6), use the
  anchor that fits the level, and stay short. The tutor adapts them anyway.
- **Questions.** At least one `warmup` and one `check` question per level.
  Wrong options in multiple-choice questions are real misconceptions with their
  IDs, not filler.

## 4. Learning paths

- Order steps by `requires`, concrete before abstract.
- Keep each step short: one element, about 5 to 15 minutes of activity.
- Revisit earlier ideas in later steps (spiral), and plan review questions
  that mix elements.
- End a path with a step that applies several ideas together.

## 5. Simulators

Early simulators tried to show everything at once. They overwhelm and are hard
to repair. Build them step by step instead:

- **Small stations.** One station teaches one idea (SIMULATOR-SPEC.md §7
  rule 3). Prefer several small stations, or several small simulators, to one
  large dashboard. As a rule of thumb: at most about three controls a learner
  can change in one station, and at most about seven stations in one
  simulator. Beyond that, split it.
- **Progressive disclosure.** A station shows only what its idea needs. Later
  stations may add one control or one view at a time.
- **Predict, then reveal.** A station asks for a guess before showing the
  result, and reports the guess as `answered` with the misconception it
  reveals.
- **Familiar first.** The first station starts from something recognisable
  (a sentence, a falling ball, a coin), not from the formal model.
- **A clear end.** Every station has a small task and emits
  `station_completed` when it is done, so the tutor knows when to move on.

---

## 6. Evidence

- Ausubel, D. P. (1968). *Educational Psychology: A Cognitive View*. Prior knowledge and advance organizers.
- Bloom, B. S. (1968). Learning for mastery. *Evaluation Comment*, 1(2).
- Cepeda, N. J., et al. (2006). Distributed practice in verbal recall tasks. *Psychological Bulletin*, 132(3).
- Chi, M. T. H., et al. (1994). Eliciting self-explanations improves understanding. *Cognitive Science*, 18(3).
- Dunlosky, J., et al. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*, 14(1).
- Fyfe, E. R., et al. (2014). Concreteness fading in mathematics and science instruction. *Educational Psychology Review*, 26(1).
- Kapur, M. (2008). Productive failure. *Cognition and Instruction*, 26(3).
- Mayer, R. E. (2009). *Multimedia Learning* (2nd ed.). Cambridge University Press.
- Paivio, A. (1986). *Mental Representations: A Dual Coding Approach*. Oxford University Press.
- Pashler, H., et al. (2008). Learning styles: Concepts and evidence. *Psychological Science in the Public Interest*, 9(3).
- Posner, G. J., et al. (1982). Accommodation of a scientific conception. *Science Education*, 66(2).
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science*, 17(3).
- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science*, 35(6).
- Slamecka, N. J., & Graf, P. (1978). The generation effect. *Journal of Experimental Psychology: Human Learning and Memory*, 4(6).
- Sweller, J. (1988). Cognitive load during problem solving. *Cognitive Science*, 12(2).
