import Link from "next/link";

import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <AuthForm
      title="Sign in to SyncKit"
      endpoint="/api/auth/login"
      submitLabel="Sign in"
      fields={[
        { name: "email", label: "Email", type: "email" },
        { name: "password", label: "Password", type: "password" },
      ]}
      footer={
        <span>
          No account?{" "}
          <Link className="text-indigo-400 hover:underline" href="/signup">
            Sign up
          </Link>
        </span>
      }
    />
  );
}
