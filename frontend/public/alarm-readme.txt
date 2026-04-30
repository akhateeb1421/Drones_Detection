Place a CC0 alarm sound at frontend/public/alarm.mp3.

Suggested sources (free / CC0):
- https://freesound.org/  (filter by License: Creative Commons 0)
- https://pixabay.com/sound-effects/

The file is loaded by src/hooks/useAlarms.ts and played when an alarm event
arrives over the /ws/alarms WebSocket. Without this file the system will still
work — the banner shows up but the audio is silent.
