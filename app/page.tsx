'use client';

import { useEffect } from "react";
import { useSession, signIn } from "next-auth/react";

export default function Home() {
  const { data: session, status } = useSession();

  // Each person lands on their own dashboard: Farah on /dashboard, Omar on /omar.
  useEffect(() => {
    if (!session || session.error) return;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => window.location.replace(me?.home || "/dashboard"))
      .catch(() => window.location.replace("/dashboard"));
  }, [session]);

  if (status === "loading" || (session && !session.error)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4" style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}>
      <div className="bg-white p-8 rounded-lg shadow-xl text-center max-w-sm w-full">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">myday</h1>
        <p className="text-gray-600 mb-6 text-sm">Sign in with Google to load your Gmail and Calendar.</p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="text-white font-semibold py-3 px-6 rounded-lg w-full"
          style={{ background: "#667eea" }}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
