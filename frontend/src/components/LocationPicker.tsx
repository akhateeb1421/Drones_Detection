import { MapContainer, Marker, TileLayer, useMapEvents, useMap } from "react-leaflet";
import { Icon, LatLng } from "leaflet";
import { useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";

const PIN_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 22 12.5 41 12.5 41S25 22 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#c89968" stroke="#1a0810" stroke-width="1.5"/>
    <circle cx="12.5" cy="12.5" r="4.5" fill="#1a0810"/>
  </svg>`,
);
const pinIcon = new Icon({
  iconUrl: `data:image/svg+xml;utf8,${PIN_SVG}`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface Props { lat: number; lon: number; onChange: (lat: number, lon: number) => void; height?: string; zoom?: number; }

function ClickCatcher({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function Recenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lon]); }, [lat, lon, map]);
  return null;
}

export function LocationPicker({ lat, lon, onChange, height = "320px", zoom = 11 }: Props) {
  const { theme } = useTheme();
  const tileUrl = theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  return (
    <div style={{ height }} className="rounded-md overflow-hidden border border-slate-700">
      <MapContainer center={[lat, lon]} zoom={zoom} scrollWheelZoom className="h-full w-full">
        <TileLayer attribution='&copy; OpenStreetMap' url={tileUrl} />
        <Marker position={[lat, lon]} icon={pinIcon} draggable eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng() as LatLng; onChange(ll.lat, ll.lng); } }} />
        <ClickCatcher onPick={onChange} />
        <Recenter lat={lat} lon={lon} />
      </MapContainer>
    </div>
  );
}
