const MAX_COMPLETED_COMMANDS = 5000
const inFlight = new Set()
const completed = new Set()

/**
 * Claims a command invocation for a WhatsApp message. Replayed messages with
 * the same chat, message ID, and command are ignored, even after completion.
 */
export function beginCommandExecution(message, command) {
  const messageId = message?.key?.id || message?.id
  const chat = message?.chat || message?.key?.remoteJid
  if (!messageId || !chat) return { finish() {} }

  const key = `${chat}:${messageId}:${command}`
  if (inFlight.has(key) || completed.has(key)) return null
  inFlight.add(key)

  let finished = false
  return {
    finish() {
      if (finished) return
      finished = true
      inFlight.delete(key)
      completed.add(key)
      if (completed.size > MAX_COMPLETED_COMMANDS) {
        completed.delete(completed.values().next().value)
      }
    },
  }
}
