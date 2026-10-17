"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { MaximizeIcon, MessageCircleIcon, XIcon } from "lucide-react"

import { trackEvent } from "@/lib/events"
import { cn } from "@/lib/utils"
import { Button } from "@/components/base/ui/button"
import { USER } from "@/features/portfolio/data/user"

import { CHAT_COPY } from "../config"
import { ChatConversation } from "./chat-conversation"

/**
 * Square corners and the page's own colours, so the launcher reads as part of
 * the site's ruled-box vocabulary rather than as a pasted-on widget.
 *
 * `outline` supplies the border and the hover state; the overrides drop its
 * translucent dark fill, which lets the page show through a button that floats
 * over scrolling content.
 *
 * `font-normal` rather than the button's default `font-medium`, which is the
 * weight this site reserves for headings — at `text-sm` it reads as a different
 * face beside the body copy the launcher floats over.
 */
const LAUNCHER_CLASS =
  "cursor-default rounded-none border-border bg-background font-normal text-foreground shadow-lg hover:bg-muted dark:border-border dark:bg-background dark:hover:bg-muted"

/**
 * Floating entry point, mounted once by `FloatingActions` in the app layout.
 *
 * `sm`-only, in both directions. At phone widths the panel covers nearly
 * everything behind it, which is `/chat` with extra steps and worse — so below
 * `sm` nothing floats here at all and the way in is `ChatNavItem`, a link to
 * the page from the bottom nav.
 *
 * Base UI's Dialog is used directly rather than through
 * `@/components/base/ui/dialog`, whose `DialogContent` hard-codes centre
 * positioning; this panel is anchored above the launcher in the bottom-right.
 *
 * The conversation itself lives in `ChatProvider` above this, so closing the
 * panel hides the thread rather than discarding it.
 *
 * Never opens on its own. Everything here is behind a click.
 */
export function ChatLauncher() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  /**
   * Hidden on the dedicated page, which renders the same conversation inline.
   * They now share one thread, so the launcher there would be a second view of
   * the messages already on screen.
   */
  if (pathname === "/chat") return null

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next)
          trackEvent({
            name: "chat_open",
            properties: { source: "launcher" },
          })
      }}
    >
      <DialogPrimitive.Trigger
        render={
          <Button
            className={cn(
              LAUNCHER_CLASS,
              "hidden h-(--fab-size) gap-2 px-4 sm:inline-flex"
            )}
            variant="outline"
            size="lg"
          />
        }
      >
        {/*
            The trigger doubles as the close control while the panel is open —
            it is the one part of the page not covered by it, so a button that
            still read "chat with Dan" was the obvious thing to click and did
            nothing. The label carries the accessible name, so it swaps with the
            icon rather than being pinned by an `aria-label` that would then
            disagree with the visible text.
          */}
        {open ? <XIcon /> : <MessageCircleIcon />}
        {open ? "Close" : CHAT_COPY.launcher}
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          data-chat-ui
          className={[
            "fixed! z-50 flex flex-col overflow-hidden border border-border bg-background text-sm shadow-lg duration-100 outline-none",
            /**
             * Anchored above the launcher row, clearing it by `--fab-gap` so the
             * panel does not sit directly on top of the button that opened it.
             * Every offset here comes from the same variables the row uses.
             */
            "right-(--fab-inset) bottom-[calc(var(--fab-inset)+var(--fab-size)+var(--fab-gap)+env(safe-area-inset-bottom,0))]",
            "h-[min(32rem,calc(100dvh-var(--fab-inset)*2-var(--fab-size)-var(--fab-gap)-2rem))]",
            /**
             * The panel is `sm`-only, so this is never opened on a narrow
             * viewport — but a desktop window dragged narrow while it is open
             * should shrink rather than overflow.
             */
            "w-[min(24rem,calc(100vw-var(--fab-inset)*2))]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          ].join(" ")}
        >
          <header className="screen-line-bottom flex items-center gap-3 p-2 pl-4">
            <Image
              className="size-9 shrink-0 rounded-full object-cover inset-ring-1 inset-ring-foreground/10"
              src={USER.avatar}
              alt=""
              width={36}
              height={36}
              quality={100}
              unoptimized
              aria-hidden
            />

            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm/none font-medium">
                {CHAT_COPY.name}
              </DialogPrimitive.Title>
              <p className="mt-1.5 font-mono text-[0.625rem]/none font-medium tracking-wider text-muted-foreground uppercase">
                {CHAT_COPY.role}
              </p>
              <DialogPrimitive.Description className="sr-only">
                {CHAT_COPY.subtitle}
              </DialogPrimitive.Description>
            </div>

            <Button
              // Also an anchor, and sits directly beside the close button —
              // one finger cursor and one arrow in the same row.
              className="cursor-default rounded-none border-none"
              variant="ghost"
              size="icon-sm"
              aria-label="Open full page"
              nativeButton={false}
              render={<Link href="/chat" onClick={() => setOpen(false)} />}
            >
              <MaximizeIcon />
            </Button>

            <DialogPrimitive.Close
              render={
                <Button
                  className="rounded-none border-none"
                  variant="ghost"
                  size="icon-sm"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </header>

          <ChatConversation className="flex-1" />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export default ChatLauncher
