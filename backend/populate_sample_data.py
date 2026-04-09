"""
Populate sample condition monitoring data for Neutral Glass
"""
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone, timedelta
import random
import os
from dotenv import load_dotenv

load_dotenv()

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Configuration
PLANTS = {
    "A": ["A1", "A2", "A3", "A4"],
    "G": ["G1", "G2", "G3A", "G3B"],
    "K": ["K1", "K2", "K3", "K4"],
    "E": ["E1", "E2", "E3"]
}

MOTORS = [
    "TubeRotation",
    "TubeHeight", 
    "Feeder",
    "Shear1",
    "Shear2",
    "Gob Distributor",
    "Main Conveyor",
    "Ware Transfer",
    "Cross Conveyor",
    "Sec1 Invert",
    "Sec1 Takeout",
    "Sec1 Pusher Arm",
    "Sec2 Invert",
    "Sec2 Takeout"
]

async def generate_sample_data():
    """Generate realistic sample data"""
    
    print("🔄 Clearing existing data...")
    await db.condition_monitoring.delete_many({})
    
    print("📊 Generating sample readings...")
    
    readings = []
    base_time = datetime.now(timezone.utc) - timedelta(days=7)
    
    for plant, machines in PLANTS.items():
        for machine in machines:
            # Select random motors for each machine
            selected_motors = random.sample(MOTORS, random.randint(8, 12))
            
            for motor in selected_motors:
                # Generate base current values
                normal_current = round(random.uniform(2.5, 4.5), 1)
                warning_current = normal_current + round(random.uniform(0.5, 1.5), 1)
                
                # Generate readings over 7 days
                for day_offset in range(7):
                    for hour in [6, 10, 14, 18, 22]:  # 5 readings per day
                        timestamp = base_time + timedelta(days=day_offset, hours=hour, minutes=random.randint(0, 30))
                        
                        # Generate realistic current value
                        # 80% OK, 15% Warning, 5% Alarm
                        status_roll = random.random()
                        if status_roll < 0.80:  # OK
                            current = round(random.uniform(normal_current * 0.7, normal_current * 0.95), 2)
                            status = "OK"
                        elif status_roll < 0.95:  # Warning
                            current = round(random.uniform(normal_current, warning_current * 0.95), 2)
                            status = "Warning"
                        else:  # Alarm
                            current = round(random.uniform(warning_current, warning_current * 1.2), 2)
                            status = "Alarm"
                        
                        # Entry source: 70% Field, 30% Office
                        entry_source = "Field" if random.random() < 0.7 else "Office"
                        
                        # Field entries more likely to have photos
                        has_photo = entry_source == "Field" and random.random() < 0.6
                        
                        # Verified by
                        technicians = ["Rajesh K", "Suresh M", "Priya S", "Kumar R", "Anand P"]
                        verified_by = random.choice(technicians) if entry_source == "Field" else None
                        
                        reading = {
                            "plant": plant,
                            "machine": machine,
                            "motor": motor,
                            "current": current,
                            "normal_current": normal_current,
                            "warning_current": warning_current,
                            "status": status,
                            "timestamp": timestamp.isoformat(),
                            "entry_timestamp": timestamp.isoformat(),
                            "entry_source": entry_source,
                            "verified_by": verified_by,
                            "notes": f"Regular inspection - {motor}" if random.random() < 0.3 else None,
                            "bulk_entry_flag": False,
                            "has_photo": has_photo,
                            "photo": None,  # Actual photos would be too large for sample data
                            "verified": entry_source == "Field" or has_photo
                        }
                        
                        readings.append(reading)
    
    # Insert all readings
    if readings:
        await db.condition_monitoring.insert_many(readings)
        print(f"✅ Inserted {len(readings)} sample readings")
        
        # Show summary
        print("\n📈 Data Summary:")
        for plant in PLANTS.keys():
            count = await db.condition_monitoring.count_documents({"plant": plant})
            print(f"   Plant {plant}: {count} readings")
        
        # Show status breakdown
        ok_count = await db.condition_monitoring.count_documents({"status": "OK"})
        warning_count = await db.condition_monitoring.count_documents({"status": "Warning"})
        alarm_count = await db.condition_monitoring.count_documents({"status": "Alarm"})
        
        print(f"\n🚦 Status Breakdown:")
        print(f"   ✓ OK: {ok_count}")
        print(f"   ⚠ Warning: {warning_count}")
        print(f"   🚨 Alarm: {alarm_count}")
        
        # Show active alarms
        active_alarms = await db.condition_monitoring.count_documents({"status": "Alarm"})
        print(f"\n🔴 Active Alarms: {active_alarms}")
    
    print("\n✅ Sample data generation complete!")
    print("🌐 Visit the dashboard to see the data in action!")

if __name__ == "__main__":
    asyncio.run(generate_sample_data())
