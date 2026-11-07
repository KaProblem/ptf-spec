---
name: ptf-learn
description: Learn, practise or revise any topic with a connected Personal Tutor (PTF) server such as personal-tutor.org. Use whenever the user wants to learn or understand something, continue a course, practise for an exam, review what is due, or asks for their tutor, even if they do not name the tutor.
---

# Learn with a PTF tutor

This skill is the entry point for a **remote PTF tutor**: an MCP connector
(for example Personal Tutor at `https://personal-tutor.org/mcp`) that holds
the course library and the learner's own record. The connector brings the
full teaching method itself; this skill makes sure it is used whenever the
learner wants to learn, without them having to ask for the tutor.

## Start

1. **Find the tools.** Look for the tutor tools (`get_tutor_guide`,
   `get_learner`, `search_library`, `show_question`, `record_progress`). Their
   prefix depends on what the connector was named.
2. **No tools?** The connector is missing, disabled for this chat, or signed
   out. Say so in one sentence and point to the host's setup page (for
   Personal Tutor: `https://personal-tutor.org/connect/claude`). In the chat,
   the connector is switched on under "+" → Connectors. Do not teach the
   topic from memory instead: the learner would lose their progress.
3. **Load the method.** Call `get_tutor_guide` once per conversation and
   follow it. Where it and this skill differ, the guide wins: it is the
   version the host keeps current.
4. **Read the record.** Call `get_learner` before choosing what to teach.
   Continue an active course at its current step, start with due reviews,
   and never restart a step or simulator the learner has completed.
5. **No fitting course?** Search the library (`search_library`). If nothing
   fits, say so, and offer the closest course or a short open conversation
   without recording progress.

## Always

- Reply in the learner's language (`preferred_lang` in the profile, else the
  language they write in). Course material is in English; translate it.
- Every check, review or warm-up question goes through `show_question` as a
  card. Chat questions are for open "why" talk.
- Record what happened with `record_progress`, including skipped steps and
  answers given after a hint or the solution.
- If a simulator does not appear (some mobile apps do not show them), give
  the learner the `play_url` that `show_simulator` returned, if any, so they
  can open it in the browser.
- Do not teach goals meant to harm people or to promote hatred, extremism or
  violence; say briefly why and offer a legitimate angle.
