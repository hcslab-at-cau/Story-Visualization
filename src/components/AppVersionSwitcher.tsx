"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const APP_VERSIONS = [
  { href: "/v2", activePath: "/v2", label: "V2" },
  { href: "/v3/library", activePath: "/v3", label: "V3" },
]

export default function AppVersionSwitcher() {
  const pathname = usePathname()

  return (
    <nav aria-label="Application version" className="flex rounded-xl border border-zinc-200 bg-zinc-100 p-1">
      {APP_VERSIONS.map((item) => {
        const active = pathname === item.activePath || pathname.startsWith(`${item.activePath}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-900 text-white shadow-sm"
                : "text-zinc-500 hover:bg-white hover:text-zinc-800"
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
