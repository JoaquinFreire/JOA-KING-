const isUserJid = (value) => typeof value === 'string' && /^.+@(?:s\.whatsapp\.net|lid)$/.test(value)

export function participantMentionJid(participant, addressingMode) {
  const identifiers = addressingMode === 'lid'
    ? [participant?.lid, participant?.id, participant?.jid, participant?.phoneNumber]
    : addressingMode === 'pn'
      ? [participant?.phoneNumber, participant?.id, participant?.jid, participant?.lid]
      : [participant?.id, participant?.jid, participant?.lid, participant?.phoneNumber]

  return identifiers.find(isUserJid) || null
}

export function mentionText(jid) {
  const user = jid?.split('@')[0]?.split(':')[0]
  return user ? `@${user}` : ''
}