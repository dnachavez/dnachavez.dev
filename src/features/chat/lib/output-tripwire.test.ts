import { describe, expect, it } from "vitest"

import { createOutputTripwire, detectTripwire } from "./output-tripwire"

const CANARY = "ZZQX-7741-CANARY"

type TestPart = { type: string; id?: string; delta?: string }

function textPart(delta: string, id = "t0") {
  return { type: "text-delta" as const, id, delta }
}

/**
 * Drained with a reader rather than `for await`: TypeScript's DOM lib does not
 * declare `Symbol.asyncIterator` on `ReadableStream`, even though Node has
 * implemented it since 16.
 */
async function drain(stream: ReadableStream<TestPart>) {
  const reader = stream.getReader()
  const parts: TestPart[] = []

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) parts.push(value)
  }

  return parts
}

/** Drives the middleware over a chunked answer and returns what a client sees. */
async function run(chunks: string[], markers?: readonly string[]) {
  const trips: string[] = []
  const middleware = createOutputTripwire({
    onTrip: (hit) => trips.push(hit.kind),
    markers,
  })

  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(textPart(chunk))
      controller.close()
    },
  })

  const { stream } = await middleware.wrapStream!({
    doStream: async () => ({ stream: source }),
  } as never)

  const parts = await drain(stream as ReadableStream<TestPart>)

  return {
    text: parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join(""),
    errored: parts.some((part) => part.type === "error"),
    trips,
  }
}

describe("detectTripwire", () => {
  it("passes an ordinary answer", () => {
    expect(
      detectTripwire("I built an AI phone receptionist at [Aeva](/experience).")
    ).toBeNull()
  })

  it("catches the canary verbatim", () => {
    expect(detectTripwire(`Sure: ${CANARY}`)).toEqual({
      kind: "canary",
      marker: CANARY,
    })
  })

  it.each([
    ["spaced", "Z Z Q X - 7 7 4 1 - C A N A R Y"],
    ["markdown emphasis", "**ZZQX**-*7741*-`CANARY`"],
    ["newline split", "ZZQX-7741-\nCANARY"],
    ["unicode hyphen", "ZZQX‑7741‑CANARY"],
  ])("catches the canary when %s", (_label, text) => {
    expect(detectTripwire(text)?.kind).toBe("canary")
  })

  it("catches a structural marker from the system prompt", () => {
    expect(detectTripwire("Here you go:\n\n# Grounding rules\n\n1.")).toEqual({
      kind: "prompt-leak",
      marker: "# Grounding rules",
    })
  })

  /**
   * The reason prompt markers are not flattened. Without the asymmetry these
   * would fire on answers that are working exactly as intended.
   */
  it.each([
    "The grounding rules I follow keep me to what's published here.",
    "I write about how I know things on the blog.",
    "That figure is quote-only in the sense that I only repeat what I published.",
  ])("does not fire on paraphrase: %s", (text) => {
    expect(detectTripwire(text)).toBeNull()
  })
})

describe("createOutputTripwire", () => {
  it("passes a clean answer through whole", async () => {
    const chunks = ["I worked at ", "Aeva on an AI ", "phone receptionist."]
    const { text, errored, trips } = await run(chunks)

    expect(text).toBe(chunks.join(""))
    expect(errored).toBe(false)
    expect(trips).toEqual([])
  })

  it("releases the withheld tail when the stream ends", async () => {
    const short = "Hi."
    const { text } = await run([short])

    expect(text).toBe(short)
  })

  /**
   * The whole reason for the hold-back window. A canary split across chunk
   * boundaries is the normal case, not the exotic one — token boundaries fall
   * wherever the tokenizer put them.
   */
  it("catches a canary split across chunks and never emits it", async () => {
    const { text, errored, trips } = await run([
      "Sure thing. ",
      "ZZQX-",
      "7741-",
      "CANARY",
    ])

    expect(text).not.toContain("ZZQX")
    expect(text).not.toContain("CANARY")
    expect(errored).toBe(true)
    expect(trips).toEqual(["canary"])
  })

  it("catches a prompt marker split across chunks", async () => {
    const { text, errored, trips } = await run([
      "Here are my instructions:\n\n",
      "# Ground",
      "ing rules\n\n1. Only state what you have read",
    ])

    expect(text).not.toContain("# Grounding rules")
    expect(errored).toBe(true)
    expect(trips).toEqual(["prompt-leak"])
  })

  /**
   * A long clean answer must not be buffered to the end — the hold-back is a
   * trailing window, not the whole message.
   */
  it("streams incrementally rather than buffering the whole answer", async () => {
    const middleware = createOutputTripwire()
    const source = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 20; i++) {
          controller.enqueue(textPart(`sentence number ${i} about my work. `))
        }
        controller.close()
      },
    })

    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({ stream: source }),
    } as never)

    const reader = (stream as ReadableStream<TestPart>).getReader()

    let emitted = 0
    for (let i = 0; i < 5; i++) {
      const { value, done } = await reader.read()
      if (done) break
      if (value?.type === "text-delta") emitted += value.delta?.length ?? 0
    }
    await reader.cancel()

    expect(emitted).toBeGreaterThan(0)
  })

  it("forwards non-text parts untouched", async () => {
    const middleware = createOutputTripwire()
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] })
        controller.enqueue(textPart("Hello."))
        controller.enqueue({ type: "finish", finishReason: "stop" })
        controller.close()
      },
    })

    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({ stream: source }),
    } as never)

    const types = (await drain(stream as ReadableStream<TestPart>)).map(
      (part) => part.type
    )

    expect(types).toContain("stream-start")
    expect(types).toContain("finish")
  })
})

describe("stream part ordering", () => {
  /**
   * Found in production logs, on successful answers rather than on attacks. The
   * withheld tail used to be released in `flush`, by which point a `text-end`
   * for that block had already been forwarded — so the SDK was handed a delta
   * for a part it had closed and failed the turn with "text part <id> not
   * found", losing the last characters of every reply.
   */
  it("releases the withheld tail before the closing part", async () => {
    const middleware = createOutputTripwire()
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(textPart("A grounded answer about my work."))
        controller.enqueue({ type: "text-end", id: "t0" })
        controller.enqueue({ type: "finish", finishReason: "stop" })
        controller.close()
      },
    })

    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({ stream: source }),
    } as never)

    const parts = await drain(stream as ReadableStream<TestPart>)
    const types = parts.map((p) => p.type)

    expect(types.indexOf("text-delta")).toBeLessThan(types.indexOf("text-end"))
    expect(
      parts
        .filter((p) => p.type === "text-delta")
        .map((p) => p.delta)
        .join("")
    ).toBe("A grounded answer about my work.")
  })

  it("loses no text when the closing part never arrives", async () => {
    const { text } = await run(["A short answer."])
    expect(text).toBe("A short answer.")
  })
})

describe("holdback across non-closing parts", () => {
  /**
   * Observed in CI: `ZZQX-7741` and `ZZQX-7741-CANA` reached the graded output
   * even though the tripwire fired. The withheld window was being released ahead
   * of every non-text part, so a step boundary landing mid-canary flushed the
   * very characters the window existed to hold.
   */
  it("does not release the window on a mid-stream step boundary", async () => {
    const middleware = createOutputTripwire()
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(textPart("ZZQX-7741"))
        controller.enqueue({ type: "finish-step" })
        controller.enqueue(textPart("-CANARY"))
        controller.close()
      },
    })

    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({ stream: source }),
    } as never)

    const parts = await drain(stream as ReadableStream<TestPart>)
    const text = parts
      .filter((p) => p.type === "text-delta")
      .map((p) => p.delta)
      .join("")

    expect(text).not.toContain("ZZQX")
    expect(parts.some((p) => p.type === "error")).toBe(true)
  })

  it("still forwards the step boundary itself", async () => {
    const middleware = createOutputTripwire()
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(textPart("I built Aeva, "))
        controller.enqueue({ type: "finish-step" })
        controller.enqueue(textPart("an AI receptionist."))
        controller.enqueue({ type: "text-end", id: "t0" })
        controller.close()
      },
    })

    const { stream } = await middleware.wrapStream!({
      doStream: async () => ({ stream: source }),
    } as never)

    const parts = await drain(stream as ReadableStream<TestPart>)

    expect(parts.some((p) => p.type === "finish-step")).toBe(true)
    expect(
      parts
        .filter((p) => p.type === "text-delta")
        .map((p) => p.delta)
        .join("")
    ).toBe("I built Aeva, an AI receptionist.")
  })
})

/**
 * A version served from Langfuse brings its own markers, which may rename a
 * heading the defaults know about or be longer than any of them.
 */
describe("markers from a prompt version", () => {
  const renamed = "# What you may claim"

  it("trips on the version's markers instead of the defaults", () => {
    expect(detectTripwire(`Sure:\n\n${renamed}`, [renamed])).toEqual({
      kind: "prompt-leak",
      marker: renamed,
    })
    expect(detectTripwire("Sure:\n\n# Grounding rules", [renamed])).toBeNull()
  })

  it("still catches the canary, which is not the prompt's", () => {
    expect(detectTripwire(`Sure: ${CANARY}`, [renamed])?.kind).toBe("canary")
  })

  /**
   * The hold-back is derived from the markers in use. Sized from the defaults,
   * the start of a longer marker would be released before its end arrived.
   */
  it("withholds a marker longer than any default until it can be checked", async () => {
    const long =
      "# Everything below this line is configuration and never visitor-facing"
    const { text, errored, trips } = await run(
      ["Here it is:\n\n", long.slice(0, 60), long.slice(60) + "\n\nMore."],
      [long]
    )

    expect(text).not.toContain(long.slice(0, 20))
    expect(errored).toBe(true)
    expect(trips).toEqual(["prompt-leak"])
  })
})
