# Skill: Prueba Multi-Agente (Orquestador)

Esta skill demuestra cómo delegar múltiples tareas a subagentes en paralelo usando la herramienta `Task`, evitando saturar el contexto de la sesión principal.

Cuando el usuario te pida ejecutar la "prueba multi-agente", "prueba de saludos múltiples" o invoque esta skill, DEBES seguir estrictamente estos pasos:

1. NO generes las respuestas tú mismo en el chat principal.
2. Utiliza la herramienta `Task` para lanzar tres (3) subagentes concurrentemente (en una sola respuesta con múltiples llamadas a la herramienta).
3. Configura cada llamada a `Task` con los siguientes parámetros:

   **Subagente 1 (Buenos Días):**
   - `subagent_type`: "coordinador"
   - `description`: "Generar saludo de buenos dias"
   - `prompt`: "Tu única tarea es generar un mensaje de buenos días muy creativo y motivador para el usuario. Devuelve únicamente el mensaje."

   **Subagente 2 (Despedida):**
   - `subagent_type`: "coordinador"
   - `description`: "Generar mensaje de despedida"
   - `prompt`: "Tu única tarea es generar un mensaje de despedida cordial y profesional, deseándole al usuario éxito en su código. Devuelve únicamente el mensaje."

   **Subagente 3 (Verificación):**
   - `subagent_type`: "explore"
   - `description`: "Verificar entorno"
   - `prompt`: "Usa la herramienta bash para ejecutar `pwd` (o `cd` en Windows). Luego, devuelve un mensaje que diga: 'Entorno verificado en [ruta]. Listo para salir'."

4. Espera a que los tres subagentes terminen y te devuelvan sus resultados.
5. Finalmente, presenta al usuario un único mensaje con un resumen limpio que contenga las tres respuestas recibidas, indicando qué subagente produjo cada una.