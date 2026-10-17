/**
 * Moves the `production` label to a version of the system prompt.
 *
 * Run by the red team gate after a version passes, with `PROMPT_VERSION`. Gate
 * runs for different versions can finish in any order, so this only ever moves
 * the label forward: a slow run for an older version must not undo a newer one.
 *
 * `--rollback <n>` is the one sanctioned manual promotion, and skips that check.
 * Name a version that has held `production` before, since that is what makes
 * skipping the gate safe — it already passed it.
 */
import { parseArgs } from "node:util"
import { LangfuseClient } from "@langfuse/client"

import { CHAT_PROMPT_NAME } from "@/features/chat/config"

const { values } = parseArgs({ options: { rollback: { type: "string" } } })

const requested = Number(values.rollback ?? process.env.PROMPT_VERSION)
if (!Number.isInteger(requested) || requested <= 0) {
  console.error("Pass PROMPT_VERSION, or --rollback <version>.")
  process.exit(1)
}

const langfuse = new LangfuseClient()

async function currentProductionVersion() {
  try {
    const current = await langfuse.prompt.get(CHAT_PROMPT_NAME, {
      type: "text",
      label: "production",
      cacheTtlSeconds: 0,
    })
    return current.version
  } catch (error) {
    /** No version holds the label yet: the seed, before its first promotion. */
    if ((error as { statusCode?: number }).statusCode === 404) return 0
    throw error
  }
}

if (!values.rollback) {
  const current = await currentProductionVersion()
  if (requested <= current) {
    console.log(
      `Not promoting v${requested}: production is already at v${current}.`
    )
    process.exit(0)
  }
}

const updated = await langfuse.prompt.update({
  name: CHAT_PROMPT_NAME,
  version: requested,
  newLabels: ["production"],
})

console.log(
  `Promoted ${CHAT_PROMPT_NAME} v${requested}. Labels: ${updated.labels.join(", ")}`
)
