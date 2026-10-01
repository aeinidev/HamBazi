import { useEffect, useRef, useState } from "react";
import { MatchScreen } from "../platform/match-screen.js";
import { ClientError } from "../platform/errors.js";
import { ErrorNotice, Loading, Panel, useRuntime, useSession } from "../ui/shared.js";

// Mounted only for the loopback preview entry; the ordinary route still requires Telegram auth.
export function DirectCoupPreview({ matchId }: { matchId: string }) {
  const runtime = useRuntime();
  const session = useSession((state) => state.session);
  const expired = useSession((state) => state.expired);
  const requested = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<ClientError | null>(null);

  useEffect(() => {
    if (session || expired || requested.current) return;
    requested.current = true;
    let active = true;
    void runtime.login(crypto.randomUUID()).catch((cause: unknown) => {
      if (active)
        setError(cause instanceof ClientError ? cause : new ClientError("INTERNAL_ERROR"));
    });
    return () => {
      active = false;
    };
  }, [runtime, session, expired, attempt]);

  if (session) return <MatchScreen id={matchId} />;
  return (
    <>
      <p className="eyebrow">LOCAL COUP PREVIEW</p>
      <h1>Opening the table</h1>
      <Panel title="Synthetic session">
        {expired ? (
          <p>Preview session ended. Reload this page to start again.</p>
        ) : error ? (
          <ErrorNotice
            error={error}
            retry={() => {
              requested.current = false;
              setError(null);
              setAttempt((value) => value + 1);
            }}
          />
        ) : (
          <Loading />
        )}
      </Panel>
    </>
  );
}
