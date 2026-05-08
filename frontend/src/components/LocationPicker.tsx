import { MapContainer, Marker, TileLayer, useMapEvents, useMap } from "react-leaflet";
import { Icon, LatLng } from "leaflet";
import { useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";

const pinIcon = new Icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface Props {
  lat: number;
  lon: number;
  onChange: (lat: number, lon: number) => void;
  height?: string;
  zoom?: number;
}

// Catches map clicks and forwards the lat/lon up to the parent.
function ClickCatcher({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// When the parent's lat/lon changes (e.g. user typed in the number inputs),
// recenter the map so the marker stays in view.
function Recenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

export function LocationPicker({ lat, lon, onChange, height = "320px", zoom = 11 }: Props) {
  const { theme } = useTheme();
  // Match the main DroneMap basemap so the admin picker doesn't stay dark
  // when the rest of the dashboard flips to light mode.
  const tileUrl =
    theme === "light"
      ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  return (
    <div style={{ height }} className="rounded-md overflow-hidden border border-slate-700">
      <MapContainer
        center={[lat, lon]}
        zoom={zoom}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url={tileUrl}
        />
        <Marker
          position={[lat, lon]}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const ll = (e.target.getLatLng() as LatLng);
              onChange(ll.lat, ll.lng);
            },
          }}
        />
        <ClickCatcher onPick={onChange} />
        <Recenter lat={lat} lon={lon} />
      </MapContainer>
    </div>
  );
}
