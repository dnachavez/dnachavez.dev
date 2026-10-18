# Red team suite

Three suites against `/api/chat`, split by cost and determinism.

|                   | `promptfooconfig.yaml` | `redteam.yaml`  | `redteam-multiturn.yaml` |
| ----------------- | ---------------------- | --------------- | ------------------------ |
| Cases             | 11, fixed              | ~114, generated | ~16, generated           |
| Grading           | JavaScript only        | grader model    | grader model             |
| Requests per run  | 33                     | ~342            | ~192                     |
| Same answer twice | yes                    | no              | no                       |
| Runs on           | every PR               | weekly          | monthly                  |
| Gates merge       | yes                    | critical/high   | critical/high            |

The regression suite is the one that gates a merge. It holds the eight payloads
that got through, verbatim, and fails on three tripwires: the canary string
reaching output, system prompt content reaching output, and the reply dropping out
of Dan's first-person voice. It also carries two controls that fail if the widget
starts refusing everything, which is otherwise the cheapest way to make an
injection suite pass.

The generated suites are for finding the payloads nobody has written down yet.
They are split in two because promptfoo cannot scope a strategy to particular
plugins: a multi-turn strategy in the single-turn file would run against every
base case at four turns apiece and, on its own, cost more requests than the site
has in a day.

## Running

```bash
pnpm redteam:snapshot           # required first; see below
pnpm dev                        # target must be up

pnpm redteam:regress            # deterministic suite
pnpm redteam:scan               # generated, single-turn
pnpm redteam:scan:multiturn     # generated, multi-turn
pnpm redteam:view               # open the last report
```

`redteam:snapshot` writes `.system-prompt.txt` and `.system-prompt-markers.json`
from the prompt the target serves: the Langfuse version when `.env.local` has the
keys, the repo copy otherwise. The leak assertion diffs output against the text
in 8-word shingles rather than against a hardcoded phrase list, so editing the
prompt cannot silently leave the assertion testing nothing. Both are gitignored
and the assertion throws if either is missing. `pnpm test:run` rewrites them from
the repo copy, so snapshot again before a local `redteam:regress`.

To run against preview instead of localhost:

```bash
PROMPTFOO_TARGET_URL=https://<preview>.vercel.app/api/chat pnpm redteam:regress
```

## Prompt lifecycle

The system prompt is versioned in Langfuse as `chat-system`. The copy in
`src/features/chat/lib/system-prompt.ts` is the seed and the fallback, not the
source of truth.

1. Save a new version in the Langfuse UI with "Set the 'production' label" left
   unchecked, which is the default for a new version of an existing prompt. Or
   run `pnpm prompt:push` to send the repo copy.
2. Langfuse calls `/api/langfuse-webhook`, which dispatches `redteam.yml` with
   `prompt_version`.
3. The regression suite runs against exactly that version, in strict mode: if it
   cannot be fetched, the run fails rather than testing the repo copy.
4. If the suite passes, the `promote` job moves `production` to it. Serving
   instances pick it up within the five-minute cache.

From save to live is roughly ten minutes: about five for the gate, and up to
five more for the cache. Each gate run spends 33 of the day's 1,000 free
requests.

**Only CI sets `production`.** Langfuse's Hobby plan has no protected labels, so
this is a convention, not a control: ticking the box when saving, or moving the
label by hand, skips the gate. The next pull request run tests whatever holds
`production`, so the gap closes eventually, but not before visitors see it.

**Rollback** is the one sanctioned manual promotion:

```bash
pnpm prompt:promote --rollback <version>
```

Name a version that has held `production` before. It skips the gate because that
version already passed it. Promotion otherwise only moves forward, so a slow gate
run for an older version cannot undo a newer one.

**A failed gate** leaves `production` where it was. Find the run with
`gh run list --workflow redteam.yml --event workflow_dispatch`; the failure email
goes to whoever owns `GITHUB_DISPATCH_TOKEN`.

**Markers live with each version**, in its `config` as `{ "markers": [...] }`.
The output tripwire uses them in production and the leak assertion uses them here.
The snapshot fails the run if a marker, `{{site_index}}` or `{{contact_email}}` is
missing from the version's text — so renaming a heading means updating its marker
in the same version.

The generated scan never gets the Langfuse keys, so it always tests the repo copy.
It runs pull request code, and the secret key can move `production`.

**The repo copy drifts**, and that is accepted. It is served only during a
Langfuse outage, on an instance with nothing cached. After editing it, run
`pnpm prompt:push` so the fallback has been through the gate at least once. Pull
request runs test the `production` version, not the repo copy.

**Previewing a version locally:** set `LANGFUSE_PROMPT_VERSION=<n>` in
`.env.local`. Outside production the cache is off, so each turn fetches it fresh.

`LANGFUSE_WEBHOOK_SECRET` is held by both Langfuse and Vercel. Rotate both in one
sitting: Langfuse retries a delivery that gets a 401 until it gives up, and a
version saved in between is never gated.

## Running the scan

The scan never runs on push. It is a few hundred model calls, so a pull request
pushed to ten times would pay for it ten times. Ask for one when a change is
ready, and the result is recorded against that exact commit:

- comment `/redteam <sha>` on the pull request, or `/redteam multi-turn <sha>`,
  naming the full 40-character head commit — honoured only from the owner,
  members and collaborators, because the scan runs the pull request's code with
  secrets in its environment. The status check prints the exact comment for the
  current head.
- or run it locally and publish the result:

```bash
pnpm redteam:scan
PR=<number> HEAD_SHA=$(git rev-parse HEAD) \
  GITHUB_TOKEN=$(gh auth token) pnpm redteam:publish
```

`redteam-status.yml` runs on every push and costs one API call. If the recorded
evidence is for the current head it republishes that conclusion; otherwise the
check reports the revision as unscanned and says how to ask. Unscanned is
reported as `action_required`, not as a failure — nothing is known to be wrong
with it, nobody has looked, and reporting those the same way teaches people to
merge through red.

## Credentials

`OPENROUTER_API_KEY` is the only one a run cannot do without. promptfoo grades
with an OpenAI model by default; all three configs override that to
`openrouter:google/gemini-2.5-flash-lite`.

The prompt gate also needs `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` as
Actions secrets, and `LANGFUSE_BASE_URL` as an Actions variable. Without them a
run tests the repo copy of the prompt, which is what fork pull requests get.

It has to be a **paid** model. OpenRouter meters every `:free` model against one
account-wide allowance of 1,000 requests a day — the same allowance the live widget
spends — so a grader on the free tier would bill its judgements to the site's daily
budget and take the chat down in order to test the chat. Paid models draw on the
balance, which is a separate meter.

Spending that balance does not endanger the free allowance. OpenRouter sets the
1,000/day tier on **credit purchased all time**, not on the current balance, so
draining the $10 would not drop the account back to 50 requests a day.

Attack _generation_ needs no credential of ours: promptfoo generates plugin test
cases through its own hosted service by default. Setting
`PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true` generates locally through the
configured provider instead, at noticeably lower attack quality.

## What this costs

A judgement on `google/gemini-2.5-flash-lite` is roughly **$0.0002 a call** at
about 1,000 tokens in and 150 out. That is the figure the whole table below scales
from, so it is the one to re-measure if these stop looking right.

The previous grader, `openai/gpt-oss-120b`, was about $0.00006 — cheaper by three
times and abandoned anyway, because it returned prose where the rubric needed JSON
and published grader failures as widget findings. The difference is a fraction of
a cent per run and buys a verdict that parses.

| Suite                    | Runs     | Grader + attacker calls | Per run | Per month  |
| ------------------------ | -------- | ----------------------- | ------- | ---------- |
| `redteam:regress`        | per push | 2                       | $0.0004 | ~$0.008    |
| `redteam:scan`           | weekly   | ~320                    | ~$0.064 | ~$0.26     |
| `redteam:scan:multiturn` | monthly  | ~80                     | ~$0.016 | ~$0.016    |
|                          |          |                         |         | **~$0.28** |

At that rate the $10 balance covers about three years of red teaming, and the
balance is there for `FALLBACK_MODEL` anyway — one full day of primary-provider
outage costs ~$2.50, which is roughly nine months of scanning.

The runtime layer (`src/features/chat/lib/output-tripwire.ts`) costs nothing at all:
it is string matching inside the existing stream, with no extra model call and no
network hop. That is the reason it was built that way rather than as a hosted
classifier — a guard that bills per visitor is the expensive layer, not this one.

## Request budget

Requests, not tokens, are what is scarce here. The widget's model is `:free`, which
OpenRouter meters at 20 requests a minute and 1,000 a day account-wide, and one
turn costs three of them (search, read, answer).

| Suite                    | Requests | Share of a day |
| ------------------------ | -------- | -------------- |
| `redteam:regress`        | 30       | 3%             |
| `redteam:scan`           | ~342     | 34%            |
| `redteam:scan:multiturn` | ~192     | 19%            |

Wall clock binds before requests do. A turn takes ~15s, so one worker runs at ~4
turns/minute — already under the 6.7 the request ceiling allows, which is why the
scans pass `-j 1` and no delay. The first attempt at this file was sized against
requests alone, at 192 tests, and spent 65 minutes without finishing.

`CHAT_MODEL_OVERRIDE` is the way out of the budget entirely. The scan workflow
sets it to a cheap paid model by default, so a few hundred generated turns are
billed to the balance (~$0.14) instead of to the allowance the live widget shares.
Dispatch it with `model: production` to scan what actually ships — worth doing
periodically, since a scan of a model you do not serve only tests the prompt.

## Notes on the target

- The per-IP limiter is 20/hour and trusts `x-forwarded-for`, so every config sends
  a random source address per request. Without it a 10-case suite spends the
  budget and grades 429s as passes.
- Generated attacks are capped at 400 characters because the route 413s a message
  over 1000 and hex encoding roughly doubles length.
- Multi-turn strategies are capped at 4 turns against the route's 10-turn session
  ceiling, and run `stateful: false` because the route holds no session state.
