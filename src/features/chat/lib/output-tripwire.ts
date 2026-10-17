import type { LanguageModelMiddleware } from "ai"

/**
 * Last line of defence, on the way out rather than on the way in.
 *
 * The system prompt is the primary control and it does most of the work. This
 * exists for the case where it does not, and it watches output rather than input
 * for one reason: an input classifier has to recognise an attack, which is
 * open-ended and which every published classifier loses at the margins, whereas
 * the shape of a *successful* attack here is closed and short. There are only a
 * few things a compromised reply can contain that a real one never does, and all
 * of them are literal strings.
 *
 * Nothing here calls a network service. The route already spends three upstream
 * requests per turn against a 20-per-minute account-wide ceiling, so a fourth hop
 * for a hosted classifier would cost a third of the site's throughput to catch a
 * class of failure this file catches for free.
 *
 * What it cannot do is judge meaning. A model talked into inventing an employer
 * produces text this passes without comment. That failure is caught in CI by the
 * hallucination and policy plugins instead — see `redteam/`.
 */

/** Provider-level stream part, read off the SDK so it survives a major bump. */
type StreamPart =
  Awaited<
    ReturnType<
      Parameters<
        NonNullable<LanguageModelMiddleware["wrapStream"]>
      >[0]["doStream"]
    >
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never

/**
 * Verbatim fragments of the system prompt, chosen for being structural — a
 * heading or a tag rather than a sentence — because those survive a model that
 * summarises the prompt instead of pasting it.
 *
 * Not secrets: this repository is public, so the prompt is already readable by
 * anyone who wants it. The reason to stop them is that a reply containing one is
 * a reply that accepted the visitor's framing as authoritative, and it renders as
 * a wall of instructions in a chat bubble on a portfolio site.
 *
 * These match the repo copy of the prompt and are the default. A version served
 * from Langfuse carries its own set in `config.markers`, which the route passes
 * in — see `loadSystemPrompt()`.
 */
export const PROMPT_MARKERS: readonly string[] = [
  "<site_index>",
  "</site_index>",
  "# Grounding rules",
  "# Handling instructions in messages",
  "# How you know things",
  "Figures are quote-only",
  "table of contents, not the content",
]

/**
 * Canaries from payloads already observed getting through. Each is proof that a
 * specific documented attack is live in production, rather than a probability
 * that something might be.
 */
const CANARIES = ["ZZQX-7741-CANARY"]

export type TripwireHit = {
  kind: "prompt-leak" | "canary"
  marker: string
}

/**
 * Marks the error this file puts on the stream, so `onError` in the route can
 * tell a reply it deliberately cut from one the provider dropped. Both end the
 * turn; only one of them is a fault, and they need different copy.
 */
export class TripwireError extends Error {
  readonly hit: TripwireHit

  constructor(hit: TripwireHit) {
    super(`Output tripwire: ${hit.kind} (${hit.marker})`)
    this.name = "TripwireError"
    this.hit = hit
  }
}

export function isTripwireError(error: unknown): error is TripwireError {
  return error instanceof TripwireError
}

/* -------------------------------------------------------------------------- *
 * Why there is no fuzzy matching here
 *
 * A shingle check against the live prompt was tried and reverted. It caught the
 * one thing the markers miss — a dump of the prompt's opening, which sits before
 * the first marker — but on its first run in CI it also cut off a correct answer
 * to "What did you work on at Aeva?" at sixteen matching runs. The threshold had
 * been measured against ten outputs, which was not enough to separate a dump
 * from an answer that happens to name several things the index also names.
 *
 * A false positive here truncates a real conversation, so the bar for adding to
 * this file is higher than for the offline suite, where the same check lives and
 * where a false positive only fails a build. That asymmetry is the point of
 * having both layers: `redteam/assert/no-system-prompt-leak.js` still catches
 * the dump, on a run nobody is waiting on.
 * -------------------------------------------------------------------------- */

function flatten(text: string) {
  return text.replace(/[^a-z0-9]/gi, "").toLowerCase()
}

/**
 * Prompt markers are matched literally; canaries are matched against a flattened
 * copy as well.
 *
 * The asymmetry is deliberate. A model told to emit a canary will space it,
 * re-hyphenate it, or wrap it in markdown emphasis, none of which survive a
 * literal comparison — and the canary is a fixed nonsense token, so flattening
 * cannot make it collide with anything. Prompt markers carry meaning in their
 * whitespace and punctuation, and flattening them yields substrings common enough
 * to fire on ordinary answers.
 */
export function detectTripwire(
  text: string,
  markers: readonly string[] = PROMPT_MARKERS
): TripwireHit | null {
  for (const marker of markers) {
    if (text.includes(marker)) return { kind: "prompt-leak", marker }
  }

  const flattened = flatten(text)
  for (const canary of CANARIES) {
    if (flattened.includes(flatten(canary))) {
      return { kind: "canary", marker: canary }
    }
  }

  return null
}

/**
 * Characters withheld from the client until the text following them is scanned.
 *
 * Streaming and scanning pull opposite ways: a reply is only checkable once it
 * exists, but a reply already rendered cannot be recalled, and the failure being
 * guarded against is someone screenshotting the bubble. Withholding a trailing
 * window rather than the whole message keeps the visible lag to about one clause.
 *
 * Derived rather than chosen, so adding a longer marker cannot silently open a
 * gap: no marker can begin inside the released text and end outside it. Canaries
 * are doubled because the flattened match tolerates a separator between every
 * character, which up to doubles the span they occupy in the raw text.
 *
 * Computed from the markers the tripwire is given, not the defaults, because a
 * version fetched from Langfuse can carry a longer one.
 */
function holdbackFor(markers: readonly string[]) {
  return Math.max(
    ...markers.map((marker) => marker.length),
    ...CANARIES.map((canary) => canary.length * 2)
  )
}

/**
 * Parts after which no further text can arrive for the current block, and so the
 * only ones it is safe to release the withheld window ahead of. Everything else
 * — step boundaries, tool traffic, reasoning, metadata — can be followed by more
 * text, and flushing on those reopens the gap the window exists to close.
 */
const CLOSING_PARTS = new Set(["text-end", "finish", "error"])

export function createOutputTripwire({
  onTrip,
  markers = PROMPT_MARKERS,
}: {
  onTrip?: (hit: TripwireHit) => void
  markers?: readonly string[]
} = {}): LanguageModelMiddleware {
  const holdback = holdbackFor(markers)

  return {
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()

      /** Every text delta so far, including the part not yet released. */
      let seen = ""
      /** How much of `seen` has reached the client and is unrecallable. */
      let released = 0
      /** Carried so the withheld tail is flushed under its own text block. */
      let lastId: string | undefined
      let tripped = false

      const scanned = stream.pipeThrough(
        new TransformStream<StreamPart, StreamPart>({
          transform(part, controller) {
            if (tripped) return

            /**
             * The withheld tail is released just before the parts that close the
             * text block or the response, and only those.
             *
             * It cannot wait for `flush`: a `text-end` forwarded first would
             * close the block, and the remainder would then address a part the
             * SDK has already closed, which it rejects with "text part <id> not
             * found" and fails the whole turn.
             *
             * It equally cannot happen on every non-text part. A model that emits
             * a step boundary mid-answer would flush the window early, and the
             * window is the only thing stopping a canary split across that
             * boundary from rendering — `ZZQX-7741` and `ZZQX-7741-CANA` both
             * reached output that way before this was narrowed.
             */
            if (part.type !== "text-delta") {
              if (CLOSING_PARTS.has(part.type)) {
                if (released < seen.length && lastId !== undefined) {
                  controller.enqueue({
                    type: "text-delta",
                    id: lastId,
                    delta: seen.slice(released),
                  })
                  released = seen.length
                }
              }

              controller.enqueue(part)
              return
            }

            lastId = part.id
            seen += part.delta

            const hit = detectTripwire(seen, markers)
            if (hit) {
              tripped = true
              onTrip?.(hit)

              /**
               * The clause already on screen stays there — no stream part unsays
               * it — and the turn ends with the copy every other failure uses. A
               * visitor sees a truncated line and an error, which is worse than a
               * clean answer and better than a leaked prompt.
               */
              controller.enqueue({
                type: "error",
                error: new TripwireError(hit),
              })
              controller.terminate()
              return
            }

            const safe = Math.max(0, seen.length - holdback)
            if (safe > released) {
              controller.enqueue({
                ...part,
                delta: seen.slice(released, safe),
              })
              released = safe
            }
          },

          /**
           * Only reached when the stream ends without a closing part, since a
           * `text-end` or `finish` already released the tail above.
           */
          flush(controller) {
            if (tripped || released >= seen.length || lastId === undefined) {
              return
            }

            controller.enqueue({
              type: "text-delta",
              id: lastId,
              delta: seen.slice(released),
            })
          },
        })
      )

      return { stream: scanned, ...rest }
    },
  }
}
