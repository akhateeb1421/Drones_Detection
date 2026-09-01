import { MapContainer, Marker, TileLayer, useMapEvents, useMap } from "react-leaflet";
import { Icon, LatLng } from "leaflet";
import { useEffect } from "react";
import { useTheme } from "../contexts/ThemeContext";

const PIN_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 22 12.5 41 12.5 41S25 22 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#03DA9A" stroke="#0a1410" stroke-width="1.5"/>
    <circle cx="12.5" cy="12.5" r="4.5" fill="#0a1410"/>
  </svg>`,
);
const pinIcon = new Icon({
  iconUrl: `data:image/svg+xml;utf8,${PIN_SVG}`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface Props { lat: number; lon: number; onChange: (lat: number, lon: number) => void; height?: string; zoom?: number; }

/** Wrap a longitude into the canonical [-180, 180] range. Defensive
 *  guard against world-copy clicks returning a wrapped longitude that
 *  Leaflet refuses to draw a marker at. */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function isFiniteLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function ClickCatcher({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      const lat = e.latlng.lat;
      const lng = wrapLng(e.latlng.lng);
      if (!isFiniteLatLng(lat, lng)) return;
      onPick(lat, lng);
    },
  });
  return null;
}

/** Smoothly pan the map to the new lat/lon whenever the prop changes.
 *  Uses `panTo` so the move is animated (~350 ms slide) instead of a
 *  hard teleport, while keeping the operator's current zoom level. */
function Recenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    if (!isFiniteLatLng(lat, lon)) return;
    map.panTo([lat, lon], { animate: true, duration: 0.35 });
  }, [lat, lon, map]);
  return null;
}

export function LocationPicker({ lat, lon, onChange, height = "320px", zoom = 11 }: Props) {
  const { theme } = useTheme();
  const tileUrl = theme === "light"
    ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png"; // dark look comes from the CSS invert filter

  const handlePick = (newLat: number, newLon: number) => {
    if (!isFiniteLatLng(newLat, newLon)) return;
    onChange(newLat, newLon);
  };

  return (
    <div style={{ height }} className="rounded-md overflow-hidden border border-slate-700">
      <MapContainer center={[lat, lon]} zoom={zoom} scrollWheelZoom worldCopyJump={false} className="h-full w-full">
        <TileLayer attribution='&copy; OpenStreetMap' url={tileUrl} />
        <Marker
          position={[lat, lon]}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const ll = e.target.getLatLng() as LatLng;
              handlePick(ll.lat, wrapLng(ll.lng));
            },
          }}
        />
        <ClickCatcher onPick={handlePick} />
        <Recenter lat={lat} lon={lon} />
      </MapContainer>
    </div>
  );
}
