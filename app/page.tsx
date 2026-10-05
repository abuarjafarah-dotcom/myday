'use client';

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-500 to-purple-600">
        <div className="bg-white p-8 rounded-lg shadow-xl text-center max-w-md">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">Farah Dashboard</h1>
          <p className="text-gray-600 mb-6">
            Sign in with Google to access your personalized dashboard with Gmail, Calendar, and weather integration.
          </p>
          <button
            onClick={() => signIn("google")}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg w-full transition"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <main>
      <Dashboard user={session.user} onSignOut={() => signOut()} />
    </main>
  );
}
