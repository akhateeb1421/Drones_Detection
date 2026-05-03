import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer } from "react-leaflet";
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

export type CameraMarker = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  heading_deg: number;
  fov_h_deg: number;
  distance_m: number;
};

interface Props {
  center?: LatLngExpression;
  zoom?: number;
  markers?: DroneMapMarker[];
  sensitiveAreas?: SensitiveMarker[];
  cameras?: CameraMarker[];
  predictedPath?: LatLngExpression[] | null;
}

function offset(lat: number, lon: number, bearing_deg: number, distance_m: number): [number, number] {
  const bearing = (bearing_deg * Math.PI) / 180;
  const dN = distance_m * Math.cos(bearing);
  const dE = distance_m * Math.sin(bearing);
  const newLat = lat + dN / 111320;
  const newLon = lon + dE / (111320 * Math.cos((lat * Math.PI) / 180));
  return [newLat, newLon];
}

function fovCone(cam: CameraMarker, segments = 18): [number, number][] {
  const half = cam.fov_h_deg / 2;
  const apex: [number, number] = [cam.lat, cam.lon];
  const arc: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = cam.heading_deg - half + (cam.fov_h_deg * i) / segments;
    arc.push(offset(cam.lat, cam.lon, bearing, cam.distance_m));
  }
  return [apex, ...arc, apex];
}

export function DroneMap({
  center = [24.7136, 46.6753],
  zoom = 6,
  markers = [],
  sensitiveAreas = [],
  cameras = [],
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

      {cameras.flatMap((cam) => {
        const cone = fovCone(cam);
        const tip = offset(cam.lat, cam.lon, cam.heading_deg, cam.distance_m);
        return [
          <Polygon
            key={`cam-cone-${cam.id}`}
            positions={cone}
            pathOptions={{
              color: "#22c55e",
              fillColor: "#22c55e",
              fillOpacity: 0.12,
              weight: 1.5,
              dashArray: "4 6",
            }}
          />,
          <Polyline
            key={`cam-axis-${cam.id}`}
            positions={[[cam.lat, cam.lon], tip]}
            pathOptions={{ color: "#22c55e", weight: 2 }}
          />,
          <CircleMarker
            key={`cam-pin-${cam.id}`}
            center={[cam.lat, cam.lon]}
            radius={7}
            pathOptions={{ color: "#22c55e", fillColor: "#0a0f1e", fillOpacity: 1, weight: 2 }}
          >
            <Popup>
              <strong>{cam.name}</strong>
              <br />
              heading: {cam.heading_deg}°<br />
              FOV: {cam.fov_h_deg}°<br />
              range: {cam.distance_m} m
            </Popup>
          </CircleMarker>,
        ];
      })}

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
