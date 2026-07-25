import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in · Fitness Tracker",
};

export default async function LoginPage(props: {
  // `searchParams` is a Promise as of Next.js 16.
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await props.searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Fitness Tracker</h1>
          <p className="mt-1 text-sm text-muted">Strength, conditioning and cardio programming.</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
