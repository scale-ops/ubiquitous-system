const MESSAGES: Record<string, string> = {
  not_allowed:
    "That Google account isn't on the team list. Ask your team lead to add you to the Internal Team list as Active, then try again.",
  expired: "The sign-in took too long or was started in another tab. Please try again.",
  cancelled: "Sign-in was cancelled.",
  failed: "Something went wrong signing in with Google. Please try again.",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string; signedOut?: string }>;
}) {
  const { error, returnTo, signedOut } = await searchParams;
  const target = `/api/auth/signin?returnTo=${encodeURIComponent(returnTo ?? "/")}`;
  return (
    <main className="signin">
      <div className="card">
        <h1>Contractor Ops Screening Hub</h1>
        <p className="muted">Sign in with your Scale, Remotasks or Outlier Google account.</p>
        {error && <p className="error">{MESSAGES[error] ?? MESSAGES.failed}</p>}
        {signedOut && !error && <p className="muted small">You&apos;re signed out.</p>}
        <a className="button primary" href={target}>
          Sign in with Google
        </a>
      </div>
    </main>
  );
}
