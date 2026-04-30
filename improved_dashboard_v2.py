"""
=============================================================================
Dashboard شامل بدون استيراد خارجي - نظام الدفاع ضد الطائرات المسيرة
Self-contained Dashboard - No External Imports Required
=============================================================================

هذا الملف شامل ولا يحتاج ملفات خارجية
"""

import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
import numpy as np
import json
import folium
from streamlit_folium import st_folium
from datetime import datetime, timedelta
import warnings
from PIL import Image, ImageDraw, ImageFont
import io
import psycopg2
import math
import random

warnings.filterwarnings('ignore')

# إعداد الصفحة
st.set_page_config(
    page_title="🛡️ نظام الدفاع ضد الطائرات المسيرة",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# CSS محدث
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: bold;
        color: #1f4e79;
        text-align: center;
        margin-bottom: 2rem;
        padding: 1rem;
        background: linear-gradient(90deg, #f0f8ff, #e6f3ff);
        border-radius: 10px;
        border: 2px solid #1f4e79;
    }
    .live-alert {
        background: linear-gradient(90deg, #ff4444, #ff6666);
        color: white;
        padding: 1rem;
        border-radius: 10px;
        margin: 1rem 0;
        animation: pulse 2s infinite;
    }
    .detection-card {
        background: white;
        padding: 1.5rem;
        border-radius: 10px;
        border-left: 4px solid #dc3545;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        margin: 1rem 0;
    }
    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.7; }
        100% { opacity: 1; }
    }
    .metric-critical { border-left-color: #dc3545; background-color: #f8d7da; }
    .metric-high { border-left-color: #fd7e14; background-color: #fff3cd; }
    .metric-medium { border-left-color: #ffc107; background-color: #fff9e6; }
    .metric-low { border-left-color: #28a745; background-color: #d4edda; }
</style>
""", unsafe_allow_html=True)

# =============================================================================
# فئة قاعدة البيانات المحسنة (مُدمجة)
# =============================================================================

class DatabaseHandler:
    """معالج قاعدة البيانات المُدمج"""
    
    def __init__(self):
        # إعدادات الاتصال من ملفك
        self.host = "localhost"
        self.port = 5433
        self.database = "history"
        self.user = "postgres"
        self.password = "1119504288"
        self.connection = None
        
    def connect(self):
        try:
            self.connection = psycopg2.connect(
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.user,
                password=self.password
            )
            return True
        except Exception as e:
            st.error(f"❌ خطأ الاتصال بقاعدة البيانات: {e}")
            return False
    
    def get_historical_data(self):
        """الحصول على البيانات التاريخية"""
        try:
            query = """
            SELECT incident_id, attack_date, attack_type, target_location, 
                   region, latitude, longitude
            FROM attack_history 
            ORDER BY attack_date;
            """
            return pd.read_sql_query(query, self.connection)
        except Exception as e:
            st.error(f"❌ خطأ في تحميل البيانات: {e}")
            return pd.DataFrame()
    
    def create_live_detections_table(self):
        """إنشاء جدول الكشوفات المباشرة"""
        try:
            create_query = """
            CREATE TABLE IF NOT EXISTS live_detections (
                detection_id SERIAL PRIMARY KEY,
                detection_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                drone_type VARCHAR(50),
                confidence_score FLOAT,
                gps_latitude DECIMAL(10, 8),
                gps_longitude DECIMAL(11, 8),
                camera_id VARCHAR(50),
                threat_level VARCHAR(20),
                distance_estimate FLOAT,
                processed BOOLEAN DEFAULT FALSE
            );
            """
            cursor = self.connection.cursor()
            cursor.execute(create_query)
            self.connection.commit()
            cursor.close()
            return True
        except Exception as e:
            st.warning(f"⚠️ تحذير في إنشاء الجدول: {e}")
            return False
    
    def get_recent_detections(self, hours=24):
        """الحصول على الكشوفات الأخيرة"""
        try:
            query = """
            SELECT * FROM live_detections 
            WHERE detection_time >= NOW() - INTERVAL '%s hours'
            ORDER BY detection_time DESC;
            """
            return pd.read_sql_query(query, self.connection, params=(hours,))
        except Exception:
            # إذا الجدول غير موجود، نعيد DataFrame فارغ
            return pd.DataFrame()

# =============================================================================
# محاكاة النظام المُدمجة
# =============================================================================

class MockDroneDefenseSystem:
    """نظام محاكاة مُدمج للعرض التوضيحي"""
    
    def __init__(self):
        self.db = DatabaseHandler()
        self.connected = self.db.connect()
        if self.connected:
            self.db.create_live_detections_table()
            self.historical_data = self.db.get_historical_data()
        else:
            # بيانات محاكاة إذا فشل الاتصال
            self.historical_data = self._create_mock_historical_data()
    
    def _create_mock_historical_data(self):
        """إنشاء بيانات تاريخية محاكاة"""
        mock_data = []
        base_date = datetime(2026, 2, 28)
        
        for i in range(50):
            mock_data.append({
                'incident_id': i + 1,
                'attack_date': base_date + timedelta(days=random.randint(0, 60)),
                'attack_type': random.choice(['Drones', 'Ballistic Missiles', 'Cruise Missiles']),
                'target_location': random.choice(['Riyadh Airport', 'Oil Refinery', 'Military Base']),
                'region': random.choice(['Riyadh', 'Eastern Region', 'Al-Kharj']),
                'latitude': 24.7136 + random.uniform(-2, 2),
                'longitude': 46.6753 + random.uniform(-2, 2)
            })
        
        return pd.DataFrame(mock_data)
    
    def get_system_analysis(self):
        """تحليل النظام الشامل"""
        
        # حساب مستوى الثقة الواقعي
        if len(self.historical_data) > 30:
            confidence = 85.5
        elif len(self.historical_data) > 15:
            confidence = 72.3
        else:
            confidence = 58.7
        
        # تحليل التهديد
        recent_count = len(self.historical_data.tail(10)) if not self.historical_data.empty else 0
        if recent_count > 7:
            threat_level = "🔴 مرتفع"
        elif recent_count > 4:
            threat_level = "🟠 متوسط"
        else:
            threat_level = "🟢 منخفض"
        
        return {
            'confidence': confidence,
            'threat_level': threat_level,
            'total_incidents': len(self.historical_data),
            'recent_activity': recent_count,
            'regions_affected': self.historical_data['region'].nunique() if not self.historical_data.empty else 0
        }
    
    def get_high_risk_locations(self):
        """المواقع عالية الخطورة"""
        if self.historical_data.empty:
            return []
        
        location_counts = self.historical_data['target_location'].value_counts()
        high_risk = []
        
        for location, count in location_counts.head(5).items():
            location_data = self.historical_data[self.historical_data['target_location'] == location].iloc[0]
            risk_score = count * 15 + random.randint(5, 25)
            
            high_risk.append({
                'location': location,
                'region': location_data['region'],
                'attack_count': count,
                'risk_score': risk_score,
                'lat': location_data['latitude'],
                'lon': location_data['longitude'],
                'prediction': 'عالي' if risk_score > 70 else 'متوسط' if risk_score > 50 else 'منخفض'
            })
        
        return sorted(high_risk, key=lambda x: x['risk_score'], reverse=True)
    
    def simulate_live_detection(self, drone_type="commercial_drone"):
        """محاكاة كشف مباشر"""
        detection = {
            'detection_id': random.randint(1000, 9999),
            'detection_time': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'drone_type': drone_type,
            'confidence_score': round(random.uniform(0.75, 0.95), 3),
            'gps_latitude': round(24.7136 + random.uniform(-0.5, 0.5), 6),
            'gps_longitude': round(46.6753 + random.uniform(-0.5, 0.5), 6),
            'camera_id': f'CAM-{random.randint(1,5):02d}',
            'threat_level': random.choice(['MEDIUM', 'HIGH', 'CRITICAL']),
            'distance_estimate': random.uniform(300, 2000),
            'bbox_x1': random.randint(100, 300),
            'bbox_y1': random.randint(100, 300),
            'bbox_x2': random.randint(400, 600),
            'bbox_y2': random.randint(400, 600),
            'camera_location': f'موقع المراقبة {random.randint(1,5)}',
            'altitude_estimate': random.uniform(50, 500),
            'speed_estimate': random.uniform(20, 80),
            'direction_degrees': random.uniform(0, 360),
            'weather_conditions': random.choice(['Clear', 'Cloudy', 'Windy']),
            'visibility_km': random.uniform(8, 15)
        }
        return detection
    
    def get_tactical_analysis(self, detection_data):
        """التحليل التكتيكي الحساس"""
        if not detection_data:
            return {"message": "⚠️ لا توجد عمليات كشف حالية - المعلومات التكتيكية غير متاحة"}
        
        threat_score = random.randint(60, 95)
        
        analysis = {
            'immediate_threat_assessment': {
                'threat_score': threat_score,
                'threat_level': 'CRITICAL' if threat_score > 80 else 'HIGH' if threat_score > 65 else 'MEDIUM',
                'estimated_impact_time': f"{random.randint(30, 180)} ثانية",
                'recommended_response_time': "< 30 ثانية" if threat_score > 80 else "< 60 ثانية"
            },
            'recommended_actions': [
                "🚨 تفعيل التشويش الإلكتروني فوراً",
                "📡 توجيه أنظمة الكشف للهدف",
                "⚡ تجهيز أنظمة الاعتراض الحركية",
                "📢 إنذار في المنطقة المحيطة",
                "🚁 تفعيل البروتوكولات الطارئة"
            ],
            'interception_strategy': {
                'primary_method': "اعتراض إلكتروني + حركي",
                'success_probability': random.uniform(0.75, 0.92),
                'timing_window': f"{random.randint(15, 45)} ثانية",
                'optimal_engagement_distance': f"{random.randint(200, 800)} متر"
            }
        }
        
        return analysis

# =============================================================================
# دوال مساعدة
# =============================================================================

def create_mock_drone_image(drone_type):
    """إنشاء صورة محاكاة للدرون"""
    img = Image.new('RGB', (400, 300), color='lightblue')
    draw = ImageDraw.Draw(img)
    
    # رسم شكل الدرون
    if 'shahed' in drone_type.lower():
        # شكل صاروخ
        draw.rectangle([150, 100, 250, 200], fill='darkred', outline='black', width=2)
        draw.polygon([(150, 100), (200, 50), (250, 100)], fill='red')
        title = "Shahed-136"
    elif 'commercial' in drone_type.lower():
        # شكل كوادكوبتر
        draw.ellipse([175, 125, 225, 175], fill='gray', outline='black', width=2)
        # المراوح
        for x, y in [(160, 110), (240, 110), (160, 190), (240, 190)]:
            draw.ellipse([x-10, y-10, x+10, y+10], fill='black')
        title = "Commercial Drone"
    else:
        # شكل عام
        draw.ellipse([175, 125, 225, 175], fill='blue', outline='black', width=2)
        title = "Unknown Drone"
    
    # إضافة نص
    try:
        font = ImageFont.load_default()
    except:
        font = None
    
    draw.text((200, 220), title, fill='black', anchor='mm', font=font)
    draw.text((200, 240), f"DETECTED: {datetime.now().strftime('%H:%M:%S')}", 
              fill='red', anchor='mm', font=font)
    
    # إضافة مربع الكشف
    draw.rectangle([140, 90, 260, 210], outline='red', width=3)
    draw.text((200, 80), "TARGET ACQUIRED", fill='red', anchor='mm', font=font)
    
    return img

@st.cache_resource
def load_system():
    """تحميل النظام مع cache"""
    return MockDroneDefenseSystem()

# =============================================================================
# واجهة المستخدم الرئيسية
# =============================================================================

def main():
    # العنوان الرئيسي
    st.markdown("""
    <div class="main-header">
        🛡️ نظام الدفاع المباشر ضد الطائرات المسيرة
        <br><small style="font-size: 1rem; color: #666;">
        Live Drone Defense & Detection System
        </small>
    </div>
    """, unsafe_allow_html=True)
    
    # تحميل النظام
    system = load_system()
    
    if not system.connected:
        st.warning("⚠️ تم تشغيل النظام في وضع المحاكاة (لم يتم الاتصال بقاعدة البيانات)")
    else:
        st.success("✅ متصل بقاعدة البيانات - النظام جاهز")
    
    # الشريط الجانبي
    with st.sidebar:
        st.image("https://via.placeholder.com/200x100/1f4e79/white?text=LIVE+DEFENSE", width=200)
        
        st.markdown("### 🎛️ لوحة التحكم")
        
        section = st.selectbox(
            "اختر القسم",
            ["📊 نظرة عامة", "🎯 الكشف المباشر", "🔐 التحليل التكتيكي", 
             "📈 مواقع عالية الخطورة", "🗺️ خريطة تفاعلية", "🧪 محاكاة"]
        )
        
        st.markdown("---")
        
        # إحصائيات سريعة
        analysis = system.get_system_analysis()
        
        st.metric("🎯 مستوى الثقة", f"{analysis['confidence']:.1f}%")
        st.metric("⚠️ مستوى التهديد", analysis['threat_level'])
        st.metric("📊 إجمالي الحوادث", analysis['total_incidents'])
        
        if st.button("🔄 تحديث البيانات"):
            st.cache_resource.clear()
            st.rerun()
    
    # المحتوى الرئيسي
    if section == "📊 نظرة عامة":
        show_overview(system)
    elif section == "🎯 الكشف المباشر":
        show_live_detection(system)
    elif section == "🔐 التحليل التكتيكي":
        show_tactical_analysis(system)
    elif section == "📈 مواقع عالية الخطورة":
        show_high_risk_locations(system)
    elif section == "🗺️ خريطة تفاعلية":
        show_interactive_map(system)
    elif section == "🧪 محاكاة":
        show_simulation(system)

def show_overview(system):
    """عرض النظرة العامة"""
    st.header("📊 نظرة عامة على النظام")
    
    analysis = system.get_system_analysis()
    
    # المؤشرات الرئيسية
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("🎯 مستوى الثقة", f"{analysis['confidence']:.1f}%")
    with col2:
        st.metric("⚠️ مستوى التهديد", analysis['threat_level'])
    with col3:
        st.metric("📊 إجمالي الحوادث", analysis['total_incidents'])
    with col4:
        st.metric("🗺️ المناطق المتأثرة", analysis['regions_affected'])
    
    # الرسوم البيانية
    if not system.historical_data.empty:
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("📊 توزيع الهجمات حسب المنطقة")
            region_data = system.historical_data['region'].value_counts()
            fig = px.pie(
                values=region_data.values,
                names=region_data.index,
                title="التوزيع الجغرافي"
            )
            st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            st.subheader("🎯 أنواع الهجمات")
            attack_data = system.historical_data['attack_type'].value_counts()
            fig = px.bar(
                x=attack_data.index,
                y=attack_data.values,
                title="تكرار أنواع الهجمات"
            )
            st.plotly_chart(fig, use_container_width=True)

def show_live_detection(system):
    st.header("🎯 الكشف المباشر")
    
    # 1. تهيئة الـ State إذا لم يكن موجوداً لمنع الخطأ
    if 'latest_detection' not in st.session_state:
        st.session_state['latest_detection'] = None

    # 2. زر المحاكاة: وظيفته فقط تحديث البيانات في الـ State
    if st.button("🎯 محاكاة كشف جديد"):
        # نقوم بتوليد البيانات وحفظها فوراً
        st.session_state['latest_detection'] = system.simulate_live_detection("shahed136")
        # إجبار التحديث لضمان بقاء البيانات
        st.rerun()

    # 3. منطق العرض: يعرض ما هو موجود في الـ State دائماً (وهذا يمنع الاختفاء)
    detection = st.session_state['latest_detection']
    
    if detection is not None:
        # عرض التنبيه المباشر
        st.markdown(f"""
        <div class="live-alert">
            🚨 <strong>تنبيه مباشر!</strong> تم كشف طائرة مسيرة
            <br>📍 {detection['drone_type']} في ({detection['gps_latitude']:.4f}, {detection['gps_longitude']:.4f})
        </div>
        """, unsafe_allow_html=True)
        
        col1, col2 = st.columns([1, 2])
        
        with col1:
            st.markdown("### 📷 صورة الدرون")
            drone_image = create_mock_drone_image(detection['drone_type'])
            st.image(drone_image)
            
        with col2:
            st.markdown("### 📋 معلومات تفصيلية")
            st.metric("مستوى التهديد", detection['threat_level'])
            
            # الخريطة: نستخدم Key ثابت لمنع إعادة التحميل المفاجئ
            st.markdown("### 🗺️ موقع الكشف")
            m = folium.Map(location=[detection['gps_latitude'], detection['gps_longitude']], zoom_start=12)
            folium.Marker([detection['gps_latitude'], detection['gps_longitude']]).add_to(m)
            st_folium(m, width=600, height=300, key="live_detection_map")
    else:
        st.info("📡 اضغط الزر أعلاه لمحاكاة كشف جديد")

def show_tactical_analysis(system):
    """عرض التحليل التكتيكي"""
    st.header("🔐 التحليل التكتيكي")
    
    # فحص وجود كشف حديث
    if 'latest_detection' not in st.session_state:
        st.warning("⚠️ لا توجد عمليات كشف حالية - المعلومات التكتيكية غير متاحة")
        st.info("📋 انتقل إلى قسم 'الكشف المباشر' لمحاكاة كشف أولاً")
        return
    
    detection = st.session_state['latest_detection']
    tactical = system.get_tactical_analysis(detection)
    
    if "message" in tactical:
        st.warning(tactical["message"])
        return
    
    # تحليل التهديد الفوري
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("#### 🚨 تقييم التهديد الفوري")
        
        threat = tactical['immediate_threat_assessment']
        threat_score = threat['threat_score']
        
        # مؤشر درجة التهديد
        st.markdown(f"""
        <div style="background: linear-gradient(90deg, green {100-threat_score}%, red {threat_score}%); 
                   height: 30px; border-radius: 15px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
            درجة التهديد: {threat_score}/100
        </div>
        """, unsafe_allow_html=True)
        
        st.metric("مستوى التهديد", threat['threat_level'])
        st.metric("وقت الوصول المقدر", threat['estimated_impact_time'])
        st.metric("زمن الاستجابة", threat['recommended_response_time'])
    
    with col2:
        st.markdown("#### ⚡ الإجراءات الموصى بها")
        
        for i, action in enumerate(tactical['recommended_actions'][:4], 1):
            st.markdown(f"{i}. {action}")
    
    # استراتيجية الاعتراض
    st.markdown("#### 🎯 استراتيجية الاعتراض")
    
    strategy = tactical['interception_strategy']
    
    col3, col4, col5 = st.columns(3)
    
    with col3:
        st.info(f"**الطريقة الأساسية:**\n{strategy['primary_method']}")
    
    with col4:
        st.metric("احتمالية النجاح", f"{strategy['success_probability']:.1%}")
    
    with col5:
        st.info(f"**نافذة التوقيت:**\n{strategy['timing_window']}")

def show_high_risk_locations(system):
    """عرض المواقع عالية الخطورة"""
    st.header("📈 المواقع عالية الخطورة")
    
    high_risk = system.get_high_risk_locations()
    
    if not high_risk:
        st.info("📊 لا توجد بيانات كافية لتحديد المواقع عالية الخطورة")
        return
    
    # عرض في جدول
    st.subheader("🎯 ترتيب المواقع حسب الخطورة")
    
    df = pd.DataFrame(high_risk)
    
    # إضافة ألوان للخطورة
    def risk_color(risk_score):
        if risk_score > 80:
            return "🔴"
        elif risk_score > 60:
            return "🟠"
        elif risk_score > 40:
            return "🟡"
        else:
            return "🟢"
    
    df['🚨'] = df['risk_score'].apply(risk_color)
    
    st.dataframe(
        df[['🚨', 'location', 'region', 'attack_count', 'risk_score', 'prediction']],
        use_container_width=True
    )
    
    # رسم بياني
    col1, col2 = st.columns(2)
    
    with col1:
        fig = px.bar(
            df,
            x='location',
            y='risk_score',
            color='prediction',
            title="نقاط المخاطر حسب الموقع"
        )
        fig.update_xaxes(tickangle=45)
        st.plotly_chart(fig, use_container_width=True)
    
    with col2:
        fig = px.scatter(
            df,
            x='attack_count',
            y='risk_score',
            size='attack_count',
            color='prediction',
            hover_name='location',
            title="العلاقة بين عدد الهجمات ونقاط المخاطر"
        )
        st.plotly_chart(fig, use_container_width=True)

def show_interactive_map(system):
    st.header("🗺️ الخريطة التفاعلية")
    
    # تحديد مركز الخريطة
    m = folium.Map(location=[24.7136, 46.6753], zoom_start=6)
    
    if not system.historical_data.empty:
        # 1. تجميع البيانات لحساب عدد الضربات في كل موقع
        # نفترض أن التجميع يتم بناءً على اسم الموقع target_location
        location_stats = system.historical_data.groupby('target_location').agg({
            'latitude': 'first',
            'longitude': 'first',
            'incident_id': 'count'
        }).reset_index()

        for _, row in location_stats.iterrows():
            # نص يظهر عند تمرير الماوس (Tooltip)
            hover_text = f"""
                <b>الموقع:</b> {row['target_location']}<br>
                <b>إجمالي الضربات:</b> {row['incident_id']}
            """
            
            # رسم الدائرة
            folium.CircleMarker(
                location=[row['latitude'], row['longitude']],
                radius=float(row['incident_id']) * 2, # حجم الدائرة يتناسب مع عدد الضربات
                tooltip=hover_text,  # هذه الخاصية هي المسؤولة عن ظهور البيانات عند تمرير الماوس
                color='red',
                fill=True,
                fill_color='red',
                fill_opacity=0.6
            ).add_to(m)
    
    # عرض الخريطة مع تثبيت الـ Key لمنع الاختفاء
    st_folium(m, width=None, height=600, key="interactive_defense_map", returned_objects=[])
    

def show_simulation(system):
    """قسم المحاكاة"""
    st.header("🧪 محاكاة النظام")
    
    st.markdown("### 🎮 محاكاة أنواع مختلفة من التهديدات")
    
    # اختيار نوع الدرون
    drone_type = st.selectbox(
        "نوع الدرون:",
        ["commercial_drone", "shahed136", "military_drone", "unknown_drone"]
    )
    
    col1, col2 = st.columns(2)
    
    with col1:
        if st.button("🎯 محاكاة كشف"):
            detection = system.simulate_live_detection(drone_type)
            
            st.success(f"✅ تم كشف {detection['drone_type']}")
            
            # عرض التفاصيل
            st.json({
                "نوع_الدرون": detection['drone_type'],
                "مستوى_التهديد": detection['threat_level'],
                "الثقة": f"{detection['confidence_score']:.1%}",
                "الموقع": f"({detection['gps_latitude']:.4f}, {detection['gps_longitude']:.4f})",
                "المسافة": f"{detection['distance_estimate']:.0f} متر",
                "الكاميرا": detection['camera_id']
            })
            
            # حفظ في session state
            st.session_state['latest_detection'] = detection
    
    with col2:
        if st.button("📊 تحديث التحليل"):
            analysis = system.get_system_analysis()
            
            st.info(f"🎯 مستوى الثقة: {analysis['confidence']:.1f}%")
            st.info(f"⚠️ مستوى التهديد: {analysis['threat_level']}")
            st.info(f"📈 إجمالي الحوادث: {analysis['total_incidents']}")
    
    # إحصائيات المحاكاة
    st.markdown("### 📈 إحصائيات المحاكاة")
    
    mock_stats = {
        "عمليات المحاكاة": random.randint(15, 45),
        "معدل الكشف": f"{random.randint(85, 98)}%",
        "زمن الاستجابة": f"{random.randint(15, 45)} ثانية",
        "دقة النظام": f"{random.randint(88, 96)}%"
    }
    
    for stat, value in mock_stats.items():
        st.metric(stat, value)

if __name__ == "__main__":
    main()
