# Evaluation Plan for Reader Support

## 1. Why Evaluation Needs to Start Early

The project is approaching a stage where many support forms are plausible.

Without evaluation, it becomes too easy to optimize for:

- novelty
- visual appeal
- prompt cleverness

instead of:

- actual reading recovery

So evaluation planning should begin before all support forms are built.

---

## 2. Main Research Question

Core question:

`Which support forms help readers recover the current scene state with the least disruption?`

This can be broken into smaller questions:

- which forms are most useful during confusion?
- which forms are most useful after re-entry?
- when is image support genuinely helpful?
- when is causal support more valuable than visual support?
- does selective support beat one generic summary?

---

## 3. Evaluation Layers

The project should evaluate at three layers.

## 3.1 Artifact Quality Evaluation

Question:

- is the support output itself grounded and useful?

Judged by:

- expert/internal annotators

## 3.2 Interface Usefulness Evaluation

Question:

- does support placement/timing help during reading?

Judged by:

- prototype users or pilot participants

## 3.3 End-Task Reading Evaluation

Question:

- does the system improve recovery, continuity, and re-entry?

Judged by:

- comprehension and recovery tasks

---

## 4. Metrics by Layer

## 4.1 Artifact quality metrics

For each support artifact, rate:

- grounding correctness
- usefulness
- brevity appropriateness
- distinctiveness
- timing appropriateness

Suggested scale:

- 1 to 5

Additional binary checks:

- wrong factual support?
- unsupported inference?
- redundant with another support?

## 4.2 Interface-level metrics

Possible measures:

- support open rate
- time to first useful support click
- abandonment rate
- support overload complaints
- preference between support conditions

## 4.3 Reading outcome metrics

Possible measures:

- scene-state reconstruction accuracy
- causal linkage recall
- place continuity accuracy
- character-role recovery
- re-entry time
- confidence in "I know what is going on now"

---

## 5. Recommended Experimental Conditions

Do not test too many conditions at once.

Suggested staged comparison:

## Study A. Minimal support comparison

Conditions:

- no support
- generic summary
- current-state snapshot + chips

Goal:

- verify that targeted local repair beats generic summary

## Study B. Modality comparison

Conditions:

- text support only
- VIS only
- text + VIS

Goal:

- determine when image helps and when it does not

## Study C. Causal support comparison

Conditions:

- snapshot only
- snapshot + causal bridge

Goal:

- test whether explicit causal repair helps in "why did this happen?" scenes

## Study D. Re-entry comparison

Conditions:

- no recap
- generic recap
- re-entry recap

Goal:

- test whether present-anchored re-entry support beats plain retrospective summary

---

## 6. Scene Sampling Strategy

Evaluation should not use random scenes only.

Sample across failure types:

- place shift scenes
- time shift scenes
- cast-heavy scenes
- dialogue-heavy scenes
- reflective scenes
- strongly causal scenes
- scenes with recurring location
- scenes where image is likely low-value

This matters because support usefulness is type-dependent.

---

## 7. Annotation Tasks for Internal Evaluation

Before user studies, create internal annotation tasks.

## 7.1 Support usefulness annotation

Prompt:

- if a reader were confused here, would this support help them recover?

Rate:

- useful / partly useful / not useful

## 7.2 Causal validity annotation

Prompt:

- does this causal bridge connect the right earlier event to the current state?

Rate:

- correct / weak / wrong

## 7.3 VIS usefulness annotation

Prompt:

- does this image help reconstruct the current scene state?

Rate:

- high / medium / low / misleading

## 7.4 Timing annotation

Prompt:

- should this support be always visible, optional, or trigger-only?

These annotations will help policy design later.

---

## 8. Logging Recommendations

To support evaluation later, log:

- scene and subscene IDs
- support artifacts available
- support artifacts shown
- user interactions with supports
- whether user resumed after pause
- time spent before next navigation

Keep logs aligned with evaluation questions, not generic analytics only.

---

## 9. Success Criteria for First Prototype

The first support prototype can be considered promising if:

- targeted supports outperform generic summary in scene-state recovery
- causal bridge improves performance in causally difficult scenes
- VIS is helpful in some scene types but not forced in all
- users do not report interface overload

---

## 10. What Not to Overclaim

The system should not immediately claim:

- overall reading comprehension improvement
- literacy improvement in general
- universal usefulness of image support

The most defensible early claims are narrower:

- faster current-state recovery
- better re-entry support
- better causal continuity recovery in selected cases

---

## 11. Final Recommendation

The project should evaluate support not by how impressive it looks, but by whether it reduces the cost of reconnecting to the story's present.

That should remain the central criterion across artifact design, UI design, and study design.
