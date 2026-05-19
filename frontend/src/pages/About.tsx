import { useState } from "react";
import { useTranslation } from "react-i18next";

/* All colours from var(--*) tokens defined in styles.css */

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: "calc(var(--radius, 0.875rem) + 4px)",
      padding: "clamp(18px,2.2vw,28px)",
      position: "relative", overflow: "hidden",
      boxShadow: "var(--shadow-card)",
      ...style,
    }}>
      {/* Emerald shimmer top edge */}
      <div style={{ position:"absolute", top:0, left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,var(--primary-glow),transparent)", pointerEvents:"none" }}/>
      {children}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.15em", textTransform:"uppercase", color:"var(--muted-foreground)", marginBottom:5 }}>
      {label}
    </div>
  );
}

function STitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize:"clamp(15px,1.8vw,18px)", fontWeight:800, color:"var(--foreground)", marginBottom:"clamp(12px,1.5vw,18px)" }}>
      {children}
    </div>
  );
}

/* Pill — uses --primary and --primary-glow from styles.css */
function Pill({ label }: { label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600,
      background: "oklch(from var(--primary) l c h / 0.12)",
      color: "var(--primary)",
      border: "1px solid oklch(from var(--primary) l c h / 0.25)",
      margin: "3px",
    }}>
      {label}
    </span>
  );
}

/* Step number node — gradient-primary circle from styles.css */
function Step({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div style={{ display:"flex", gap:14, alignItems:"flex-start", paddingBottom:14 }}>
      <div style={{
        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
        background: "var(--gradient-primary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 800, color: "var(--primary-foreground)",
        boxShadow: "var(--shadow-glow)",
      }}>
        {num}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize:"clamp(13px,1.5vw,15px)", fontWeight:700, color:"var(--foreground)", marginBottom:4 }}>{title}</div>
        <div style={{ fontSize:"clamp(12px,1.3vw,14px)", color:"var(--muted-foreground)", lineHeight:1.7 }}>{desc}</div>
      </div>
    </div>
  );
}

const DATA = {
  ar: {
    hero_tag:"نظرة على المشروع",
    hero_title:"رقيب — منظومة الدفاع ضد الطائرات المسيّرة",
    hero_desc:"طُوِّر رقيب كمشروع تخرج يهدف إلى بناء منصة ذكاء اصطناعي متكاملة للكشف عن الطائرات المسيّرة المعادية والتصدي لها في السياق السعودي. يجمع النظام بين الرؤية الحاسوبية في الوقت الفعلي وتحليل البيانات التاريخية والمساعد الذكي اللغوي لمنح المشغّل صورة تكتيكية شاملة.",
    stats:[{v:"3,026",l:"هجوم مسجّل"},{v:"3",l:"مسيرات"},{v:"٢",l:"لغة مدعومة"}],
    tabs:["نظرة عامة","النماذج","التقنيات"],
    prob_tag:"المشكلة",prob_title:"لماذا بُني هذا النظام؟",
    prob_pts:["تعد المسيرات سلاح حربي ذو تكلفة قليلة كما يصعب اكتشافها بالرادار التقليدي","تُستخدم في أسراب لإرباك منظومات الدفاع","تستهدف البنية التحتية: المصافي، الكهرباء، المياه","المشغّل يحتاج قرار في ثوانٍ لا دقائق"],
    how_tag:"آلية العمل",how_title:"كيف يعمل النظام؟",
    steps:[
      {title:"الكاميرا",desc:"تلتقط بث الفيديو وترسله للخادم عبر MJPEG أو RTSP"},
      {title:"YOLOv26 — الكشف",desc:"يحلل كل إطار ويصنّف: شاهد-136، أورلان-10، DJI، طائرة، طائر، هيليكوبتر"},
      {title:"ByteTrack — التتبع",desc:"يعطي كل هدف معرّفاً فريداً ويتبعه حتى لو اختفى مؤقتاً"},
      {title:"التحليل الجغرافي",desc:"يحوّل موقع البكسل إلى GPS ويقوم بتحديد الاتجاه وحساب السرعة والوقت المتوقع للوصول لأقرب نقطة حساسة"},
      {title:"تقييم التهديد",desc:"يصنّف التهديد ويقترح نقطة الاعتراض الأمثل"},
      {title:"المشغّل",desc:"يقوم بمراقبة الكاميرات والتفاعل مع الانذارات واعداد التقارير"},
    ],
    data_tag:"البيانات",data_title:"مصادر البيانات",
    data_items:[
      {l:"93 سجل حقيقي",d:"من حوادث موثقة (هجمات أرامكو، الهجمات الحوثية...)"},
      {l:"3,000+ سجل مُولَّد",d:"بيانات اصطناعية تتبع نفس التوزيع الجغرافي"},
      {l:"1,950 سؤال وجواب",d:"مجموعة أسئلة باللغتين لتدريب الماسعد الذكي"},
    ],
    models_tag:"النماذج",models_title:"النماذج المدرّبة",
    models:[
      {n:"YOLOv8 — كاشف الطائرات",desc:"مدرَّب على صور حقيقية وصور مُولَّدة لستة أصناف (مسيّرة حربية، تجارية، طائرة، طائر، هيليكوبتر). يعمل في الوقت الفعلي على 30+ إطار/ثانية.",pills:["mAP50: 91%","Precision: 88%","Recall: 86%"]},
      {n:"XGBoost — مصنّف التهديد",desc:"يأخذ ميزات الكشف والمسار والسياق الجغرافي ليصنّف مستوى التهديد في أقل من 10ms.",pills:["Accuracy: 94%","F1: 0.91","Latency: <10ms"]},
      {n:"Prophet — متنبّئ الهجمات",desc:"نموذج سلاسل زمنية مُدرَّب على البيانات التاريخية للتنبؤ بحجم الهجمات الأسبوعية لكل منطقة.",pills:["MAE: 2.1","RMSE: 3.4","Horizon: 90 يوم"]},
      {n:"Qwen2.5-3B (LoRA) — المساعد الذكي",desc:"نموذج لغوي صغير مضبوط دقيق بـ1,950 سؤالاً باللغتين العربية والإنجليزية لتحليل التهديدات والإجابة عن الاستفسارات التكتيكية.",pills:["Fine-tuned","Bilingual","Offline"]},
    ],
    tech_tag:"التقنيات",tech_title:"المكدّس التقني",
    tech:[
      {cat:"الرؤية الحاسوبية",items:["YOLOv8","ByteTrack","OpenCV","PyTorch"]},
      {cat:"تحليل البيانات",items:["XGBoost","Prophet","Scikit-learn","Pandas"]},
      {cat:"البنية الخلفية",items:["FastAPI","PostgreSQL","SQLAlchemy","WebSocket"]},
      {cat:"الواجهة الأمامية",items:["React","TypeScript","Recharts","Leaflet"]},
      {cat:"الذكاء الاصطناعي",items:["Qwen2.5-3B","LoRA","HuggingFace","GGUF"]},
    ],
  },
  en: {
    hero_tag:"Project Overview",
    hero_title:"Raqeeb — Counter-UAS Defense System",
    hero_desc:"Raqeeb was built as a graduation project aiming to create an integrated AI platform for detecting and countering hostile drones in the Saudi context. The system combines real-time computer vision, historical data analysis, and an AI language assistant to give the operator a comprehensive tactical picture.",
    stats:[{v:"3,026",l:"Recorded Attacks"},{v:"3",l:"Drones"},{v:"2",l:"Supported Languages"}],
    tabs:["Overview","Models","Tech Stack"],
    prob_tag:"The Problem",prob_title:"Why Was This System Built?",
    prob_pts:["Drones are cheap weapons that are difficult to detect with traditional radar","Used in swarms to overwhelm defense systems","Target critical infrastructure: refineries, electricity, water","Operators need decisions in seconds, not minutes"],
    how_tag:"How It Works",how_title:"System Architecture",
    steps:[
      {title:"Camera",desc:"Captures video stream and sends it to the server via MJPEG or RTSP"},
      {title:"YOLOv8 — Detection",desc:"Analyzes each frame and classifies: Shahed-136, Orlan-10, DJI, Plane, Bird, Helicopter"},
      {title:"ByteTrack — Tracking",desc:"Assigns each target a unique ID and tracks it even if it temporarily disappears"},
      {title:"Geospatial Analysis",desc:"Converts pixel location to GPS, determines heading, calculates speed and ETA to nearest sensitive point"},
      {title:"Threat Assessment",desc:"Classifies the threat and suggests the optimal intercept point"},
      {title:"Operator",desc:"Monitors cameras, responds to alerts, and generates reports"},
    ],
    data_tag:"Data",data_title:"Data Sources",
    data_items:[
      {l:"93 Real Records",d:"From documented incidents (Aramco attacks, Houthi attacks...)"},
      {l:"3,000+ Generated Records",d:"Synthetic data following the same geographic distribution"},
      {l:"1,950 Q&A Pairs",d:"Bilingual question set for training the AI assistant"},
    ],
    models_tag:"Models",models_title:"Trained Models",
    models:[
      {n:"YOLOv8 — Drone Detector",desc:"Trained on real and generated images for six classes (military drone, commercial, plane, bird, helicopter). Runs real-time at 30+ FPS.",pills:["mAP50: 91%","Precision: 88%","Recall: 86%"]},
      {n:"XGBoost — Threat Classifier",desc:"Takes detection features, trajectory, and geographic context to classify threat level in under 10ms.",pills:["Accuracy: 94%","F1: 0.91","Latency: <10ms"]},
      {n:"Prophet — Attack Forecaster",desc:"Time series model trained on historical data to predict weekly attack volumes per region.",pills:["MAE: 2.1","RMSE: 3.4","Horizon: 90 days"]},
      {n:"Qwen2.5-3B (LoRA) — AI Assistant",desc:"Small language model fine-tuned on 1,950 bilingual Q&A pairs for threat analysis and tactical queries.",pills:["Fine-tuned","Bilingual","Offline"]},
    ],
    tech_tag:"Tech Stack",tech_title:"Technology Stack",
    tech:[
      {cat:"Computer Vision",items:["YOLOv8","ByteTrack","OpenCV","PyTorch"]},
      {cat:"Data Analysis",items:["XGBoost","Prophet","Scikit-learn","Pandas"]},
      {cat:"Backend",items:["FastAPI","PostgreSQL","SQLAlchemy","WebSocket"]},
      {cat:"Frontend",items:["React","TypeScript","Recharts","Leaflet"]},
      {cat:"AI / LLM",items:["Qwen2.5-3B","LoRA","HuggingFace","GGUF"]},
    ],
  },
};

export function About() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("ar") ? "ar" : "en";
  const d = DATA[lang];
  const [tab, setTab] = useState(0);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }} data-mount>

      {/* Hero */}
      <Card>
        <Tag label={d.hero_tag}/>
        <h1 style={{ fontSize:"clamp(18px,2.5vw,26px)", fontWeight:800, color:"var(--foreground)", margin:"0 0 12px" }}>
          {d.hero_title}
        </h1>
        <p style={{ fontSize:"clamp(13px,1.4vw,15px)", color:"var(--muted-foreground)", lineHeight:1.8, margin:"0 0 20px" }}>
          {d.hero_desc}
        </p>
        {/* Stats row */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {d.stats.map((s,i) => (
            <div key={i} style={{ background:"var(--secondary)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"clamp(12px,1.5vw,18px)", textAlign:"center" }}>
              <div style={{ fontSize:"clamp(20px,3vw,28px)", fontWeight:800, color:"var(--primary)", fontVariantNumeric:"tabular-nums" }}>{s.v}</div>
              <div style={{ fontSize:"clamp(11px,1.2vw,13px)", color:"var(--muted-foreground)", marginTop:4 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Tab switcher — .ts-selector glass pill */}
      <div className="ts-selector" style={{ alignSelf:"flex-start" }}>
        {d.tabs.map((tab_label, i) => (
          <button key={i} onClick={() => setTab(i)} className={tab === i ? "active" : ""}>
            {tab_label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 0 && (
        <div style={{ display:"grid", gap:16, gridTemplateColumns:"1fr" }}>
          {/* Problem */}
          <Card>
            <Tag label={d.prob_tag}/>
            <STitle>{d.prob_title}</STitle>
            <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:8 }}>
              {d.prob_pts.map((p,i) => (
                <li key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, fontSize:"clamp(13px,1.4vw,15px)", color:"var(--foreground)" }}>
                  {/* Bullet uses --primary */}
                  <span style={{ width:8, height:8, borderRadius:"50%", background:"var(--primary)", flexShrink:0, marginTop:6 }}/>
                  {p}
                </li>
              ))}
            </ul>
          </Card>

          {/* How it works */}
          <Card>
            <Tag label={d.how_tag}/>
            <STitle>{d.how_title}</STitle>
            {d.steps.map((s,i) => <Step key={i} num={i+1} title={s.title} desc={s.desc}/>)}
          </Card>

          {/* Data sources */}
          <Card>
            <Tag label={d.data_tag}/>
            <STitle>{d.data_title}</STitle>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {d.data_items.map((item,i) => (
                <div key={i} style={{ display:"flex", gap:14, alignItems:"flex-start", padding:"10px 0", borderBottom: i < d.data_items.length-1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:"var(--gradient-primary)", flexShrink:0, marginTop:5, boxShadow:"var(--shadow-glow)" }}/>
                  <div>
                    <div style={{ fontWeight:700, fontSize:"clamp(13px,1.4vw,15px)", color:"var(--foreground)", marginBottom:3 }}>{item.l}</div>
                    <div style={{ fontSize:"clamp(12px,1.3vw,13px)", color:"var(--muted-foreground)" }}>{item.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Models tab */}
      {tab === 1 && (
        <div style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))" }}>
          {d.models.map((m,i) => (
            <Card key={i}>
              <div style={{ fontWeight:800, fontSize:"clamp(14px,1.6vw,16px)", color:"var(--foreground)", marginBottom:8 }}>{m.n}</div>
              <p style={{ fontSize:"clamp(12px,1.3vw,14px)", color:"var(--muted-foreground)", lineHeight:1.7, margin:"0 0 12px" }}>{m.desc}</p>
              <div style={{ display:"flex", flexWrap:"wrap" }}>
                {m.pills.map((p,j) => <Pill key={j} label={p}/>)}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tech stack tab */}
      {tab === 2 && (
        <div style={{ display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))" }}>
          {d.tech.map((cat,i) => (
            <Card key={i}>
              <div style={{ fontWeight:800, fontSize:"clamp(13px,1.5vw,15px)", color:"var(--primary)", marginBottom:10, textTransform:"uppercase", letterSpacing:"0.08em", fontSize:11 }}>
                {cat.cat}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {cat.items.map((item,j) => (
                  <span key={j} style={{
                    padding:"4px 10px", borderRadius:"9999px", fontSize:12, fontWeight:600,
                    background:"var(--secondary)",
                    color:"var(--foreground)",
                    border:"1px solid var(--border)",
                  }}>
                    {item}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
