"""
Neutral Glass - Condition Monitoring System
Backend Server (Render Free Tier Edition)
- No MongoDB (removed)
- Google Sheets = primary database
- Cloudinary = photo storage
- Self-ping = keeps Render free tier awake
- Brevo HTTP API = daily report email (SMTP blocked on Render free tier)
"""
import gc
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))  # India Standard Time
from PIL import Image, ImageDraw, ImageFont
import base64
from io import BytesIO
import json
import asyncio
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ============================================================
# EMAIL CONFIG (for daily report emails via Brevo)
# ============================================================
GMAIL_SENDER = os.environ.get('GMAIL_SENDER', 'sivasuresh.p@gmail.com')
BREVO_API_KEY = os.environ.get('BREVO_API_KEY', '')
REPORT_RECIPIENTS = [r.strip() for r in os.environ.get('REPORT_RECIPIENTS', 'suresh.perumalla@gerresheimer.com').split(',') if r.strip()]
REPORT_CC = [r.strip() for r in os.environ.get('REPORT_CC', 'makrand.kshirsagar@gerresheimer.com,anish.k@gerresheimer.com').split(',') if r.strip()]
REPORT_SEND_HOUR_IST = int(os.environ.get('REPORT_SEND_HOUR_IST', '7'))
REPORT_SEND_MINUTE_IST = int(os.environ.get('REPORT_SEND_MINUTE_IST', '10'))

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
        
        sa_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON', '')
        sa_file = ROOT_DIR / 'service_account.json'
        
        if sa_json:
            sa_info = json.loads(sa_json)
            creds = Credentials.from_service_account_info(sa_info, scopes=scopes)
        elif sa_file.exists():
            creds = Credentials.from_service_account_file(str(sa_file), scopes=scopes)
        else:
            logging.warning("⚠️ No Google service account credentials found. Running in demo mode.")
            return
        
        sheets_service = gspread.authorize(creds)
        spreadsheet = sheets_service.open_by_key(GOOGLE_SHEET_ID)
        
        try:
            readings_sheet = spreadsheet.worksheet("Readings")
        except gspread.WorksheetNotFound:
            readings_sheet = spreadsheet.add_worksheet(title="Readings", rows=10000, cols=20)
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
readings_cache = []
cache_loaded = False

MAX_CACHE_SIZE = 500
async def load_cache_from_sheets():
    """Load recent readings from Google Sheets into memory cache"""
    global readings_cache, cache_loaded
    
    if not config_ready or not readings_sheet:
        cache_loaded = True
        return
    
    try:
        all_data = readings_sheet.get_all_records()
        readings_cache = all_data[-MAX_CACHE_SIZE:] if len(all_data) > MAX_CACHE_SIZE else all_data
        for r in readings_cache:
            r.pop("photo_base64", None)
        cache_loaded = True
        logging.info(f"✅ Loaded {len(readings_cache)} readings into cache (max {MAX_CACHE_SIZE})")
    except Exception as e:
        logging.error(f"Cache load error: {e}")
        cache_loaded = True

# ============================================================
# APP SETUP
# ============================================================
app = FastAPI(title="Neutral Glass Condition Monitoring")
api_router = APIRouter(prefix="/api")

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
    try:
        image_data = base64.b64decode(
            photo_base64.split(',')[1] if ',' in photo_base64 else photo_base64
        )
        image = Image.open(BytesIO(image_data))
        # Safety net: if a client ever sends a full-resolution photo (bypassed
        # frontend compression, old cached app version, etc.), this tells the
        # JPEG decoder to downscale WHILE decoding rather than after, capping
        # peak memory use regardless of source image size. No-op for smaller images.
        try:
            image.draft('RGB', (800, 800))
        except Exception:
            pass
        image.load()
        if image.mode != 'RGB':
            image = image.convert('RGB')
        max_width = 800
        if image.width > max_width:
            ratio = max_width / image.width
            image = image.resize((max_width, int(image.height * ratio)), Image.LANCZOS)
        draw = ImageDraw.Draw(image)
        timestamp = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
        width, height = image.size
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
        except:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), timestamp, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = width - text_width - 15
        y = height - text_height - 15
        padding = 8
        draw.rectangle([x - padding, y - padding, x + text_width + padding, y + text_height + padding], fill=(0, 0, 0))
        draw.text((x, y), timestamp, fill=(255, 255, 255), font=font)
        verified_text = "VERIFIED"
        bbox_v = draw.textbbox((0, 0), verified_text, font=font)
        vw = bbox_v[2] - bbox_v[0]
        xv = width - vw - 15
        yv = y - text_height - 20
        draw.rectangle([xv - padding, yv - padding, xv + vw + padding, yv + text_height + padding], fill=(0, 47, 167))
        draw.text((xv, yv), verified_text, fill=(255, 255, 255), font=font)
        buffered = BytesIO()
        image.save(buffered, format="JPEG", quality=75)
        img_str = base64.b64encode(buffered.getvalue()).decode()
        gc.collect()
        return f"data:image/jpeg;base64,{img_str}"
    except Exception as e:
        logging.error(f"Watermark error: {e}")
        return photo_base64

def upload_photo_to_cloudinary(photo_base64: str, plant: str, machine: str) -> str:
    if not CLOUDINARY_ENABLED:
        return ""
    try:
        import cloudinary.uploader
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
    if not config_ready or not readings_sheet:
        return False
    try:
        row = [
            reading_data.get('id', ''), reading_data.get('timestamp', ''),
            reading_data.get('plant', ''), reading_data.get('machine', ''),
            reading_data.get('motor', ''), str(reading_data.get('current', '')),
            str(reading_data.get('temperature', '')), str(reading_data.get('i2t', '')),
            str(reading_data.get('normal_current', '')), str(reading_data.get('warning_current', '')),
            str(reading_data.get('normal_temperature', '')), str(reading_data.get('warning_temperature', '')),
            str(reading_data.get('normal_i2t', '')), str(reading_data.get('warning_i2t', '')),
            reading_data.get('status', ''), reading_data.get('verified_by', ''),
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
    if not config_ready or not readings_sheet:
        return False
    try:
        rows = []
        for r in readings_list:
            rows.append([
                r.get('id', ''), r.get('timestamp', ''), r.get('plant', ''),
                r.get('machine', ''), r.get('motor', ''), str(r.get('current', '')),
                str(r.get('temperature', '')), str(r.get('i2t', '')),
                str(r.get('normal_current', '')), str(r.get('warning_current', '')),
                str(r.get('normal_temperature', '')), str(r.get('warning_temperature', '')),
                str(r.get('normal_i2t', '')), str(r.get('warning_i2t', '')),
                r.get('status', ''), r.get('verified_by', ''), r.get('entry_source', ''),
                'Yes' if r.get('has_photo') else 'No', r.get('photo_url', ''),
                'Yes' if r.get('bulk_entry') else 'No'
            ])
        readings_sheet.append_rows(rows, value_input_option='USER_ENTERED')
        logging.info(f"✅ Saved {len(rows)} readings to Google Sheets")
        return True
    except Exception as e:
        logging.error(f"Sheets bulk write error: {e}")
        return False

# ============================================================
# DAILY REPORT EMAIL
# ============================================================

def _build_report_data():
    cutoff = datetime.now(IST) - timedelta(hours=24)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")
    recent = [r for r in readings_cache if r.get("Timestamp", r.get("timestamp", "")) >= cutoff_str]
    latest = {}
    for r in recent:
        key = f"{r.get('Plant', r.get('plant',''))}_{r.get('Machine', r.get('machine',''))}_{r.get('Motor', r.get('motor',''))}"
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    total = len(latest)
    ok_count = sum(1 for r in latest.values() if r.get("Status", r.get("status", "")) == "OK")
    warning_count = sum(1 for r in latest.values() if r.get("Status", r.get("status", "")) == "Warning")
    alarm_count = sum(1 for r in latest.values() if r.get("Status", r.get("status", "")) == "Alarm")
    alarms = [r for r in latest.values() if r.get("Status", r.get("status", "")) == "Alarm"]
    warnings = [r for r in latest.values() if r.get("Status", r.get("status", "")) == "Warning"]
    machines = sorted({r.get("Machine", r.get("machine", "")) for r in latest.values()})
    criticals = []
    for r in alarms:
        i2t = r.get("I2t", r.get("i2t", ""))
        wi2t = r.get("Warning_I2t", r.get("warning_i2t", ""))
        temp = r.get("Temperature", r.get("temperature", ""))
        wtemp = r.get("Warning_Temperature", r.get("warning_temperature", ""))
        is_critical = False
        if i2t and wi2t:
            try:
                if float(i2t) >= float(wi2t): is_critical = True
            except (ValueError, TypeError): pass
        if temp and wtemp:
            try:
                if float(temp) >= float(wtemp): is_critical = True
            except (ValueError, TypeError): pass
        if is_critical:
            criticals.append(r)
    return {
        "date": datetime.now(IST).strftime("%d-%b-%Y"),
        "total": total, "ok": ok_count, "warning": warning_count,
        "alarm": alarm_count, "critical": len(criticals),
        "machines": machines, "alarms": alarms, "warnings": warnings,
        "criticals": criticals, "recent_count": len(recent),
    }


def _build_html_report(d: dict) -> str:
    def _motor_label(r):
        return f"{r.get('Machine', r.get('machine', ''))} → {r.get('Motor', r.get('motor', ''))}"

    def _reading_detail(r):
        parts = []
        cur = r.get("Current", r.get("current", ""))
        wcur = r.get("Warning_Current", r.get("warning_current", ""))
        temp = r.get("Temperature", r.get("temperature", ""))
        wtemp = r.get("Warning_Temperature", r.get("warning_temperature", ""))
        i2t = r.get("I2t", r.get("i2t", ""))
        wi2t = r.get("Warning_I2t", r.get("warning_i2t", ""))
        if cur and wcur: parts.append(f"Current {cur} ≥ {wcur}")
        if temp and wtemp: parts.append(f"Temp {temp}°C ≥ {wtemp}°C")
        if i2t and wi2t: parts.append(f"I²t {i2t} (threshold {wi2t})")
        return "; ".join(parts) if parts else "Alarm threshold exceeded"

    machines_str = ", ".join(d["machines"]) if d["machines"] else "—"
    critical_html = ""
    if d["criticals"]:
        items = "".join(f'<li><b>{_motor_label(r)}</b>: {_reading_detail(r)} — CRITICAL</li>' for r in d["criticals"])
        critical_html = f"""<div style="background:#fff3cd;border-left:4px solid #dc3545;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <b style="color:#dc3545;">&#9888; CRITICAL ALERT &mdash; Immediate Action Required</b>
          <ul style="margin:8px 0 0 0;padding-left:20px;color:#333;">{items}</ul></div>"""

    alarm_rows = "".join(f"""<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">{_motor_label(r)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#dc3545;font-weight:bold;">ALARM</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">{_reading_detail(r)}</td></tr>""" for r in d["alarms"])

    warning_rows = "".join(f"""<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">{_motor_label(r)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#fd7e14;font-weight:bold;">WARNING</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">{_reading_detail(r)}</td></tr>""" for r in d["warnings"]) if d["warnings"] else ""

    alerts_table = ""
    if alarm_rows or warning_rows:
        alerts_table = f"""<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;font-size:13px;">
          <tr style="background:#f8f9fa;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Motor</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Status</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #dee2e6;">Details</th>
          </tr>{alarm_rows}{warning_rows}</table>"""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
  <tr><td align="center">
  <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <tr><td style="background:#002fa7;padding:24px 28px;">
      <div style="color:#fff;font-size:22px;font-weight:bold;">Condition Monitoring &mdash; Daily Report</div>
      <div style="color:#aac4ff;font-size:13px;margin-top:6px;">Gerresheimer Glass India &nbsp;|&nbsp; {d['date']} &nbsp;|&nbsp; Period: Last 24 Hours &nbsp;|&nbsp; {d['total']} readings &nbsp;|&nbsp; {machines_str}</div>
    </td></tr>
    <tr><td style="padding:24px 28px;">
      <div style="font-size:14px;font-weight:bold;color:#002fa7;letter-spacing:1px;margin-bottom:12px;">EXECUTIVE SUMMARY</div>
      <table cellpadding="0" cellspacing="8" style="width:100%;margin-bottom:20px;"><tr>
          <td align="center" style="background:#e8f4fd;border-radius:6px;padding:14px 10px;width:20%;"><div style="font-size:28px;font-weight:bold;color:#0d6efd;">{d['total']}</div><div style="font-size:11px;color:#555;margin-top:4px;">TOTAL</div></td>
          <td align="center" style="background:#d1f5d3;border-radius:6px;padding:14px 10px;width:20%;"><div style="font-size:28px;font-weight:bold;color:#198754;">{d['ok']}</div><div style="font-size:11px;color:#555;margin-top:4px;">OK</div></td>
          <td align="center" style="background:#fff3cd;border-radius:6px;padding:14px 10px;width:20%;"><div style="font-size:28px;font-weight:bold;color:#fd7e14;">{d['warning']}</div><div style="font-size:11px;color:#555;margin-top:4px;">WARNING</div></td>
          <td align="center" style="background:#fde8e8;border-radius:6px;padding:14px 10px;width:20%;"><div style="font-size:28px;font-weight:bold;color:#dc3545;">{d['alarm']}</div><div style="font-size:11px;color:#555;margin-top:4px;">ALARM</div></td>
          <td align="center" style="background:#f3e8ff;border-radius:6px;padding:14px 10px;width:20%;"><div style="font-size:28px;font-weight:bold;color:#6f42c1;">{d['critical']}</div><div style="font-size:11px;color:#555;margin-top:4px;">CRITICAL</div></td>
      </tr></table>
      {critical_html}
      {'<div style="font-size:14px;font-weight:bold;color:#002fa7;letter-spacing:1px;margin:20px 0 8px;">ALARMS &amp; WARNINGS</div>' + alerts_table if alerts_table else ''}
    </td></tr>
    <tr><td style="background:#f8f9fa;padding:14px 28px;font-size:11px;color:#888;border-top:1px solid #dee2e6;">
      Generated automatically by Condition Monitoring System &mdash; Gerresheimer Glass India &nbsp;|&nbsp; {datetime.now(IST).strftime("%d %b %Y %H:%M IST")}
    </td></tr>
  </table></td></tr>
</table></body></html>"""


def send_daily_report_email() -> dict:
    """Build and send the daily condition monitoring report via Brevo HTTP API."""
    if not BREVO_API_KEY:
        return {"success": False, "message": "BREVO_API_KEY environment variable not set"}
    try:
        d = _build_report_data()
        html_body = _build_html_report(d)
        plain_body = (
            f"Condition Monitoring — Daily Report — {d['date']}\n"
            f"Gerresheimer Glass India | {d['total']} readings | "
            f"{d['ok']} OK | {d['warning']} Warning | {d['alarm']} Alarm | {d['critical']} Critical\n\n"
            "Please view this email in HTML format for the full formatted report."
        )
        subject = f"Condition Monitoring — Daily Report — {d['date']}"
        payload = {
            "sender": {"name": "Condition Monitoring", "email": GMAIL_SENDER},
            "to": [{"email": r} for r in REPORT_RECIPIENTS],
            "cc": [{"email": r} for r in REPORT_CC],
            "subject": subject,
            "textContent": plain_body,
            "htmlContent": html_body,
        }
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                "https://api.brevo.com/v3/smtp/email",
                json=payload,
                headers={
                    "api-key": BREVO_API_KEY,
                    "Content-Type": "application/json",
                },
            )
        all_recipients = REPORT_RECIPIENTS + REPORT_CC
        if resp.status_code in (200, 201):
            logging.info(f"✅ Daily report email sent to {all_recipients}")
            return {"success": True, "message": f"Report sent to {', '.join(all_recipients)}", "stats": d}
        else:
            msg = f"Brevo error {resp.status_code}: {resp.text}"
            logging.error(f"❌ {msg}")
            return {"success": False, "message": msg}
    except Exception as e:
        logging.error(f"❌ Email send error: {e}")
        return {"success": False, "message": str(e)}


# ============================================================
# API ROUTES
# ============================================================

@api_router.get("/")
async def root():
    return {"message": "Neutral Glass Condition Monitoring API", "status": "running"}

@api_router.get("/healthz")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now(IST).isoformat()}

@api_router.get("/machine-config/{plant}/{machine}")
async def get_machine_config(plant: str, machine: str):
    try:
        with open(ROOT_DIR / 'machine_config.json', 'r') as f:
            fresh_config = json.load(f)
        if plant in fresh_config["plants"] and machine in fresh_config["plants"][plant]["machines"]:
            data = fresh_config["plants"][plant]["machines"][machine]
            return JSONResponse(content=data, headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache", "Expires": "0",
            })
        else:
            raise HTTPException(status_code=404, detail="Machine configuration not found")
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="machine_config.json not found on server")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"machine_config.json is invalid: {e}")
    except KeyError:
        raise HTTPException(status_code=404, detail="Machine configuration not found")

@api_router.post("/reload-config")
async def reload_machine_config():
    global MACHINE_CONFIG
    try:
        with open(ROOT_DIR / 'machine_config.json', 'r') as f:
            MACHINE_CONFIG = json.load(f)
        return {"status": "ok", "message": "machine_config.json reloaded successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reload failed: {e}")

@api_router.post("/condition-monitoring/bulk")
async def add_bulk_condition_data(data: dict):
    try:
        plant = data.get("plant")
        machine = data.get("machine")
        readings_list = data.get("readings", [])
        technician = data.get("technician")
        photo_base64 = data.get("photo_base64")
        entry_source = data.get("entry_source", "Field")
        timestamp = datetime.now(IST)
        timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
        photo_url = ""
        has_photo = False
        if photo_base64:
            watermarked = add_timestamp_watermark(photo_base64)
            photo_url = upload_photo_to_cloudinary(watermarked, plant, machine)
            has_photo = True
        inserted_count = 0
        alarm_count = 0
        warning_count = 0
        docs_for_sheets = []
        for reading in readings_list:
            motor = reading.get("motor")
            severity = 0
            def _evaluate(value, normal, warning):
                if warning > 0 and value >= warning: return 2
                if normal > 0 and value >= normal: return 1
                return 0
            if reading.get("current"):
                severity = max(severity, _evaluate(float(reading.get("current")), float(reading.get("normal_current", 0)), float(reading.get("warning_current", 0))))
            if reading.get("temperature"):
                severity = max(severity, _evaluate(float(reading.get("temperature")), float(reading.get("normal_temperature", 0)), float(reading.get("warning_temperature", 0))))
            if reading.get("i2t"):
                severity = max(severity, _evaluate(float(reading.get("i2t")), float(reading.get("normal_i2t", 0)), float(reading.get("warning_i2t", 0))))
            if severity == 2:
                status = "Alarm"; alarm_count += 1
            elif severity == 1:
                status = "Warning"; warning_count += 1
            else:
                status = "OK"
            doc = {
                "id": str(uuid.uuid4())[:8], "timestamp": timestamp_str,
                "plant": plant, "machine": machine, "motor": motor,
                "current": float(reading.get("current")) if reading.get("current") else "",
                "temperature": float(reading.get("temperature")) if reading.get("temperature") else "",
                "i2t": float(reading.get("i2t")) if reading.get("i2t") else "",
                "normal_current": float(reading.get("normal_current")) if reading.get("normal_current") else "",
                "warning_current": float(reading.get("warning_current")) if reading.get("warning_current") else "",
                "normal_temperature": float(reading.get("normal_temperature")) if reading.get("normal_temperature") else "",
                "warning_temperature": float(reading.get("warning_temperature")) if reading.get("warning_temperature") else "",
                "normal_i2t": float(reading.get("normal_i2t")) if reading.get("normal_i2t") else "",
                "warning_i2t": float(reading.get("warning_i2t")) if reading.get("warning_i2t") else "",
                "status": status, "verified_by": technician or "",
                "entry_source": entry_source, "has_photo": has_photo,
                "photo_url": photo_url, "bulk_entry": True
            }
            docs_for_sheets.append(doc)
            readings_cache.append(doc)
            inserted_count += 1
        sheets_synced = save_bulk_readings_to_sheets(docs_for_sheets)
        if len(readings_cache) > MAX_CACHE_SIZE:
            del readings_cache[:len(readings_cache) - MAX_CACHE_SIZE]
        return {"message": "Bulk readings submitted successfully", "inserted_count": inserted_count, "alarm_count": alarm_count, "warning_count": warning_count, "sheets_synced": sheets_synced}
    except Exception as e:
        logging.error(f"Bulk entry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/condition-monitoring")
async def add_condition_data(data: ConditionMonitoringCreate):
    status = "OK"
    if data.warning_current > 0 and data.current >= data.warning_current:
        status = "Alarm"
    elif data.normal_current > 0 and data.current >= data.normal_current:
        status = "Warning"
    timestamp = datetime.now(IST)
    photo_url = ""
    has_photo = False
    if data.photo_base64:
        watermarked = add_timestamp_watermark(data.photo_base64)
        photo_url = upload_photo_to_cloudinary(watermarked, data.plant, data.machine)
        has_photo = True
    doc = {
        "id": str(uuid.uuid4())[:8], "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        "plant": data.plant, "machine": data.machine, "motor": data.motor,
        "current": data.current, "temperature": "", "i2t": "",
        "normal_current": data.normal_current, "warning_current": data.warning_current,
        "normal_temperature": "", "warning_temperature": "", "normal_i2t": "", "warning_i2t": "",
        "status": status, "verified_by": data.verified_by or "",
        "entry_source": data.entry_source, "has_photo": has_photo,
        "photo_url": photo_url, "bulk_entry": False
    }
    save_reading_to_sheets(doc)
    readings_cache.append(doc)
    if len(readings_cache) > MAX_CACHE_SIZE:
        del readings_cache[:len(readings_cache) - MAX_CACHE_SIZE]
    return {"message": "Data added successfully", "status": status, "has_photo": has_photo}

@api_router.get("/condition-monitoring/plant/{plant}")
async def get_plant_data(plant: str, limit: int = 1000):
    if not cache_loaded:
        await load_cache_from_sheets()
    data = [r for r in readings_cache if r.get("Plant", r.get("plant", "")) == plant]
    data.sort(key=lambda x: x.get("Timestamp", x.get("timestamp", "")), reverse=True)
    return data[:limit]

@api_router.get("/condition-monitoring/machine/{plant}/{machine}")
async def get_machine_data(plant: str, machine: str, limit: int = 100):
    if not cache_loaded:
        await load_cache_from_sheets()
    data = [r for r in readings_cache if (r.get("Plant", r.get("plant", "")) == plant and r.get("Machine", r.get("machine", "")) == machine)]
    data.sort(key=lambda x: x.get("Timestamp", x.get("timestamp", "")), reverse=True)
    return data[:limit]

@api_router.get("/active-alarms")
async def get_active_alarms():
    if not cache_loaded:
        await load_cache_from_sheets()
    latest = {}
    for r in readings_cache:
        key = f"{r.get('Plant', r.get('plant', ''))}_{r.get('Machine', r.get('machine', ''))}_{r.get('Motor', r.get('motor', ''))}"
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    alarms = []
    for r in latest.values():
        if r.get("Status", r.get("status", "")) == "Alarm":
            alarms.append({
                "plant": r.get("Plant", r.get("plant", "")), "machine": r.get("Machine", r.get("machine", "")),
                "motor": r.get("Motor", r.get("motor", "")), "current": r.get("Current", r.get("current", "")),
                "temperature": r.get("Temperature", r.get("temperature", "")), "i2t": r.get("I2t", r.get("i2t", "")),
                "normal_current": r.get("Normal_Current", r.get("normal_current", "")),
                "warning_current": r.get("Warning_Current", r.get("warning_current", "")),
                "normal_temperature": r.get("Normal_Temperature", r.get("normal_temperature", "")),
                "warning_temperature": r.get("Warning_Temperature", r.get("warning_temperature", "")),
                "normal_i2t": r.get("Normal_I2t", r.get("normal_i2t", "")),
                "warning_i2t": r.get("Warning_I2t", r.get("warning_i2t", "")),
                "status": "Alarm", "timestamp": r.get("Timestamp", r.get("timestamp", "")),
                "verified_by": r.get("Verified_By", r.get("verified_by", "")),
            })
    return alarms

@api_router.get("/machine-health/{plant}")
async def get_machine_health(plant: str):
    if not cache_loaded:
        await load_cache_from_sheets()
    latest = {}
    for r in readings_cache:
        if r.get("Plant", r.get("plant", "")) != plant:
            continue
        key = f"{r.get('Machine', r.get('machine', ''))}_{r.get('Motor', r.get('motor', ''))}"
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    machines = {}
    for r in latest.values():
        m = r.get("Machine", r.get("machine", ""))
        if m not in machines:
            machines[m] = {"ok": 0, "warning": 0, "alarm": 0, "total": 0}
        status = r.get("Status", r.get("status", "OK"))
        machines[m]["total"] += 1
        if status == "Alarm": machines[m]["alarm"] += 1
        elif status == "Warning": machines[m]["warning"] += 1
        else: machines[m]["ok"] += 1
    result = []
    for machine, counts in sorted(machines.items()):
        total = counts["total"]
        health = round((counts["ok"] / total) * 100) if total > 0 else 100
        result.append({"machine": machine, "ok": counts["ok"], "warning": counts["warning"], "alarm": counts["alarm"], "total": total, "health_percent": health})
    return result

@api_router.get("/plant-health")
async def get_plant_health():
    if not cache_loaded:
        await load_cache_from_sheets()
    latest = {}
    for r in readings_cache:
        key = f"{r.get('Plant', r.get('plant', ''))}_{r.get('Machine', r.get('machine', ''))}_{r.get('Motor', r.get('motor', ''))}"
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    plants = {}
    for r in latest.values():
        p = r.get("Plant", r.get("plant", ""))
        if p not in plants:
            plants[p] = {"ok": 0, "warning": 0, "alarm": 0, "total": 0}
        status = r.get("Status", r.get("status", "OK"))
        plants[p]["total"] += 1
        if status == "Alarm": plants[p]["alarm"] += 1
        elif status == "Warning": plants[p]["warning"] += 1
        else: plants[p]["ok"] += 1
    result = []
    for plant, counts in sorted(plants.items()):
        total = counts["total"]
        health = round((counts["ok"] / total) * 100) if total > 0 else 100
        result.append({"plant": plant, "ok": counts["ok"], "warning": counts["warning"], "alarm": counts["alarm"], "total": total, "health_percent": health})
    return result

@api_router.get("/stats")
async def get_stats():
    if not cache_loaded:
        await load_cache_from_sheets()
    return {"total_readings": len(readings_cache), "google_sheets_connected": config_ready, "cloudinary_connected": CLOUDINARY_ENABLED, "cache_loaded": cache_loaded}

@api_router.post("/send-daily-report")
async def trigger_send_daily_report():
    if not cache_loaded:
        await load_cache_from_sheets()
    result = send_daily_report_email()
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["message"])
    return result

# ============================================================
# DAILY REPORT SCHEDULER
# ============================================================

async def daily_report_scheduler():
    if not BREVO_API_KEY:
        logging.warning("⚠️ BREVO_API_KEY not set — daily report auto-send disabled")
        return
    logging.info(f"📧 Daily report scheduler started — will send at {REPORT_SEND_HOUR_IST:02d}:{REPORT_SEND_MINUTE_IST:02d} IST")
    last_sent_date = None
    while True:
        now = datetime.now(IST)
        today = now.date()
        if now.hour == REPORT_SEND_HOUR_IST and now.minute == REPORT_SEND_MINUTE_IST and last_sent_date != today:
            logging.info(f"⏰ Scheduled daily report triggered at {now.strftime('%H:%M IST')}")
            result = send_daily_report_email()
            if result["success"]:
                last_sent_date = today
            else:
                logging.error(f"Scheduled report failed: {result['message']}")
        await asyncio.sleep(60)

# ============================================================
# SELF-PING (Keeps Render Free Tier Awake)
# ============================================================

async def self_ping():
    render_url = os.environ.get('RENDER_EXTERNAL_URL', '')
    if not render_url:
        logging.info("ℹ️ RENDER_EXTERNAL_URL not set, self-ping disabled")
        return
    ping_url = f"{render_url}/api/healthz"
    logging.info(f"🏓 Self-ping enabled: {ping_url}")
    while True:
        await asyncio.sleep(300)
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
    await load_cache_from_sheets()
    asyncio.create_task(self_ping())
    asyncio.create_task(daily_report_scheduler())
    logging.info("🚀 Condition Monitoring System started")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
