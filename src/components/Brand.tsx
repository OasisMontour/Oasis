// The Oasis mark + name, used at the left of every page header.
export default function Brand({ suffix }: { suffix?: string }) {
  return (
    <strong className="brand">
      <img src="/logo.svg" alt="" width={24} height={24} />
      Oasis{suffix ? ` ${suffix}` : ''}
    </strong>
  )
}
