# 📊 Google Sheets Auto-Sync Setup Guide

## Step 1: Create Your Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Click **+ Blank** to create new sheet
3. Name it: **"Neutral Glass - Condition Monitoring"**
4. In Row 1, add these headers:

   ```
   Timestamp | Plant | Machine | Motor | Current (A) | Temperature (°C) | I²t (A²s) | Normal Current | Warning Current | Normal Temp | Warning Temp | Normal I²t | Warning I²t | Status | Technician | Entry Source | Photo
   ```

5. **Copy the Sheet ID** from the URL:
   - URL looks like: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
   - Copy everything between `/d/` and `/edit`
   - Example: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

---

## Step 2: Create Service Account (Google Cloud)

1. **Go to Google Cloud Console:**
   👉 https://console.cloud.google.com

2. **Create a Project:**
   - Click **Select Project** (top bar)
   - Click **NEW PROJECT**
   - Name: `NeutralGlass`
   - Click **CREATE**
   - Wait for project to be created

3. **Enable Google Sheets API:**
   - In left menu → **APIs & Services** → **Library**
   - Search for: `Google Sheets API`
   - Click on it → Click **ENABLE**

4. **Create Service Account:**
   - In left menu → **APIs & Services** → **Credentials**
   - Click **+ CREATE CREDENTIALS** → **Service account**
   - Service account name: `sheets-sync`
   - Service account ID: `sheets-sync` (auto-filled)
   - Click **CREATE AND CONTINUE**
   - Skip "Grant this service account access" → Click **CONTINUE**
   - Skip "Grant users access" → Click **DONE**

5. **Download JSON Key:**
   - You'll see the service account in the list
   - Click on the service account email (looks like: `sheets-sync@neutralglass-xxx.iam.gserviceaccount.com`)
   - Go to **KEYS** tab
   - Click **ADD KEY** → **Create new key**
   - Choose **JSON**
   - Click **CREATE**
   - A JSON file will download → **SAVE THIS FILE!**

---

## Step 3: Share Sheet with Service Account

1. **Open the JSON file** you just downloaded
2. **Find the `client_email`** field:
   ```json
   {
     "client_email": "sheets-sync@neutralglass-xxx.iam.gserviceaccount.com",
     ...
   }
   ```
3. **Copy that email address**

4. **Go back to your Google Sheet**
5. Click **Share** button (top right)
6. **Paste the service account email**
7. Change permission to **Editor**
8. **Uncheck** "Notify people"
9. Click **Share** or **Send**

---

## Step 4: Add Credentials to System

**You'll need to provide me:**

1. **The JSON key file** (the one you downloaded)
   - Upload it here when ready

2. **Sheet ID** (from Step 1)
   - Example: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

---

## Step 5: I'll Configure & Test

Once you provide those 2 things, I will:
1. Add the credentials to the backend
2. Configure auto-sync
3. Test it works
4. Every submission → Automatically adds row to your Sheet!

---

## 📝 Summary - What You Need to Do:

✅ Create Google Sheet with headers
✅ Create Google Cloud project
✅ Enable Sheets API  
✅ Create Service Account
✅ Download JSON key
✅ Share Sheet with service account email
✅ Give me: JSON file + Sheet ID

**Take your time!** When ready, just share those 2 things and I'll set it up in 2 minutes! 🚀

---

## ❓ Need Help?

If you get stuck on any step, just tell me where and I'll guide you through it!
