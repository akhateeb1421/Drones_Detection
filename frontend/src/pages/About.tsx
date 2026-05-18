import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../contexts/ThemeContext";

/* ── Colors matching the main system ── */
const C1 = "#01F2CF";
const C2 = "#03DA9A";
const C3 = "#03B3DA";
const DANGER = "#f87171";
const WARN = "#fbbf24";

/** Brand colors used as TEXT on light cards have ~1.4:1 contrast.
 *  Map each to the existing darkened sibling used in the light-mode
 *  CSS overrides (.text-success → #03796a, .text-warning → #a16207,
 *  etc.) so brand-coded labels stay readable in light mode while the
 *  dark-mode treatment is preserved. No new colors introduced. */
function brandForText(brand: string, isLight: boolean): string {
  if (!isLight) return brand;
  switch (brand) {
    case C1:
      return "#03796a";
    case C2:
      return "#03796a";
    case C3:
      return "#00505a";
    case WARN:
      return "#a16207";
    case DANGER:
      return "#dc2626";
    default:
      return brand;
  }
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        // Theme-aware — CSS variables swap on html.light. Border + drop
        // shadow so cards float above the deeper light page bg.
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 16,
        padding: "clamp(18px,2.2vw,28px)",
        position: "relative",
        overflow: "hidden",
        boxShadow:
          "0 8px 24px -12px rgba(0,0,0,0.25),0 2px 6px -2px rgba(0,0,0,0.12)",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background:
            "linear-gradient(90deg,transparent,rgba(1,242,207,0.16),transparent)",
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        marginBottom: 5,
      }}
    >
      {label}
    </div>
  );
}
function STitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "clamp(15px,1.8vw,18px)",
        fontWeight: 800,
        color: "var(--text-primary)",
        marginBottom: "clamp(12px,1.5vw,18px)",
      }}
    >
      {children}
    </div>
  );
}
function Pill({ label, color = C1 }: { label: string; color?: string }) {
  const { theme } = useTheme();
  const isLight = theme === "light";
  // In light mode the brand color is used both as text and as a tint.
  // For text, darken to the existing dark-brand sibling. For the tint
  // and border, keep the bright brand so the pill still reads as
  // "branded".
  const textColor = brandForText(color, isLight);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "5px 12px",
        borderRadius: 20,
        fontSize: 13,
        fontWeight: 600,
        background: `${color}12`,
        color: textColor,
        border: `0.5px solid ${color}30`,
        margin: "3px",
      }}
    >
      {label}
    </span>
  );
}
function Step({
  num,
  title,
  desc,
}: {
  num: number;
  title: string;
  desc: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        paddingBottom: 14,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: `linear-gradient(135deg,${C1},${C3})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 13,
          fontWeight: 800,
          color: "#fff",
          boxShadow: `0 0 12px ${C1}40`,
        }}
      >
        {num}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: "clamp(13px,1.5vw,15px)",
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: "clamp(12px,1.3vw,14px)",
            color: "var(--text-muted)",
            lineHeight: 1.7,
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}

const DATA = {
  ar: {
    hero_tag: "نظرة على المشروع",
    hero_title: "رقيب — منظومة الدفاع ضد الطائرات المسيّرة",
    hero_desc:
      "طُوِّر رقيب كمشروع تخرج يهدف إلى بناء منصة ذكاء اصطناعي متكاملة للكشف عن الطائرات المسيّرة المعادية والتصدي لها في السياق السعودي. يجمع النظام بين الرؤية الحاسوبية في الوقت الفعلي وتحليل البيانات التاريخية والمساعد الذكي اللغوي لمنح المشغّل صورة تكتيكية شاملة.",
    stats: [
      { v: "3,026", l: "هجوم مسجّل" },
      { v: "3", l: "مسيرات" },
      { v: "٢", l: "لغة مدعومة" },
    ],
    tabs: ["نظرة عامة", "النماذج", "التقنيات"],
    prob_tag: "المشكلة",
    prob_title: "لماذا بُني هذا النظام؟",
    prob_pts: [
      "تعد المسيرات سلاح حربي ذو تكلفة قليلة كما يصعب اكتشافها بالرادار التقليدي",
      "تُستخدم في أسراب لإرباك منظومات الدفاع",
      "تستهدف البنية التحتية: المصافي، الكهرباء، المياه",
      "المشغّل يحتاج قرار في ثوانٍ لا دقائق",
    ],
    how_tag: "آلية العمل",
    how_title: "كيف يعمل النظام؟",
    steps: [
      { title: "الكاميرا", desc: "تلتقط بث الفيديو وترسله للخادم عبر MJPEG" },
      {
        title: "YOLOv26 — الكشف",
        desc: "يحلل كل إطار ويصنّف: شاهد-136، أورلان-10، DJI، طائرة، طائر، هيليكوبتر",
      },
      {
        title: "ByteTrack — التتبع",
        desc: "يعطي كل هدف معرّفاً فريداً ويتبعه حتى لو اختفى مؤقتاً",
      },
      {
        title: "التحليل الجغرافي",
        desc: "يحوّل موقع البكسل إلى GPS ويقوم بتحديد الاتجاه وحساب السرعة والوقت المتوقع للوصول لأقرب نقطة حساسة",
      },
      {
        title: "تقييم التهديد",
        desc: "يصنّف التهديد ويقترح نقطة الاعتراض الأمثل",
      },
      {
        title: "المشغّل",
        desc: "يقوم بمراقبة الكاميرات والتفاعل مع الانذارات واعداد التقارير",
      },
    ],
    data_tag: "البيانات",
    data_title: "مصادر البيانات",
    data_items: [
      {
        l: "93 سجل حقيقي",
        d: "من حوادث موثقة (هجمات أرامكو، الهجمات الحوثية...)",
      },
      {
        l: "3,000+ سجل مُولَّد",
        d: "بيانات اصطناعية تتبع نفس التوزيع الجغرافي",
      },
      {
        l: "1,950 سؤال وجواب",
        d: "مجموعة أسئلة باللغتين لتدريب الماسعد الذكي",
      },
    ],
    models_tag: "النماذج",
    models_title: "نماذج الذكاء الاصطناعي",
    models: [
      {
        name: "YOLOv26",
        role: "كشف الطائرات",
        desc: "مُدرَّب على صور الطائرات المسيّرة. يعمل 25+ إطار/ثانية.",
        color: C1,
      },
      {
        name: "ByteTrack",
        role: "تتبع متعدد الأهداف",
        desc: "خوارزمية تتبع تحافظ على هوية الهدف حتى عند الاختفاء المؤقت.",
        color: C2,
      },
      {
        name: "Qwen2.5-3B + QLoRA",
        role: "المساعد الذكي",
        desc: "نموذج لغوي على 1,950 سؤال وجواب. يعمل محلياً بدون إنترنت.",
        color: C3,
      },
      {
        name: "XGBoost",
        role: "التنبؤ بالهجمات",
        desc: "يتوقع معدل الهجمات اليومي لكل منطقة خلال 30 يوماً.",
        color: WARN,
      },
    ],
    tech_tag: "التقنيات",
    tech_title: "أدوات وتقنيات البناء",
    frontend: [
      "React 18",
      "TypeScript",
      "Tailwind CSS",
      "Recharts",
      "React-Leaflet",
      "i18next",
      "Vite",
    ],
    backend: [
      "FastAPI",
      "SQLAlchemy",
      "PostgreSQL",
      "Supabase",
      "WebSockets",
      "Python 3.12",
    ],
    ai: [
      "YOLOv26",
      "ByteTrack",
      "Qwen2.5-3B",
      "QLoRA 4-bit",
      "Ollama",
      "Hugging Face",
    ],
    devops: ["uv", "GitHub", "Node 20", "Open-Meteo API", "Sketchfab"],
    arch_tag: "المعمارية",
    arch_title: "معمارية النظام",
    arch: [
      {
        l: "Frontend",
        d: "React + TypeScript — يتواصل عبر REST API و WebSockets",
      },
      { l: "Backend", d: "FastAPI يعالج بث الفيديو والكشف وخدمات الـ API" },
      { l: "Database", d: "Supabase PostgreSQL + PostGIS للبيانات الجغرافية" },
      { l: "AI Engine", d: "Ollama يشغّل Qwen2.5-3B محلياً بدون إنترنت" },
      {
        l: "Detection",
        d: "YOLOv26 + ByteTrack في workers متوازية لكل كاميرا",
      },
    ],
  },
  en: {
    hero_tag: "Project Overview",
    hero_title: "Sentinel — Counter-UAS Defense System",
    hero_desc:
      "Sentinel was developed as a graduation capstone project to build an AI-powered platform for detecting and countering hostile drones in the Saudi Arabian context. The system combines real-time computer vision, historical data analytics, and a bilingual AI assistant to give operators a complete tactical picture.",
    stats: [
      { v: "3,026", l: "Attack Records" },
      { v: "3", l: "Drones" },
      { v: "2", l: "Languages" },
    ],
    tabs: ["Overview", "Models", "Technology"],
    prob_tag: "The Problem",
    prob_title: "Why was this built?",
    prob_pts: [
      "Drones are a low-cost weapon and hard to detect with traditional radar",
      "Used in swarms to overwhelm air defense systems",
      "Target critical infrastructure: oil, power, water",
      "Operators need to decide in seconds — not minutes",
    ],
    how_tag: "How It Works",
    how_title: "System Workflow",
    steps: [
      {
        title: "Camera",
        desc: "Captures live video and streams to backend via MJPEG or RTSP",
      },
      {
        title: "YOLOv26 — Detection",
        desc: "Analyzes every frame: Shahed-136, Orlan-10, DJI, aircraft, bird, helicopter",
      },
      {
        title: "ByteTrack — Tracking",
        desc: "Assigns each target a unique ID and tracks it across frames",
      },
      {
        title: "Geographic Analysis",
        desc: "Converts pixel to GPS, determines heading, and computes speed and ETA to the nearest sensitive site",
      },
      {
        title: "Threat Assessment",
        desc: "Scores threat level and suggests the optimal intercept point",
      },
      {
        title: "Operator",
        desc: "Monitors cameras, responds to alarms, and prepares reports",
      },
    ],
    data_tag: "Data",
    data_title: "Data Sources",
    data_items: [
      {
        l: "93 real attack records",
        d: "From documented incidents (Aramco attacks, Houthi strikes...)",
      },
      {
        l: "3,000+ synthetic records",
        d: "AI-generated data following same geographic distribution",
      },
      {
        l: "1,950 Q&A pairs",
        d: "Bilingual Q&A set for training the AI assistant",
      },
    ],
    models_tag: "AI Models",
    models_title: "Models Used",
    models: [
      {
        name: "YOLOv26",
        role: "Drone Detection",
        desc: "Trained on drone images. Runs at 25+ FPS in real time.",
        color: C1,
      },
      {
        name: "ByteTrack",
        role: "Multi-Object Tracking",
        desc: "Maintains target identity even when temporarily occluded.",
        color: C2,
      },
      {
        name: "Qwen2.5-3B + QLoRA",
        role: "AI Assistant",
        desc: "Fine-tuned on 1,950 Q&A pairs. Runs locally via Ollama.",
        color: C3,
      },
      {
        name: "XGBoost",
        role: "Attack Forecasting",
        desc: "Predicts daily attack count per region for next 30 days.",
        color: WARN,
      },
    ],
    tech_tag: "Tech Stack",
    tech_title: "Tools & Technologies",
    frontend: [
      "React 18",
      "TypeScript",
      "Tailwind CSS",
      "Recharts",
      "React-Leaflet",
      "i18next",
      "Vite",
    ],
    backend: [
      "FastAPI",
      "SQLAlchemy",
      "PostgreSQL",
      "Supabase",
      "WebSockets",
      "Python 3.12",
    ],
    ai: [
      "YOLOv26",
      "ByteTrack",
      "Qwen2.5-3B",
      "QLoRA 4-bit",
      "Ollama",
      "Hugging Face",
    ],
    devops: ["uv", "GitHub", "Node 20", "Open-Meteo API", "Sketchfab"],
    arch_tag: "Architecture",
    arch_title: "System Architecture",
    arch: [
      {
        l: "Frontend",
        d: "React + TypeScript — communicates via REST API and WebSockets",
      },
      {
        l: "Backend",
        d: "FastAPI handles video streaming, detection, and API services",
      },
      { l: "Database", d: "Supabase PostgreSQL + PostGIS for spatial data" },
      {
        l: "AI Engine",
        d: "Ollama runs Qwen2.5-3B locally — no internet required",
      },
      {
        l: "Detection",
        d: "YOLOv26 + ByteTrack in parallel workers per camera",
      },
    ],
  },
};

export function About() {
  const { i18n } = useTranslation();
  const { theme } = useTheme();
  const isAr = i18n.language === "ar";
  const isLight = theme === "light";
  const d = isAr ? DATA.ar : DATA.en;
  const [tab, setTab] = useState(0);

  // maxWidth removed — About page now stretches the full content
  // area like every other section, so cards match their siblings.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "clamp(12px,1.8vw,18px)",
      }}
      data-mount
    >
      {/* Hero */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          {/* Brand logo tile — dark navy backdrop so the cyan→mint→sky
              gradient on the SVG stays vivid in both light and dark
              modes, matching the header logo treatment. */}
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0b2422",
              border: "1px solid rgba(0,90,75,0.45)",
              boxShadow: `0 4px 18px rgba(11,36,34,0.25), 0 0 26px ${C1}25`,
            }}
          >
            <img
              src="/logo.svg"
              alt="رقيب"
              width="46"
              height="46"
              style={{ display: "block" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Tag label={d.hero_tag} />
            {/* Hero title: bright brand gradient on dark cards reads
                well; in light mode the same gradient blends with the
                white card. Switch to solid #0b2422 (deep teal-black)
                so the title reads as a strong heading in light mode. */}
            <div
              style={
                isLight
                  ? {
                      fontSize: "clamp(17px,2.2vw,22px)",
                      fontWeight: 800,
                      marginBottom: 10,
                      color: "#0b2422",
                    }
                  : {
                      fontSize: "clamp(17px,2.2vw,22px)",
                      fontWeight: 800,
                      marginBottom: 10,
                      background: `linear-gradient(90deg,${C1},${C3})`,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }
              }
            >
              {d.hero_title}
            </div>
            <div
              style={{
                fontSize: "clamp(13px,1.5vw,15px)",
                color: "var(--text-muted)",
                lineHeight: 1.75,
              }}
            >
              {d.hero_desc}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
            gap: 10,
            marginTop: 20,
          }}
        >
          {d.stats.map((s) => (
            <div
              key={s.l}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 12,
                padding: "14px 16px",
                textAlign: "center",
              }}
            >
              {/* Stat tile values — brand gradient on dark cards,
                  solid #0b2422 in light mode so the numbers read
                  cleanly on the white tile background. */}
              <div
                style={
                  isLight
                    ? {
                        fontSize: "clamp(20px,2.5vw,26px)",
                        fontWeight: 800,
                        color: "#0b2422",
                        lineHeight: 1,
                      }
                    : {
                        fontSize: "clamp(20px,2.5vw,26px)",
                        fontWeight: 800,
                        background: `linear-gradient(135deg,${C1},${C3})`,
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        backgroundClip: "text",
                        lineHeight: 1,
                      }
                }
              >
                {s.v}
              </div>
              <div
                style={{
                  fontSize: "clamp(10px,1.1vw,12px)",
                  color: "var(--text-muted)",
                  marginTop: 5,
                  textTransform: "uppercase",
                  letterSpacing: "0.10em",
                }}
              >
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 3,
          padding: 4,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 13,
        }}
      >
        {d.tabs.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            style={{
              flex: 1,
              padding: "9px 14px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              fontSize: "clamp(12px,1.4vw,14px)",
              fontWeight: 700,
              fontFamily: "inherit",
              transition: "all 0.15s",
              background:
                tab === i
                  ? `linear-gradient(135deg,${C1},${C3})`
                  : "transparent",
              color: tab === i ? "#0a1410" : "#5fa09a",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "clamp(12px,1.8vw,18px)",
          }}
        >
          <Card>
            <Tag label={d.prob_tag} />
            <STitle>{d.prob_title}</STitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {d.prob_pts.map((p, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
                >
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: DANGER,
                      marginTop: 7,
                      flexShrink: 0,
                      boxShadow: `0 0 6px ${DANGER}60`,
                    }}
                  />
                  <div
                    style={{
                      fontSize: "clamp(13px,1.5vw,15px)",
                      color: "var(--text-muted)",
                      lineHeight: 1.7,
                    }}
                  >
                    {p}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <Tag label={d.how_tag} />
            <STitle>{d.how_title}</STitle>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {d.steps.map((s, i) => (
                <Step key={i} num={i + 1} title={s.title} desc={s.desc} />
              ))}
            </div>
          </Card>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 10,
            }}
          >
            {d.data_items.map((di, i) => (
              <Card key={i}>
                <div
                  style={{
                    fontSize: "clamp(12px,1.4vw,14px)",
                    fontWeight: 700,
                    color: brandForText(C1, isLight),
                    marginBottom: 8,
                  }}
                >
                  {di.l}
                </div>
                <div
                  style={{
                    fontSize: "clamp(12px,1.3vw,14px)",
                    color: "var(--text-muted)",
                    lineHeight: 1.7,
                  }}
                >
                  {di.d}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Models */}
      {tab === 1 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 12,
          }}
        >
          {d.models.map((m, i) => (
            <Card key={i}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 11,
                    background: `${m.color}14`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    border: `0.5px solid ${m.color}30`,
                  }}
                >
                  <div
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: "50%",
                      background: m.color,
                      boxShadow: `0 0 8px ${m.color}`,
                    }}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "clamp(14px,1.6vw,16px)",
                      fontWeight: 800,
                      color: brandForText(m.color, isLight),
                    }}
                  >
                    {m.name}
                  </div>
                  <div
                    style={{
                      fontSize: "clamp(9px,1vw,11px)",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                    }}
                  >
                    {m.role}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: "clamp(12px,1.3vw,14px)",
                  color: "var(--text-muted)",
                  lineHeight: 1.75,
                }}
              >
                {m.desc}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tech */}
      {tab === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { label: "Frontend", items: d.frontend, color: C1 },
            { label: "Backend", items: d.backend, color: C2 },
            { label: "AI / ML", items: d.ai, color: C3 },
            { label: "DevOps", items: d.devops, color: WARN },
          ].map(({ label, items, color }) => (
            <Card key={label}>
              <Tag label={label} />
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                  marginTop: 2,
                }}
              >
                {items.map((item) => (
                  <Pill key={item} label={item} color={color} />
                ))}
              </div>
            </Card>
          ))}
          <Card>
            <Tag label={d.arch_tag} />
            <STitle>{d.arch_title}</STitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {d.arch.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 14,
                    alignItems: "flex-start",
                    padding: "12px 14px",
                    background: "var(--bg-elevated)",
                    borderRadius: 10,
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "clamp(12px,1.3vw,14px)",
                      fontWeight: 700,
                      color: brandForText(C1, isLight),
                      minWidth: 90,
                      flexShrink: 0,
                    }}
                  >
                    {a.l}
                  </div>
                  <div
                    style={{
                      fontSize: "clamp(12px,1.3vw,14px)",
                      color: "var(--text-muted)",
                      lineHeight: 1.7,
                    }}
                  >
                    {a.d}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
