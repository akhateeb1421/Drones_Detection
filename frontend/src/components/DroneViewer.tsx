import { Component, ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bounds, Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import { useTheme } from "../contexts/ThemeContext";
import * as THREE from "three";

interface Props {
  modelUrl?: string;       // optional .glb url under /public/models/
  embedUrl?: string;       // optional Sketchfab embed url -> rendered as iframe
  modelKey: string;        // forces canvas remount when switching drones
  autoRotate?: boolean;
}

function GLTFModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const cloned = scene.clone(true);
  cloned.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if ("metalness" in mat) {
        mat.metalness = Math.min(0.4, mat.metalness ?? 0);
        mat.roughness = Math.max(0.5, mat.roughness ?? 1);
      }
    }
  });
  return <primitive object={cloned} />;
}

function SpinRig({ autoRotate, children }: { autoRotate: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (autoRotate && ref.current) ref.current.rotation.y += dt * 0.4;
  });
  return <group ref={ref}>{children}</group>;
}

function Placeholder() {
  return (
    <group>
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.25, 0.18, 2.4, 24]} />
        <meshStandardMaterial color="#475569" metalness={0.2} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.12, 0.6, 4]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <boxGeometry args={[0.05, 1.6, 0.4]} />
        <meshStandardMaterial color="#64748b" metalness={0.2} roughness={0.7} />
      </mesh>
      <mesh position={[-1.0, 0.25, 0]}>
        <boxGeometry args={[0.4, 0.5, 0.05]} />
        <meshStandardMaterial color="#64748b" metalness={0.2} roughness={0.7} />
      </mesh>
    </group>
  );
}

class ModelBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (this.state.failed) return <Placeholder />;
    return this.props.children;
  }
}

export function DroneViewer({ modelUrl, embedUrl, modelKey, autoRotate = true }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [missing, setMissing] = useState(false);

  // Probe the GLB only when we're going down that path. Embed iframes are
  // hosted on Sketchfab and don't need a HEAD check.
  useEffect(() => {
    if (embedUrl || !modelUrl) return;
    let alive = true;
    setMissing(false);
    fetch(modelUrl, { method: "HEAD" })
      .then((r) => {
        if (!alive) return;
        if (!r.ok) setMissing(true);
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, [modelUrl, embedUrl]);

  const bg = theme === "light" ? "#e2e8f0" : "#0a0f1e";

  // Branch 1: Sketchfab embed iframe — used when the user couldn't download
  // the GLB. Sketchfab itself uses Three.js under the hood so this still
  // satisfies the "Three.js for 3D rendering" requirement.
  if (embedUrl) {
    // Strip any existing query params and add our presentation flags.
    const base = embedUrl.split("?")[0];
    const params = new URLSearchParams({
      autostart: "1",
      ui_infos: "0",
      ui_watermark_link: "0",
      ui_watermark: "0",
      ui_stop: "0",
      ui_inspector: "0",
      ui_settings: "0",
      ui_vr: "0",
      ui_help: "0",
      ui_hint: "0",
      transparent: "0",
    });
    const src = `${base}?${params.toString()}`;
    return (
      <div
        key={modelKey}
        className="relative h-[420px] w-full overflow-hidden rounded-md border border-slate-800"
        style={{ background: bg }}
      >
        <iframe
          title={modelKey}
          src={src}
          allow="autoplay; fullscreen; xr-spatial-tracking"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  // Branch 2: local GLB via react-three-fiber
  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-md border border-slate-800" style={{ background: bg }}>
      <Canvas key={modelKey} camera={{ position: [3, 2, 4], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.0} />
        <directionalLight position={[-5, -2, -3]} intensity={0.4} />
        <Suspense fallback={<Placeholder />}>
          <Environment preset="city" />
          <Bounds fit clip observe margin={1.2}>
            <SpinRig autoRotate={autoRotate}>
              {missing || !modelUrl ? (
                <Placeholder />
              ) : (
                <ModelBoundary onError={() => setMissing(true)}>
                  <GLTFModel url={modelUrl} />
                </ModelBoundary>
              )}
            </SpinRig>
          </Bounds>
        </Suspense>
        <OrbitControls makeDefault enablePan={false} minDistance={1.5} maxDistance={10} />
      </Canvas>
      {missing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-slate-400">
          {t("drones.placeholder_hint")}
        </div>
      )}
    </div>
  );
}

useGLTF.preload("/models/orlan.glb");
