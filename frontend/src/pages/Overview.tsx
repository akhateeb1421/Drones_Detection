import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Analysis, RegionStat, TypeStat } from "../services/api";

const COLORS = ["#0369a1", "#e94560", "#f5a623", "#22c55e", "#a855f7", "#1abc9c", "#e67e22", "#3498db"];

export function Overview() {
  const { t } = useTranslation();
  const [regions, setRegions] = useState<RegionStat[]>([]);
  const [types, setTypes] = useState<TypeStat[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([Analysis.byRegion(), Analysis.byType()])
      .then(([r, ty]) => {
        setRegions(r);
        setTypes(ty);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="card text-danger">{error}</div>;

  const total = regions.reduce((acc, r) => acc + r.count, 0);
  const regionsAffected = regions.length;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-accent">{t("nav.overview")}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="label">{t("overview.total_attacks")}</div>
          <div className="text-3xl font-bold">{total}</div>
        </div>
        <div className="card">
          <div className="label">{t("overview.regions")}</div>
          <div className="text-3xl font-bold">{regionsAffected}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="label">{t("overview.by_region")}</div>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={regions}
                  dataKey="count"
                  nameKey="region"
                  outerRadius={90}
                  label={(e) => e.region}
                >
                  {regions.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="label">{t("overview.by_type")}</div>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <BarChart data={types}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="attack_type" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="count" fill="#0369a1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
