import brandUrl from '../assets/brand-mark.svg'

type Props = {
  size?: number
}

// SVG viewBox 是 284 × 234,宽高比约 1.21:1。size 当作"宽度",高度按比例派生。
const ASPECT = 234 / 284

export function BrandMark({ size = 40 }: Props) {
  return (
    <img
      src={brandUrl}
      width={size}
      height={Math.round(size * ASPECT)}
      alt="OpenClaw"
      style={{ flex: 'none', display: 'block' }}
    />
  )
}
