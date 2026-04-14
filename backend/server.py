"""
Neutral Glass - Condition Monitoring System
Backend Server (Render Free Tier Edition)
- No MongoDB (removed)
- Google Sheets = primary database
- Cloudinary = photo storage
- Self-ping = keeps Render free tier awake
"""

from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from PIL import Image, ImageDraw, ImageFont
import base64
from io import BytesIO
import json
import asyncio
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Load machine configuration
with open(ROOT_DIR / 'machine_config.json', 'r') as f:
    MACHINE_CONFIG = json.load(f)

# ============================================================
# GOOGLE SHEETS SETUP (Primary Database)
# ============================================================
GOOGLE_SHEETS_ENABLED = os.environ.get('GOOGLE_SHEETS_ENABLED', 'true').lower() == 'true'
GOOGLE_SHEET_ID = os.environ.get('GOOGLE_SHEET_ID', '')

sheets_service = None
readings_sheet = None
config_ready = False

def init_google_sheets():
    """Initialize Google Sheets connection"""
    global sheets_service, readings_sheet, config_ready
    
    if not GOOGLE_SHEET_ID:
        logging.warning("⚠️ GOOGLE_SHEET_ID not set. Running in demo mode (data not persisted).")
        return
    
    try:
        import gspread
        from google.oauth2.service_account import Credentials
        
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        
        # Check for service account JSON in environment variable (for Render)
        sa_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON', '')
        sa_file = ROOT_DIR / 'service_account.json'
        
        if sa_json:
            # Parse JSON from environment variable
            sa_info = json.loads(sa_json)
            creds = Credentials.from_service_account_info(sa_info, scopes=scopes)
        elif sa_file.exists():
            creds = Credentials.from_service_account_file(str(sa_file), scopes=scopes)
        else:
            logging.warning("⚠️ No Google service account credentials found. Running in demo mode.")
            return
        
        sheets_service = gspread.authorize(creds)
        
        # Open the spreadsheet
        spreadsheet = sheets_service.open_by_key(GOOGLE_SHEET_ID)
        
        # Get or create "Readings" worksheet
        try:
            readings_sheet = spreadsheet.worksheet("Readings")
        except gspread.WorksheetNotFound:
            readings_sheet = spreadsheet.add_worksheet(title="Readings", rows=10000, cols=20)
            # Add headers
            headers = [
                "ID", "Timestamp", "Plant", "Machine", "Motor",
                "Current", "Temperature", "I2t",
                "Normal_Current", "Warning_Current",
                "Normal_Temperature", "Warning_Temperature",
                "Normal_I2t", "Warning_I2t",
                "Status", "Verified_By", "Entry_Source",
                "Has_Photo", "Photo_URL", "Bulk_Entry"
            ]
            readings_sheet.append_row(headers)
        
        config_ready = True
        logging.info("✅ Google Sheets connected successfully")
        
    except Exception as e:
        logging.error(f"❌ Google Sheets setup error: {e}")
        config_ready = False

init_google_sheets()

# ============================================================
# CLOUDINARY SETUP (Photo Storage)
# ============================================================
CLOUDINARY_ENABLED = False
try:
    cloudinary_url = os.environ.get('CLOUDINARY_URL', '')
    if cloudinary_url:
        import cloudinary
        import cloudinary.uploader
        cloudinary.config(cloudinary_url=cloudinary_url)
        CLOUDINARY_ENABLED = True
        logging.info("✅ Cloudinary connected for photo storage")
    else:
        logging.warning("⚠️ CLOUDINARY_URL not set. Photos will not be stored.")
except Exception as e:
    logging.error(f"Cloudinary setup error: {e}")

# ============================================================
# IN-MEMORY CACHE (for fast reads, backed by Google Sheets)
# ============================================================
readings_cache = []  # Cache of recent readings
cache_loaded = False

async def load_cache_from_sheets():
    """Load recent readings from Google Sheets into memory cache"""
    global readings_cache, cache_loaded
    
    if not config_ready or not readings_sheet:
        cache_loaded = True
        return
    
    try:
        all_data = readings_sheet.get_all_records()
        readings_cache = all_data[-2000:] if len(all_data) > 2000 else all_data  # Keep last 2000
        cache_loaded = True
        logging.info(f"✅ Loaded {len(readings_cache)} readings into cache")
    except Exception as e:
        logging.error(f"Cache load error: {e}")
        cache_loaded = True  # Don't block startup

# ============================================================
# APP SETUP
# ============================================================
app = FastAPI(title="Neutral Glass Condition Monitoring")
api_router = APIRouter(prefix="/api")

# Models
class ConditionMonitoringCreate(BaseModel):
    plant: str
    machine: str
    motor: str
    current: float
    normal_current: float
    warning_current: float
    entry_source: str = "Office"
    verified_by: Optional[str] = None
    notes: Optional[str] = None
    photo_base64: Optional[str] = None

# ============================================================
# HELPER FUNCTIONS
# ============================================================

def add_timestamp_watermark(photo_base64: str) -> str:
    """Add timestamp watermark to photo"""
    try:
        image_data = base64.b64decode(
            photo_base64.split(',')[1] if ',' in photo_base64 else photo_base64
        )
        image = Image.open(BytesIO(image_data))
        
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Resize to reduce size (max 800px wide)
        max_width = 800
        if image.width > max_width:
            ratio = max_width / image.width
            image = image.resize((max_width, int(image.height * ratio)), Image.LANCZOS)
        
        draw = ImageDraw.Draw(image)
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        width, height = image.size
        
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
        except:
            font = ImageFont.load_default()
        
        # Timestamp text
        bbox = draw.textbbox((0, 0), timestamp, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = width - text_width - 15
        y = height - text_height - 15
        padding = 8
        
        draw.rectangle(
            [x - padding, y - padding, x + text_width + padding, y + text_height + padding],
            fill=(0, 0, 0)
        )
        draw.text((x, y), timestamp, fill=(255, 255, 255), font=font)
        
        # VERIFIED badge
        verified_text = "VERIFIED"
        bbox_v = draw.textbbox((0, 0), verified_text, font=font)
        vw = bbox_v[2] - bbox_v[0]
        xv = width - vw - 15
        yv = y - text_height - 20
        
        draw.rectangle(
            [xv - padding, yv - padding, xv + vw + padding, yv + text_height + padding],
            fill=(0, 47, 167)
        )
        draw.text((xv, yv), verified_text, fill=(255, 255, 255), font=font)
        
        # Convert back to base64
        buffered = BytesIO()
        image.save(buffered, format="JPEG", quality=75)
        img_str = base64.b64encode(buffered.getvalue()).decode()
        
        return f"data:image/jpeg;base64,{img_str}"
    
    except Exception as e:
        logging.error(f"Watermark error: {e}")
        return photo_base64

def upload_photo_to_cloudinary(photo_base64: str, plant: str, machine: str) -> str:
    """Upload photo to Cloudinary and return URL"""
    if not CLOUDINARY_ENABLED:
        return ""
    
    try:
        import cloudinary.uploader
        
        # Upload to Cloudinary
        result = cloudinary.uploader.upload(
            photo_base64,
            folder=f"condition-monitoring/{plant}/{machine}",
            resource_type="image",
            quality="auto:low",
            format="jpg"
        )
        return result.get('secure_url', '')
    except Exception as e:
        logging.error(f"Cloudinary upload error: {e}")
        return ""

def save_reading_to_sheets(reading_data: dict):
    """Save a single reading to Google Sheets"""
    if not config_ready or not readings_sheet:
        return False
    
    try:
        row = [
            reading_data.get('id', ''),
            reading_data.get('timestamp', ''),
            reading_data.get('plant', ''),
            reading_data.get('machine', ''),
            reading_data.get('motor', ''),
            str(reading_data.get('current', '')),
            str(reading_data.get('temperature', '')),
            str(reading_data.get('i2t', '')),
            str(reading_data.get('normal_current', '')),
            str(reading_data.get('warning_current', '')),
            str(reading_data.get('normal_temperature', '')),
            str(reading_data.get('warning_temperature', '')),
            str(reading_data.get('normal_i2t', '')),
            str(reading_data.get('warning_i2t', '')),
            reading_data.get('status', ''),
            reading_data.get('verified_by', ''),
            reading_data.get('entry_source', ''),
            'Yes' if reading_data.get('has_photo') else 'No',
            reading_data.get('photo_url', ''),
            'Yes' if reading_data.get('bulk_entry') else 'No'
        ]
        readings_sheet.append_row(row, value_input_option='USER_ENTERED')
        return True
    except Exception as e:
        logging.error(f"Sheets write error: {e}")
        return False

def save_bulk_readings_to_sheets(readings_list: list):
    """Save multiple readings to Google Sheets at once (batch)"""
    if not config_ready or not readings_sheet:
        return False
    
    try:
        rows = []
        for r in readings_list:
            rows.append([
                r.get('id', ''),
                r.get('timestamp', ''),
                r.get('plant', ''),
                r.get('machine', ''),
                r.get('motor', ''),
                str(r.get('current', '')),
                str(r.get('temperature', '')),
                str(r.get('i2t', '')),
                str(r.get('normal_current', '')),
                str(r.get('warning_current', '')),
                str(r.get('normal_temperature', '')),
                str(r.get('warning_temperature', '')),
                str(r.get('normal_i2t', '')),
                str(r.get('warning_i2t', '')),
                r.get('status', ''),
                r.get('verified_by', ''),
                r.get('entry_source', ''),
                'Yes' if r.get('has_photo') else 'No',
                r.get('photo_url', ''),
                'Yes' if r.get('bulk_entry') else 'No'
            ])
        
        readings_sheet.append_rows(rows, value_input_option='USER_ENTERED')
        logging.info(f"✅ Saved {len(rows)} readings to Google Sheets")
        return True
    except Exception as e:
        logging.error(f"Sheets bulk write error: {e}")
        return False

# ============================================================
# API ROUTES
# ============================================================

@api_router.get("/")
async def root():
    return {"message": "Neutral Glass Condition Monitoring API", "status": "running"}

@api_router.get("/healthz")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@api_router.get("/machine-config/{plant}/{machine}")
async def get_machine_config(plant: str, machine: str):
    """Get motor configuration for a specific machine"""
    try:
        if plant in MACHINE_CONFIG["plants"] and machine in MACHINE_CONFIG["plants"][plant]["machines"]:
            return MACHINE_CONFIG["plants"][plant]["machines"][machine]
        else:
            raise HTTPException(status_code=404, detail="Machine configuration not found")
    except KeyError:
        raise HTTPException(status_code=404, detail="Machine configuration not found")

@api_router.post("/condition-monitoring/bulk")
async def add_bulk_condition_data(data: dict):
    """Add bulk condition monitoring data for entire machine"""
    try:
        plant = data.get("plant")
        machine = data.get("machine")
        readings_list = data.get("readings", [])
        technician = data.get("technician")
        photo_base64 = data.get("photo_base64")
        entry_source = data.get("entry_source", "Field")
        
        timestamp = datetime.now(timezone.utc)
        timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
        
        # Process photo
        photo_url = ""
        has_photo = False
        if photo_base64:
            watermarked = add_timestamp_watermark(photo_base64)
            photo_url = upload_photo_to_cloudinary(watermarked, plant, machine)
            has_photo = True
        
        # Process each reading
        inserted_count = 0
        alarm_count = 0
        warning_count = 0
        docs_for_sheets = []
        
        for reading in readings_list:
            motor = reading.get("motor")
            status = "OK"
            
            # Check current
            if reading.get("current"):
                current = float(reading.get("current"))
                normal_current = float(reading.get("normal_current", 0))
                warning_current = float(reading.get("warning_current", 0))
                if current >= warning_current:
                    status = "Alarm"
                    alarm_count += 1
                elif current >= normal_current:
                    status = "Warning"
                    warning_count += 1
            
            # Check temperature
            if reading.get("temperature"):
                temp = float(reading.get("temperature"))
                normal_temp = float(reading.get("normal_temperature", 0))
                warning_temp = float(reading.get("warning_temperature", 0))
                if temp >= warning_temp:
                    status = "Alarm"
                    alarm_count += 1
                elif temp >= normal_temp and status == "OK":
                    status = "Warning"
                    warning_count += 1
            
            # Check I2t
            if reading.get("i2t"):
                i2t_val = float(reading.get("i2t"))
                normal_i2t = float(reading.get("normal_i2t", 0))
                warning_i2t = float(reading.get("warning_i2t", 0))
                if i2t_val >= warning_i2t:
                    status = "Alarm"
                    alarm_count += 1
                elif i2t_val >= normal_i2t and status == "OK":
                    status = "Warning"
                    warning_count += 1
            
            doc = {
                "id": str(uuid.uuid4())[:8],
                "timestamp": timestamp_str,
                "plant": plant,
                "machine": machine,
                "motor": motor,
                "current": float(reading.get("current")) if reading.get("current") else "",
                "temperature": float(reading.get("temperature")) if reading.get("temperature") else "",
                "i2t": float(reading.get("i2t")) if reading.get("i2t") else "",
                "normal_current": float(reading.get("normal_current")) if reading.get("normal_current") else "",
                "warning_current": float(reading.get("warning_current")) if reading.get("warning_current") else "",
                "normal_temperature": float(reading.get("normal_temperature")) if reading.get("normal_temperature") else "",
                "warning_temperature": float(reading.get("warning_temperature")) if reading.get("warning_temperature") else "",
                "normal_i2t": float(reading.get("normal_i2t")) if reading.get("normal_i2t") else "",
                "warning_i2t": float(reading.get("warning_i2t")) if reading.get("warning_i2t") else "",
                "status": status,
                "verified_by": technician or "",
                "entry_source": entry_source,
                "has_photo": has_photo,
                "photo_url": photo_url,
                "bulk_entry": True
            }
            
            docs_for_sheets.append(doc)
            readings_cache.append(doc)  # Add to in-memory cache
            inserted_count += 1
        
        # Batch write to Google Sheets
        sheets_synced = save_bulk_readings_to_sheets(docs_for_sheets)
        
        return {
            "message": "Bulk readings submitted successfully",
            "inserted_count": inserted_count,
            "alarm_count": alarm_count,
            "warning_count": warning_count,
            "sheets_synced": sheets_synced
        }
    
    except Exception as e:
        logging.error(f"Bulk entry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/condition-monitoring")
async def add_condition_data(data: ConditionMonitoringCreate):
    """Add single condition monitoring data"""
    status = "OK"
    if data.current >= data.warning_current:
        status = "Alarm"
    elif data.current >= data.normal_current:
        status = "Warning"
    
    timestamp = datetime.now(timezone.utc)
    
    photo_url = ""
    has_photo = False
    if data.photo_base64:
        watermarked = add_timestamp_watermark(data.photo_base64)
        photo_url = upload_photo_to_cloudinary(watermarked, data.plant, data.machine)
        has_photo = True
    
    doc = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        "plant": data.plant,
        "machine": data.machine,
        "motor": data.motor,
        "current": data.current,
        "temperature": "",
        "i2t": "",
        "normal_current": data.normal_current,
        "warning_current": data.warning_current,
        "normal_temperature": "",
        "warning_temperature": "",
        "normal_i2t": "",
        "warning_i2t": "",
        "status": status,
        "verified_by": data.verified_by or "",
        "entry_source": data.entry_source,
        "has_photo": has_photo,
        "photo_url": photo_url,
        "bulk_entry": False
    }
    
    # Save to sheets and cache
    save_reading_to_sheets(doc)
    readings_cache.append(doc)
    
    return {
        "message": "Data added successfully",
        "status": status,
        "has_photo": has_photo
    }

@api_router.get("/condition-monitoring/plant/{plant}")
async def get_plant_data(plant: str, limit: int = 1000):
    """Get condition monitoring data for a plant"""
    if not cache_loaded:
        await load_cache_from_sheets()
    
    data = [r for r in readings_cache if r.get("Plant", r.get("plant", "")) == plant]
    data.sort(key=lambda x: x.get("Timestamp", x.get("timestamp", "")), reverse=True)
    return data[:limit]

@api_router.get("/condition-monitoring/machine/{plant}/{machine}")
async def get_machine_data(plant: str, machine: str, limit: int = 100):
    """Get condition monitoring data for a specific machine"""
    if not cache_loaded:
        await load_cache_from_sheets()
    
    data = [
        r for r in readings_cache
        if (r.get("Plant", r.get("plant", "")) == plant and
            r.get("Machine", r.get("machine", "")) == machine)
    ]
    data.sort(key=lambda x: x.get("Timestamp", x.get("timestamp", "")), reverse=True)
    return data[:limit]

@api_router.get("/active-alarms")
async def get_active_alarms():
    """Get all active alarms (latest reading per motor)"""
    if not cache_loaded:
        await load_cache_from_sheets()
    
    # Group by plant+machine+motor, get latest
    latest = {}
    for r in readings_cache:
        key = f"{r.get('Plant', r.get('plant', ''))}_{r.get('Machine', r.get('machine', ''))}_{r.get('Motor', r.get('motor', ''))}"
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    
    # Filter alarms
    alarms = []
    for r in latest.values():
        status = r.get("Status", r.get("status", ""))
        if status == "Alarm":
            alarms.append({
                "plant": r.get("Plant", r.get("plant", "")),
                "machine": r.get("Machine", r.get("machine", "")),
                "motor": r.get("Motor", r.get("motor", "")),
                "current": r.get("Current", r.get("current", "")),
                "temperature": r.get("Temperature", r.get("temperature", "")),
                "i2t": r.get("I2t", r.get("i2t", "")),
                "warning_current": r.get("Warning_Current", r.get("warning_current", "")),
                "status": "Alarm",
                "timestamp": r.get("Timestamp", r.get("timestamp", "")),
                "verified_by": r.get("Verified_By", r.get("verified_by", "")),
            })
    
    return alarms

@api_router.get("/machine-health/{plant}")
async def get_machine_health(plant: str):
    """Get health status for all machines in a plant"""
    if not cache_loaded:
        await load_cache_from_sheets()
    
    # Get latest reading per motor
    latest = {}
    for r in readings_cache:
        rp = r.get("Plant", r.get("plant", ""))
        if rp != plant:
            continue
        key = f"{r.get('Machine', r.get('machine', ''))}_{r.get('Motor', r.get('motor', ''))}"
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    
    # Group by machine
    machines = {}
    for r in latest.values():
        m = r.get("Machine", r.get("machine", ""))
        if m not in machines:
            machines[m] = {"ok": 0, "warning": 0, "alarm": 0, "total": 0}
        status = r.get("Status", r.get("status", "OK"))
        machines[m]["total"] += 1
        if status == "Alarm":
            machines[m]["alarm"] += 1
        elif status == "Warning":
            machines[m]["warning"] += 1
        else:
            machines[m]["ok"] += 1
    
    result = []
    for machine, counts in sorted(machines.items()):
        total = counts["total"]
        health = round((counts["ok"] / total) * 100) if total > 0 else 100
        result.append({
            "machine": machine,
            "ok": counts["ok"],
            "warning": counts["warning"],
            "alarm": counts["alarm"],
            "total": total,
            "health_percent": health
        })
    
    return result

@api_router.get("/plant-health")
async def get_plant_health():
    """Get overall health for all plants"""
    if not cache_loaded:
        await load_cache_from_sheets()
    
    # Get latest reading per motor across all plants
    latest = {}
    for r in readings_cache:
        key = f"{r.get('Plant', r.get('plant', ''))}_{r.get('Machine', r.get('machine', ''))}_{r.get('Motor', r.get('motor', ''))}"
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    
    # Group by plant
    plants = {}
    for r in latest.values():
        p = r.get("Plant", r.get("plant", ""))
        if p not in plants:
            plants[p] = {"ok": 0, "warning": 0, "alarm": 0, "total": 0}
        status = r.get("Status", r.get("status", "OK"))
        plants[p]["total"] += 1
        if status == "Alarm":
            plants[p]["alarm"] += 1
        elif status == "Warning":
            plants[p]["warning"] += 1
        else:
            plants[p]["ok"] += 1
    
    result = []
    for plant, counts in sorted(plants.items()):
        total = counts["total"]
        health = round((counts["ok"] / total) * 100) if total > 0 else 100
        result.append({
            "plant": plant,
            "ok": counts["ok"],
            "warning": counts["warning"],
            "alarm": counts["alarm"],
            "total": total,
            "health_percent": health
        })
    
    return result

@api_router.get("/stats")
async def get_stats():
    """Get system stats"""
    if not cache_loaded:
        await load_cache_from_sheets()
    
    return {
        "total_readings": len(readings_cache),
        "google_sheets_connected": config_ready,
        "cloudinary_connected": CLOUDINARY_ENABLED,
        "cache_loaded": cache_loaded
    }

# ============================================================
# SELF-PING (Keeps Render Free Tier Awake)
# ============================================================

async def self_ping():
    """Ping self every 5 minutes to prevent Render free tier sleep"""
    render_url = os.environ.get('RENDER_EXTERNAL_URL', '')
    if not render_url:
        logging.info("ℹ️ RENDER_EXTERNAL_URL not set, self-ping disabled")
        return
    
    ping_url = f"{render_url}/api/healthz"
    logging.info(f"🏓 Self-ping enabled: {ping_url}")
    
    while True:
        await asyncio.sleep(300)  # 5 minutes
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(ping_url, timeout=10)
                logging.debug(f"Self-ping: {resp.status_code}")
        except Exception as e:
            logging.debug(f"Self-ping error (non-critical): {e}")

# ============================================================
# APP LIFECYCLE
# ============================================================

@app.on_event("startup")
async def startup():
    """Load cache and start self-ping on startup"""
    await load_cache_from_sheets()
    asyncio.create_task(self_ping())
    logging.info("🚀 Condition Monitoring System started")

# Include router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
