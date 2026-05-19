import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { Icon } from "leaflet";
import { useTheme } from "../contexts/ThemeContext";

/* Read a CSS custom property at runtime so the pin matches the system theme */
function getCssVar(name: string, fallback = "#22c79d"): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function buildPinIcon(color: string): Icon {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 22 12.5 41 12.5 41S25 22 25 12.5C25 5.6 19.4 0 12.5 0Z"
        fill="${color}" stroke="#0a1410" stroke-width="1.5"/>
      <circle cx="12.5" cy="12.5" r="4.5" fill="rgba(0,0,0,0.65)"/>
    </svg>`,
  );
  return new Icon({
    iconUrl:    `data:image/svg+xml;utf8,${svg}`,
    iconSize:   [25, 41],
    iconAnchor: [12, 41],
  });
}

interface Pos { lat: number; lon: number }

interface Props {
  value:    Pos | null;
  onChange: (pos: Pos) => void;
}

function ClickHandler({ onChange }: { onChange: (pos: Pos) => void }) {
  useMapEvents({
    click(e) { onChange({ lat: e.latlng.lat, lon: e.latlng.lng }); },
  });
  return null;
}

/* Keeps the map view centred on the current marker without a hard teleport */
function FlyTo({ pos }: { pos: Pos | null }) {
  const map = useMapEvents({});
  const prev = useRef<Pos | null>(null);
  useEffect(() => {
    if (!pos) return;
    if (prev.current?.lat === pos.lat && prev.current?.lon === pos.lon) return;
    prev.current = pos;
    map.flyTo([pos.lat, pos.lon], Math.max(map.getZoom(), 8), { animate: true, duration: 0.8 });
  }, [pos, map]);
  return null;
}

export function LocationPicker({ value, onChange }: Props) {
  const { theme } = useTheme();

  const tileUrl = theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

  /* Build icon with live primary color so it always matches the theme */
  const primaryColor = getCssVar("--primary", "#22c79d");
  const pinIcon = buildPinIcon(primaryColor);

  return (
    <MapContainer
      center={value ? [value.lat, value.lon] : [24.7136, 46.6753]}
      zoom={value ? 10 : 6}
      scrollWheelZoom={true}
      style={{ height:"100%", width:"100%", borderRadius:12 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url={tileUrl}
      />
      <ClickHandler onChange={onChange}/>
      <FlyTo pos={value}/>
      {value && (
        <Marker position={[value.lat, value.lon]} icon={pinIcon}/>
      )}
    </MapContainer>
  );
}
