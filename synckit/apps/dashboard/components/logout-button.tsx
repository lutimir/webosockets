"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="mt-2 cursor-pointer text-zinc-400 hover:text-zinc-200"
      onClick={() => {
        void fetch("/api/auth/logout", { method: "POST" }).then(() => {
          router.push("/login");
          router.refresh();
        });
      }}
    >
      Sign out
    </button>
  );
}
