'use client';

import { useEffect, useState } from 'react';

interface DashboardProps {
     user?: { email?: string | null; name?: string | null } | null;
  onSignOut: () => void;
}

export default function Dashboard({ user, onSignOut }: DashboardProps) {
  const [weather, setWeather] = useState<any>(null);
  const [gmail, setGmail] = useState<any[]>([]);
  const [calendar, setCalendar] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [weatherRes, gmailRes, calendarRes] = await Promise.all([
          fetch('/api/weather'),
          fetch('/api/gmail'),
          fetch('/api/calendar'),
        ]);

        const weatherData = await weatherRes.json();
        setWeather(weatherData);

        const gmailData = await gmailRes.json();
        setGmail(gmailData.emails || []);

        const calendarData = await calendarRes.json();
        setCalendar(calendarData.events || []);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Farah</h1>
          <button
            onClick={onSignOut}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
          >
            Sign Out
          </button>
        </div>

        {/* Weather */}
        {weather && (
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 rounded-lg mb-6">
            <p className="text-sm opacity-90 mb-2">{new Date().toLocaleDateString()}</p>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-4xl font-bold">{weather.temperature}°</p>
                <p className="text-lg">{weather.condition}</p>
              </div>
              <div className="text-right">
                <p className="text-sm opacity-90">Feels like</p>
                <p className="text-2xl">{weather.feelsLike}°</p>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading your dashboard...</p>
          </div>
        )}

        {!loading && (
          <div className="space-y-6">
            {/* Gmail Actions */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg">
              <h2 className="text-xl font-bold mb-4">✉️ Action Items</h2>
              {gmail.length > 0 ? (
                <ul className="space-y-2">
                  {gmail.map((email: any) => (
                    <li key={email.id} className="text-gray-700 dark:text-gray-300 border-l-4 border-blue-500 pl-4">
                      {email.subject}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">No unread emails</p>
              )}
            </div>

            {/* Calendar Events */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg">
              <h2 className="text-xl font-bold mb-4">📅 Upcoming Events</h2>
              {calendar.length > 0 ? (
                <ul className="space-y-2">
                  {calendar.map((event: any) => (
                    <li key={event.id} className="text-gray-700 dark:text-gray-300 border-l-4 border-green-500 pl-4">
                      <div className="font-semibold">{event.title}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(event.start).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">No upcoming events</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
