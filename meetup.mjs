// meetup.mjs - versión de prueba con eventos mock
export async function getMeetupEvents() {
  try {
    // 🔹 Simulación de respuesta de API
    return [
      {
        title: "Meetup Tech CDMX: Inteligencia Artificial",
        date: "2025-10-05T19:00:00",
        url: "https://www.meetup.com/es-ES/ai-cdmx/events/12345/"
      },
      {
        title: "Comunidad Startups CDMX: Networking & Pitch",
        date: "2025-10-08T18:30:00",
        url: "https://www.meetup.com/es-ES/startups-cdmx/events/67890/"
      }
    ];
  } catch (err) {
    console.error("Error en Meetup (mock):", err);
    return [];
  }
}