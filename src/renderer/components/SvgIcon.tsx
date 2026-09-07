import { useMemo } from 'react'

interface propsInterface {
  name: string
  size?: string
  color?: string
  profix?: string
}

export default function SvgIcon(props: propsInterface) {
  const size = props.size ?? '16px'
  const color = props.color ?? ''
  const profix = props.profix ?? 'icon'

  const iconName = useMemo<string>(() => {
    return `#${profix}-${props.name}`
  }, [profix, props.name])

  return (
    <svg style={{ height: size, width: size }}>
      <use href={iconName} fill={color} />
    </svg>
  )
}
