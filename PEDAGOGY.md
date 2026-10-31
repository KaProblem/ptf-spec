# PTF Pedagogy Guide

**Version 0.1 (draft)** · part of the [Personal Tutor Format](SPEC.md)

How to build and teach learning elements, paths and simulators so that people
understand and remember them. This guide is a **recommendation**, not a
conformance requirement: a bundle that ignores it is still valid PTF.

Every rule names the research it rests on (§10), so it can be challenged and
replaced when better evidence turns up.

---

## 0. How to use this guide

PTF splits the work in two (SPEC.md §6.7): **the content fixes what is
learned** (`objectives`, `# Core`, `# Key facts`, `# Misconceptions`), **the
tutor decides how** (order, words, examples, questions, simulators) for one
learner. This guide serves both sides:

| Reader | Read | Uses it for |
| --- | --- | --- |
| Authors and generators of elements and paths | §1, §2, §5, §6, §9 | Writing content a tutor can teach from |
| Authors and generators of simulators | §1, §4, §7, §9 | Building small stations that teach one idea |
| The tutor (`ptf-tutor` skill, any host) | §1 to §4, §8 | Running a session with one learner |
| Reviewers (CONTENT-POLICY.md §2) | §9 | A rubric for contributions |

Where the guide says "SHOULD" it means the default that the evidence supports.
An author's `# Tutor notes` win over it (SPEC.md §6.7), and so does a learner
who clearly wants something else.

---

## 1. Principles

Sixteen principles in four groups, roughly in the order a step uses them.

### Orient

1. **Say where you are going.** Before the first activity, tell the learner
   what the course or step is about, why it matters and what they will be
   able to do afterwards (advance organizer, clear learning intentions). This
   is what `objectives` and `# Introduction` are for.
2. **Find out what the learner already knows.** Ask before you teach: a
   warmup question, a short pretest along `requires`, or the learner record.
   Skip what is secure, repair what is missing, and never restart work the
   learner has completed (mastery learning, pretesting effect).
3. **Start from something familiar.** New knowledge sticks when it is attached
   to something the learner knows (Ausubel). Open with an everyday experience,
   an object or a question most people can answer, then move towards the new
   idea. For a known learner, pick the anchor from their profile (`interests`,
   `notes`).

### Engage

4. **Let them try before you tell.** A short prediction, guess or attempt
   before the explanation makes the explanation land better, even when the
   guess is wrong (generation effect, productive failure, pretesting effect).
   Predict, observe, explain.
5. **Guide the discovery.** Exploring on one's own works when it is framed and
   debriefed: a clear question before, a conversation about what was seen
   after (minimal guidance does not work for novices). A simulator without an
   introduction and without a debrief leaves the learner alone.
6. **Novices study examples, experts solve problems.** A beginner learns a
   procedure faster from a worked example than from solving the problem
   unaided. Show one solved case, then let the learner complete a partly
   solved one, then solve one alone (worked-example effect, fading). For
   learners who already know the basics, skip the examples: they get in the
   way (expertise reversal).

### Explain

7. **One idea per step.** Working memory holds only a few new elements at a
   time (cognitive load theory). Split a concept until every step adds one new
   idea; show only what that step needs.
8. **Explain simply, then honestly.** Explain in plain words as if to a
   newcomer, and notice where the plain version is wrong. Every analogy gets a
   sentence on where it breaks down.
9. **Concrete first, then abstract.** Begin with a concrete case, then fade
   towards the general rule or formula (concreteness fading).
10. **Words and pictures together.** Combine an explanation with a matching
    visual or simulation; do not split attention between text and a distant
    figure (dual coding, Mayer's multimedia principles).
11. **Confront misconceptions directly.** Name the wrong belief, let the
    learner see where it fails, then give the correct view (conceptual
    change). This is why every element has `# Misconceptions`.

### Consolidate

12. **Retrieve, don't reread.** Asking the learner to recall or apply
    something strengthens memory far more than showing it again (testing
    effect). Each step ends with a question, not a summary.
13. **Feedback explains, not only judges.** After an answer, say why it is
    right or wrong and what to do next; for a wrong answer, name the
    misconception behind it. Give hints in small steps before giving the
    solution (formative feedback, scaffolding).
14. **Make the learner explain.** "Why does this happen?" and "explain it in
    your own words" deepen understanding (self-explanation, elaborative
    interrogation).
15. **Judge understanding by evidence, not by feeling.** "I got it" right
    after an explanation is a poor predictor of what a learner can do
    tomorrow (illusion of competence). Count a step as done when the learner
    has answered a `check` question at their level correctly, not when they
    say they understood. Objectives, activities and questions must fit
    together, so that a correct answer really shows the objective
    (constructive alignment).
16. **Space and mix.** Review after growing intervals instead of all at once
    (spacing effect), and mix related problem types in reviews (interleaving).
    `mastery.json` carries `next_review` for this.

**Not a principle: matching "learning styles".** Teaching visual learners only
visually and so on has not been shown to improve learning (Pashler et al.,
2008). The profile's `style.modality` is a preference that helps engagement and
the choice of a first representation. The same holds for `style.explain`
(LEARNER-RECORD.md §3.1): it changes how something is explained, never what
has to be understood. Every learner still gets words *and* visuals and
something to try.

---

## 2. The course: introduction and sessions

A learner who is dropped straight into the first activity does not know what
it is for. Every course therefore starts with an introduction, and every
session with a short orientation.

### 2.1 The course introduction

The path's `# Introduction` (or, without one, the tutor from `goal` and
`objectives`) answers six questions in a few sentences, before any activity:

1. **What is this about?** The topic in one plain sentence, with an everyday
   example of where it shows up.
2. **Why is it worth knowing?** What the learner can understand or do that
   they could not before.
3. **What will you be able to do at the end?** The path's `objectives`, in
   words the learner understands.
4. **How is it built?** The steps as a short map ("first how text becomes
   numbers, then how the model guesses, then how it learns").
5. **What do you need already?** Prerequisites, and a quick check of them
   (principle 2).
6. **How long does it take?** A rough number of sessions or minutes.

Then the tutor asks whether this fits the learner's goal, and adjusts the
plan if it does not.

### 2.2 The arc of a session

| Phase | What happens |
| --- | --- |
| Review | If reviews are due, a two-minute retrieval round first (§8.3). |
| Where you are | Course goal in one sentence, what is done, what comes today. For a first session: the course introduction (§2.1). |
| Steps | One or more steps (§3), each closed before the next starts. |
| Close | What the learner can now explain, in their words; what comes next; goals updated. |

A session that continues a course recaps completed steps in a sentence or
two and moves on. It never repeats a completed step or simulator station
unless the learner asks.

---

## 3. The arc of one step

A step is one learning element at the learner's level. This is the default
order; the tutor shortens it when the learner record shows a phase is not
needed, and the learner can always skip ahead.

| Phase | What happens | Where it lives in PTF |
| --- | --- | --- |
| Orient | What this step is about and what the learner will be able to do | `objectives`, `# Introduction` |
| Anchor | Something familiar: an experience, an object, a question | `# Examples`, start of a level text |
| Try | Predict, guess or attempt something | `warmup` question, a quick calculation, a simulator station when it helps (§4) |
| Observe | See what really happens, then talk about it | Worked example, a calculation, a simulator station |
| Explain | Plain words, one idea, one analogy and its limit | `# Core`, `# Key facts`, `# Level: <id>` |
| Confront | The typical wrong belief and why it fails | `# Misconceptions` |
| Retrieve | Recall or apply without looking, with feedback | `check` questions |
| Connect | What this enables next | `leads_to`, the next step in the path |

"Try" does not mean "open a simulator". Most steps are tried with a question
or a small calculation.

---

## 4. Choosing the medium

A step can be taught with words, a worked example, a question card, a
simulator or code. Pick the simplest medium that serves the objective
(SIMULATOR-SPEC.md §7.1 is the same ladder for generated UI).

| Medium | Good for | PTF |
| --- | --- | --- |
| Conversation | Definitions, reasons, history, connecting ideas, repairing a misconception | `# Core`, `# Key facts` |
| Worked example | Procedures and calculations, for novices | `# Examples`, `calculation_steps` |
| Question card | Predictions, checks, reviews | Question blocks (SPEC.md §7) |
| Simulator station | Cause and effect the learner cannot easily imagine, a parameter to vary, many fast trials, processes in time or space | `simulators` with `use_when` |
| Code lab | Learners who want to build it themselves, usually `college` and above | `code` (CODE-SPEC.md) |

A simulator **earns its place** when the learner can change something and see
a result that words or one picture cannot show as well. **Skip it** when the
step is about a fact, a definition or a single calculation, when the learner
prefers less (`style.explain.simulators`), when the station is already
completed, or when the learner is on a phone and the station needs a large
screen. Many steps need no simulator; one simulator station per step is
usually enough.

---

## 5. Learning elements

- **Granularity.** One element teaches one concept that can be checked on its
  own. If `# Core` needs more than about five sentences or the element has more
  than one central misconception, split it and connect the parts with
  `requires`.
- **Objectives are checkable.** Two to four statements that start with a verb
  the learner can show ("explain", "compute", "predict", "tell apart"), not
  "understand" or "know about".
- **Levels are depths, not parts** (SPEC.md §5.2). Each level teaches the
  whole concept: the beginner level as simply as possible, higher levels the
  same ideas with more terms, formulas, limits and harder tasks. Test it by
  imagining a learner who only ever sees one level: can they reach every
  objective? If temperature is an objective of softmax, the highschool text
  needs it too ("the die gets more or less fair"), not only the college text
  (`softmax(z / T)`). Concepts that build on each other become separate
  elements connected by `requires`, not levels of one element.
- **Level texts** start with something to try or picture (SPEC.md §6.3), use
  the anchor that fits the level, stand on their own (never "as above") and
  stay short. The tutor adapts them anyway.
- **Anchors, analogies and worked examples** go into `# Examples`. Each
  analogy has a "breaks down when" line, so the tutor can choose one that
  fits the learner. Procedural concepts get at least one fully worked example
  per level, ideally as a `calculation_steps` question the learner completes.
- **Questions fit the objectives.** At least one `warmup` and one `check`
  question per level. Every objective is tested by at least one `check`
  question at every level, at that level's depth (a beginner computes with
  three numbers, an expert explains a limit). A question that tests nothing
  in `objectives` belongs to another element or is a `transfer` question.
- **Feedback in the question.** Wrong options in multiple-choice questions are
  real misconceptions with their IDs, not filler, and each has `feedback`
  that explains why it is wrong. `explanation` says why the right answer is
  right in a way that also helps a learner who guessed.
- **Self-contained.** Never refer to source material the learner has not seen.
  Sources go into `sources`; deep dives into `# Further reading`.

## 6. Learning paths

- **Introduction first.** Every path has `objectives` and a `# Introduction`
  that answers the six questions in §2.1.
- **Order** steps by `requires`, concrete before abstract.
- **Short steps.** One element per step, about 5 to 15 minutes of activity.
  Note in `# Tutor notes` where learners usually need a break.
- **Check prerequisites.** A path that assumes earlier knowledge starts with a
  warmup that tests it, so the tutor can repair gaps before step one.
- **Spiral.** Revisit earlier ideas in later steps, and plan review questions
  that mix elements.
- **Capstone.** End a path with a step that applies several ideas together.

---

## 7. Simulators

Simulators are aids, not stations every step must pass (§4). The tutor opens
one when it helps this learner reach an objective, introduces it with a
question, and talks about what the learner saw afterwards.

Early simulators tried to show everything at once. They overwhelm, are hard
to use on a phone and hard to repair. Build them step by step instead:

- **Small stations.** One station teaches one idea (SIMULATOR-SPEC.md §7
  rule 3). Prefer several small stations, or several small simulators, to one
  large dashboard. As a rule of thumb: at most about three controls a learner
  can change in one station, about one to three minutes per station, and at
  most about seven stations in one simulator. Beyond that, split it.
- **One phone screen.** In focus mode (SIMULATOR-SPEC.md §4.7) a station fits
  on a phone screen in portrait without scrolling while the experiment runs:
  question, controls and result are visible together. Long explanations
  belong to the tutor, not into the station.
- **Progressive disclosure.** A station shows only what its idea needs. Later
  stations may add one control or one view at a time.
- **Familiar first.** The first station starts from something recognisable
  (a sentence, a falling ball, a coin), not from the formal model.
- **Predict, then reveal.** A station asks for a guess before showing the
  result, and reports the guess as `answered` with the misconception it
  reveals (SIMULATOR-SPEC.md §7 rule 5).
- **Framed even without a tutor.** A station opens with its question and ends
  with a one-line takeaway after the result, so a learner who uses it
  standalone is not left alone either.
- **Every level, different depth.** A station that teaches part of the
  concept is available at every level; levels change its depth, not whether
  it is shown (SIMULATOR-SPEC.md §7 rule 4).
- **A clear end.** Every station has a small task and emits
  `station_completed` when it is done, so the tutor knows when to move on and
  does not open it again.
- **Report what matters.** The tutor never sees the simulator, only events
  and the snapshot. Report the learner's choices and results in words the
  tutor can talk about ("predicted 'e', model chose 'e' with 41 %").

---

## 8. Progress, feedback and review

The learner record (LEARNER-RECORD.md) is how a tutor remembers. Using it
well is part of teaching.

### 8.1 Feedback during a step

- Answer every checkable response, right after it, with the reason.
- A wrong answer is information: name the misconception, show where it fails
  (principle 11), then ask a new question of the same kind. Do not just
  repeat the explanation.
- When the learner is stuck, give a hint first, then a smaller step, then a
  worked solution (principle 13), and ask them to explain the solution back.

### 8.2 When a step is done

- A step is **completed** when the learner has met its objectives: at least
  one `check` question per objective answered correctly at their level,
  without the solution shown first.
- "Understood" and "got it" are recorded as what they are, a self-report.
  They are a reason to ask a check question, not to move on without one.
- A step or station that the record shows as completed is not repeated;
  the tutor refers back to what the learner found ("last time you saw that
  the high temperature made every letter almost equally likely").
- "Go deeper" means the same element one level up, offered after the step,
  not a requirement for completing it.

### 8.3 Review

- Due reviews (`next_review`) come first in a session and take about two
  minutes: retrieval questions, not re-explaining.
- Mix elements in one review, and prefer questions the learner has not seen
  in that form.
- A correct review lengthens the interval; a wrong one reopens the
  misconception and shortens it. Re-teach only what a review shows is
  missing.

---

## 9. Checklists

Short versions of the rules above, for authors, generators and reviewers.

**Learning element**
- [ ] Two to four checkable `objectives`; `# Core` in at most about five sentences.
- [ ] Every level covers every objective and stands on its own.
- [ ] At least one `warmup` and one `check` question per level; every objective has a `check` question.
- [ ] Multiple-choice distractors are real misconceptions with IDs and `feedback`.
- [ ] Analogies say where they break down; procedures have a worked example.
- [ ] No reference to unseen source material.

**Learning path**
- [ ] `objectives` and a `# Introduction` that answers the six questions of §2.1.
- [ ] Steps ordered by `requires`, 5 to 15 minutes each, ending with a capstone.

**Simulator**
- [ ] Each station teaches one idea with at most about three controls.
- [ ] A station fits one phone screen in focus mode.
- [ ] Prediction before result, `answered` with misconception, `station_completed` at the end.
- [ ] Stations that teach part of the concept show at every level.
- [ ] `use_when` on the element entry says when the simulator helps.

**Tutor session**
- [ ] Reviews first, then where the learner is; course introduction in the first session.
- [ ] Each step: objective, try, debrief, explain, check, close.
- [ ] Simulators only when they help (§4); never a completed station again.
- [ ] Completion from correct check answers, not from "I got it".

---

## 10. Evidence

- Ausubel, D. P. (1968). *Educational Psychology: A Cognitive View*. Prior knowledge and advance organizers.
- Biggs, J. (1996). Enhancing teaching through constructive alignment. *Higher Education*, 32(3).
- Bjork, R. A. (1994). Memory and metamemory considerations in the training of human beings. In J. Metcalfe & A. Shimamura (Eds.), *Metacognition*. MIT Press.
- Bloom, B. S. (1968). Learning for mastery. *Evaluation Comment*, 1(2).
- Cepeda, N. J., et al. (2006). Distributed practice in verbal recall tasks. *Psychological Bulletin*, 132(3).
- Chi, M. T. H., et al. (1994). Eliciting self-explanations improves understanding. *Cognitive Science*, 18(3).
- Dunlosky, J., et al. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*, 14(1).
- Fyfe, E. R., et al. (2014). Concreteness fading in mathematics and science instruction. *Educational Psychology Review*, 26(1).
- Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of Educational Research*, 77(1). "Where am I going?" as the first feedback question.
- Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist*, 38(1).
- Kapur, M. (2008). Productive failure. *Cognition and Instruction*, 26(3).
- Karpicke, J. D., Butler, A. C., & Roediger, H. L. (2009). Metacognitive strategies in student learning: Do students practise retrieval when they study on their own? *Memory*, 17(4).
- Kirschner, P. A., Sweller, J., & Clark, R. E. (2006). Why minimal guidance during instruction does not work. *Educational Psychologist*, 41(2).
- Mayer, R. E. (2009). *Multimedia Learning* (2nd ed.). Cambridge University Press. Includes the segmenting principle behind small stations.
- Paivio, A. (1986). *Mental Representations: A Dual Coding Approach*. Oxford University Press.
- Pashler, H., et al. (2008). Learning styles: Concepts and evidence. *Psychological Science in the Public Interest*, 9(3).
- Posner, G. J., et al. (1982). Accommodation of a scientific conception. *Science Education*, 66(2).
- Renkl, A., & Atkinson, R. K. (2003). Structuring the transition from example study to problem solving in cognitive skill acquisition. *Educational Psychologist*, 38(1).
- Richland, L. E., Kornell, N., & Kao, L. S. (2009). The pretesting effect: Do unsuccessful retrieval attempts enhance learning? *Journal of Experimental Psychology: Applied*, 15(3).
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science*, 17(3).
- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science*, 35(6).
- Shute, V. J. (2008). Focus on formative feedback. *Review of Educational Research*, 78(1).
- Slamecka, N. J., & Graf, P. (1978). The generation effect. *Journal of Experimental Psychology: Human Learning and Memory*, 4(6).
- Sweller, J. (1988). Cognitive load during problem solving. *Cognitive Science*, 12(2).
- Sweller, J., & Cooper, G. A. (1985). The use of worked examples as a substitute for problem solving in learning algebra. *Cognition and Instruction*, 2(1).
- Wood, D., Bruner, J. S., & Ross, G. (1976). The role of tutoring in problem solving. *Journal of Child Psychology and Psychiatry*, 17(2).
