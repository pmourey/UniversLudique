export function suitToSymbol(suit) {
  if (!suit) return { symbol: '—', color: 'inherit', label: '—' }
  const s = String(suit).toUpperCase()
  switch (s) {
    case 'S':
    case 'SPADES':
      return { symbol: '♠', color: '#111', label: 'Pique' }
    case 'H':
    case 'HEARTS':
      return { symbol: '♥', color: '#c00', label: 'Cœur' }
    case 'D':
    case 'DIAMONDS':
      return { symbol: '♦', color: '#c00', label: 'Carreau' }
    case 'C':
    case 'CLUBS':
      return { symbol: '♣', color: '#111', label: 'Trèfle' }
    default:
      return { symbol: String(suit), color: 'inherit', label: String(suit) }
  }
}

