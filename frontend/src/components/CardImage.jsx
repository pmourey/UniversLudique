import React, { useState } from 'react'

function normalizeCardName(card) {
  if (!card) return null
  const s = String(card).trim()
  // Normalize common variants: remove extension and whitespace
  const cleaned = s.replace(/\.svg$/i, '').trim()

  // 1) Handle suit-first formats like 'S7', 'S10', 'HJ' (suit then rank)
  const suitFirst = cleaned.toUpperCase().match(/^([SHDC])([AJQK]|10|[2-9])$/i)
  if (suitFirst) {
    const suit = suitFirst[1].toUpperCase()
    const rank = suitFirst[2].toUpperCase()
    return `${rank}${suit}`
  }

  // 2) Handle rank-first formats like 'AS', '10H', 'QC'
  const short = cleaned.toUpperCase().replace(/\s+/g, '')
  const rankFirst = short.match(/^([AJQK]|10|[2-9])([SHDC])$/i)
  if (rankFirst) return `${rankFirst[1]}${rankFirst[2].toUpperCase()}`

  // 3) Handle long names like 'ace_of_spades' or 'ace of spades'
  const long = cleaned.toLowerCase().replace(/[-\s]+/g, '_')
  const parts = long.split('_of_')
  if (parts.length === 2) {
    let rank = parts[0]
    let suit = parts[1]
    const rankMap = { ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: '10', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }
    const suitMap = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' }
    const r = rankMap[rank] || rank.toUpperCase()
    const s2 = suitMap[suit] || (suit ? suit[0].toUpperCase() : '')
    return `${r}${s2}`
  }

  // Fallback: return the cleaned value (may be already appropriate)
  return cleaned
}

export default function CardImage({ card, onClick, className = '', alt, faceDown = false, width = 64, style = {} }) {
  const normalized = faceDown ? 'back' : normalizeCardName(card)
  const defaultFilename = normalized ? `${normalized}.svg` : 'back.png'
  const initialSrc = `/cards/${defaultFilename}`
  const [src, setSrc] = useState(initialSrc)

  const handleError = () => {
    if (!src.endsWith('/cards/back.png')) {
      setSrc('/cards/back.png')
    }
  }

  const imgAlt = alt || (card || 'card')
  return (
    <img
      src={src}
      alt={imgAlt}
      onClick={onClick}
      onError={handleError}
      className={className}
      loading="lazy"
      style={{ width, height: 'auto', cursor: onClick ? 'pointer' : 'default', ...style }}
    />
  )
}
