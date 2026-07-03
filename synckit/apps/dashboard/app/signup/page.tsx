import Link from "next/link";

import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  return (
    <AuthForm
      title="Create your SyncKit account"
      endpoint="/api/auth/signup"
      submitLabel="Create account"
      redirectTo="/onboarding"
      fields={[
        { name: "name", label: "Your name" },
        { name: "organizationName", label: "Company / organization" },
        { name: "email", label: "Email", type: "email" },
        { name: "password", label: "Password (min 8 chars)", type: "password" },
      ]}
      footer={
        <span>
          Already registered?{" "}
          <Link className="text-indigo-400 hover:underline" href="/login">
            Sign in
          </Link>
        </span>
      }
    />
  );
}
