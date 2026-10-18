import { decodeEmail } from "@/utils/string"

import { USER } from "@/features/portfolio/data/user"

/**
 * Chosen over `openai/gpt-oss-20b:free` after running both against this prompt.
 * Nemotron searched before declining a question about an employer that does not
 * exist, rather than declining from priors; gpt-oss-20b emitted `(#/education)`
 * for a link, a path this site does not serve and the renderer correctly refuses
 * to make clickable. It is also 120b-class, matching what Groq was serving.
 */
export const CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"

/**
 * The one model tried if Nemotron cannot be served, via OpenRouter's `models`
 * parameter — routed onward server-side inside the same request.
 *
 * Paid, and that is the entire point. Exactly one provider serves Nemotron, so
 * OpenRouter's usual answer to an outage — route the same model to another host
 * — has nowhere to go, and the SDK's retries only reach the same dead endpoint.
 * A `:free` fallback does not help either: the daily allowance and the
 * per-minute ceiling are both account-wide across every `:free` model, so a
 * refused request is refused again by the alternates. Only a model on a
 * different meter is a real fallback.
 *
 * Costs nothing on a healthy day, because OpenRouter never reaches it while the
 * primary answers. At ~9k tokens a turn it is ~$0.0076 when it does, so even a
 * full day of outage at the site's ceiling of ~330 turns is about $2.50 against
 * a $10 balance that free models never touch.
 *
 * Chosen on measurement rather than price, run against this system prompt
 * through OpenRouter itself. It searched on all three probes including the one
 * about an employer that does not exist, and linked
 * `/experience#position-framework-1` rather than a vaguer anchor.
 *
 * `openai/gpt-oss-120b` is half the price and was rejected for the opposite
 * behaviour on the same probes: it called no tool at all for the employer that
 * does not exist, answering from priors, and wrapped a link in the full-width
 * brackets `normalize-links.ts` exists to repair. That is the third measurement
 * of that family failing this prompt, after `gpt-oss-20b` lost the original
 * comparison and `gpt-oss-120b` did the same when checked on Groq.
 */
export const FALLBACK_MODEL = "qwen/qwen3.6-27b"

/** The system prompt's name in Langfuse, where its live versions are kept. */
export const CHAT_PROMPT_NAME = "chat-system"

/**
 * Read from the same encoded value the Overview panel reveals, so the address
 * the bot hands out and the address the page shows can never drift apart.
 */
export const CONTACT_EMAIL = decodeEmail(USER.emailB64)

/* -------------------------------------------------------------------------- *
 * Budget
 *
 * OpenRouter meters `:free` models by *requests*, not tokens: 20 per minute and
 * 1,000 per day, the daily figure being what the account's one-off $10 credit
 * purchase unlocked — the threshold is measured on credit bought all time, not
 * on a balance, and `:free` models draw none of it down, so it does not lapse.
 * That is a different constraint from the one this feature was built against,
 * and it inverts which numbers matter.
 *
 * Groq's free tier was 8,000 tokens per minute counting input and output
 * together, which made every token in the payload expensive and made a single
 * oversized request fail permanently with a 413. Nothing here is token-bound any
 * more — the model takes 262k of context and the whole corpus is ~13k — so the
 * caps below are set for answer quality rather than to squeeze under a ceiling.
 *
 * What is scarce now is the turn itself. A turn that searches and reads costs
 * three requests, so 1,000 a day is roughly **330 conversations** — enough that
 * the daily cap is no longer the binding limit. The 20 a minute is: about six
 * turns a minute, across every visitor at once.
 *
 * The per-IP limiter is what keeps that minute from belonging to one person.
 * It matters more than the daily figure now, not less.
 *
 * `FALLBACK_MODEL` sits outside all of this. It is paid, so it is metered by
 * balance rather than by either ceiling — which is what makes it useful when
 * the ceilings are exactly the problem.
 *
 * Measured against the alternatives before settling here: Groq's free tier caps
 * tokens rather than requests and could not fit one turn under 8k a minute;
 * Gemini's allows five requests a minute, which is under two turns; and both
 * Together and the paid tiers spend a balance per token rather than unlocking a
 * ceiling once.
 * -------------------------------------------------------------------------- */

/**
 * Model calls per turn, counting the answer: search, read, answer.
 *
 * Also the multiplier on every request-based limit above, which is the reason
 * not to raise it casually — a fourth step is a 33% cut to turns per day.
 */
export const MAX_STEPS = 3

/**
 * Ceiling on a single `read` result, summed across the entries it returns, and
 * the per-entry cap the build asserts.
 *
 * Raised from 800 with the move off Groq. It was low because every token was
 * charged against a per-minute ceiling; now it decides how finely blog posts are
 * chopped at build time, and larger chunks mean fewer half-thoughts.
 */
export const MAX_TOOL_RESULT_TOKENS = 3_000

/**
 * Turns kept from the conversation, counting both sides. Raised with the move
 * off Groq for the same reason: history is what makes a follow-up question
 * intelligible, and it is no longer competing with the answer for room.
 */
export const MAX_HISTORY_MESSAGES = 10

/**
 * A ceiling, not a target — the style rules ask for two to four sentences. It was
 * kept close to that so one runaway answer could not bury the thread.
 *
 * Raised because the ceiling is not a budget for the answer, it is a budget for
 * everything the model emits, and on a reasoning model that includes the
 * thinking. `nemotron-3-ultra-550b` returned six empty replies in 33 cases —
 * complete streams, `finishReason: "length"`, and not one character of text: the
 * whole 800 went on reasoning and the answer never started. The same ceiling was
 * also truncating `super-120b` answers mid-link.
 *
 * Nearly free to raise. OpenRouter meters `:free` models by request, not by
 * token, so a larger ceiling costs latency and nothing else. Length is governed
 * by the style rules; this is only the backstop.
 */
export const MAX_OUTPUT_TOKENS = 2_000

/**
 * Hard cap on the always-in-context listing, asserted by the build.
 *
 * Unchanged by the provider switch, and deliberately so. It is small because a
 * model handed a list of everything describes it from priors rather than
 * searching — a grounding decision, not a cost one.
 */
export const INDEX_TOKEN_BUDGET = 450

/** Candidates `search` returns. Previews only, so this is cheap. */
export const MAX_SEARCH_HITS = 5

/** Entries one `read` may fetch, before the token cap trims further. */
export const MAX_READ_ENTRIES = 3

/**
 * Assistant replies allowed per conversation. Client-supplied and therefore
 * trivially reset by anyone who cares to; it exists to bound honest use, not to
 * stop abuse. The per-IP limit is the actual control.
 */
export const MAX_TURNS_PER_SESSION = 10

export const RATE_LIMIT = {
  requests: 20,
  windowMs: 60 * 60 * 1000,
} as const

/** Longer than any real question, short enough to bound a prompt-stuffing attempt. */
export const MAX_MESSAGE_LENGTH = 1_000

/** Follow-up chips offered after a turn, and openers offered before one. */
export const MAX_SUGGESTIONS = 3
export const MAX_OPENERS = 4

export const CHAT_COPY = {
  /**
   * An invitation in Dan's own voice rather than a role, because the model
   * answers as Dan in the first person — see `system-prompt.ts`, which forbids
   * it from calling itself an assistant. A label reading "assistant"
   * contradicted every reply underneath it.
   *
   * `subtitle` survives as the dialog's accessible description.
   */
  name: USER.displayName,
  role: "Ask me anything",
  /**
   * The floating launcher's own label, distinct from `name`: the header names
   * who is answering once the panel is open, the button has to say what it is
   * from across the page.
   */
  launcher: `Chat with ${USER.firstName}`,
  subtitle: "Answers come from what's published on this site.",
  placeholder: "Ask about my work…",
  error: `Something broke. Email me: ${CONTACT_EMAIL}`,
  /**
   * Distinct from `error`: the upstream per-minute ceiling is a wait, not a
   * fault, and telling someone to email instead of retrying loses a visitor who
   * would have got an answer sixty seconds later.
   */
  busy: `Too many questions at once — give it a minute. Or email me: ${CONTACT_EMAIL}`,
  /**
   * Distinct from both `error` and `busy`: the model provider fell over, which
   * is neither the visitor's fault nor something waiting a minute reliably
   * fixes, but is also not a bug in this site. Saying "something broke" invited
   * a bug report for someone else's outage.
   */
  upstream: `The model is having a moment. Try again in a bit, or email me: ${CONTACT_EMAIL}`,
  /**
   * Distinct from `busy`, which is the same 429 from the same provider: the
   * per-minute throttle clears in a minute, the free-model daily allowance does
   * not clear until midnight UTC. "Give it a minute" is actively misleading for
   * most of the day, and a visitor who takes it at its word retries into the
   * same wall until they give up on the site rather than on the hour.
   */
  exhausted: `I'm out of answers for today — the allowance resets at midnight UTC. Email me instead: ${CONTACT_EMAIL}`,
  rateLimited: `That's the limit for now. Email me: ${CONTACT_EMAIL}`,
  sessionEnded: `That's the limit for this conversation. Email me: ${CONTACT_EMAIL}`,
  unavailable: `Chat is off right now. Email me: ${CONTACT_EMAIL}`,
  /**
   * Shown when `output-tripwire.ts` cuts a reply that was leaking. Distinct from
   * `error` because nothing broke: the system refused, and telling someone to
   * report a bug for a working control wastes their time and ours. It reads as a
   * refusal rather than as a fault, which is what it is.
   *
   * It also gives the red team suite something to assert on. With the generic
   * copy here, a turn the tripwire saved and a turn the provider dropped were
   * indistinguishable downstream, so a defence that worked was graded the same
   * as an outage.
   */
  blocked: `I can't help with that. Ask me about my work instead, or email me: ${CONTACT_EMAIL}`,
  /**
   * Last resort for a turn that produced no text at all.
   *
   * The model can finish a stream having emitted only tool calls and reasoning —
   * observed on 9 of 87 turns in a generated scan against the shipped model — and
   * what reached the bubble in that case was nothing whatsoever. `prepareStep` in
   * the route removes the tools for the final step so there is almost always an
   * answer to show; this is what gets shown when there still is not one.
   *
   * Worded as a reply rather than as an error, because it is not one: nothing
   * broke, the model simply had nothing to say. Terse and first-person for the
   * same reason as every other line here.
   */
  empty: `I don't have an answer for that one. Ask me about my work, or email me: ${CONTACT_EMAIL}`,
} as const
