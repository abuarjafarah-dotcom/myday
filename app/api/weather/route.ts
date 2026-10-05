export async function GET(request: Request) {
  try {
    // Open-Meteo API - free, no key required
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=43.8509&longitude=-92.2174&current=temperature_2m,relative_humidity_2m,weather_code,apparent_temperature&timezone=America/Chicago"
    );

    const data = await response.json();
    const current = data.current;

    // Map WMO weather codes to descriptions
    const weatherCodes: { [key: number]: string } = {
      0: "Clear",
      1: "Mostly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Foggy",
      48: "Foggy",
      51: "Light drizzle",
      53: "Drizzle",
      55: "Heavy drizzle",
      61: "Light rain",
      63: "Rain",
      65: "Heavy rain",
      71: "Light snow",
      73: "Snow",
      75: "Heavy snow",
      77: "Snow grains",
      80: "Light showers",
      81: "Showers",
      82: "Heavy showers",
      85: "Light snow showers",
      86: "Snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm with hail",
      99: "Thunderstorm with hail",
    };

    return Response.json({
      temperature: Math.round(current.temperature_2m),
      condition: weatherCodes[current.weather_code] || "Unknown",
      feelsLike: Math.round(current.apparent_temperature),
      humidity: current.relative_humidity_2m,
    });
  } catch (error) {
    console.error("Weather API error:", error);
    return Response.json({ error: "Failed to fetch weather" }, { status: 500 });
  }
}
