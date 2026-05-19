import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer } from "react-leaflet";
import { Icon, LatLngExpression } from "leaflet";
import { useTranslation } from "react-i18next";
import { useTheme } from "../contexts/ThemeContext";

/*
  ALL MAP PIN COLORS use CSS custom properties — resolved to the system
  primary emerald at runtime so they always match the global theme.

  Primary color (var(--primary)):
    Dark mode:  oklch(0.74 0.18 158) ≈ #22c79d  emerald
    Light mode: oklch(0.66 0.16 158) ≈ #1aaa8a  emerald

  Resolved hex equivalents used in SVG (must be static for Leaflet icon URLs):
  We use a fresh resolved value from the document root.
*/

/* Helper: read a CSS variable from :root at runtime */
function cssVar(name: string, fallback = "#22c79d"): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/*
  Sensitive area pin SVG — uses the computed primary color.
  We build the icon lazily so the CSS variables are resolved after the
  theme has been applied.
*/
function makeSensitiveIcon(primaryColor: string): Icon {
  const fill = primaryColor || "#22c79d";
  const svg  = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 22 12.5 41 12.5 41S25 22 25 12.5C25 5.6 19.4 0 12.5 0Z"
        fill="${fill}" stroke="${fill === "#22c79d" ? "#0a1410" : "#0a1410"}" stroke-width="1.5"/>
      <circle cx="12.5" cy="12.5" r="4.5" fill="rgba(0,0,0,0.65)"/>
    </svg>`,
  );
  return new Icon({
    iconUrl:    `data:image/svg+xml;utf8,${svg}`,
    iconSize:   [25, 41],
    iconAnchor: [12, 41],
  });
}

export type DroneMapMarker  = { id: string | number; lat: number; lon: number; color: string; label: string; radius?: number };
export type SensitiveMarker = { name: string; lat: number; lon: number };
export type CameraMarker    = { id: number; name: string; lat: number; lon: number; heading_deg: number; fov_h_deg: number; distance_m: number; threatActive?: boolean };
export type InterceptMarker = { lat: number; lon: number; label: string };

interface Props {
  center?:         LatLngExpression;
  zoom?:           number;
  markers?:        DroneMapMarker[];
  sensitiveAreas?: SensitiveMarker[];
  cameras?:        CameraMarker[];
  predictedPath?:  LatLngExpression[] | null;
  interceptPoint?: InterceptMarker | null;
}

function offset(lat: number, lon: number, bearing_deg: number, distance_m: number): [number, number] {
  const bearing = (bearing_deg * Math.PI) / 180;
  const dN = distance_m * Math.cos(bearing);
  const dE = distance_m * Math.sin(bearing);
  return [lat + dN / 111320, lon + dE / (111320 * Math.cos((lat * Math.PI) / 180))];
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
  center         = [24.7136, 46.6753],
  zoom           = 6,
  markers        = [],
  sensitiveAreas = [],
  cameras        = [],
  predictedPath  = null,
  interceptPoint = null,
}: Props) {
  const { t }     = useTranslation();
  const { theme } = useTheme();

  const tileUrl = theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

  /*
    SYSTEM COLOR TOKENS — read from CSS variables at render time.
    This ensures every map marker uses the same primary/destructive
    colors as the rest of the UI.
  */
  const primaryColor     = cssVar("--primary",     "#22c79d");
  const destructiveColor = cssVar("--destructive", "#ef4444");
  const interceptColor   = "oklch(0.78 0.18 275)"; /* violet — unchanged, action target */
  const pathColor        = "oklch(0.62 0.13 175)"; /* teal — predicted path */

  /* Camera fill (inside the dot) contrasts with the stroke color */
  const camFill = theme === "light" ? "#ffffff" : "#0d130f";

  /* Build sensitive icon with live primary color */
  const sensitiveIcon = makeSensitiveIcon(primaryColor);

  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom={true} className="h-full w-full rounded-md">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url={tileUrl}
      />

      {/* Sensitive area pins — primary color */}
      {sensitiveAreas.map((a) => (
        <Marker key={a.name} position={[a.lat, a.lon]} icon={sensitiveIcon}>
          <Popup><strong>{a.name}</strong></Popup>
        </Marker>
      ))}

      {/* Camera FOV cones + markers */}
      {cameras.flatMap((cam) => {
        const cone     = fovCone(cam);
        const tip      = offset(cam.lat, cam.lon, cam.heading_deg, cam.distance_m);
        /* Threat-active cameras use destructive red, normal use primary emerald */
        const camColor = cam.threatActive ? destructiveColor : primaryColor;
        return [
          <Polygon
            key={`cam-cone-${cam.id}`}
            positions={cone}
            pathOptions={{ color: camColor, fillColor: camColor, fillOpacity: cam.threatActive ? 0.22 : 0.12, weight: 1.5, dashArray: "4 6" }}
          />,
          <Polyline
            key={`cam-axis-${cam.id}`}
            positions={[[cam.lat, cam.lon], tip]}
            pathOptions={{ color: camColor, weight: 2 }}
          />,
          <CircleMarker
            key={`cam-pin-${cam.id}`}
            center={[cam.lat, cam.lon]}
            radius={cam.threatActive ? 9 : 7}
            pathOptions={{ color: camColor, fillColor: camFill, fillOpacity: 1, weight: 2 }}
          >
            <Popup>
              <strong>{cam.name}</strong>{cam.threatActive ? ` — ${t("live.cam_threat")}` : ""}<br/>
              {t("live.cam_heading")}: <span dir="ltr">{cam.heading_deg}°</span><br/>
              {t("live.cam_fov")}: <span dir="ltr">{cam.fov_h_deg}°</span><br/>
              {t("live.cam_range")}: <span dir="ltr">{cam.distance_m} m</span>
            </Popup>
          </CircleMarker>,
        ];
      })}

      {/*
        Generic markers (history attacks, drone tracks, etc.).
        The COLOR passed by callers is preserved — but callers
        should now pass "var(--primary)" or "var(--destructive)"
        instead of hardcoded hex. For Recharts/Leaflet we resolve here.
        If the color starts with "var(", resolve it.
      */}
      {markers.map((m) => {
        const resolvedColor =
          m.color === "var(--primary)"     ? primaryColor :
          m.color === "var(--destructive)" ? destructiveColor :
          m.color;
        return (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={m.radius ?? 6}
            pathOptions={{ color: resolvedColor, fillColor: resolvedColor, fillOpacity: 0.65, weight: 1.5 }}
          >
            <Popup>{m.label}</Popup>
          </CircleMarker>
        );
      })}

      {/* Predicted path — teal polyline */}
      {predictedPath && predictedPath.length >= 2 && (
        <Polyline
          positions={predictedPath}
          pathOptions={{ color: pathColor, dashArray: "6 8", weight: 3 }}
        />
      )}

      {/* Intercept point — violet */}
      {interceptPoint && (
        <>
          <CircleMarker
            center={[interceptPoint.lat, interceptPoint.lon]}
            radius={11}
            pathOptions={{ color: interceptColor, fillColor: interceptColor, fillOpacity: 0.25, weight: 2 }}
          >
            <Popup><strong>{t("live.intercept_point")}</strong><br/>{interceptPoint.label}</Popup>
          </CircleMarker>
          <CircleMarker
            center={[interceptPoint.lat, interceptPoint.lon]}
            radius={3}
            pathOptions={{ color: interceptColor, fillColor: interceptColor, fillOpacity: 1, weight: 1 }}
          />
        </>
      )}
    </MapContainer>
  );
}
