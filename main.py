#!/usr/bin/env python3
"""
🚀 تشغيل نظام الدفاع ضد الطائرات المسيرة
Main execution file for Drone Defense AI System
"""

from enhanced_drone_defense_complete import EnhancedDroneDefenseSystem
import json
from datetime import datetime

def main():
    """تشغيل النظام الرئيسي"""
    
    print("🚀 **نظام الدفاع الذكي ضد الطائرات المسيرة**")
    print("=" * 60)
    
    try:
        # إنشاء النظام
        print("🔌 الاتصال بقاعدة البيانات...")
        system = EnhancedDroneDefenseSystem()
        
        print("\n✅ النظام جاهز! بدء التحليلات...")
        print("=" * 60)
        
        # 1. توقع أماكن الضربات
        print("\n🔮 **1. توقع أماكن الضربات وأوقاتها:**")
        print("-" * 40)
        
        predictions = system.predict_attack_locations_and_timing(days=30)
        
        if "high_risk_locations" in predictions and predictions["high_risk_locations"]:
            print(f"📍 تم تحديد {len(predictions['high_risk_locations'])} موقع عالي الخطورة:")
            
            for i, loc in enumerate(predictions["high_risk_locations"][:5], 1):
                print(f"   {i}. {loc['location']} ({loc['region']})")
                print(f"      🎯 مستوى الخطر: {loc['prediction']}")
                print(f"      📊 نقاط المخاطر: {loc['risk_score']}")
                print(f"      📅 آخر هجوم: {loc['days_since_last']} يوم مضى")
                print()
        
        if "temporal_predictions" in predictions:
            temporal = predictions["temporal_predictions"]
            print(f"⏰ التوقيت: الشهر الحالي {temporal.get('current_month_risk', 'متوسط')} الخطورة")
            print(f"📈 مستوى الثقة: {predictions.get('confidence_score', 0):.1f}%")
        
        # 2. تحليل مصادر الهجمات
        print("\n🗺️ **2. تحليل مصادر الهجمات:**")
        print("-" * 40)
        
        sources = system.analyze_attack_origin_sources()
        
        if "probable_sources" in sources and sources["probable_sources"]:
            print("📍 المصادر المحتملة مرتبة حسب الاحتمالية:")
            
            for i, source in enumerate(sources["probable_sources"][:4], 1):
                print(f"   {i}. {source['direction']}: {source['source_region']}")
                print(f"      🎯 احتمالية: {source['likelihood']}")
                print(f"      📏 متوسط المسافة: {source['avg_distance_km']} كم")
                print(f"      📊 نقاط القرب: {source['proximity_score']}")
                print()
        
        if "intelligence_summary" in sources:
            intel = sources["intelligence_summary"]
            print(f"🔍 التقييم الاستخباراتي:")
            print(f"   • المصدر الأساسي: {intel.get('primary_source', 'غير محدد')}")
            print(f"   • الهدف الاستراتيجي: {intel.get('strategic_intent', 'غير واضح')}")
        
        # 3. تحسين مواقع الدفاع
        print("\n🛡️ **3. أفضل مواقع الرادارات وأنظمة التصدي:**")
        print("-" * 40)
        
        defense = system.optimize_defense_systems_placement()
        
        if "optimal_radar_positions" in defense and defense["optimal_radar_positions"]:
            print(f"📡 مواقع الرادار المثلى ({len(defense['optimal_radar_positions'])} موقع):")
            
            for radar in defense["optimal_radar_positions"]:
                print(f"   🔸 {radar['radar_id']}: ({radar['lat']}, {radar['lon']})")
                print(f"      🎯 أولوية: {radar['priority']}")
                print(f"      📏 تغطية: {radar['coverage_radius_km']} كم")
                print(f"      ⭐ قيمة استراتيجية: {radar['strategic_value']}")
                print()
        
        if "layered_defense_strategy" in defense:
            print("🎯 استراتيجية الدفاع المتدرج:")
            layers = defense["layered_defense_strategy"]
            for layer_name, layer_info in layers.items():
                print(f"   • {layer_info['description']}: {layer_info['range_km']} كم")
        
        # 4. تكتيكات الاشتباك
        print("\n⚔️ **4. أفضل مواقع وتكتيكات محاربة الدرونز:**")
        print("-" * 40)
        
        combat = system.find_optimal_combat_positions()
        
        if "interception_zones" in combat and combat["interception_zones"]:
            print("🎯 مناطق الاعتراض المثلى:")
            
            for zone in combat["interception_zones"]:
                print(f"   🔸 منطقة {zone['region']}:")
                print(f"      📍 مركز: ({zone['center_lat']}, {zone['center_lon']})")
                print(f"      🎯 مدى الاشتباك الأمثل: {zone['optimal_range_km']} كم")
                print(f"      ⚡ أولوية الاشتباك: {zone['engagement_priority']}")
                print(f"      🚨 التهديد الأساسي: {zone['primary_threat']}")
                print()
        
        if "engagement_tactics" in combat:
            print("💡 تكتيكات الاشتباك حسب نوع التهديد:")
            tactics = combat["engagement_tactics"]
            
            for threat_type, tactic in tactics.items():
                print(f"   🔸 {threat_type}:")
                print(f"      📋 الطريقة: {tactic['method']}")
                print(f"      ⏰ التوقيت المثالي: {tactic['timing']}")
                print(f"      🎯 معدل النجاح: {tactic['success_rate']}")
                print(f"      ⚠️ ملاحظة: {tactic['notes']}")
                print()
        
        if "tactical_recommendations" in combat:
            print("🚀 التوصيات التكتيكية الرئيسية:")
            for i, rec in enumerate(combat["tactical_recommendations"], 1):
                print(f"   {i}. {rec['action']}")
                print(f"      🎯 المنفعة: {rec['benefit']}")
                print(f"      📊 الأولوية: {rec['priority']}")
                print()
        
        # 5. اختبار النظام الذكي
        print("\n🤖 **5. اختبار النظام الذكي للأسئلة:**")
        print("-" * 40)
        
        smart_questions = [
            "متى وأين ستحدث الهجمات القادمة؟",
            "من أين تأتي الهجمات ومن المسؤول؟",
            "أين يجب أن نضع أنظمة الدفاع؟",
            "ما أفضل تكتيكات لمحاربة الدرونز؟"
        ]
        
        for i, question in enumerate(smart_questions, 1):
            print(f"\n❓ **سؤال {i}:** {question}")
            answer = system.ask_question(question)
            print(f"🧠 **الإجابة الذكية:**")
            print(answer)
            print("-" * 30)
        
        # 6. تصدير التحليل الشامل
        print("\n💾 **6. تصدير التحليل الشامل:**")
        print("-" * 40)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"drone_defense_analysis_{timestamp}.json"
        
        export_result = system.export_analysis(filename)
        print(f"📄 {export_result}")
        
        # ملخص نهائي
        print("\n🎉 **ملخص التحليل:**")
        print("=" * 60)
        
        total_attacks = len(system.analyzer.data)
        regions = system.analyzer.data['region'].nunique()
        top_region = system.analyzer.data['region'].value_counts().index[0]
        top_attack_type = system.analyzer.data['attack_category'].value_counts().index[0]
        
        print(f"📊 إجمالي الهجمات المسجلة: {total_attacks}")
        print(f"🗺️ المناطق المتأثرة: {regions}")
        print(f"🎯 أكثر المناطق استهدافاً: {top_region}")
        print(f"🚀 نوع الهجوم الأكثر شيوعاً: {top_attack_type}")
        
        print(f"\n✅ **التحليل مكتمل!** تم حفظ النتائج في: {filename}")
        
        # إبقاء النظام مفتوح للاستخدام
        print("\n" + "=" * 60)
        print("💡 **النظام جاهز للاستخدام التفاعلي:**")
        print("   🤖 للأسئلة: system.ask_question('سؤالك هنا')")
        print("   📋 للمساعدة: system.show_commands()")
        print("   🔄 للتحليل المتقدم: استخدم الدوال المتخصصة")
        print("   🔌 للإغلاق: system.close()")
        
        return system
        
    except KeyboardInterrupt:
        print("\n⚠️ تم إيقاف النظام بواسطة المستخدم")
        return None
        
    except Exception as e:
        print(f"\n❌ **خطأ في النظام:** {str(e)}")
        print("\n🔧 **خطوات الحل:**")
        print("1. تأكد من تشغيل PostgreSQL على المنفذ 5433")
        print("2. تأكد من وجود قاعدة البيانات 'history'")
        print("3. تأكد من وجود جدول 'attack_history' مع البيانات")
        print("4. تأكد من صحة كلمة المرور '1119504288'")
        print("5. تأكد من تثبيت جميع المكتبات المطلوبة")
        print("\n💡 للاختبار السريع:")
        print("   poetry add psycopg2-binary pandas numpy matplotlib plotly scikit-learn")
        
        return None

def interactive_mode(system):
    """وضع التفاعل المباشر"""
    
    if not system:
        return
    
    print("\n🎮 **الوضع التفاعلي - أدخل أسئلتك:**")
    print("   (اكتب 'exit' للخروج، 'help' للمساعدة)")
    print("-" * 50)
    
    while True:
        try:
            question = input("\n❓ سؤالك: ").strip()
            
            if question.lower() in ['exit', 'quit', 'خروج']:
                break
                
            elif question.lower() in ['help', 'مساعدة']:
                system.show_commands()
                
            elif question:
                answer = system.ask_question(question)
                print(f"\n🧠 الإجابة:\n{answer}")
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"❌ خطأ: {e}")
    
    print("\n👋 تم الخروج من الوضع التفاعلي")

if __name__ == "__main__":
    # تشغيل التحليل الشامل
    system = main()
    
    # اختياري: تشغيل الوضع التفاعلي
    if system:
        try:
            choice = input("\n🤔 هل تريد الدخول للوضع التفاعلي؟ (y/n): ").strip().lower()
            if choice in ['y', 'yes', 'نعم']:
                interactive_mode(system)
        except:
            pass
        
        # إغلاق النظام
        system.close()
