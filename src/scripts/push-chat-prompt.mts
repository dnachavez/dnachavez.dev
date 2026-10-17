/**
 * Sends the repo copy of the system prompt to Langfuse as a new version.
 *
 * Used once to seed the prompt and afterwards whenever the repo copy is edited
 * on purpose. The new version is created without `production`, so the webhook
 * puts it through the red team gate like any version saved in the UI, and CI
 * promotes it only if the suite passes.
 */
import { execFileSync } from "node:child_process"
import { LangfuseClient } from "@langfuse/client"

import { CHAT_PROMPT_NAME } from "@/features/chat/config"
import { PROMPT_MARKERS } from "@/features/chat/lib/output-tripwire"
import { CHAT_SYSTEM_TEMPLATE } from "@/features/chat/lib/system-prompt"

if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
  console.error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set.")
  process.exit(1)
}

const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  encoding: "utf8",
}).trim()

const prompt = await new LangfuseClient().prompt.create({
  name: CHAT_PROMPT_NAME,
  type: "text",
  prompt: CHAT_SYSTEM_TEMPLATE,
  config: { markers: PROMPT_MARKERS },
  /** Informational: the webhook gates every new version without `production`. */
  labels: ["candidate"],
  commitMessage: `repo template @ ${sha}`,
})

console.log(
  `Created ${CHAT_PROMPT_NAME} v${prompt.version}. The red team gate promotes it if the suite passes.`
)
