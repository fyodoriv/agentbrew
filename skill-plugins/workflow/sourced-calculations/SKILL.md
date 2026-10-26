---
name: sourced-calculations
description: >
  Makes every computed number advisor-grade: each input comes from the user's
  own data, the user, or a named benchmark (a guess only as a labeled last
  resort), the calculation is shown as a chain of small steps, and every
  assumption is listed for the user to accept or reject. Use before giving any
  number that is computed rather than read from a source — forecasts, cash
  flow, budgets, affordability of a hire or a purchase, marketing returns,
  debt or savings timelines, capacity or effort estimates — and when the user
  asks "how did you get that", "can we afford", "project", "forecast", or
  "how much do we need".
---

# Sourced calculations

A number with nothing behind it is a bug. Users act on computed numbers: they
hire, borrow, price, and show them to buyers or banks. Without this skill,
agents pick round inputs by feel ("customers grow 3% a year"), hide the steps,
and present guesses as facts.

## 1. Find each input, in this order

For every input (growth rate, conversion rate, cost, price, headcount,
inflation, hours), use the first source that exists:

1. **The user's own records.** Actual sales and costs, customer counts,
   marketing spend and results, invoices, bank exports, time logs. Look them
   up yourself first, with the tools and connectors you have, before you ask.
   Stay read-only and open only sources relevant to this question; ask
   before opening a connector the user did not mention.
2. **Ask the user.** When the data should exist but you cannot reach it, name
   exactly what is missing and why it matters ("monthly sales for last year",
   "ad spend and orders by month").
3. **A named benchmark.** When the user cannot provide it, use a benchmark
   and name its source and year. Prefer the same industry and country. Search
   for a current figure when you do not know one, and say when you could not
   confirm it.
4. **Judgment, last resort.** Label it as a guess, say why you chose it, and
   ask the user to agree before anything depends on it.

Never choose a round number by feel when 1 to 3 are possible.

## 2. Build the calculation as a chain

- Start from actuals (for example the last 12 months, by line).
- Derive each driver from the data: growth from year-on-year history;
  customers from spend ÷ cost per customer (spend → clicks → conversion →
  orders × average order value); costs as a share of sales or their own trend.
- Combine the drivers into the result, one step per line, with its numbers.
- Give low, base, and high cases from the range in the data (worst, average,
  best period) or the benchmark range, not from round numbers.
- Sanity-check against reality. A margin far above the industry norm usually
  means a missing cost; say what you found.
- Re-check the arithmetic with a script or a second method before you show it.

## 3. Show it so the user can follow

- The answer first, in one line. Then the steps in plain words, one idea each.
- One worked example for the first period, not every period.
- An assumptions table at the end:

| Input | Value | Source type | Source / why | Confidence | What would replace it |
|---|---|---|---|---|---|
| Customer growth | 4.1%/yr | Your data | New customers, this year vs last | Medium | Three or more years of history |
| Ad conversion | 2.5% | Benchmark | Named industry report and year | Low | Your own ad conversions |

Source type is one of: **Your data**, **You said**, **Benchmark** (named), or
**My guess** (with the reason).

## 4. When the result goes to someone else

When a buyer, a bank, a client, or staff will read the result, put the
inputs, sources, and steps in the document itself, not only in the chat.
Every number must be traceable without the conversation.

## Gotchas

- An accounting system's cost lines can be incomplete. Cross-check costs
  against a second source (invoices, a supplier statement) before you quote a
  profit.
- A forecast where sales grow faster than costs every year widens the margin
  by itself. Say so, or tie price growth to cost growth unless the data shows
  otherwise.
- A percentage of a percentage hides units. Write the unit on every line
  (per month, per order, per year).
