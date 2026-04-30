import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { Icon, LatLngExpression } from "leaflet";

const sensitiveIcon = new Icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export type DroneMapMarker = {
  id: string | number;
  lat: number;
  lon: number;
  color: string;
  label: string;
  radius?: number;
};

export type SensitiveMarker = {
  name: string;
  lat: number;
  lon: number;
};

interface Props {
  center?: LatLngExpression;
  zoom?: number;
  markers?: DroneMapMarker[];
  sensitiveAreas?: SensitiveMarker[];
  predictedPath?: LatLngExpression[] | null;
}

export function DroneMap({
  center = [24.7136, 46.6753],
  zoom = 6,
  markers = [],
  sensitiveAreas = [],
  predictedPath = null,
}: Props) {
  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom={true} className="h-full w-full rounded-md">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {sensitiveAreas.map((a) => (
        <Marker key={a.name} position={[a.lat, a.lon]} icon={sensitiveIcon}>
          <Popup>
            <strong>{a.name}</strong>
          </Popup>
        </Marker>
      ))}
      {markers.map((m) => (
        <CircleMarker
          key={m.id}
          center={[m.lat, m.lon]}
          radius={m.radius ?? 6}
          pathOptions={{ color: m.color, fillColor: m.color, fillOpacity: 0.6 }}
        >
          <Popup>{m.label}</Popup>
        </CircleMarker>
      ))}
      {predictedPath && predictedPath.length >= 2 && (
        <Polyline positions={predictedPath} pathOptions={{ color: "#f5a623", dashArray: "6 8", weight: 3 }} />
      )}
    </MapContainer>
  );
}
