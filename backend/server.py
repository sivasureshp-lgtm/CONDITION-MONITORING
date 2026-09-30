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
import sys
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
# Supports two config styles:
#   Style A (combined): CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
#   Style B (separate): CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
# ============================================================
CLOUDINARY_ENABLED = False
try:
    import cloudinary
    import cloudinary.uploader
    cloudinary_url = os.environ.get('CLOUDINARY_URL', '')
    cloud_name     = os.environ.get('CLOUDINARY_CLOUD_NAME', '')
    api_key        = os.environ.get('CLOUDINARY_API_KEY', '')
    api_secret     = os.environ.get('CLOUDINARY_API_SECRET', '')
    if cloudinary_url:
        cloudinary.config(cloudinary_url=cloudinary_url)
        CLOUDINARY_ENABLED = True
        logging.info("✅ Cloudinary connected via CLOUDINARY_URL")
    elif cloud_name and api_key and api_secret:
        cloudinary.config(cloud_name=cloud_name, api_key=api_key,
                          api_secret=api_secret, secure=True)
        CLOUDINARY_ENABLED = True
        logging.info(f"✅ Cloudinary connected via separate keys: {cloud_name}")
    else:
        logging.warning("⚠️ No Cloudinary credentials found. Photos will not be stored.")
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
        # MEMORY FIX: never read the whole sheet (get_all_records on 40k+ rows
        # needs 150-300 MB and was the main cause of Render restarts).
        # 1) small index of columns C:E tells us where the data ends,
        # 2) read only the last MAX_CACHE_SIZE rows,
        # 3) build the newest-reading-per-motor table (~300 rows).
        await get_plant_machine_index(force=True)
        last_row = _plant_machine_index_cache.get("last_row", 1)
        if last_row >= 2:
            first_row = max(2, last_row - MAX_CACHE_SIZE + 1)
            block = readings_sheet.get(f"A{first_row}:{LAST_COL}{last_row}")
            readings_cache = [r for r in _rows_to_dicts([block]) if r.get("plant") or r.get("machine")]
            del block
        else:
            readings_cache = []
        cache_loaded = True
        logging.info(f"✅ Loaded last {len(readings_cache)} readings into cache | {memory_mb()}")
        await build_latest_by_motor()
        gc.collect()
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
        return readings_sheet.append_row(row, value_input_option='USER_ENTERED') or True
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
                'Yes' if r.get('bulk_entry') else 'No',
                'Yes' if r.get('qr_verified') else 'No',
                r.get('manual_override_reason', '')
            ])
        resp = readings_sheet.append_rows(rows, value_input_option='USER_ENTERED')
        logging.info(f"✅ Saved {len(rows)} readings to Google Sheets | {memory_mb()}")
        return resp or True
    except Exception as e:
        logging.error(f"Sheets bulk write error: {e}")
        return False

# ============================================================
# DAILY REPORT EMAIL
# ============================================================

def _build_report_data():
    cutoff = datetime.now(IST) - timedelta(hours=24)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")
    # newest reading of every motor, keeping those read in the last 24 h
    recent = [r for r in latest_docs() if str(r.get("Timestamp", r.get("timestamp", ""))) >= cutoff_str]
    latest = {i: r for i, r in enumerate(recent)}
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

        # --- QR machine-presence verification (defense-in-depth) ---
        # The frontend already enforces this, but re-check here in case the
        # API is called directly, bypassing the UI's scan requirement.
        qr_verified_claim = bool(data.get("qr_verified"))
        qr_scan_timestamp = data.get("qr_scan_timestamp") or ""
        manual_override_reason = (data.get("manual_override_reason") or "").strip()
        qr_verified = False
        if qr_verified_claim and qr_scan_timestamp:
            try:
                scan_dt = datetime.fromisoformat(qr_scan_timestamp.replace("Z", "+00:00"))
                if scan_dt.tzinfo is None:
                    scan_dt = IST.localize(scan_dt) if hasattr(IST, "localize") else scan_dt.replace(tzinfo=IST)
                age_minutes = (timestamp - scan_dt.astimezone(IST)).total_seconds() / 60
                qr_verified = 0 <= age_minutes <= 15
            except Exception as e:
                logging.warning(f"QR scan timestamp parse error: {e}")
                qr_verified = False
        if not qr_verified and not manual_override_reason:
            raise HTTPException(
                status_code=400,
                detail="Machine QR verification missing or expired. Please re-scan the machine panel, or use Manual Entry with a reason."
            )
        if photo_base64:
            watermarked = add_timestamp_watermark(photo_base64)
            photo_url = upload_photo_to_cloudinary(watermarked, plant, machine)
            has_photo = True
            # free the photo copies before processing readings
            del watermarked
            photo_base64 = None
            data.pop("photo_base64", None)
            gc.collect()
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
                "photo_url": photo_url, "bulk_entry": True,
                "qr_verified": qr_verified,
                "manual_override_reason": manual_override_reason if not qr_verified else ""
            }
            docs_for_sheets.append(doc)
            readings_cache.append(doc)
            inserted_count += 1
        sheets_resp = save_bulk_readings_to_sheets(docs_for_sheets)
        sheets_synced = bool(sheets_resp)
        if len(readings_cache) > MAX_CACHE_SIZE:
            del readings_cache[:len(readings_cache) - MAX_CACHE_SIZE]
        # extend the index in place (no full re-read) + update latest-per-motor
        _register_written_docs(docs_for_sheets, sheets_resp if isinstance(sheets_resp, dict) else None)
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
    sheets_resp = save_reading_to_sheets(doc)
    readings_cache.append(doc)
    if len(readings_cache) > MAX_CACHE_SIZE:
        del readings_cache[:len(readings_cache) - MAX_CACHE_SIZE]
    _register_written_docs([doc], sheets_resp if isinstance(sheets_resp, dict) else None)
    return {"message": "Data added successfully", "status": status, "has_photo": has_photo}

@api_router.get("/condition-monitoring/plant/{plant}")
async def get_plant_data(plant: str, limit: int = 1000):
    if not cache_loaded:
        await load_cache_from_sheets()
    data = [r for r in readings_cache if r.get("Plant", r.get("plant", "")) == plant]
    data.sort(key=lambda x: x.get("Timestamp", x.get("timestamp", "")), reverse=True)
    return data[:limit]


# ============================================================
# TARGETED PER-MACHINE HISTORY FETCH (memory-safe)
# ------------------------------------------------------------
# With 37,000+ rows in the Readings sheet, pulling the ENTIRE sheet
# into memory (get_all_records()) on every history view is what was
# crashing the backend on Render's 512MB free tier.
#
# Instead:
#   1. Read a lightweight index of just the Plant (col C) and
#      Machine (col D) columns for every row - this is a small,
#      cheap read (2 columns of text, not 20+ columns of full data).
#   2. Find which row numbers belong to the requested plant+machine.
#   3. Fetch ONLY those specific rows' full data in one batched call
#      (chunked to stay under safe request-size limits).
# This keeps memory usage proportional to one machine's history
# (~hundreds of rows), not the whole sheet, no matter how large the
# sheet grows.
# ============================================================
# SHEET_HEADERS: the actual column headers/order in the Google Sheet
# (capitalized, e.g. "Timestamp", "Normal_Current").
SHEET_HEADERS = [
    "ID", "Timestamp", "Plant", "Machine", "Motor",
    "Current", "Temperature", "I2t",
    "Normal_Current", "Warning_Current",
    "Normal_Temperature", "Warning_Temperature",
    "Normal_I2t", "Warning_I2t",
    "Status", "Verified_By", "Entry_Source",
    "Has_Photo", "Photo_URL", "Bulk_Entry",
    "QR_Verified", "Manual_Override_Reason"
]

# FIELD_KEYS: the lowercase keys the frontend (ConditionMonitoring.js)
# actually reads, e.g. item.timestamp, item.current, item.normal_current.
# Same order as SHEET_HEADERS above - this is what was missing before,
# which is why every field showed up blank ("Invalid Date", etc.) even
# though the row count (66 readings) was correct.
FIELD_KEYS = [
    "id", "timestamp", "plant", "machine", "motor",
    "current", "temperature", "i2t",
    "normal_current", "warning_current",
    "normal_temperature", "warning_temperature",
    "normal_i2t", "warning_i2t",
    "status", "verified_by", "entry_source",
    "has_photo", "photo_url", "bulk_entry",
    "qr_verified", "manual_override_reason"
]
LAST_COL = "V"  # column letter of the 22nd column (Manual_Override_Reason)
_BOOL_KEYS = {"has_photo", "bulk_entry", "qr_verified"}

# ============================================================
# MEMORY-SAFE INDEX + LATEST READING PER MOTOR
# ------------------------------------------------------------
# The index holds only (Plant, Machine, row_number, Motor) for every row,
# read from columns C:E (~8-15 MB peak for 40k rows, vs 150-300 MB for a
# full-sheet read). It is:
#   * built once at startup,
#   * extended IN PLACE after every write (no full re-read per submission),
#   * fully re-read only every INDEX_CACHE_TTL seconds as a safety net
#     (e.g. if someone edits or deletes rows directly in the sheet).
#
# _latest_by_motor keeps the newest reading of every motor (~300 rows).
# Dashboard, alarms, health % and the daily email use it, so a motor is
# never missed just because it was read long ago.
# ============================================================
_plant_machine_index_cache = {"data": None, "ts": 0.0, "last_row": 1}
INDEX_CACHE_TTL = 600  # seconds (10 min) - full safety-net refresh
_latest_by_motor = {}          # (plant, machine, motor_key) -> reading dict
_latest_ready = False


def _motor_key(name) -> str:
    """'Tube Rotation' and 'TubeRotation' are the same motor."""
    return "".join(ch for ch in str(name or "").lower() if ch.isalnum())


def _latest_key(doc: dict):
    return (
        str(doc.get("plant", doc.get("Plant", ""))),
        str(doc.get("machine", doc.get("Machine", ""))),
        _motor_key(doc.get("motor", doc.get("Motor", ""))),
    )


def _merge_row_ranges(row_numbers):
    """[5,6,7,10,11] -> [(5,7),(10,11)] so consecutive rows are fetched in one range."""
    bounds = []
    if not row_numbers:
        return bounds
    rows = sorted(row_numbers)
    start = prev = rows[0]
    for r in rows[1:]:
        if r == prev + 1:
            prev = r
            continue
        bounds.append((start, prev))
        start = prev = r
    bounds.append((start, prev))
    return bounds


def _fetch_rows(row_numbers, chunk: int = 40):
    """Fetch specific sheet rows (full width) as lowercase-key dicts."""
    data = []
    bounds = _merge_row_ranges(row_numbers)
    for i in range(0, len(bounds), chunk):
        ranges = [f"A{s}:{LAST_COL}{e}" for (s, e) in bounds[i:i + chunk]]
        data.extend(_rows_to_dicts(readings_sheet.batch_get(ranges)))
    return data


def _build_index_sync():
    """Read ONLY columns C:E (Plant, Machine, Motor) and build the row index."""
    values = readings_sheet.get("C2:E")
    idx = []
    last_row = 1
    intern = sys.intern  # identical strings share memory (e.g. 'K', 'K1')
    for i, row in enumerate(values):
        row_num = i + 2  # sheet rows are 1-based, plus the header row
        plant_v = row[0].strip() if len(row) > 0 else ""
        machine_v = row[1].strip() if len(row) > 1 else ""
        motor_v = row[2].strip() if len(row) > 2 else ""
        if plant_v or machine_v:
            idx.append((intern(plant_v), intern(machine_v), row_num, intern(motor_v)))
            last_row = row_num
    del values
    gc.collect()
    return idx, last_row


async def get_plant_machine_index(force: bool = False):
    """(Plant, Machine, row_number, Motor) for every data row; refreshed every 10 min."""
    global _plant_machine_index_cache
    now = datetime.now(IST).timestamp()
    cache = _plant_machine_index_cache
    if not force and cache["data"] is not None and (now - cache["ts"]) < INDEX_CACHE_TTL:
        return cache["data"]
    idx, last_row = _build_index_sync()
    _plant_machine_index_cache = {"data": idx, "ts": now, "last_row": last_row}
    logging.info(f"✅ Refreshed plant/machine index: {len(idx)} rows indexed (last row {last_row}) | {memory_mb()}")
    return idx


def _parse_updated_rows(api_response):
    """Row numbers written by append_row(s), from 'Readings!A40001:V40034'. None if unknown."""
    try:
        rng = api_response["updates"]["updatedRange"]
        cells = rng.split("!")[-1]
        first, _, last = cells.partition(":")
        start = int("".join(ch for ch in first if ch.isdigit()))
        end = int("".join(ch for ch in (last or first) if ch.isdigit()))
        return start, end
    except Exception:
        return None


def _register_written_docs(docs, api_response):
    """After a write: extend the index in place and update latest-per-motor."""
    for d in docs:
        _latest_by_motor[_latest_key(d)] = d
    cache = _plant_machine_index_cache
    rows = _parse_updated_rows(api_response) if api_response else None
    if cache["data"] is not None and rows and (rows[1] - rows[0] + 1) == len(docs):
        intern = sys.intern
        for offset, d in enumerate(docs):
            cache["data"].append((
                intern(str(d.get("plant", ""))), intern(str(d.get("machine", ""))),
                rows[0] + offset, intern(str(d.get("motor", ""))),
            ))
        cache["last_row"] = max(cache.get("last_row", 1), rows[1])
    else:
        # could not tell where the rows landed -> rebuild on next use
        cache["data"] = None


async def build_latest_by_motor():
    """Newest row of every (plant, machine, motor) - about 300 rows, fetched by row number."""
    global _latest_by_motor, _latest_ready
    idx = await get_plant_machine_index()
    last_row_of = {}
    for (p, m, row_num, motor) in idx:  # sheet is append-only -> later row = newer
        last_row_of[(p, m, _motor_key(motor))] = row_num
    docs = _fetch_rows(list(last_row_of.values()))
    latest = {}
    for d in docs:
        key = _latest_key(d)
        old = latest.get(key)
        if old is None or str(d.get("timestamp", "")) >= str(old.get("timestamp", "")):
            latest[key] = d
    _latest_by_motor = latest
    _latest_ready = True
    logging.info(f"✅ Latest-per-motor table: {len(latest)} motors | {memory_mb()}")


def latest_docs():
    """Newest reading per motor. Falls back to the 500-row cache if not built yet."""
    if _latest_ready and _latest_by_motor:
        return list(_latest_by_motor.values())
    latest = {}
    for r in readings_cache:
        key = _latest_key(r)
        ts = r.get("Timestamp", r.get("timestamp", ""))
        if key not in latest or ts > latest[key].get("Timestamp", latest[key].get("timestamp", "")):
            latest[key] = r
    return list(latest.values())


def memory_mb() -> str:
    """Current and peak memory of this process (Linux), for logs and /api/debug/memory."""
    try:
        with open("/proc/self/status") as f:
            info = {line.split(":")[0]: line.split(":")[1].strip() for line in f if ":" in line}
        rss = int(info.get("VmRSS", "0 kB").split()[0]) // 1024
        peak = int(info.get("VmHWM", "0 kB").split()[0]) // 1024
        return f"memory {rss} MB (peak {peak} MB of 512)"
    except Exception:
        return "memory n/a"


@api_router.get("/debug/memory")
async def debug_memory():
    """Open in a browser to see memory use without Render logs."""
    cache = _plant_machine_index_cache
    return {
        "memory": memory_mb(),
        "index_rows": len(cache["data"]) if cache["data"] is not None else None,
        "index_age_seconds": round(datetime.now(IST).timestamp() - cache["ts"]) if cache["ts"] else None,
        "sheet_last_row": cache.get("last_row"),
        "latest_motors": len(_latest_by_motor),
        "recent_cache_rows": len(readings_cache),
    }


@api_router.get("/debug/plant-machines")
async def debug_plant_machines(plant: str = "K"):
    """
    TEMPORARY DIAGNOSTIC ENDPOINT.
    Shows exactly what the index scan sees for a given plant, including
    the raw repr() of each machine value (reveals hidden whitespace or
    invisible characters that wouldn't show up in the Sheets UI), plus
    the row numbers and total index size, so we can pinpoint exactly
    why a specific machine isn't matching.
    """
    if not config_ready or not readings_sheet:
        return {"error": "Sheets not connected"}
    idx = await get_plant_machine_index()
    total_rows = len(idx)
    last_5_overall = idx[-5:] if idx else []
    matches_for_plant = [(p, m, r) for (p, m, r, _mo) in idx if p == plant]
    unique_machines = sorted(set(m for (p, m, r, _mo) in idx if p == plant))
    return {
        "total_indexed_rows": total_rows,
        "last_5_rows_in_index_overall": [{"plant": repr(p), "machine": repr(m), "row": r} for (p, m, r, _mo) in last_5_overall],
        "unique_machines_for_plant": [repr(m) for m in unique_machines],
        "matching_rows_for_plant": len(matches_for_plant),
        "sample_matches": [{"plant": repr(p), "machine": repr(m), "row": r} for (p, m, r) in matches_for_plant[:5]],
    }


@api_router.get("/debug/machine-fetch")
async def debug_machine_fetch(plant: str, machine: str, limit: int = 500):
    """
    TEMPORARY DIAGNOSTIC ENDPOINT.
    Walks through the exact same steps get_machine_data uses, but reports
    back what happens at EACH stage (row count found, ranges built, rows
    actually returned by batch_get) plus the full exception message/type
    if anything fails - instead of silently falling back like the real
    endpoint does. This is how we see errors without needing Render logs.
    """
    if not config_ready or not readings_sheet:
        return {"error": "Sheets not connected"}

    idx = await get_plant_machine_index()
    matching_rows = [row_num for (p, m, row_num, _mo) in idx if p == plant and m == machine]
    result = {"matching_rows_found": len(matching_rows)}
    if not matching_rows:
        result["note"] = "No rows matched this plant+machine in the index."
        return result

    if len(matching_rows) > limit:
        matching_rows = matching_rows[-limit:]
    result["rows_after_limit"] = len(matching_rows)
    result["first_few_row_numbers"] = matching_rows[:5]
    result["last_few_row_numbers"] = matching_rows[-5:]

    ranges_bounds = []
    start = prev = matching_rows[0]
    for r in matching_rows[1:]:
        if r == prev + 1:
            prev = r
            continue
        ranges_bounds.append((start, prev))
        start = prev = r
    ranges_bounds.append((start, prev))
    result["num_merged_ranges"] = len(ranges_bounds)
    result["sample_ranges"] = [f"A{s}:{LAST_COL}{e}" for (s, e) in ranges_bounds[:5]]

    try:
        CHUNK = 40
        total_rows_fetched = 0
        for i in range(0, len(ranges_bounds), CHUNK):
            chunk = ranges_bounds[i:i + CHUNK]
            ranges = [f"A{s}:{LAST_COL}{e}" for (s, e) in chunk]
            batch_results = readings_sheet.batch_get(ranges)
            for block in batch_results:
                if block:
                    total_rows_fetched += len(block)
        result["total_rows_fetched_successfully"] = total_rows_fetched
        result["status"] = "SUCCESS"
    except Exception as e:
        result["status"] = "FAILED"
        result["error_type"] = type(e).__name__
        result["error_message"] = str(e)

    return result


def _rows_to_dicts(row_blocks):
    """row_blocks: list of blocks from batch_get. Each block can now contain
    MULTIPLE rows (since we merge consecutive row numbers into one range),
    so iterate over every row in every block, not just the first."""
    data = []
    for block in row_blocks:
        if not block:
            continue
        for row_vals in block:
            d = {}
            for i, key in enumerate(FIELD_KEYS):
                val = row_vals[i] if i < len(row_vals) else ""
                if key in _BOOL_KEYS:
                    val = (val == "Yes")  # sheet stores these as "Yes"/"No" text
                d[key] = val
            data.append(d)
    return data


async def get_machine_history_targeted(plant: str, machine: str, limit: int = 500):
    """
    Returns the most recent `limit` readings for one machine, without
    loading the whole sheet or issuing one API call per row.

    A machine with thousands of historical readings (e.g. K1 with 3000+)
    would need 75+ individual batch_get calls if fetched one row at a
    time - that blows straight through Google's per-minute read quota
    and the whole request fails. Two fixes:
      1. Only fetch the most recent `limit` rows (row numbers are already
         in chronological/append order, so this is just the tail).
      2. Merge consecutive row numbers into single ranges - bulk-entry
         writes consecutive rows per machine, so e.g. 20 individual rows
         collapse into ONE range covering all 20, in one API call.
    """
    idx = await get_plant_machine_index()
    matching_rows = [row_num for (p, m, row_num, _mo) in idx if p == plant and m == machine]
    if not matching_rows:
        return []

    if len(matching_rows) > limit:
        matching_rows = matching_rows[-limit:]  # most recent (tail of the sheet)

    data = _fetch_rows(matching_rows)
    # safety: if rows were deleted/moved by hand since the index was built,
    # drop anything that is not this plant+machine and rebuild the index next time
    good = [d for d in data if d.get("plant") == plant and d.get("machine") == machine]
    if len(good) != len(data):
        _plant_machine_index_cache["data"] = None
    return good


@api_router.get("/condition-monitoring/machine/{plant}/{machine}")
async def get_machine_data(plant: str, machine: str, limit: int = 500):
    """
    Returns the most recent `limit` readings for one machine, reading
    only that machine's rows from the sheet (see get_machine_history_targeted)
    instead of the whole ~37k-row sheet or the 500-row global readings_cache.
    """
    if config_ready and readings_sheet:
        try:
            data = await get_machine_history_targeted(plant, machine, limit=limit)
        except Exception as e:
            logging.error(f"Targeted history fetch error for {plant}/{machine}: {e}")
            if not cache_loaded:
                await load_cache_from_sheets()
            data = [r for r in readings_cache if (r.get("Plant", r.get("plant", "")) == plant and r.get("Machine", r.get("machine", "")) == machine)]
    else:
        if not cache_loaded:
            await load_cache_from_sheets()
        data = [r for r in readings_cache if (r.get("Plant", r.get("plant", "")) == plant and r.get("Machine", r.get("machine", "")) == machine)]

    data.sort(key=lambda x: x.get("Timestamp", x.get("timestamp", "")), reverse=True)
    return data[:limit]

@api_router.get("/active-alarms")
async def get_active_alarms():
    if not cache_loaded:
        await load_cache_from_sheets()
    alarms = []
    for r in latest_docs():
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
    machines = {}
    for r in latest_docs():
        if r.get("Plant", r.get("plant", "")) != plant:
            continue
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
    plants = {}
    for r in latest_docs():
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
    return {"total_readings": len(readings_cache), "google_sheets_connected": config_ready, "cloudinary_connected": CLOUDINARY_ENABLED, "cache_loaded": cache_loaded, "latest_motors": len(_latest_by_motor), "memory": memory_mb()}

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
    logging.info(f"🚀 Condition Monitoring System started | {memory_mb()}")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
