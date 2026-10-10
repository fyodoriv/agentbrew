---
name: ubiquitous-language
description: >
  Extract a DDD-style ubiquitous language glossary from the conversation and
  codebase. Resolves synonyms, proposes canonical terms, shows example dialogues.
  Re-runnable: merges with existing UBIQUITOUS_LANGUAGE.md rather than overwriting.
  Use when terms drift between code, docs, and conversation, or when the user
  asks for a glossary or domain language.
---

# Ubiquitous Language

Domain-Driven Design's core discipline: one term per concept, used by both
developers and domain experts. Ambiguous language compounds across a codebase
over years.

## Step 1: Mine sources

Scan (in priority order):
1. The current conversation
2. Existing `UBIQUITOUS_LANGUAGE.md` (if present — merge, don't overwrite)
3. Key source files: model definitions, service interfaces, API contracts
4. Comments and docstrings (often the most honest domain language)
5. Variable and function names

Collect candidate terms with their context.

## Step 2: Identify conflicts

Flag:
- **Synonyms** — two words for the same concept (e.g., `User` vs `Account` vs `Member`)
- **Overloaded terms** — one word with multiple meanings in context
- **Implicit concepts** — behaviors that exist but have no named term

## Step 3: Propose canonical terms

For each concept, propose:
- **Canonical term** — the single preferred word
- **Aliases to avoid** — the alternatives that should not appear in code or conversation
- **Brief definition** — one sentence, in domain terms not implementation terms

Present the proposals. Wait for approval or corrections before writing.

## Step 4: Write example dialogue

For 3-5 key terms, write a brief exchange between a developer and domain expert
that demonstrates the term in natural use and clarifies its boundary:

```
Dev: "When a customer places an order, does the inventory decrement immediately?"
Expert: "No — inventory is reserved, not decremented. Decrement happens on shipment."
→ Canonical: reservation (not decrement, not hold, not lock)
```

## Step 5: Write or merge UBIQUITOUS_LANGUAGE.md

If the file exists: read it, merge new terms (add missing, update changed,
keep confirmed unchanged). Never overwrite approved terms without noting the
change.

Format:
```markdown
# Ubiquitous Language

## [Domain Area]

**[Canonical Term]**
Definition: [one sentence]
Aliases to avoid: [term1], [term2]
Example: [one sentence showing usage in context]
```
